-- Sales Hub V8.6: lead allocation, master CRM dedupe, admin lead work, rep invitations, rep lifecycle,
-- structured offboarding and reactivation. Additive; safe to run more than once.
-- Requires the earlier sales migrations, including 20270118001000 (calendar) and 20270119002000 (compliance).
--
--   * One lead record per business. Ownership changes are rows in sales_lead_assignments, never copies.
--   * New company leads are shared out by least-recently-assigned round robin under a lock. Admin-only
--     members, dual-role admins (unless they opt in), paused, suspended, offboarding, offboarded,
--     not-yet-signed-in reps and reps on time off are skipped. Reps' own leads stay with them.
--   * Lead owner, activity actor and commission beneficiary are separate. Nothing here changes
--     sales_attributions or sales_commissions.
--   * Offboarding ends with status 'removed', so the "earned sales only" rule (removed_at) applies.
--     Earned commission, statements, payouts and agreements are kept; nothing is forfeited.

-- ---------------------------------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_reps add column if not exists allocation_paused boolean not null default false;
alter table public.sales_reps add column if not exists allocation_paused_at timestamptz;
alter table public.sales_reps add column if not exists allocation_note text check (allocation_note is null or char_length(allocation_note) <= 300);
-- null = by role (plain reps yes; Sales Administrators and the platform owner no).
alter table public.sales_reps add column if not exists auto_leads boolean;
-- Empty = anywhere / any trade.
alter table public.sales_reps add column if not exists lead_states text[] not null default '{}';
alter table public.sales_reps add column if not exists lead_trades text[] not null default '{}';
alter table public.sales_reps add column if not exists last_allocated_at timestamptz;
alter table public.sales_reps add column if not exists reactivated_at timestamptz;
alter table public.sales_reps add column if not exists reactivated_by uuid references auth.users (id) on delete set null;

alter table public.sales_leads add column if not exists assigned_at timestamptz;
alter table public.sales_leads add column if not exists lead_origin text not null default 'company';
alter table public.sales_leads add column if not exists hold_reason text;
alter table public.sales_leads add column if not exists hold_note text check (hold_note is null or char_length(hold_note) <= 300);
do $$ begin
  alter table public.sales_leads add constraint sales_leads_origin check (lead_origin in ('company', 'rep_sourced', 'referral', 'customer', 'historical'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sales_leads add constraint sales_leads_hold check (hold_reason is null or hold_reason in
    ('no_eligible_rep', 'possible_duplicate', 'validation', 'admin_hold', 'needs_classification', 'manual', 'existing_customer'));
exception when duplicate_object then null; end $$;
create index if not exists sales_leads_queue on public.sales_leads (hold_reason) where assigned_rep is null;

update public.sales_leads set lead_origin = case source when 'manual' then 'rep_sourced' when 'link' then 'referral' else 'company' end
where lead_origin = 'company' and source in ('manual', 'link');
update public.sales_leads set assigned_at = coalesce(assigned_at, updated_at) where assigned_rep is not null and assigned_at is null;

alter table public.sales_activities add column if not exists disposition text check (disposition is null or char_length(disposition) <= 40);
alter table public.sales_activities add column if not exists actor_label text check (actor_label is null or char_length(actor_label) <= 120);
-- manual = typed in by a person; provider = a delivery event from the email provider; system = the app.
alter table public.sales_activities add column if not exists evidence text not null default 'manual';
do $$ begin
  alter table public.sales_activities add constraint sales_activities_evidence check (evidence in ('manual', 'provider', 'system'));
exception when duplicate_object then null; end $$;
alter table public.sales_activities drop constraint if exists sales_activities_kind_check;
alter table public.sales_activities add constraint sales_activities_kind_check
  check (kind in ('call', 'email', 'text', 'meeting', 'note', 'stage', 'assignment', 'system', 'reply'));

alter table public.sales_rep_invites add column if not exists email text;
alter table public.sales_rep_invites add column if not exists sent_at timestamptz;
alter table public.sales_rep_invites add column if not exists send_count integer not null default 0;
alter table public.sales_rep_invites add column if not exists delivery_status text not null default 'not_sent';
alter table public.sales_rep_invites add column if not exists provider_message_id text;
alter table public.sales_rep_invites add column if not exists last_error text check (last_error is null or char_length(last_error) <= 300);
do $$ begin
  -- accepted = the provider took it (not proof of delivery); delivered/bounced only come from provider events.
  alter table public.sales_rep_invites add constraint sales_rep_invites_delivery check (delivery_status in ('not_sent', 'queued', 'accepted', 'delivered', 'bounced', 'failed'));
exception when duplicate_object then null; end $$;
create index if not exists sales_rep_invites_msg on public.sales_rep_invites (provider_message_id) where provider_message_id is not null;

alter table public.sales_lead_batches drop constraint if exists sales_lead_batches_source_check;
alter table public.sales_lead_batches add constraint sales_lead_batches_source_check check (source in ('agent', 'owner', 'admin', 'rep'));
alter table public.sales_lead_batches add column if not exists possible integer not null default 0;
alter table public.sales_lead_batches add column if not exists existing_customers integer not null default 0;
alter table public.sales_lead_batches add column if not exists allocated integer not null default 0;
alter table public.sales_lead_batches add column if not exists held integer not null default 0;
alter table public.sales_lead_batches add column if not exists created_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_lead_assignments (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  rep_id uuid references public.sales_reps (id) on delete set null,
  previous_rep_id uuid references public.sales_reps (id) on delete set null,
  method text not null check (method in ('auto', 'manual', 'bulk', 'self', 'unassign', 'offboarding', 'rep_sourced', 'import', 'recycle', 'merge', 'legacy')),
  reason text check (reason is null or char_length(reason) <= 300),
  batch_id uuid references public.sales_lead_batches (id) on delete set null,
  algorithm text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason is null or char_length(end_reason) <= 60)
);
create index if not exists sales_lead_assignments_lead on public.sales_lead_assignments (lead_id, created_at desc);
create index if not exists sales_lead_assignments_rep on public.sales_lead_assignments (rep_id, created_at desc);
create index if not exists sales_lead_assignments_batch on public.sales_lead_assignments (batch_id) where batch_id is not null;

create table if not exists public.sales_lead_import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.sales_lead_batches (id) on delete cascade,
  row_no integer not null,
  company_name text,
  outcome text not null check (outcome in ('added', 'duplicate', 'possible_duplicate', 'suppressed', 'invalid', 'existing_customer')),
  lead_id uuid references public.sales_leads (id) on delete set null,
  candidates uuid[] not null default '{}',
  signals text[] not null default '{}',
  -- Kept only for possible duplicates awaiting a decision (cleared once decided).
  raw jsonb,
  decision text check (decision is null or decision in ('pending', 'merged', 'skipped', 'created')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sales_lead_import_rows_batch on public.sales_lead_import_rows (batch_id, row_no);
create index if not exists sales_lead_import_rows_pending on public.sales_lead_import_rows (decision) where decision = 'pending';
create index if not exists sales_lead_import_rows_lead on public.sales_lead_import_rows (lead_id) where lead_id is not null;

create table if not exists public.sales_rep_offboardings (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'canceled')),
  effective_date date not null,
  reason_category text not null check (reason_category in ('voluntary', 'contract_expired', 'inactivity', 'performance', 'policy_violation', 'restructuring', 'admin_error', 'other')),
  -- Visible to sales administrators and the owner only. No health, family or protected-class details.
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 4000),
  access_end text not null default 'on_completion' check (access_end in ('now', 'on_completion')),
  lead_plan text not null default 'equal' check (lead_plan in ('equal', 'rep', 'trade', 'territory', 'manual')),
  meetings_note text check (meetings_note is null or char_length(meetings_note) <= 1000),
  commission_review text not null default 'pending' check (commission_review in ('pending', 'reviewed')),
  reward_review text not null default 'pending' check (reward_review in ('pending', 'reviewed')),
  agreement_status text not null default 'unknown' check (agreement_status in ('unknown', 'on_file', 'not_applicable', 'missing')),
  final_payout_review text not null default 'pending' check (final_payout_review in ('pending', 'scheduled', 'not_needed')),
  tax_retention text not null default 'pending' check (tax_retention in ('pending', 'retained', 'not_applicable')),
  snapshot jsonb not null default '{}'::jsonb,
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  canceled_reason text check (canceled_reason is null or char_length(canceled_reason) <= 300),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_rep_offboardings_open on public.sales_rep_offboardings (rep_id) where status = 'in_progress';

