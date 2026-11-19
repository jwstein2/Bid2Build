-- Sales Portal, Phase 3a: weekly automated lead import (a scheduled Claude agent posts found
-- contractor businesses to /api/sales/leads/import). Requires 20270107002000_sales_crm.sql. Safe to re-run.
--
-- Every import is a batch with counts. Leads arrive unassigned (source 'agent') for the owner to assign
-- in the Sales Hub. A business already on file, or on the do-not-contact list, is skipped, so a weekly
-- run never duplicates a lead or brings back someone who opted out.
--
-- The owner picks each run's target in the Hub (ZIP + trade, radius, how many leads). The agent reads it
-- before searching. Each lead carries the owner's name, the business start date, the public sources each
-- fact was checked against, and a short Haiku sales brief written by the server after import.

alter table public.sales_leads drop constraint if exists sales_leads_source_check;
alter table public.sales_leads add constraint sales_leads_source_check check (source in ('manual', 'import', 'places', 'link', 'owner', 'agent'));
alter table public.sales_leads add column if not exists import_batch_id uuid;
-- Business start date as published (state filing or license): 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'.
alter table public.sales_leads add column if not exists business_started text check (business_started is null or business_started ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$');
-- Where each fact was verified: { "owner_name": ["https://..."], "email": [...], "phone": [...], ... } plus checks.
alter table public.sales_leads add column if not exists verification jsonb;
alter table public.sales_leads add column if not exists sales_brief text check (sales_brief is null or char_length(sales_brief) <= 1200);
alter table public.sales_leads add column if not exists sales_brief_at timestamptz;

-- The weekly run's target, set by the owner in the Sales Hub.
alter table public.sales_settings add column if not exists lead_target_zip text check (lead_target_zip is null or lead_target_zip ~ '^[0-9]{5}$');
alter table public.sales_settings add column if not exists lead_target_trade text check (lead_target_trade is null or char_length(lead_target_trade) between 1 and 40);
alter table public.sales_settings add column if not exists lead_target_radius_miles integer not null default 50 check (lead_target_radius_miles between 5 and 250);
alter table public.sales_settings add column if not exists lead_target_count integer not null default 50 check (lead_target_count between 1 and 200);
alter table public.sales_settings add column if not exists lead_target_paused boolean not null default false;

create table if not exists public.sales_lead_batches (
  id uuid primary key default gen_random_uuid(),
  -- The sender's own id for the run; the same id twice is answered from the first run (safe retries).
  external_id text not null unique check (char_length(external_id) between 1 and 100),
  source text not null default 'agent' check (source in ('agent', 'owner')),
  label text check (label is null or char_length(label) <= 200),
  received integer not null default 0,
  added integer not null default 0,
  duplicates integer not null default 0,
  suppressed integer not null default 0,
  invalid integer not null default 0,
  -- Rows turned away before the database because a required fact was missing or failed a check.
  unverified integer not null default 0,
  target_zip text,
  target_trade text,
  created_at timestamptz not null default now()
);
alter table public.sales_lead_batches add column if not exists unverified integer not null default 0;
alter table public.sales_lead_batches add column if not exists target_zip text;
alter table public.sales_lead_batches add column if not exists target_trade text;

-- Businesses that must never be contacted again (opt-outs), by email, domain or phone key.
create table if not exists public.sales_suppressions (
  key text primary key check (key ~ '^(e|d|p):.+'),
  reason text not null default 'opted_out' check (reason in ('opted_out', 'bounced', 'complained', 'owner')),
  created_at timestamptz not null default now()
);

alter table public.sales_lead_batches enable row level security;
alter table public.sales_suppressions enable row level security;
revoke all on public.sales_lead_batches, public.sales_suppressions from public, anon, authenticated;
grant all on public.sales_lead_batches, public.sales_suppressions to service_role;

-- Suppression keys for a business: e:<email>, plus the domain and phone keys used for duplicates.
create or replace function public.sales_suppression_keys(p_email text, p_website text, p_phone text) returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[
    case when position('@' in coalesce(p_email, '')) > 1 then 'e:' || lower(btrim(p_email)) end
  ] || (select coalesce(array_agg(k), '{}') from unnest(public.sales_lead_keys(null, p_website, p_phone, null)) k where k like 'd:%' or k like 'p:%'), null)
