-- Rollback for 20270121001000_sales_v86_leads.sql. Restores the earlier import, assign and invite functions,
-- removes allocation, dedupe review, offboarding records and rep notices. Leads, activities, assignments made
-- and reps' statuses stay as they are (removed reps stay removed).
drop trigger if exists sales_leads_assign_after on public.sales_leads;
drop trigger if exists sales_leads_assign_before on public.sales_leads;
drop trigger if exists sales_leads_keys_v2 on public.sales_leads;
drop function if exists public.sales_lead_keys_v2(text, text, text, text, text);
drop function if exists public.sales_leads_keys_trg();
drop function if exists public.sales_lead_match(text[], text, text, text, uuid);
drop function if exists public.sales_assign_ctx(text, uuid, text, uuid, text);
drop function if exists public.sales_leads_assign_before();
drop function if exists public.sales_leads_assign_after();
drop function if exists public.sales_rep_auto_default(public.sales_reps);
drop function if exists public.sales_rep_auto_eligible(public.sales_reps, text, text[], timestamptz);
drop function if exists public.sales_allocate_pick(text, text[], uuid[], text, timestamptz);
drop function if exists public.sales_allocate_lead(uuid, uuid, uuid, uuid[], text, text);
drop function if exists public.sales_notify_assigned(jsonb, text, text);
drop function if exists public.sales_lead_ingest(uuid, integer, jsonb, text, text, uuid, text, uuid);
drop function if exists public.sales_ingest_rows(uuid, jsonb, text, text, uuid, text, uuid);
drop function if exists public.admin_sales_lead_import(uuid, jsonb, text, uuid, text);
drop function if exists public.admin_sales_leads(uuid, jsonb, integer, integer);
drop function if exists public.admin_sales_lead_detail(uuid, uuid);
drop function if exists public.sales_assign_warnings(uuid[], uuid);
drop function if exists public.admin_sales_leads_assign(uuid, uuid[], text, uuid, text, boolean);
drop function if exists public.admin_sales_leads_hold(uuid, uuid[], text, text);
drop function if exists public.sales_allocate_queue(uuid);
drop function if exists public.admin_sales_allocate_queue(uuid);
drop function if exists public.admin_sales_possible_dups(uuid);
drop function if exists public.admin_sales_possible_dup_decide(uuid, bigint, text, uuid);
drop function if exists public.admin_sales_batch_allocations(uuid);
drop function if exists public.admin_sales_lead_activity_add(uuid, uuid, text, text, text);
drop function if exists public.admin_sales_lead_task(uuid, uuid, text, timestamptz);
drop function if exists public.admin_sales_invite_resend(uuid, uuid, text);
drop function if exists public.admin_sales_invite_sent(uuid, uuid, boolean, text, text);
drop function if exists public.admin_sales_invite_revoke(uuid, uuid);
drop function if exists public.sales_invite_delivery(text, text);
drop function if exists public.sales_manage_guard(uuid, public.sales_reps);
drop function if exists public.admin_sales_rep_allocation_save(uuid, uuid, boolean, text, text, text[], text[]);
drop function if exists public.sales_sign_out_user(uuid);
drop function if exists public.admin_sales_rep_access(uuid, uuid, text, text, boolean);
drop function if exists public.sales_rep_open_work(uuid);
drop function if exists public.admin_sales_offboarding_start(uuid, uuid, jsonb);
drop function if exists public.admin_sales_offboarding_update(uuid, uuid, jsonb);
drop function if exists public.admin_sales_rep_leads_reassign(uuid, uuid, text[], text, uuid);
drop function if exists public.admin_sales_offboarding_complete(uuid, uuid, boolean);
drop function if exists public.admin_sales_offboarding_cancel(uuid, uuid, text);
drop function if exists public.admin_sales_rep_reactivate(uuid, uuid, text, boolean);
drop function if exists public.admin_sales_rep_manage(uuid, uuid);
drop function if exists public.sales_crm_import(jsonb, text);
drop function if exists public.sales_crm_activity_log(uuid, text, text, text);
drop function if exists public.sales_my_notices();
drop function if exists public.sales_disposition_ok(text, text);

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

create or replace function public.admin_sales_crm_import(p_caller uuid, p_rows jsonb, p_rep uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_keys text[]; added integer := 0; skipped integer := 0;
begin
  perform public.sales_require_admin(p_caller);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    continue when char_length(btrim(coalesce(r->>'company_name', ''))) = 0;
    v_keys := public.sales_lead_keys(r->>'company_name', r->>'website', r->>'phone', r->>'zip');
    if exists (select 1 from public.sales_leads l where l.dedupe_keys && v_keys) then skipped := skipped + 1; continue; end if;
    insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, assigned_rep, dedupe_keys, created_by)
    values (left(btrim(r->>'company_name'), 200), nullif(btrim(r->>'contact_name'), ''), nullif(lower(btrim(r->>'email')), ''), nullif(left(btrim(r->>'phone'), 40), ''),
            nullif(left(btrim(r->>'website'), 300), ''), nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'state'), ''),
            case when r->>'zip' ~ '^[0-9]{5}$' then r->>'zip' end,
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'trades', '[]'::jsonb)) x), '{}'), 'owner', p_rep, v_keys, p_caller);
    added := added + 1;
  end loop;
  perform public.sales_audit(p_caller, 'sales.leads_imported', 'sales_rep', coalesce(p_rep::text, 'none'), jsonb_build_object('added', added, 'skipped', skipped));
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