-- In-app notices for a rep (new leads assigned, leads moved away). Read only through sales_my_notices.
create table if not exists public.sales_rep_notices (
  id bigint generated always as identity primary key,
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  kind text not null check (kind in ('leads_assigned', 'leads_moved', 'recycle_warning', 'leads_recycled', 'info')),
  body text not null check (char_length(body) between 1 and 500),
  lead_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists sales_rep_notices_rep on public.sales_rep_notices (rep_id, read_at, created_at desc);

alter table public.sales_lead_assignments enable row level security;
alter table public.sales_lead_import_rows enable row level security;
alter table public.sales_rep_offboardings enable row level security;
alter table public.sales_rep_notices enable row level security;
revoke all on public.sales_lead_assignments, public.sales_lead_import_rows, public.sales_rep_offboardings, public.sales_rep_notices from public, anon, authenticated;
grant all on public.sales_lead_assignments, public.sales_lead_import_rows, public.sales_rep_offboardings, public.sales_rep_notices to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 3. Identity keys v2: adds e:<email>; profile hosts (Facebook, Yelp...) never count as a website match
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_lead_keys_v2(p_name text, p_website text, p_phone text, p_zip text, p_email text) returns text[]
language sql immutable set search_path = public as $$
  select array_remove(
    (select coalesce(array_agg(k), '{}') from unnest(public.sales_lead_keys(p_name, p_website, p_phone, p_zip)) k
     where not (k ~ '^d:([a-z0-9-]+\.)*(facebook|fb|instagram|yelp|google|linkedin|nextdoor|houzz|angi|angieslist|homeadvisor|thumbtack|bbb|linktr|twitter|x|youtube|tiktok|wixsite|godaddysites|business)\.(com|org|me|ee|site)$'
                or k ~ '^d:(sites\.google\.com|g\.page|maps\.app\.goo\.gl)$'))
    || array[case when position('@' in coalesce(p_email, '')) > 1 then 'e:' || lower(btrim(p_email)) end], null)
$$;

create or replace function public.sales_leads_keys_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  new.dedupe_keys := public.sales_lead_keys_v2(new.company_name, new.website, new.phone, new.zip, new.email);
  if tg_op = 'INSERT' and new.lead_origin = 'company' and new.source in ('manual', 'link') then
    new.lead_origin := case new.source when 'manual' then 'rep_sourced' else 'referral' end;
  end if;
  return new;
end $$;
drop trigger if exists sales_leads_keys_v2 on public.sales_leads;
create trigger sales_leads_keys_v2 before insert or update on public.sales_leads for each row execute function public.sales_leads_keys_trg();
update public.sales_leads set dedupe_keys = dedupe_keys;

-- How sure are we this is a business already on file? high = same domain, email or phone (exact keys);
-- possible = same name in the same ZIP, or the same name in the same city and state. Name alone never
-- counts as high.
create or replace function public.sales_lead_match(p_keys text[], p_name text, p_city text, p_state text, p_except uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_strong text[]; v_hit uuid; v_sig text[]; v_cands uuid[]; v_norm text;
begin
  v_strong := (select coalesce(array_agg(k), '{}') from unnest(coalesce(p_keys, '{}')) k where k ~ '^(d|e|p):');
  if cardinality(v_strong) > 0 then
    select l.id, (select array_agg(distinct split_part(k, ':', 1)) from unnest(l.dedupe_keys) k where k = any (v_strong))
      into v_hit, v_sig
    from public.sales_leads l where l.dedupe_keys && v_strong and (p_except is null or l.id <> p_except)
    order by (l.customer_user_id is not null) desc, l.created_at limit 1;
    if v_hit is not null then
      return jsonb_build_object('level', 'high', 'lead_id', v_hit, 'signals', to_jsonb(v_sig));
    end if;
  end if;
  v_norm := regexp_replace(regexp_replace(lower(coalesce(p_name, '')), '\m(llc|inc|co|corp|company|ltd)\M', '', 'g'), '[^a-z0-9]', '', 'g');
  select array_agg(id) into v_cands from (
    select l.id from public.sales_leads l
    where (p_except is null or l.id <> p_except) and (
      l.dedupe_keys && (select coalesce(array_agg(k), '{}') from unnest(coalesce(p_keys, '{}')) k where k like 'n:%')
      or (char_length(v_norm) >= 4 and nullif(btrim(p_city), '') is not null
          and regexp_replace(regexp_replace(lower(l.company_name), '\m(llc|inc|co|corp|company|ltd)\M', '', 'g'), '[^a-z0-9]', '', 'g') = v_norm
          and lower(btrim(coalesce(l.city, ''))) = lower(btrim(p_city)) and upper(btrim(coalesce(l.state, ''))) = upper(btrim(coalesce(p_state, '')))))
    order by l.created_at limit 5) x;
  if v_cands is not null then
    return jsonb_build_object('level', 'possible', 'candidates', to_jsonb(v_cands), 'signals', '["name_location"]'::jsonb);
  end if;
  return jsonb_build_object('level', 'none');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Assignment history: every change of sales_leads.assigned_rep, from any function, is recorded
-- ---------------------------------------------------------------------------------------------------
-- Callers describe the change with set_config('sales.assign_ctx', '{"method":...,"actor":...}', true).
create or replace function public.sales_assign_ctx(p_method text, p_actor uuid, p_reason text default null, p_batch uuid default null, p_algorithm text default null) returns void
language plpgsql set search_path = public as $$
begin
  perform set_config('sales.assign_ctx', jsonb_build_object('method', p_method, 'actor', p_actor, 'reason', p_reason, 'batch', p_batch, 'algorithm', p_algorithm)::text, true);
end $$;

create or replace function public.sales_leads_assign_before() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.assigned_rep is not null then new.assigned_at := coalesce(new.assigned_at, now()); new.hold_reason := null; end if;
  elsif new.assigned_rep is distinct from old.assigned_rep then
    new.assigned_at := case when new.assigned_rep is null then null else now() end;
    if new.assigned_rep is not null then new.hold_reason := null; new.hold_note := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists sales_leads_assign_before on public.sales_leads;
create trigger sales_leads_assign_before before insert or update of assigned_rep on public.sales_leads for each row execute function public.sales_leads_assign_before();

create or replace function public.sales_leads_assign_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare ctx jsonb := nullif(current_setting('sales.assign_ctx', true), '')::jsonb; v_method text; v_prev uuid;
begin
  v_prev := case when tg_op = 'UPDATE' then old.assigned_rep end;
  if tg_op = 'INSERT' and new.assigned_rep is null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_rep is not distinct from old.assigned_rep then return new; end if;
  v_method := coalesce(ctx->>'method', case when tg_op = 'INSERT' and new.lead_origin = 'rep_sourced' then 'rep_sourced' when tg_op = 'INSERT' then 'import' else 'legacy' end);
  if v_method not in ('auto', 'manual', 'bulk', 'self', 'unassign', 'offboarding', 'rep_sourced', 'import', 'recycle', 'merge', 'legacy') then v_method := 'legacy'; end if;
  update public.sales_lead_assignments set ended_at = now(), end_reason = left(v_method, 60) where lead_id = new.id and ended_at is null;
  insert into public.sales_lead_assignments (lead_id, rep_id, previous_rep_id, method, reason, batch_id, algorithm, actor_id)
  values (new.id, new.assigned_rep, v_prev, v_method, left(ctx->>'reason', 300), nullif(ctx->>'batch', '')::uuid, ctx->>'algorithm',
          coalesce(nullif(ctx->>'actor', '')::uuid, auth.uid()));
  -- Open follow-ups travel with the lead so the new owner sees them. Done ones stay as history.
  if tg_op = 'UPDATE' and new.assigned_rep is not null then
    update public.sales_tasks set rep_id = new.assigned_rep where lead_id = new.id and done_at is null and rep_id is distinct from new.assigned_rep;
  end if;
  return new;
end $$;
drop trigger if exists sales_leads_assign_after on public.sales_leads;
create trigger sales_leads_assign_after after insert or update of assigned_rep on public.sales_leads for each row
  when (pg_trigger_depth() < 2) execute function public.sales_leads_assign_after();

-- ---------------------------------------------------------------------------------------------------
-- 5. Allocation
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_rep_auto_default(r public.sales_reps) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(r.auto_leads, r.role <> 'admin' and not coalesce(public.is_admin(r.user_id), false))
$$;

-- Can this rep take a new company lead automatically right now?
create or replace function public.sales_rep_auto_eligible(r public.sales_reps, p_state text, p_trades text[], p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = public as $$
  select r.status = 'active' and r.user_id is not null and r.sells and not r.allocation_paused
    and public.sales_rep_auto_default(r)
    and not exists (select 1 from public.sales_rep_offboardings o where o.rep_id = r.id and o.status = 'in_progress')
    and not exists (select 1 from public.sales_time_off t where t.rep_id = r.id and t.status = 'active' and p_at >= t.starts_at and p_at < t.ends_at)
    and (cardinality(r.lead_states) = 0 or upper(btrim(coalesce(p_state, ''))) = any (r.lead_states))
    and (cardinality(r.lead_trades) = 0 or r.lead_trades && coalesce(p_trades, '{}'))
$$;

-- Least recently assigned eligible rep (ties: who joined first, then id). Takes the allocation lock, so
-- two imports at once queue up instead of handing out the same turn twice. p_mode 'trade'/'territory'
-- requires a rep whose trade or state list actually matches.
create or replace function public.sales_allocate_pick(p_state text, p_trades text[], p_exclude uuid[] default '{}', p_mode text default 'equal', p_at timestamptz default now()) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_rep uuid;
begin
  perform pg_advisory_xact_lock(hashtext('sales_lead_allocation'));
  select r.id into v_rep from public.sales_reps r
  where public.sales_rep_auto_eligible(r, p_state, p_trades, p_at) and not (r.id = any (coalesce(p_exclude, '{}')))
    and (p_mode <> 'trade' or (cardinality(r.lead_trades) > 0 and r.lead_trades && coalesce(p_trades, '{}')))
    and (p_mode <> 'territory' or (cardinality(r.lead_states) > 0 and upper(btrim(coalesce(p_state, ''))) = any (r.lead_states)))
  order by r.last_allocated_at nulls first, r.created_at, r.id
  limit 1 for update;
  if v_rep is not null then update public.sales_reps set last_allocated_at = clock_timestamp() where id = v_rep; end if;
  return v_rep;
end $$;

-- Give one unassigned lead to the next rep in turn, or hold it as "no eligible rep".
create or replace function public.sales_allocate_lead(p_lead uuid, p_actor uuid, p_batch uuid default null, p_exclude uuid[] default '{}', p_mode text default 'equal', p_method text default 'auto') returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.sales_leads; v_rep uuid;
begin
  select * into l from public.sales_leads where id = p_lead for update;
  if not found then return null; end if;
  v_rep := public.sales_allocate_pick(l.state, l.trades, p_exclude, p_mode);
  if v_rep is null then
    update public.sales_leads set assigned_rep = null, hold_reason = 'no_eligible_rep', updated_at = now() where id = p_lead;
    return null;
  end if;
  perform public.sales_assign_ctx(p_method, p_actor, null, p_batch, 'rr-lra-1');
  update public.sales_leads set assigned_rep = v_rep, updated_at = now() where id = p_lead;
  insert into public.sales_activities (lead_id, actor_id, kind, body, evidence)
  values (p_lead, p_actor, 'assignment', 'Assigned to ' || (select full_name from public.sales_reps where id = v_rep) || ' (automatic, round robin)', 'system');
  return v_rep;
end $$;

create or replace function public.sales_notify_assigned(p_counts jsonb, p_kind text default 'leads_assigned', p_text text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.sales_rep_notices (rep_id, kind, body)
  select k::uuid, p_kind, coalesce(p_text, case when v::int = 1 then '1 new lead was' else v || ' new leads were' end || ' assigned to you.')
  from jsonb_each_text(coalesce(p_counts, '{}'::jsonb)) as e(k, v) where v::int > 0
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. One ingest path for every import (weekly agent, admin paste/CSV, a rep's own list)
-- ---------------------------------------------------------------------------------------------------
-- p_assign: auto (round robin), rep (p_rep), hold (admin hold), none (unassigned, no reason).
create or replace function public.sales_lead_ingest(p_batch uuid, p_row_no integer, r jsonb, p_origin text, p_source text, p_actor uuid, p_assign text, p_rep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_zip text := substring(coalesce(r->>'zip', '') from '^\s*([0-9]{5})');
  v_email text := case when position('@' in coalesce(r->>'email', '')) > 1 then left(lower(btrim(r->>'email')), 320) end;
  v_keys text[]; m jsonb; v_id uuid; v_trades text[]; v_cust uuid; v_rep uuid; ex public.sales_leads;
begin
  if char_length(btrim(coalesce(r->>'company_name', ''))) = 0 or (v_email is null and coalesce(r->>'phone', '') = '' and coalesce(r->>'website', '') = '') then
    insert into public.sales_lead_import_rows (batch_id, row_no, company_name, outcome) values (p_batch, p_row_no, left(btrim(r->>'company_name'), 200), 'invalid');
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if exists (select 1 from public.sales_suppressions s where s.key = any (public.sales_suppression_keys(v_email, r->>'website', r->>'phone'))) then
    insert into public.sales_lead_import_rows (batch_id, row_no, company_name, outcome) values (p_batch, p_row_no, left(btrim(r->>'company_name'), 200), 'suppressed');
    return jsonb_build_object('outcome', 'suppressed');
  end if;
  v_trades := coalesce((select array_agg(distinct lower(btrim(x))) from jsonb_array_elements_text(case when jsonb_typeof(r->'trades') = 'array' then r->'trades' else '[]'::jsonb end) x where char_length(btrim(x)) between 1 and 40), '{}');
  v_keys := public.sales_lead_keys_v2(r->>'company_name', r->>'website', r->>'phone', v_zip, v_email);
  m := public.sales_lead_match(v_keys, r->>'company_name', r->>'city', r->>'state');

  if m->>'level' = 'high' then
    -- Already on file: keep the owner, history and attribution. Only fill blanks; never start outreach.
    select * into ex from public.sales_leads where id = (m->>'lead_id')::uuid for update;
    update public.sales_leads set
      contact_name = coalesce(contact_name, left(nullif(btrim(r->>'contact_name'), ''), 120)),
      email = coalesce(email, v_email), phone = coalesce(phone, left(nullif(btrim(r->>'phone'), ''), 40)),
      website = coalesce(website, left(nullif(btrim(r->>'website'), ''), 300)),
      city = coalesce(city, left(nullif(btrim(r->>'city'), ''), 100)), state = coalesce(state, left(nullif(btrim(r->>'state'), ''), 40)), zip = coalesce(zip, v_zip),
      trades = (select coalesce(array_agg(distinct t), '{}') from unnest(trades || v_trades) t),
      updated_at = now()
    where id = ex.id;
    insert into public.sales_activities (lead_id, actor_id, kind, body, evidence)
    values (ex.id, p_actor, 'system', 'Seen again in an import (matched by ' || (select string_agg(x, ', ') from jsonb_array_elements_text(m->'signals') x) || '). Kept as is; no outreach started.', 'system');
    insert into public.sales_lead_import_rows (batch_id, row_no, company_name, outcome, lead_id, signals)
    values (p_batch, p_row_no, left(btrim(r->>'company_name'), 200), 'duplicate', ex.id, (select array_agg(x) from jsonb_array_elements_text(m->'signals') x));
    return jsonb_build_object('outcome', 'duplicate', 'lead_id', ex.id);
  end if;

  if m->>'level' = 'possible' then
    insert into public.sales_lead_import_rows (batch_id, row_no, company_name, outcome, candidates, signals, raw, decision)
    values (p_batch, p_row_no, left(btrim(r->>'company_name'), 200), 'possible_duplicate', (select array_agg(x::uuid) from jsonb_array_elements_text(m->'candidates') x),
            '{name_location}', r || jsonb_build_object('_origin', p_origin, '_source', p_source, '_assign', p_assign, '_rep', p_rep), 'pending');
    return jsonb_build_object('outcome', 'possible_duplicate');
  end if;

  select id into v_cust from auth.users where v_email is not null and lower(email) = v_email limit 1;

  insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, source_ref, notes, import_batch_id,
                                  business_started, verification, lead_origin, customer_user_id, created_by, hold_reason, discovered_at)
  values (left(btrim(r->>'company_name'), 200), left(nullif(btrim(r->>'contact_name'), ''), 120), v_email,
          left(nullif(btrim(r->>'phone'), ''), 40), left(nullif(btrim(r->>'website'), ''), 300),
          left(nullif(btrim(r->>'city'), ''), 100), left(nullif(btrim(r->>'state'), ''), 40), v_zip, v_trades, p_source,
          left(nullif(btrim(r->>'source_url'), ''), 300), left(nullif(btrim(r->>'notes'), ''), 4000), p_batch,
          case when coalesce(r->>'business_started', '') ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then r->>'business_started' end,
          case when jsonb_typeof(r->'verification') = 'object' then r->'verification' end,
          case when v_cust is not null then 'customer' else p_origin end, v_cust, p_actor,
          case when v_cust is not null then 'existing_customer' when p_assign = 'hold' then 'admin_hold' end, now())
  returning id into v_id;

  if v_cust is not null then
    -- An existing Built2Bid account: not a new acquisition lead. Held for review; attribution untouched.
    insert into public.sales_lead_import_rows (batch_id, row_no, company_name, outcome, lead_id) values (p_batch, p_row_no, left(btrim(r->>'company_name'), 200), 'existing_customer', v_id);
    return jsonb_build_object('outcome', 'existing_customer', 'lead_id', v_id);
  end if;
  if p_assign = 'rep' and p_rep is not null then
    perform public.sales_assign_ctx(case when p_origin = 'rep_sourced' then 'rep_sourced' else 'import' end, p_actor, null, p_batch, null);
    update public.sales_leads set assigned_rep = p_rep where id = v_id;
    v_rep := p_rep;
  elsif p_assign = 'auto' then
    v_rep := public.sales_allocate_lead(v_id, p_actor, p_batch);
  end if;
  insert into public.sales_lead_import_rows (batch_id, row_no, company_name, outcome, lead_id) values (p_batch, p_row_no, left(btrim(r->>'company_name'), 200), 'added', v_id);
  return jsonb_build_object('outcome', 'added', 'lead_id', v_id, 'rep_id', v_rep);
end $$;

-- Runs every row of a batch and fills the batch counters. Returns the counters, added ids and per-rep counts.
create or replace function public.sales_ingest_rows(p_batch uuid, p_rows jsonb, p_origin text, p_source text, p_actor uuid, p_assign text, p_rep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i integer := 0; res jsonb; v_ids uuid[] := '{}'; per jsonb := '{}'::jsonb;
  c_add integer := 0; c_dup integer := 0; c_pos integer := 0; c_sup integer := 0; c_inv integer := 0; c_cust integer := 0; c_alloc integer := 0; c_held integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    i := i + 1;
    res := public.sales_lead_ingest(p_batch, i, r, p_origin, p_source, p_actor, p_assign, p_rep);
    case res->>'outcome'
      when 'added' then
        c_add := c_add + 1; v_ids := v_ids || (res->>'lead_id')::uuid;
        if res->>'rep_id' is not null then
          c_alloc := c_alloc + 1;
          per := per || jsonb_build_object(res->>'rep_id', coalesce((per->>(res->>'rep_id'))::int, 0) + 1);
        elsif p_assign in ('auto', 'hold') then c_held := c_held + 1; end if;
      when 'duplicate' then c_dup := c_dup + 1;
      when 'possible_duplicate' then c_pos := c_pos + 1;
      when 'suppressed' then c_sup := c_sup + 1;
      when 'existing_customer' then c_cust := c_cust + 1;
      else c_inv := c_inv + 1;
    end case;
  end loop;
  update public.sales_lead_batches set added = added + c_add, duplicates = duplicates + c_dup, possible = possible + c_pos, suppressed = suppressed + c_sup,
    invalid = invalid + c_inv, existing_customers = existing_customers + c_cust, allocated = allocated + c_alloc, held = held + c_held
  where id = p_batch;
  if p_assign = 'auto' then perform public.sales_notify_assigned(per); end if;
  return jsonb_build_object('added', c_add, 'duplicates', c_dup, 'possible', c_pos, 'suppressed', c_sup, 'invalid', c_inv,
    'existing_customers', c_cust, 'allocated', c_alloc, 'held', c_held, 'added_ids', to_jsonb(v_ids), 'per_rep', per);
end $$;

-- The weekly agent import, now deduplicated against the master CRM and shared out automatically.
create or replace function public.sales_import_batch(p_external_id text, p_label text, p_rows jsonb, p_unverified integer default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.sales_lead_batches; st public.sales_settings; res jsonb;
begin
  if p_external_id is null or char_length(btrim(p_external_id)) = 0 then raise exception 'batch_id_required'; end if;
  select * into b from public.sales_lead_batches where external_id = btrim(p_external_id);
  if found then return to_jsonb(b) || jsonb_build_object('replayed', true, 'added_ids', '[]'::jsonb); end if;
  select * into st from public.sales_settings where id;
  insert into public.sales_lead_batches (external_id, source, label, received, unverified, target_zip, target_trade)
  values (btrim(p_external_id), 'agent', left(nullif(btrim(p_label), ''), 200), jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) + greatest(coalesce(p_unverified, 0), 0),
          greatest(coalesce(p_unverified, 0), 0), st.lead_target_zip, st.lead_target_trade)
  returning * into b;
  res := public.sales_ingest_rows(b.id, p_rows, 'company', 'agent', null, 'auto');
  select * into b from public.sales_lead_batches where id = b.id;
  return to_jsonb(b) || jsonb_build_object('replayed', false, 'added_ids', res->'added_ids', 'per_rep', res->'per_rep');
end $$;

-- Admin paste/CSV import. p_mode: auto (round robin), rep (to p_rep), hold (unassigned, admin hold).
create or replace function public.admin_sales_lead_import(p_caller uuid, p_rows jsonb, p_mode text, p_rep uuid, p_label text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.sales_lead_batches; res jsonb; n integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_mode not in ('auto', 'rep', 'hold') then raise exception 'invalid_mode'; end if;
  if n = 0 or n > 1000 then raise exception 'invalid_rows'; end if;
  if p_mode = 'rep' and not exists (select 1 from public.sales_reps where id = p_rep and sells and status in ('active', 'invited')) then raise exception 'rep_not_found'; end if;
  insert into public.sales_lead_batches (external_id, source, label, received, created_by)
  values ('admin:' || gen_random_uuid(), 'admin', left(nullif(btrim(p_label), ''), 200), n, p_caller) returning * into b;
  res := public.sales_ingest_rows(b.id, p_rows, 'company', 'owner', p_caller, p_mode, case when p_mode = 'rep' then p_rep end);
  if p_mode = 'rep' then perform public.sales_notify_assigned(jsonb_build_object(p_rep, res->'allocated')); end if;
  perform public.sales_audit(p_caller, 'sales.leads_imported', 'sales_lead_batch', b.id::text, res - 'added_ids');
  return res || jsonb_build_object('batch_id', b.id);
end $$;

-- The original entry point keeps working: with no rep chosen, leads now enter normal allocation.
create or replace function public.admin_sales_crm_import(p_caller uuid, p_rows jsonb, p_rep uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  res := public.admin_sales_lead_import(p_caller, p_rows, case when p_rep is null then 'auto' else 'rep' end, p_rep, null);
  return jsonb_build_object('added', (res->>'added')::int, 'skipped', (res->>'duplicates')::int + (res->>'possible')::int + (res->>'suppressed')::int + (res->>'invalid')::int + (res->>'existing_customers')::int) || res;
end $$;

-- A rep imports their own list (CSV/paste). Their leads stay theirs; duplicates are never moved to them.
create or replace function public.sales_crm_import(p_rows jsonb, p_label text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); b public.sales_lead_batches; n integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
begin
  if rep.id is null or not ('import_own_leads' = any (public.sales_capabilities(auth.uid()))) then raise exception 'not_authorized' using errcode = '42501'; end if;
  if n = 0 or n > 500 then raise exception 'invalid_rows'; end if;
  insert into public.sales_lead_batches (external_id, source, label, received, created_by)
  values ('rep:' || gen_random_uuid(), 'rep', left(nullif(btrim(p_label), ''), 200), n, auth.uid()) returning * into b;
  return public.sales_ingest_rows(b.id, p_rows, 'rep_sourced', 'import', auth.uid(), 'rep', rep.id) - 'per_rep';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Admin master CRM
-- ---------------------------------------------------------------------------------------------------
-- Filters (all optional): q, trade, state, stage, owner (uuid | 'none' | 'held'), origin, follow (overdue |
-- today | week | none), contact (7 | 30 | never), dup (seen_again | possible). Newest activity first.
create or replace function public.admin_sales_leads(p_caller uuid, p jsonb default '{}'::jsonb, p_limit integer default 100, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(btrim(coalesce(p->>'q', ''))); v_today date := (now() at time zone 'America/Chicago')::date;
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  return (
    with f as (
      select l.* from public.sales_leads l
      where (v_q = '' or lower(l.company_name || ' ' || coalesce(l.contact_name, '') || ' ' || coalesce(l.email, '') || ' ' || coalesce(l.phone, '') || ' ' || coalesce(l.city, '') || ' ' || coalesce(l.zip, '') || ' ' || coalesce(l.website, '')) like '%' || v_q || '%')
        and (coalesce(p->>'trade', '') = '' or lower(p->>'trade') = any (l.trades))
        and (coalesce(p->>'state', '') = '' or upper(btrim(coalesce(l.state, ''))) = upper(p->>'state'))
        and (coalesce(p->>'stage', '') = '' or l.stage = p->>'stage')
        and (coalesce(p->>'origin', '') = '' or l.lead_origin = p->>'origin')
        and (coalesce(p->>'owner', '') = '' or (p->>'owner' = 'none' and l.assigned_rep is null) or (p->>'owner' = 'held' and l.assigned_rep is null and l.hold_reason is not null)
             or (p->>'owner' ~ '^[0-9a-f-]{36}$' and l.assigned_rep = (p->>'owner')::uuid))
        and (coalesce(p->>'follow', '') = ''
             or (p->>'follow' = 'overdue' and l.next_action_at < now())
             or (p->>'follow' = 'today' and (l.next_action_at at time zone 'America/Chicago')::date = v_today)
             or (p->>'follow' = 'week' and l.next_action_at >= now() and l.next_action_at < now() + interval '7 days')
             or (p->>'follow' = 'none' and l.next_action_at is null))
        and (coalesce(p->>'contact', '') = ''
             or (p->>'contact' = '7' and l.last_activity_at >= now() - interval '7 days')
             or (p->>'contact' = '30' and l.last_activity_at < now() - interval '30 days')
             or (p->>'contact' = 'never' and l.last_activity_at is null))
        and (coalesce(p->>'dup', '') = ''
             or (p->>'dup' = 'seen_again' and exists (select 1 from public.sales_lead_import_rows ir where ir.lead_id = l.id and ir.outcome = 'duplicate'))
             or (p->>'dup' = 'possible' and exists (select 1 from public.sales_lead_import_rows ir where ir.decision = 'pending' and l.id = any (ir.candidates))))
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'leads', coalesce((select jsonb_agg(x.j order by x.sort desc nulls last) from (
        select jsonb_build_object('id', l.id, 'company_name', l.company_name, 'contact_name', l.contact_name, 'email', l.email, 'phone', l.phone, 'website', l.website,
          'city', l.city, 'state', l.state, 'zip', l.zip, 'trades', l.trades, 'stage', l.stage, 'source', l.source, 'lead_origin', l.lead_origin,
          'assigned_rep', l.assigned_rep, 'rep_name', r.full_name, 'assigned_at', l.assigned_at, 'hold_reason', l.hold_reason,
          'last_activity_at', l.last_activity_at, 'next_action_at', l.next_action_at, 'discovered_at', l.discovered_at, 'do_not_contact', l.do_not_contact,
          'customer_user_id', l.customer_user_id, 'sales_brief', l.sales_brief, 'business_started', l.business_started, 'notes', l.notes,
          'dnc_status', l.dnc_status,
          'seen_again', (select count(*) from public.sales_lead_import_rows ir where ir.lead_id = l.id and ir.outcome = 'duplicate'),
          'beneficiary', (select rr.full_name from public.sales_attributions a join public.sales_reps rr on rr.id = a.rep_id where a.user_id = l.customer_user_id and a.ended_at is null)) j,
          greatest(l.last_activity_at, l.created_at) sort
        from f l left join public.sales_reps r on r.id = l.assigned_rep
        order by greatest(l.last_activity_at, l.created_at) desc nulls last limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb),
      'trades', coalesce((select jsonb_agg(distinct t order by t) from public.sales_leads l, unnest(l.trades) t), '[]'::jsonb),
      'states', coalesce((select jsonb_agg(distinct upper(btrim(l.state)) order by upper(btrim(l.state))) from public.sales_leads l where nullif(btrim(l.state), '') is not null), '[]'::jsonb),
      'queue', coalesce((select jsonb_object_agg(coalesce(hold_reason, 'unassigned'), jsonb_build_object('count', n, 'oldest', oldest)) from (
          select hold_reason, count(*) n, min(created_at) oldest from public.sales_leads where assigned_rep is null and stage not in ('paying', 'lost') group by hold_reason) q), '{}'::jsonb),
      'possible_pending', (select count(*) from public.sales_lead_import_rows where decision = 'pending')));
end $$;

-- One lead for the admin profile panel: history, follow-ups, ownership, who gets the commission.
create or replace function public.admin_sales_lead_detail(p_caller uuid, p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.sales_leads;
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  select * into l from public.sales_leads where id = p_lead;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'lead', public.sales_lead_json(l) || jsonb_build_object('lead_origin', l.lead_origin, 'hold_reason', l.hold_reason, 'hold_note', l.hold_note, 'assigned_at', l.assigned_at),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body, 'occurred_at', a.occurred_at, 'disposition', a.disposition,
        'evidence', a.evidence, 'actor', coalesce(a.actor_label, r.full_name), 'is_owner', a.rep_id is not distinct from l.assigned_rep) order by a.occurred_at desc, a.id desc)
      from public.sales_activities a left join public.sales_reps r on r.id = a.rep_id where a.lead_id = l.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'done_at', t.done_at, 'rep_name', r.full_name) order by t.done_at nulls first, t.due_at)
      from public.sales_tasks t left join public.sales_reps r on r.id = t.rep_id where t.lead_id = l.id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('rep_name', r.full_name, 'previous', pr.full_name, 'method', s.method, 'reason', s.reason, 'at', s.created_at,
        'ended_at', s.ended_at, 'algorithm', s.algorithm) order by s.created_at desc, s.id desc)
      from public.sales_lead_assignments s left join public.sales_reps r on r.id = s.rep_id left join public.sales_reps pr on pr.id = s.previous_rep_id where s.lead_id = l.id), '[]'::jsonb),
    'beneficiary', (select jsonb_build_object('rep_name', r.full_name, 'since', a.attributed_at) from public.sales_attributions a join public.sales_reps r on r.id = a.rep_id
      where a.user_id = l.customer_user_id and a.ended_at is null),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'session', b.session, 'rep_name', r.full_name) order by b.starts_at)
      from public.sales_bookings b join public.sales_reps r on r.id = b.rep_id where l.email is not null and b.customer_email = l.email and b.status = 'booked' and b.starts_at > now()), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('at', ir.created_at, 'outcome', ir.outcome, 'source', b.source, 'label', b.label) order by ir.created_at desc)
      from public.sales_lead_import_rows ir join public.sales_lead_batches b on b.id = ir.batch_id where ir.lead_id = l.id), '[]'::jsonb),
    'duplicates', public.sales_lead_duplicates(l.dedupe_keys, l.id));