$$;

-- Marking a lead "do not contact" also adds it to the suppression list, so it is never re-imported.
create or replace function public.sales_leads_suppress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.do_not_contact and not coalesce(old.do_not_contact, false) then
    insert into public.sales_suppressions (key, reason)
    select k, 'opted_out' from unnest(public.sales_suppression_keys(new.email, new.website, new.phone)) k
    on conflict (key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists sales_leads_suppress on public.sales_leads;
create trigger sales_leads_suppress after insert or update of do_not_contact on public.sales_leads for each row execute function public.sales_leads_suppress();

-- Import one batch (service role only: called by the authenticated import route). Returns counts and the
-- ids of the leads added (the route writes their sales briefs).
drop function if exists public.sales_import_batch(text, text, jsonb);
create or replace function public.sales_import_batch(p_external_id text, p_label text, p_rows jsonb, p_unverified integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.sales_lead_batches;
  st public.sales_settings;
  r jsonb;
  v_keys text[];
  v_zip text;
  v_trades text[];
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  if p_external_id is null or char_length(btrim(p_external_id)) = 0 then raise exception 'batch_id_required'; end if;
  select * into b from public.sales_lead_batches where external_id = btrim(p_external_id);
  if found then return to_jsonb(b) || jsonb_build_object('replayed', true, 'added_ids', '[]'::jsonb); end if;
  select * into st from public.sales_settings where id;
  insert into public.sales_lead_batches (external_id, source, label, received, unverified, target_zip, target_trade)
  values (btrim(p_external_id), 'agent', left(nullif(btrim(p_label), ''), 200), jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) + greatest(coalesce(p_unverified, 0), 0),
          greatest(coalesce(p_unverified, 0), 0), st.lead_target_zip, st.lead_target_trade)
  returning * into b;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_zip := substring(coalesce(r->>'zip', '') from '^\s*([0-9]{5})');
    if char_length(btrim(coalesce(r->>'company_name', ''))) = 0 or (coalesce(r->>'email', '') = '' and coalesce(r->>'phone', '') = '' and coalesce(r->>'website', '') = '') then
      update public.sales_lead_batches set invalid = invalid + 1 where id = b.id; continue;
    end if;
    if exists (select 1 from public.sales_suppressions s where s.key = any (public.sales_suppression_keys(r->>'email', r->>'website', r->>'phone'))) then
      update public.sales_lead_batches set suppressed = suppressed + 1 where id = b.id; continue;
    end if;
    v_keys := public.sales_lead_keys(r->>'company_name', r->>'website', r->>'phone', v_zip);
    if exists (select 1 from public.sales_leads l where l.dedupe_keys && v_keys) then
      update public.sales_lead_batches set duplicates = duplicates + 1 where id = b.id; continue;
    end if;
    v_trades := coalesce((select array_agg(distinct lower(btrim(x))) from jsonb_array_elements_text(case when jsonb_typeof(r->'trades') = 'array' then r->'trades' else '[]'::jsonb end) x where char_length(btrim(x)) between 1 and 40), '{}');
    insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, source_ref, notes, dedupe_keys, import_batch_id,
                                    business_started, verification)
    values (left(btrim(r->>'company_name'), 200), left(nullif(btrim(r->>'contact_name'), ''), 120),
            case when position('@' in coalesce(r->>'email', '')) > 1 then left(lower(btrim(r->>'email')), 320) end,
            left(nullif(btrim(r->>'phone'), ''), 40), left(nullif(btrim(r->>'website'), ''), 300),
            left(nullif(btrim(r->>'city'), ''), 100), left(nullif(btrim(r->>'state'), ''), 40), v_zip, v_trades, 'agent',
            left(nullif(btrim(r->>'source_url'), ''), 300), left(nullif(btrim(r->>'notes'), ''), 4000), v_keys, b.id,
            case when coalesce(r->>'business_started', '') ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then r->>'business_started' end,
            case when jsonb_typeof(r->'verification') = 'object' then r->'verification' end)
    returning id into v_id;
    v_ids := v_ids || v_id;
    update public.sales_lead_batches set added = added + 1 where id = b.id;
  end loop;
  select * into b from public.sales_lead_batches where id = b.id;
  return to_jsonb(b) || jsonb_build_object('replayed', false, 'added_ids', to_jsonb(v_ids));