create or replace function public.admin_sales_crm_assign(p_caller uuid, p_leads uuid[], p_rep uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; rep_name text;
begin
  perform public.sales_require_admin(p_caller);
  if p_rep is not null then
    select full_name into rep_name from public.sales_reps where id = p_rep and status in ('active', 'invited');
    if rep_name is null then raise exception 'rep_not_found'; end if;
  end if;
  update public.sales_leads set assigned_rep = p_rep, updated_at = now() where id = any (p_leads) and assigned_rep is distinct from p_rep;
  get diagnostics n = row_count;
  insert into public.sales_activities (lead_id, actor_id, kind, body)
  select id, p_caller, 'assignment', coalesce('Assigned to ' || rep_name, 'Unassigned') from public.sales_leads where id = any (p_leads);
  perform public.sales_audit(p_caller, 'sales.leads_assigned', 'sales_rep', coalesce(p_rep::text, 'none'), jsonb_build_object('count', n));
  return n;
end $$;

create or replace function public.admin_sales_invite_create(p_caller uuid, p_rep uuid, p_token_hash text, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; inv public.sales_rep_invites;
begin
  perform public.sales_require_admin(p_caller);
  select * into rep from public.sales_reps where id = p_rep;
  if not found or rep.status = 'removed' then raise exception 'rep_not_found'; end if;
  if rep.user_id is not null then raise exception 'already_joined'; end if;
  update public.sales_rep_invites set revoked_at = now() where rep_id = p_rep and revoked_at is null and accepted_at is null;
  insert into public.sales_rep_invites (rep_id, token_hash, expires_at, created_by)
  values (p_rep, lower(p_token_hash), now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 30)), p_caller)
  returning * into inv;
  perform public.sales_audit(p_caller, 'sales.invite_created', 'sales_rep', p_rep::text, jsonb_build_object('expires_at', inv.expires_at));
  return jsonb_build_object('id', inv.id, 'expires_at', inv.expires_at, 'email', rep.email, 'full_name', rep.full_name);
end $$;

create or replace function public.admin_sales_invites(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_object_agg(i.rep_id, jsonb_build_object('created_at', i.created_at, 'expires_at', i.expires_at, 'opened_at', i.opened_at,
      'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at))
    from (select distinct on (rep_id) * from public.sales_rep_invites order by rep_id, created_at desc) i), '{}'::jsonb);
end $$;

revoke execute on function public.sales_import_batch(text, text, jsonb, integer), public.admin_sales_crm_import(uuid, jsonb, uuid),
  public.admin_sales_crm_assign(uuid, uuid[], uuid), public.admin_sales_invite_create(uuid, uuid, text, integer), public.admin_sales_invites(uuid) from public, anon, authenticated;
grant execute on function public.sales_import_batch(text, text, jsonb, integer), public.admin_sales_crm_import(uuid, jsonb, uuid),
  public.admin_sales_crm_assign(uuid, uuid[], uuid), public.admin_sales_invite_create(uuid, uuid, text, integer), public.admin_sales_invites(uuid) to service_role;

update public.sales_leads set dedupe_keys = public.sales_lead_keys(company_name, website, phone, zip);
drop table if exists public.sales_rep_notices;
drop table if exists public.sales_rep_offboardings;
drop table if exists public.sales_lead_import_rows;
drop table if exists public.sales_lead_assignments;
alter table public.sales_lead_batches drop column if exists created_by, drop column if exists held, drop column if exists allocated,
  drop column if exists existing_customers, drop column if exists possible;
alter table public.sales_lead_batches drop constraint if exists sales_lead_batches_source_check;
alter table public.sales_lead_batches add constraint sales_lead_batches_source_check check (source in ('agent', 'owner', 'admin', 'rep'));
alter table public.sales_rep_invites drop constraint if exists sales_rep_invites_delivery;
alter table public.sales_rep_invites drop column if exists last_error, drop column if exists provider_message_id, drop column if exists delivery_status,
  drop column if exists send_count, drop column if exists sent_at, drop column if exists email;
alter table public.sales_activities drop constraint if exists sales_activities_evidence;
alter table public.sales_activities drop column if exists evidence, drop column if exists actor_label, drop column if exists disposition;
alter table public.sales_leads drop constraint if exists sales_leads_hold;
alter table public.sales_leads drop constraint if exists sales_leads_origin;
drop index if exists public.sales_leads_queue;
alter table public.sales_leads drop column if exists hold_note, drop column if exists hold_reason, drop column if exists lead_origin, drop column if exists assigned_at;
alter table public.sales_reps drop column if exists reactivated_by, drop column if exists reactivated_at, drop column if exists last_allocated_at,
  drop column if exists lead_trades, drop column if exists lead_states, drop column if exists auto_leads, drop column if exists allocation_note,
  drop column if exists allocation_paused_at, drop column if exists allocation_paused;