end $$;

-- What a reassignment would disturb, per lead with a current owner other than the target.
create or replace function public.sales_assign_warnings(p_leads uuid[], p_rep uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', l.id, 'company_name', l.company_name, 'owner', r.full_name, 'warnings', w.list)), '[]'::jsonb)
  from public.sales_leads l join public.sales_reps r on r.id = l.assigned_rep
  cross join lateral (select array_remove(array[
      case when exists (select 1 from public.sales_activities a where a.lead_id = l.id and a.kind in ('call', 'email', 'text', 'meeting', 'reply') and a.occurred_at > now() - interval '14 days') then 'active_conversation' end,
      case when exists (select 1 from public.sales_bookings b where l.email is not null and b.customer_email = l.email and b.status = 'booked' and b.starts_at > now()) then 'upcoming_meeting' end,
      case when exists (select 1 from public.sales_tasks t where t.lead_id = l.id and t.done_at is null) then 'open_follow_up' end,
      case when l.stage in ('demo', 'trial') then 'pending_proposal' end,
      case when l.customer_user_id is not null or l.stage = 'paying' then 'customer' end,
      case when exists (select 1 from public.sales_attributions a where a.user_id = l.customer_user_id) then 'commission_attribution' end], null) list) w
  where l.id = any (p_leads) and l.assigned_rep is distinct from p_rep and cardinality(w.list) > 0
$$;

-- Assign, reassign, take, or return leads to the queue. p_mode: rep | self | unassign | auto. When any lead
-- has something a move would disturb and p_confirmed is false, nothing changes and the warnings come back.
create or replace function public.admin_sales_leads_assign(p_caller uuid, p_leads uuid[], p_mode text, p_rep uuid default null, p_reason text default null, p_confirmed boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rep uuid; v_name text; w jsonb; n integer := 0; per jsonb := '{}'::jsonb; lid uuid; old_rep uuid; got uuid; moved jsonb := '{}'::jsonb;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_mode not in ('rep', 'self', 'unassign', 'auto') then raise exception 'invalid_mode'; end if;
  if coalesce(cardinality(p_leads), 0) = 0 or cardinality(p_leads) > 500 then raise exception 'invalid'; end if;
  if p_mode = 'self' then
    select id into v_rep from public.sales_reps where user_id = p_caller and sells and status = 'active';
    if v_rep is null then raise exception 'no_rep_profile'; end if;
  elsif p_mode = 'rep' then
    select id into v_rep from public.sales_reps where id = p_rep and sells and status in ('active', 'invited');
    if v_rep is null then raise exception 'rep_not_found'; end if;
  end if;
  if not coalesce(p_confirmed, false) then
    w := public.sales_assign_warnings(p_leads, v_rep);
    if jsonb_array_length(w) > 0 then return jsonb_build_object('needs_confirm', true, 'warnings', w); end if;
  end if;
  select full_name into v_name from public.sales_reps where id = v_rep;
  for lid in select id from public.sales_leads where id = any (p_leads) order by created_at for update loop
    select assigned_rep into old_rep from public.sales_leads where id = lid;
    if p_mode = 'auto' then
      if old_rep is not null then continue; end if;
      got := public.sales_allocate_lead(lid, p_caller, null, '{}', 'equal', 'auto');
      if got is not null then n := n + 1; per := per || jsonb_build_object(got, coalesce((per->>got::text)::int, 0) + 1); end if;
      continue;
    end if;
    continue when old_rep is not distinct from v_rep;
    perform public.sales_assign_ctx(case p_mode when 'unassign' then 'unassign' when 'self' then 'self' else case when cardinality(p_leads) > 1 then 'bulk' else 'manual' end end,
      p_caller, left(nullif(btrim(p_reason), ''), 300), null, null);
    update public.sales_leads set assigned_rep = v_rep, hold_reason = case when v_rep is null then 'manual' end, updated_at = now() where id = lid;
    insert into public.sales_activities (lead_id, actor_id, kind, body, evidence)
    values (lid, p_caller, 'assignment', coalesce('Assigned to ' || v_name, 'Returned to the unassigned queue') || coalesce(': ' || nullif(btrim(p_reason), ''), ''), 'system');
    n := n + 1;
    if v_rep is not null and v_rep <> coalesce((select id from public.sales_reps where user_id = p_caller), '00000000-0000-0000-0000-000000000000') then
      per := per || jsonb_build_object(v_rep, coalesce((per->>v_rep::text)::int, 0) + 1);
    end if;
    if old_rep is not null then moved := moved || jsonb_build_object(old_rep, coalesce((moved->>old_rep::text)::int, 0) + 1); end if;
  end loop;
  perform public.sales_notify_assigned(per);
  perform public.sales_notify_assigned(moved, 'leads_moved', 'An administrator moved some of your leads to another owner. Your history with them is kept.');
  perform public.sales_audit(p_caller, 'sales.leads_assigned', 'sales_rep', coalesce(v_rep::text, p_mode), jsonb_build_object('count', n, 'mode', p_mode, 'reason', nullif(btrim(p_reason), ''), 'confirmed', coalesce(p_confirmed, false)));
  return jsonb_build_object('changed', n, 'per_rep', per);
end $$;

-- The original entry point: assigns as requested (the old screen had no warnings step).
create or replace function public.admin_sales_crm_assign(p_caller uuid, p_leads uuid[], p_rep uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  return (public.admin_sales_leads_assign(p_caller, p_leads, case when p_rep is null then 'unassign' else 'rep' end, p_rep, null, true)->>'changed')::int;
end $$;

-- Hold leads in the queue (or release them for allocation).
create or replace function public.admin_sales_leads_hold(p_caller uuid, p_leads uuid[], p_reason text, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  if p_reason is not null and p_reason not in ('admin_hold', 'needs_classification', 'validation', 'manual') then raise exception 'invalid'; end if;
  update public.sales_leads set hold_reason = p_reason, hold_note = left(nullif(btrim(p_note), ''), 300), updated_at = now()
  where id = any (p_leads) and assigned_rep is null;
  get diagnostics n = row_count;
  perform public.sales_audit(p_caller, 'sales.leads_held', 'sales_lead', 'many', jsonb_build_object('count', n, 'reason', p_reason));
  return n;
end $$;

-- Share out the queue: unassigned company leads with no hold, or held only because nobody was eligible.
create or replace function public.sales_allocate_queue(p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid uuid; got uuid; n integer := 0; left_ integer := 0; per jsonb := '{}'::jsonb;
begin
  for lid in select id from public.sales_leads
    where assigned_rep is null and (hold_reason is null or hold_reason = 'no_eligible_rep') and lead_origin = 'company'
      and not do_not_contact and customer_user_id is null and stage not in ('paying', 'lost')
    order by created_at limit 500 loop
    got := public.sales_allocate_lead(lid, p_actor);
    if got is null then left_ := left_ + 1; else n := n + 1; per := per || jsonb_build_object(got, coalesce((per->>got::text)::int, 0) + 1); end if;
  end loop;
  perform public.sales_notify_assigned(per);
  return jsonb_build_object('allocated', n, 'still_waiting', left_);
end $$;

create or replace function public.admin_sales_allocate_queue(p_caller uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  res := public.sales_allocate_queue(p_caller);
  perform public.sales_audit(p_caller, 'sales.queue_allocated', 'sales_lead', 'queue', res);
  return res;
end $$;

-- Possible duplicates awaiting a decision, with the leads they might match.
create or replace function public.admin_sales_possible_dups(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  return coalesce((select jsonb_agg(jsonb_build_object('id', ir.id, 'at', ir.created_at, 'source', b.source,
      'row', ir.raw - '_origin' - '_source' - '_assign' - '_rep',
      'candidates', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'company_name', l.company_name, 'city', l.city, 'state', l.state, 'zip', l.zip,
          'phone', l.phone, 'email', l.email, 'website', l.website, 'rep_name', r.full_name, 'stage', l.stage)), '[]'::jsonb)
        from public.sales_leads l left join public.sales_reps r on r.id = l.assigned_rep where l.id = any (ir.candidates))) order by ir.created_at)
    from public.sales_lead_import_rows ir join public.sales_lead_batches b on b.id = ir.batch_id where ir.decision = 'pending'), '[]'::jsonb);
end $$;

-- merge: fill blanks on p_target (owner and history unchanged); skip: drop the row; create: add it as a
-- separate business and send it through normal assignment.
create or replace function public.admin_sales_possible_dup_decide(p_caller uuid, p_row bigint, p_decision text, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ir public.sales_lead_import_rows; r jsonb; v_id uuid; v_rep uuid; v_assign text;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  select * into ir from public.sales_lead_import_rows where id = p_row for update;
  if not found or ir.decision is distinct from 'pending' then raise exception 'already_decided'; end if;
  r := ir.raw;
  if p_decision = 'merge' then
    if p_target is null or not (p_target = any (ir.candidates)) then raise exception 'invalid'; end if;
    update public.sales_leads set
      contact_name = coalesce(contact_name, left(nullif(btrim(r->>'contact_name'), ''), 120)),
      email = coalesce(email, case when position('@' in coalesce(r->>'email', '')) > 1 then left(lower(btrim(r->>'email')), 320) end),
      phone = coalesce(phone, left(nullif(btrim(r->>'phone'), ''), 40)), website = coalesce(website, left(nullif(btrim(r->>'website'), ''), 300)),
      trades = (select coalesce(array_agg(distinct t), '{}') from unnest(trades || coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(case when jsonb_typeof(r->'trades') = 'array' then r->'trades' else '[]'::jsonb end) x), '{}')) t),
      updated_at = now()
    where id = p_target;
    insert into public.sales_activities (lead_id, actor_id, kind, body, evidence) values (p_target, p_caller, 'system', 'Merged details from an import row reviewed as the same business.', 'system');
    update public.sales_lead_import_rows set decision = 'merged', lead_id = p_target, raw = null, decided_by = p_caller, decided_at = now() where id = p_row;
  elsif p_decision = 'skip' then
    update public.sales_lead_import_rows set decision = 'skipped', raw = null, decided_by = p_caller, decided_at = now() where id = p_row;
  elsif p_decision = 'create' then
    v_assign := coalesce(r->>'_assign', 'auto');
    v_rep := nullif(r->>'_rep', '')::uuid;
    insert into public.sales_leads (company_name, contact_name, email, phone, website, city, state, zip, trades, source, source_ref, notes, import_batch_id,
                                    business_started, verification, lead_origin, created_by, hold_reason)
    values (left(btrim(r->>'company_name'), 200), left(nullif(btrim(r->>'contact_name'), ''), 120),
            case when position('@' in coalesce(r->>'email', '')) > 1 then left(lower(btrim(r->>'email')), 320) end,
            left(nullif(btrim(r->>'phone'), ''), 40), left(nullif(btrim(r->>'website'), ''), 300), left(nullif(btrim(r->>'city'), ''), 100), left(nullif(btrim(r->>'state'), ''), 40),
            substring(coalesce(r->>'zip', '') from '^\s*([0-9]{5})'),
            coalesce((select array_agg(distinct lower(btrim(x))) from jsonb_array_elements_text(case when jsonb_typeof(r->'trades') = 'array' then r->'trades' else '[]'::jsonb end) x where char_length(btrim(x)) between 1 and 40), '{}'),
            coalesce(r->>'_source', 'owner'), left(nullif(btrim(r->>'source_url'), ''), 300), left(nullif(btrim(r->>'notes'), ''), 4000), ir.batch_id,
            case when coalesce(r->>'business_started', '') ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then r->>'business_started' end,
            case when jsonb_typeof(r->'verification') = 'object' then r->'verification' end, coalesce(r->>'_origin', 'company'), p_caller,
            case when v_assign = 'hold' then 'admin_hold' end)
    returning id into v_id;
    if v_assign = 'rep' and v_rep is not null then
      perform public.sales_assign_ctx(case when r->>'_origin' = 'rep_sourced' then 'rep_sourced' else 'import' end, p_caller, 'Reviewed as a separate business', ir.batch_id, null);
      update public.sales_leads set assigned_rep = v_rep where id = v_id;
    elsif v_assign = 'auto' then
      v_rep := public.sales_allocate_lead(v_id, p_caller, ir.batch_id);
      if v_rep is not null then perform public.sales_notify_assigned(jsonb_build_object(v_rep, 1)); end if;
    end if;
    update public.sales_lead_import_rows set decision = 'created', lead_id = v_id, raw = null, decided_by = p_caller, decided_at = now() where id = p_row;
  else
    raise exception 'invalid';
  end if;
  perform public.sales_audit(p_caller, 'sales.possible_duplicate_' || p_decision, 'sales_lead_import_row', p_row::text, jsonb_build_object('target', p_target, 'created', v_id));
  return jsonb_build_object('decision', p_decision, 'lead_id', coalesce(v_id, p_target));
end $$;

-- Per-rep allocation for recent batches (the weekly import report).
create or replace function public.admin_sales_batch_allocations(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  return coalesce((select jsonb_object_agg(b.id, (select coalesce(jsonb_agg(jsonb_build_object('rep_name', r.full_name, 'count', x.n) order by x.n desc), '[]'::jsonb)
      from (select s.rep_id, count(*) n from public.sales_lead_assignments s where s.batch_id = b.id and s.rep_id is not null group by s.rep_id) x
      join public.sales_reps r on r.id = x.rep_id))
    from (select id from public.sales_lead_batches order by created_at desc limit 20) b), '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Activity: owner, actor and commission beneficiary stay separate
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_disposition_ok(p_kind text, p_disposition text) returns boolean
language sql immutable as $$
  select p_disposition is null or case p_kind
    when 'call' then p_disposition in ('connected', 'voicemail', 'no_answer', 'busy', 'wrong_number')
    when 'email' then p_disposition in ('sent', 'failed', 'bounced')
    when 'text' then p_disposition in ('sent', 'failed')
    when 'meeting' then p_disposition in ('scheduled', 'held', 'no_show')
    else false end
$$;

-- Rep logs an activity with an outcome. Calls and texts keep every compliance check in sales_crm_activity_add.
create or replace function public.sales_crm_activity_log(p_lead uuid, p_kind text, p_body text, p_disposition text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; v_id bigint;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if not public.sales_disposition_ok(p_kind, nullif(p_disposition, '')) then raise exception 'invalid_disposition'; end if;
  if p_kind = 'reply' then
    select * into l from public.sales_leads where id = p_lead for update;
    if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
    insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body, actor_label) values (p_lead, rep.id, auth.uid(), 'reply', left(btrim(coalesce(p_body, '')), 4000), rep.full_name);
    update public.sales_leads set last_activity_at = now(), stage = case when stage in ('new', 'contacted') then 'engaged' else stage end, updated_at = now() where id = p_lead;
    return jsonb_build_object('ok', true);
  end if;
  perform public.sales_crm_activity_add(p_lead, p_kind, p_body, now());
  select max(id) into v_id from public.sales_activities where lead_id = p_lead and actor_id = auth.uid() and kind = p_kind;
  update public.sales_activities set disposition = nullif(p_disposition, ''), actor_label = rep.full_name where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

-- An administrator works a lead owned by someone else: logged once, as the admin, on the shared lead.
-- The owner sees it in their CRM; ownership and attribution do not move.
create or replace function public.admin_sales_lead_activity_add(p_caller uuid, p_lead uuid, p_kind text, p_body text, p_disposition text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.sales_leads; me public.sales_reps; v_at timestamptz := now(); v_label text;
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  if p_kind not in ('call', 'email', 'text', 'meeting', 'note', 'reply') then raise exception 'invalid_kind'; end if;
  if not public.sales_disposition_ok(p_kind, nullif(p_disposition, '')) and p_kind not in ('note', 'reply') then raise exception 'invalid_disposition'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found then raise exception 'not_found'; end if;
  if p_kind in ('call', 'text', 'email') and l.do_not_contact then raise exception 'do_not_contact'; end if;
  if p_kind in ('call', 'text') then
    if l.dnc_status = 'listed' then raise exception 'dnc_listed'; end if;
    if l.dnc_status <> 'clear' then raise exception 'dnc_unchecked'; end if;
    if p_kind = 'text' and l.text_consent_at is null then raise exception 'text_needs_consent'; end if;
    if not public.sales_in_call_window(l.state, v_at) then raise exception 'outside_calling_hours'; end if;
  end if;
  select * into me from public.sales_reps where user_id = p_caller and status = 'active';
  v_label := coalesce(me.full_name, 'Owner') || ' (admin)';
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body, occurred_at, disposition, actor_label)
  values (p_lead, me.id, p_caller, p_kind, left(btrim(coalesce(p_body, '')), 4000), v_at, case when p_kind in ('note', 'reply') then null else nullif(p_disposition, '') end, v_label);
  update public.sales_leads set last_activity_at = case when p_kind = 'note' then last_activity_at else v_at end,
    stage = case when stage = 'new' and p_kind in ('call', 'email', 'text', 'meeting') then 'contacted' when stage in ('new', 'contacted') and p_kind = 'reply' then 'engaged' else stage end,
    updated_at = now()
  where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;

-- An admin schedules a follow-up on a lead. It belongs to the lead's owner (or the admin, if unassigned).
create or replace function public.admin_sales_lead_task(p_caller uuid, p_lead uuid, p_title text, p_due_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.sales_leads; v_rep uuid; t public.sales_tasks;
begin
  perform public.sales_require_cap(p_caller, 'view_all_leads');
  select * into l from public.sales_leads where id = p_lead;
  if not found then raise exception 'not_found'; end if;
  v_rep := coalesce(l.assigned_rep, (select id from public.sales_reps where user_id = p_caller and status = 'active'));
  if v_rep is null then raise exception 'assign_first'; end if;
  insert into public.sales_tasks (lead_id, rep_id, title, due_at) values (p_lead, v_rep, left(btrim(p_title), 200), p_due_at) returning * into t;
  update public.sales_leads set next_action_at = (select min(due_at) from public.sales_tasks where lead_id = p_lead and done_at is null), updated_at = now() where id = p_lead;
  insert into public.sales_activities (lead_id, actor_id, kind, body, evidence) values (p_lead, p_caller, 'system', 'Follow-up scheduled by an administrator: ' || left(btrim(p_title), 200), 'system');
  return to_jsonb(t);
end $$;

-- Rep notices (assignments, moves). Reading marks them read.
create or replace function public.sales_my_notices() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); res jsonb;
begin
  if rep.id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'body', body, 'at', created_at, 'unread', read_at is null) order by created_at desc), '[]'::jsonb) into res
  from (select * from public.sales_rep_notices where rep_id = rep.id and (read_at is null or created_at > now() - interval '7 days') order by created_at desc limit 20) n;
  update public.sales_rep_notices set read_at = now() where rep_id = rep.id and read_at is null;
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. Invitations: resend (with a 10-minute guard), revoke, provider results
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_invite_create(p_caller uuid, p_rep uuid, p_token_hash text, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; inv public.sales_rep_invites;
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  select * into rep from public.sales_reps where id = p_rep for update;
  if not found or rep.status in ('removed', 'suspended') then raise exception 'rep_not_found'; end if;
  if rep.user_id is not null then raise exception 'already_joined'; end if;
  update public.sales_rep_invites set revoked_at = now() where rep_id = p_rep and revoked_at is null and accepted_at is null;
  insert into public.sales_rep_invites (rep_id, token_hash, expires_at, created_by, email)
  values (p_rep, lower(p_token_hash), now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 30)), p_caller, rep.email)
  returning * into inv;
  perform public.sales_audit(p_caller, 'sales.invite_created', 'sales_rep', p_rep::text, jsonb_build_object('expires_at', inv.expires_at));
  return jsonb_build_object('id', inv.id, 'expires_at', inv.expires_at, 'email', rep.email, 'full_name', rep.full_name);