end $$;

-- The weekly run's target, for the agent (service role only, via the import route).
create or replace function public.sales_import_target() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('zip', lead_target_zip, 'trade', lead_target_trade, 'radius_miles', lead_target_radius_miles,
                            'count', lead_target_count, 'paused', lead_target_paused or lead_target_zip is null)
  from public.sales_settings where id
$$;

-- Owner sets the target in the Sales Hub.
create or replace function public.admin_sales_import_target_save(p_caller uuid, p_zip text, p_trade text, p_radius integer, p_count integer, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_zip text := substring(coalesce(p_zip, '') from '^\s*([0-9]{5})\s*$');
begin
  perform public.sales_require_admin(p_caller);
  if v_zip is null then raise exception 'invalid_zip'; end if;
  insert into public.sales_settings (id) values (true) on conflict (id) do nothing;
  update public.sales_settings set lead_target_zip = v_zip, lead_target_trade = left(nullif(lower(btrim(p_trade)), ''), 40),
    lead_target_radius_miles = least(greatest(coalesce(p_radius, 50), 5), 250), lead_target_count = least(greatest(coalesce(p_count, 50), 1), 200),
    lead_target_paused = coalesce(p_paused, false), updated_at = now(), updated_by = p_caller
  where id;
  perform public.sales_audit(p_caller, 'sales.lead_target_set', 'sales_settings', null, jsonb_build_object('zip', v_zip, 'trade', p_trade, 'radius', p_radius, 'count', p_count, 'paused', p_paused));
  return public.sales_import_target();
end $$;

-- Leads still waiting for a sales brief (service role: the import route and the daily job fill these).
create or replace function public.sales_leads_missing_brief(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select id, company_name, contact_name, city, state, zip, trades, business_started, website, notes
    from public.sales_leads where source = 'agent' and sales_brief is null and not do_not_contact
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x
$$;

create or replace function public.sales_lead_brief_set(p_lead uuid, p_brief text) returns void
language sql security definer set search_path = public as $$
  update public.sales_leads set sales_brief = left(btrim(p_brief), 1200), sales_brief_at = now(), updated_at = now()
  where id = p_lead and nullif(btrim(p_brief), '') is not null
$$;

create or replace function public.admin_sales_import_batches(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return jsonb_build_object(
    'batches', coalesce((select jsonb_agg(to_jsonb(b) - 'external_id' order by b.created_at desc) from (select * from public.sales_lead_batches order by created_at desc limit 26) b), '[]'::jsonb),
    'unassigned_agent', (select count(*) from public.sales_leads where source = 'agent' and assigned_rep is null),
    'target', public.sales_import_target(),
    'zips', coalesce((select jsonb_agg(jsonb_build_object('zip', zip, 'leads', n) order by n desc, zip) from (
       select zip, count(*) n from public.sales_leads where zip is not null group by zip order by count(*) desc limit 40) z), '[]'::jsonb),
    'suppressed', (select count(*) from public.sales_suppressions)
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.sales_suppression_keys(text, text, text)', 'public.sales_leads_suppress()', 'public.sales_import_batch(text, text, jsonb, integer)', 'public.admin_sales_import_batches(uuid)',
                               'public.sales_import_target()', 'public.admin_sales_import_target_save(uuid, text, text, integer, integer, boolean)',
                               'public.sales_leads_missing_brief(integer)', 'public.sales_lead_brief_set(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