end $$;

-- Resend = a fresh link (the old one stops working). Refused within 10 minutes of the last email.
create or replace function public.admin_sales_invite_resend(p_caller uuid, p_rep uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  if exists (select 1 from public.sales_rep_invites where rep_id = p_rep and sent_at > now() - interval '10 minutes') then raise exception 'sent_recently'; end if;
  return public.admin_sales_invite_create(p_caller, p_rep, p_token_hash, 14);
end $$;

create or replace function public.admin_sales_invite_sent(p_caller uuid, p_invite uuid, p_ok boolean, p_message_id text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  update public.sales_rep_invites set sent_at = now(), send_count = send_count + 1, delivery_status = case when p_ok then 'accepted' else 'failed' end,
    provider_message_id = case when p_ok then left(p_message_id, 100) else provider_message_id end, last_error = case when p_ok then null else left(p_error, 300) end
  where id = p_invite;
  perform public.sales_audit(p_caller, case when p_ok then 'sales.invite_emailed' else 'sales.invite_email_failed' end, 'sales_rep_invite', p_invite::text, '{}'::jsonb);
end $$;

create or replace function public.admin_sales_invite_revoke(p_caller uuid, p_rep uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  update public.sales_rep_invites set revoked_at = now() where rep_id = p_rep and revoked_at is null and accepted_at is null;
  get diagnostics n = row_count;
  perform public.sales_audit(p_caller, 'sales.invite_revoked', 'sales_rep', p_rep::text, jsonb_build_object('count', n));
  return n;
end $$;

-- Resend webhook (service role): delivered or bounced, only from the provider's own event.
create or replace function public.sales_invite_delivery(p_message_id text, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_status not in ('delivered', 'bounced') then return false; end if;
  update public.sales_rep_invites set delivery_status = p_status where provider_message_id = p_message_id and delivery_status in ('accepted', 'delivered');
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.admin_sales_invites(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_object_agg(i.rep_id, jsonb_build_object('id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at, 'opened_at', i.opened_at,
      'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at, 'email', i.email, 'sent_at', i.sent_at, 'send_count', i.send_count, 'delivery_status', i.delivery_status, 'last_error', i.last_error))
    from (select distinct on (rep_id) * from public.sales_rep_invites order by rep_id, created_at desc) i), '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Rep lifecycle: allocation settings, suspend/restore, offboarding, reactivation
-- ---------------------------------------------------------------------------------------------------
-- The same separation rules as admin_sales_member_save: administrators are the owner's to change, and
-- nobody but the owner changes their own record.
create or replace function public.sales_manage_guard(p_caller uuid, rep public.sales_reps) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  if rep.role = 'admin' and not public.is_admin(p_caller) then raise exception 'owner_only' using errcode = '42501'; end if;
  if rep.user_id = p_caller and not public.is_admin(p_caller) then raise exception 'cannot_edit_self' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_sales_rep_allocation_save(p_caller uuid, p_rep uuid, p_paused boolean, p_note text, p_auto text, p_states text[], p_trades text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where id = p_rep for update;
  if not found then raise exception 'not_found'; end if;
  perform public.sales_manage_guard(p_caller, rep);
  if p_auto not in ('default', 'on', 'off') then raise exception 'invalid'; end if;
  update public.sales_reps set
    allocation_paused = coalesce(p_paused, false),
    allocation_paused_at = case when coalesce(p_paused, false) and not allocation_paused then now() when not coalesce(p_paused, false) then null else allocation_paused_at end,
    allocation_note = left(nullif(btrim(p_note), ''), 300),
    auto_leads = case p_auto when 'on' then true when 'off' then false else null end,
    lead_states = coalesce((select array_agg(distinct upper(btrim(s))) from unnest(coalesce(p_states, '{}')) s where upper(btrim(s)) ~ '^[A-Z]{2}$'), '{}'),
    lead_trades = coalesce((select array_agg(distinct lower(btrim(t))) from unnest(coalesce(p_trades, '{}')) t where char_length(btrim(t)) between 1 and 40), '{}'),
    updated_at = now()
  where id = p_rep returning * into rep;
  perform public.sales_audit(p_caller, case when rep.allocation_paused then 'sales.allocation_paused' else 'sales.allocation_saved' end, 'sales_rep', p_rep::text,
    jsonb_build_object('paused', rep.allocation_paused, 'auto', p_auto, 'states', rep.lead_states, 'trades', rep.lead_trades));
  return jsonb_build_object('paused', rep.allocation_paused, 'auto_effective', public.sales_rep_auto_default(rep));
end $$;

-- Ends this person's signed-in sessions (refresh tokens), when the auth tables are present.
create or replace function public.sales_sign_out_user(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if p_user is null then return 0; end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
    get diagnostics n = row_count;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'update auth.refresh_tokens set revoked = true where user_id = $1::text and not revoked' using p_user;
  end if;
  return n;
end $$;

create or replace function public.admin_sales_rep_access(p_caller uuid, p_rep uuid, p_action text, p_reason text, p_sign_out boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; v_sessions integer := 0;
begin
  select * into rep from public.sales_reps where id = p_rep for update;
  if not found then raise exception 'not_found'; end if;
  perform public.sales_manage_guard(p_caller, rep);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  if p_action = 'suspend' then
    if rep.status not in ('active', 'invited') then raise exception 'invalid_transition'; end if;
    update public.sales_reps set status = 'suspended', updated_at = now() where id = p_rep;
    if coalesce(p_sign_out, false) then v_sessions := public.sales_sign_out_user(rep.user_id); end if;
  elsif p_action = 'restore' then
    if rep.status <> 'suspended' then raise exception 'invalid_transition'; end if;
    if exists (select 1 from public.sales_rep_offboardings where rep_id = p_rep and status = 'in_progress') then raise exception 'offboarding_open'; end if;
    update public.sales_reps set status = case when user_id is null then 'invited' else 'active' end, updated_at = now() where id = p_rep;
  else raise exception 'invalid'; end if;
  perform public.sales_audit(p_caller, 'sales.rep_' || p_action || 'ed', 'sales_rep', p_rep::text, jsonb_build_object('reason', btrim(p_reason), 'from', rep.status, 'signed_out_sessions', v_sessions));
  return jsonb_build_object('ok', true, 'signed_out_sessions', v_sessions);
end $$;

-- What a rep has open right now (offboarding snapshot and the reassignment wizard).
create or replace function public.sales_rep_open_work(p_rep uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'leads', (select jsonb_build_object(
        'new', count(*) filter (where stage = 'new'),
        'contacted', count(*) filter (where stage = 'contacted'),
        'active', count(*) filter (where stage in ('engaged', 'demo')),
        'trial', count(*) filter (where stage = 'trial'),
        'customers', count(*) filter (where stage = 'paying' or customer_user_id is not null),
        'lost', count(*) filter (where stage = 'lost'))
      from public.sales_leads where assigned_rep = p_rep),
    'follow_ups', (select count(*) from public.sales_tasks where rep_id = p_rep and done_at is null),
    'meetings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'customer_name', b.customer_name, 'session', b.session) order by b.starts_at)
      from public.sales_bookings b where b.rep_id = p_rep and b.status = 'booked' and b.starts_at > now()), '[]'::jsonb),
    'attributed_customers', (select count(*) from public.sales_attributions where rep_id = p_rep and ended_at is null),
    'commissions', coalesce((select jsonb_object_agg(status, jsonb_build_object('count', n, 'cents', cents)) from (
      select status, count(*) n, sum(amount_cents) cents from public.sales_commissions where rep_id = p_rep group by status) c), '{}'::jsonb),
    'unpaid_statements', (select count(*) from public.sales_statements s where s.rep_id = p_rep and s.status <> 'paid' and s.total_cents > 0),
    'boxes_open', (select count(*) from public.sales_milestone_awards where rep_id = p_rep and status in ('locked', 'ready', 'approved')),
    'rewards_open', (select count(*) from public.sales_reward_awards where rep_id = p_rep and status in ('proposed', 'authorized', 'ordered')))
$$;

create or replace function public.admin_sales_offboarding_start(p_caller uuid, p_rep uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; o public.sales_rep_offboardings;
begin
  select * into rep from public.sales_reps where id = p_rep for update;
  if not found or rep.status = 'removed' then raise exception 'not_found'; end if;
  perform public.sales_manage_guard(p_caller, rep);
  if exists (select 1 from public.sales_rep_offboardings where rep_id = p_rep and status = 'in_progress') then raise exception 'offboarding_open'; end if;
  if coalesce(p->>'effective_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_date'; end if;
  insert into public.sales_rep_offboardings (rep_id, effective_date, reason_category, admin_notes, access_end, lead_plan, started_by, snapshot)
  values (p_rep, (p->>'effective_date')::date, p->>'reason_category', left(nullif(btrim(p->>'admin_notes'), ''), 4000),
          coalesce(nullif(p->>'access_end', ''), 'on_completion'), coalesce(nullif(p->>'lead_plan', ''), 'equal'), p_caller, public.sales_rep_open_work(p_rep))
  returning * into o;
  if o.access_end = 'now' and rep.status in ('active', 'invited') then
    update public.sales_reps set status = 'suspended', updated_at = now() where id = p_rep;
    if coalesce((p->>'sign_out')::boolean, false) then perform public.sales_sign_out_user(rep.user_id); end if;
  end if;
  perform public.sales_audit(p_caller, 'sales.offboarding_started', 'sales_rep', p_rep::text,
    jsonb_build_object('offboarding', o.id, 'effective_date', o.effective_date, 'reason', o.reason_category, 'access_end', o.access_end));
  return to_jsonb(o);
end $$;

create or replace function public.admin_sales_offboarding_update(p_caller uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.sales_rep_offboardings; rep public.sales_reps;
begin
  select * into o from public.sales_rep_offboardings where id = p_id for update;
  if not found or o.status <> 'in_progress' then raise exception 'not_found'; end if;
  select * into rep from public.sales_reps where id = o.rep_id;
  perform public.sales_manage_guard(p_caller, rep);
  update public.sales_rep_offboardings set
    effective_date = case when coalesce(p->>'effective_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'effective_date')::date else effective_date end,
    reason_category = coalesce(nullif(p->>'reason_category', ''), reason_category),
    admin_notes = case when p ? 'admin_notes' then left(nullif(btrim(p->>'admin_notes'), ''), 4000) else admin_notes end,
    lead_plan = coalesce(nullif(p->>'lead_plan', ''), lead_plan),
    meetings_note = case when p ? 'meetings_note' then left(nullif(btrim(p->>'meetings_note'), ''), 1000) else meetings_note end,
    commission_review = coalesce(nullif(p->>'commission_review', ''), commission_review),
    reward_review = coalesce(nullif(p->>'reward_review', ''), reward_review),
    agreement_status = coalesce(nullif(p->>'agreement_status', ''), agreement_status),
    final_payout_review = coalesce(nullif(p->>'final_payout_review', ''), final_payout_review),
    tax_retention = coalesce(nullif(p->>'tax_retention', ''), tax_retention),
    updated_at = now()
  where id = p_id returning * into o;
  perform public.sales_audit(p_caller, 'sales.offboarding_updated', 'sales_rep', o.rep_id::text, jsonb_build_object('offboarding', o.id,
    'commission_review', o.commission_review, 'reward_review', o.reward_review, 'agreement_status', o.agreement_status,
    'final_payout_review', o.final_payout_review, 'tax_retention', o.tax_retention));
  return to_jsonb(o);
end $$;

-- Move a departing (or any) rep's open leads. Customers, lost leads and every commission stay where they are.
-- p_categories: new, contacted, active, trial. p_method: equal | trade | territory | rep | unassign.
create or replace function public.admin_sales_rep_leads_reassign(p_caller uuid, p_rep uuid, p_categories text[], p_method text, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; l public.sales_leads; lid uuid; got uuid; n integer := 0; held integer := 0; per jsonb := '{}'::jsonb; v_name text; v_stages text[];
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  select * into rep from public.sales_reps where id = p_rep;
  if not found then raise exception 'not_found'; end if;
  if p_method not in ('equal', 'trade', 'territory', 'rep', 'unassign') then raise exception 'invalid'; end if;
  if p_method = 'rep' then
    select full_name into v_name from public.sales_reps where id = p_target and id <> p_rep and sells and status = 'active';
    if v_name is null then raise exception 'rep_not_found'; end if;
  end if;
  v_stages := (select coalesce(array_agg(s), '{}') from unnest(coalesce(p_categories, '{}')) c cross join lateral unnest(case c
    when 'new' then array['new'] when 'contacted' then array['contacted'] when 'active' then array['engaged', 'demo'] when 'trial' then array['trial'] else array[]::text[] end) s);
  for lid in select id from public.sales_leads where assigned_rep = p_rep and stage = any (v_stages) and customer_user_id is null order by created_at for update loop
    if p_method = 'rep' then
      perform public.sales_assign_ctx('offboarding', p_caller, 'Moved from ' || rep.full_name, null, null);
      update public.sales_leads set assigned_rep = p_target, updated_at = now() where id = lid;
      got := p_target;
    elsif p_method = 'unassign' then
      perform public.sales_assign_ctx('offboarding', p_caller, 'Returned from ' || rep.full_name, null, null);
      update public.sales_leads set assigned_rep = null, hold_reason = 'manual', updated_at = now() where id = lid;
      got := null;
    else
      select * into l from public.sales_leads where id = lid;
      got := public.sales_allocate_pick(l.state, l.trades, array[p_rep], p_method);
      perform public.sales_assign_ctx('offboarding', p_caller, 'Moved from ' || rep.full_name, null, case when got is not null then 'rr-lra-1' end);
      update public.sales_leads set assigned_rep = got, hold_reason = case when got is null then 'no_eligible_rep' end, updated_at = now() where id = lid;
    end if;
    if got is null then held := held + 1;
    else
      n := n + 1; per := per || jsonb_build_object(got, coalesce((per->>got::text)::int, 0) + 1);
      insert into public.sales_activities (lead_id, actor_id, kind, body, evidence)
      select lid, p_caller, 'assignment', 'Moved from ' || rep.full_name || ' to ' || r.full_name || '. History and attribution kept.', 'system' from public.sales_reps r where r.id = got;
    end if;
  end loop;
  perform public.sales_notify_assigned(per, 'leads_assigned', null);
  perform public.sales_audit(p_caller, 'sales.rep_leads_reassigned', 'sales_rep', p_rep::text, jsonb_build_object('moved', n, 'unassigned', held, 'method', p_method, 'categories', p_categories));
  return jsonb_build_object('moved', n, 'unassigned', held, 'per_rep', per);
end $$;

-- Finish offboarding. Requires every review step. Open leads still with the rep are shared out; access
-- ends (status 'removed', so only sales paid before today earn); invites, booking link and Google access stop.
create or replace function public.admin_sales_offboarding_complete(p_caller uuid, p_id uuid, p_sign_out boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.sales_rep_offboardings; rep public.sales_reps; res jsonb; v_sessions integer := 0;
begin
  select * into o from public.sales_rep_offboardings where id = p_id for update;
  if not found or o.status <> 'in_progress' then raise exception 'not_found'; end if;
  select * into rep from public.sales_reps where id = o.rep_id for update;
  perform public.sales_manage_guard(p_caller, rep);
  if o.commission_review <> 'reviewed' or o.reward_review <> 'reviewed' or o.final_payout_review = 'pending' or o.agreement_status = 'unknown' or o.tax_retention = 'pending' then
    raise exception 'review_incomplete';
  end if;
  res := public.admin_sales_rep_leads_reassign(p_caller, o.rep_id, array['new', 'contacted', 'active', 'trial'],
    case when o.lead_plan in ('trade', 'territory') then o.lead_plan else 'equal' end, null);
  update public.sales_reps set status = 'removed', allocation_paused = true, updated_at = now() where id = o.rep_id;
  update public.sales_rep_invites set revoked_at = now() where rep_id = o.rep_id and revoked_at is null and accepted_at is null;
  update public.sales_rep_calendar set booking_enabled = false where rep_id = o.rep_id;
  update public.sales_google_connections set status = 'revoked', last_error = 'Rep offboarded' where rep_id = o.rep_id;
  if coalesce(p_sign_out, true) then v_sessions := public.sales_sign_out_user(rep.user_id); end if;
  update public.sales_rep_offboardings set status = 'completed', completed_by = p_caller, completed_at = now(), updated_at = now(),
    snapshot = snapshot || jsonb_build_object('at_completion', public.sales_rep_open_work(o.rep_id), 'leads_moved', res)
  where id = p_id returning * into o;
  perform public.sales_audit(p_caller, 'sales.offboarding_completed', 'sales_rep', o.rep_id::text,
    jsonb_build_object('offboarding', o.id, 'reason', o.reason_category, 'leads', res - 'per_rep', 'signed_out_sessions', v_sessions));
  return to_jsonb(o) || jsonb_build_object('leads', res);
end $$;

create or replace function public.admin_sales_offboarding_cancel(p_caller uuid, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.sales_rep_offboardings; rep public.sales_reps;
begin
  select * into o from public.sales_rep_offboardings where id = p_id for update;
  if not found or o.status <> 'in_progress' then raise exception 'not_found'; end if;
  select * into rep from public.sales_reps where id = o.rep_id;
  perform public.sales_manage_guard(p_caller, rep);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.sales_rep_offboardings set status = 'canceled', canceled_reason = left(btrim(p_reason), 300), updated_at = now() where id = p_id;
  perform public.sales_audit(p_caller, 'sales.offboarding_canceled', 'sales_rep', o.rep_id::text, jsonb_build_object('offboarding', o.id, 'reason', btrim(p_reason)));
end $$;

-- Bring back an offboarded or suspended rep: same identity, same history and ledger. Lead allocation
-- starts paused and reassigned leads stay where they went; the admin turns allocation back on.
create or replace function public.admin_sales_rep_reactivate(p_caller uuid, p_rep uuid, p_note text, p_agreement_confirmed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where id = p_rep for update;
  if not found then raise exception 'not_found'; end if;
  perform public.sales_manage_guard(p_caller, rep);
  if rep.status not in ('removed', 'suspended') then raise exception 'invalid_transition'; end if;
  if not coalesce(p_agreement_confirmed, false) then raise exception 'agreement_required'; end if;
  if exists (select 1 from public.sales_rep_offboardings where rep_id = p_rep and status = 'in_progress') then raise exception 'offboarding_open'; end if;
  if exists (select 1 from public.sales_reps r where r.email = rep.email and r.id <> rep.id and r.status <> 'removed') then raise exception 'duplicate'; end if;
  update public.sales_reps set status = case when user_id is null then 'invited' else 'active' end, allocation_paused = true, allocation_paused_at = now(),
    allocation_note = 'Reactivated: turn lead allocation back on when ready.', reactivated_at = now(), reactivated_by = p_caller, updated_at = now()
  where id = p_rep returning * into rep;
  perform public.sales_audit(p_caller, 'sales.rep_reactivated', 'sales_rep', p_rep::text, jsonb_build_object('note', left(nullif(btrim(p_note), ''), 500), 'status', rep.status));
  return to_jsonb(rep);
end $$;

-- Everything the rep management screen needs, in one call.
create or replace function public.admin_sales_rep_manage(p_caller uuid, p_rep uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  perform public.sales_require_cap(p_caller, 'view_all_reps');
  select * into rep from public.sales_reps where id = p_rep;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'rep', jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'phone', rep.phone, 'role', rep.role, 'status', rep.status, 'sells', rep.sells,
      'payout_note', rep.payout_note, 'linked', rep.user_id is not null, 'created_at', rep.created_at, 'activated_at', rep.activated_at, 'removed_at', rep.removed_at,
      'reactivated_at', rep.reactivated_at, 'allocation_paused', rep.allocation_paused, 'allocation_paused_at', rep.allocation_paused_at, 'allocation_note', rep.allocation_note,
      'auto_leads', rep.auto_leads, 'auto_effective', public.sales_rep_auto_default(rep), 'lead_states', rep.lead_states, 'lead_trades', rep.lead_trades,
      'last_allocated_at', rep.last_allocated_at, 'eligible_now', public.sales_rep_auto_eligible(rep, rep.lead_states[1], rep.lead_trades),
      'is_owner', coalesce(public.is_admin(rep.user_id), false), 'is_me', rep.user_id = p_caller,
      'on_time_off', exists (select 1 from public.sales_time_off t where t.rep_id = rep.id and t.status = 'active' and now() >= t.starts_at and now() < t.ends_at),
      'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = rep.user_id)),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at, 'opened_at', i.opened_at, 'accepted_at', i.accepted_at,
        'revoked_at', i.revoked_at, 'email', i.email, 'sent_at', i.sent_at, 'send_count', i.send_count, 'delivery_status', i.delivery_status, 'last_error', i.last_error) order by i.created_at desc)
      from (select * from public.sales_rep_invites where rep_id = rep.id order by created_at desc limit 5) i), '[]'::jsonb),
    'offboarding', (select to_jsonb(o) from public.sales_rep_offboardings o where o.rep_id = rep.id and o.status = 'in_progress'),
    'offboardings', coalesce((select jsonb_agg(to_jsonb(o) - 'snapshot' order by o.started_at desc) from public.sales_rep_offboardings o where o.rep_id = rep.id and o.status <> 'in_progress'), '[]'::jsonb),
    'work', public.sales_rep_open_work(rep.id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'details', a.details) order by a.created_at desc)
      from (select * from public.audit_logs where target_type = 'sales_rep' and target_id = rep.id::text order by created_at desc limit 30) a), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_lead_keys_v2(text, text, text, text, text)', 'public.sales_leads_keys_trg()', 'public.sales_lead_match(text[], text, text, text, uuid)',
    'public.sales_assign_ctx(text, uuid, text, uuid, text)', 'public.sales_leads_assign_before()', 'public.sales_leads_assign_after()',
    'public.sales_rep_auto_default(public.sales_reps)', 'public.sales_rep_auto_eligible(public.sales_reps, text, text[], timestamptz)',
    'public.sales_allocate_pick(text, text[], uuid[], text, timestamptz)', 'public.sales_allocate_lead(uuid, uuid, uuid, uuid[], text, text)',
    'public.sales_notify_assigned(jsonb, text, text)', 'public.sales_lead_ingest(uuid, integer, jsonb, text, text, uuid, text, uuid)',
    'public.sales_ingest_rows(uuid, jsonb, text, text, uuid, text, uuid)', 'public.sales_import_batch(text, text, jsonb, integer)',
    'public.admin_sales_lead_import(uuid, jsonb, text, uuid, text)', 'public.admin_sales_crm_import(uuid, jsonb, uuid)',
    'public.admin_sales_leads(uuid, jsonb, integer, integer)', 'public.admin_sales_lead_detail(uuid, uuid)', 'public.sales_assign_warnings(uuid[], uuid)',
    'public.admin_sales_leads_assign(uuid, uuid[], text, uuid, text, boolean)', 'public.admin_sales_crm_assign(uuid, uuid[], uuid)',
    'public.admin_sales_leads_hold(uuid, uuid[], text, text)', 'public.sales_allocate_queue(uuid)', 'public.admin_sales_allocate_queue(uuid)',
    'public.admin_sales_possible_dups(uuid)', 'public.admin_sales_possible_dup_decide(uuid, bigint, text, uuid)', 'public.admin_sales_batch_allocations(uuid)',
    'public.admin_sales_lead_activity_add(uuid, uuid, text, text, text)', 'public.admin_sales_lead_task(uuid, uuid, text, timestamptz)',
    'public.admin_sales_invite_create(uuid, uuid, text, integer)', 'public.admin_sales_invite_resend(uuid, uuid, text)',
    'public.admin_sales_invite_sent(uuid, uuid, boolean, text, text)', 'public.admin_sales_invite_revoke(uuid, uuid)', 'public.sales_invite_delivery(text, text)',
    'public.admin_sales_invites(uuid)', 'public.sales_manage_guard(uuid, public.sales_reps)', 'public.admin_sales_rep_allocation_save(uuid, uuid, boolean, text, text, text[], text[])',
    'public.sales_sign_out_user(uuid)', 'public.admin_sales_rep_access(uuid, uuid, text, text, boolean)', 'public.sales_rep_open_work(uuid)',
    'public.admin_sales_offboarding_start(uuid, uuid, jsonb)', 'public.admin_sales_offboarding_update(uuid, uuid, jsonb)',
    'public.admin_sales_rep_leads_reassign(uuid, uuid, text[], text, uuid)', 'public.admin_sales_offboarding_complete(uuid, uuid, boolean)',
    'public.admin_sales_offboarding_cancel(uuid, uuid, text)', 'public.admin_sales_rep_reactivate(uuid, uuid, text, boolean)',
    'public.admin_sales_rep_manage(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.sales_crm_import(jsonb, text)', 'public.sales_crm_activity_log(uuid, text, text, text)', 'public.sales_my_notices()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Plain helpers with no data access.
  execute 'grant execute on function public.sales_disposition_ok(text, text) to authenticated, service_role';
end $$;
