-- Sales compliance (legal review, 2026-11-19). Additive; safe to run more than once.
-- Requires 20270107001000_sales_portal.sql and 20270107002000_sales_crm.sql.
--
-- 1. Rep removal, "earned sales only" (James, 2026-11-19): a rep who leaves is paid for every sale whose
--    customer payment happened before they left (including lines still in the 30-day hold), and earns
--    nothing for payments after they left (anniversaries and late first payments). Until now the check
--    used the rep's status at the moment the payment webhook arrived, so a payment made just before
--    removal but processed just after was wrongly marked ineligible. sales_reps.removed_at fixes that.
-- 2. Calling compliance: before a rep logs a call or text, the lead's phone number must have been
--    checked against the National Do Not Call Registry (recorded with who and when), the business must
--    not be on our do-not-contact list, texts need the prospect's written consent on file, and the time
--    must fall inside a conservative calling window (9 AM to 8 PM in the lead's state, primary time zone,
--    which keeps split-zone states and stricter state rules inside the federal 8 AM to 9 PM window).

-- 1. Rep removal ------------------------------------------------------------------------------------------
alter table public.sales_reps add column if not exists removed_at timestamptz;
update public.sales_reps set removed_at = coalesce(removed_at, updated_at) where status = 'removed' and removed_at is null;

create or replace function public.sales_reps_removed_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'removed' and (tg_op = 'INSERT' or old.status is distinct from 'removed') then new.removed_at := coalesce(new.removed_at, now()); end if;
  if new.status <> 'removed' then new.removed_at := null; end if;
  return new;
end $$;
drop trigger if exists sales_reps_removed_at on public.sales_reps;
create trigger sales_reps_removed_at before insert or update of status on public.sales_reps
  for each row execute function public.sales_reps_removed_at();

-- True when a customer payment at p_paid_at happened after the rep left.
create or replace function public.sales_rep_left_before(rep public.sales_reps, p_paid_at timestamptz) returns boolean
language sql stable as $$
  select rep.status = 'removed' and coalesce(p_paid_at, now()) >= coalesce(rep.removed_at, '-infinity'::timestamptz)
$$;

create or replace function public.sales_sync_billing(
  p_user uuid, p_subscription_id text, p_status text, p_plan text, p_company_id uuid,
  p_basis_cents integer, p_basis_detail jsonb,
  p_invoice_id text default null, p_amount_paid integer default 0, p_paid_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.sales_attributions;
  cfg public.sales_settings;
  rep public.sales_reps;
  v_month date;
  v_months integer;
  v_year integer;
  v_basis integer;
  v_created text := null;
begin
  select * into a from public.sales_attributions where user_id = p_user for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  select * into cfg from public.sales_settings where id;

  update public.sales_attributions set
    stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
    sub_status = coalesce(p_status, sub_status),
    plan = coalesce(p_plan, plan),
    company_id = coalesce(p_company_id, company_id),
    basis_cents = case when p_basis_cents is not null and p_basis_cents > 0 then p_basis_cents else basis_cents end,
    basis_detail = case when p_basis_cents is not null and p_basis_cents > 0 then p_basis_detail else basis_detail end,
    basis_updated_at = case when p_basis_cents is not null and p_basis_cents > 0 then now() else basis_updated_at end
  where user_id = p_user
  returning * into a;

  if p_invoice_id is null or coalesce(p_amount_paid, 0) <= 0 or a.ended_at is not null then
    return jsonb_build_object('action', 'synced');
  end if;

  select * into rep from public.sales_reps where id = a.rep_id;
  v_month := public.sales_month_of(coalesce(p_paid_at, now()));
  v_basis := a.basis_cents;

  if a.first_paid_at is null then
    update public.sales_attributions set first_paid_at = coalesce(p_paid_at, now()), first_paid_month = v_month, last_paid_at = coalesce(p_paid_at, now())
    where user_id = p_user returning * into a;
    insert into public.sales_link_events (rep_id, kind, user_id) values (a.rep_id, 'purchase', p_user) on conflict do nothing;
    v_year := 1;
  else
    update public.sales_attributions set last_paid_at = greatest(coalesce(last_paid_at, p_paid_at), coalesce(p_paid_at, now())) where user_id = p_user;
    v_months := (extract(year from v_month) - extract(year from a.first_paid_month)) * 12 + (extract(month from v_month) - extract(month from a.first_paid_month));
    if v_months <= 0 or v_months % 12 <> 0 then return jsonb_build_object('action', 'synced'); end if;
    v_year := v_months / 12 + 1;
    if v_year > cfg.commission_years then return jsonb_build_object('action', 'synced', 'reason', 'past_commission_term'); end if;
  end if;

  insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, stripe_invoice_id, stripe_subscription_id)
  values (a.rep_id, p_user, v_year, 'commission', v_month, coalesce(v_basis, 0), a.basis_detail,
          case when public.sales_rep_left_before(rep, p_paid_at) then 'ineligible' when v_basis is null then 'pending' else 'pending' end,
          case when public.sales_rep_left_before(rep, p_paid_at) then 'rep_removed' when v_basis is null then 'basis_missing' else null end,
          p_invoice_id, p_subscription_id)
  on conflict (user_id, year_no, kind) do nothing;
  if found then v_created := 'year_' || v_year; end if;
  return jsonb_build_object('action', coalesce('created_' || v_created, 'synced'));
end $$;

-- 2. Calling compliance -----------------------------------------------------------------------------------
alter table public.sales_leads add column if not exists dnc_status text not null default 'unchecked';
alter table public.sales_leads add column if not exists dnc_checked_at timestamptz;
alter table public.sales_leads add column if not exists dnc_checked_by uuid references auth.users (id) on delete set null;
alter table public.sales_leads add column if not exists phone_line text not null default 'unknown';
alter table public.sales_leads add column if not exists text_consent_at timestamptz;
alter table public.sales_leads add column if not exists text_consent_note text;
do $$ begin
  alter table public.sales_leads add constraint sales_leads_dnc_status check (dnc_status in ('unchecked', 'clear', 'listed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sales_leads add constraint sales_leads_phone_line check (phone_line in ('unknown', 'landline', 'mobile', 'voip'));
exception when duplicate_object then null; end $$;

-- Primary IANA time zone for a US state (split states use the zone most of the state is in).
create or replace function public.sales_state_tz(p_state text) returns text
language sql immutable as $$
  select case
    when upper(p_state) in ('CT','DE','DC','FL','GA','IN','KY','ME','MD','MA','MI','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV') then 'America/New_York'
    when upper(p_state) in ('AL','AR','IL','IA','KS','LA','MN','MS','MO','NE','ND','OK','SD','TN','TX','WI') then 'America/Chicago'
    when upper(p_state) in ('CO','ID','MT','NM','UT','WY') then 'America/Denver'
    when upper(p_state) = 'AZ' then 'America/Phoenix'
    when upper(p_state) in ('CA','NV','OR','WA') then 'America/Los_Angeles'
    when upper(p_state) = 'AK' then 'America/Anchorage'
    when upper(p_state) = 'HI' then 'Pacific/Honolulu'
    else 'America/Chicago' end
$$;

-- Inside the conservative calling window (9:00 to 19:59 local) at time p_at.
create or replace function public.sales_in_call_window(p_state text, p_at timestamptz) returns boolean
language sql stable as $$
  select extract(hour from (p_at at time zone public.sales_state_tz(p_state))) between 9 and 19
$$;

-- Record a Do Not Call check (and the line type, and optionally text consent) for a lead the rep can see.
create or replace function public.sales_crm_dnc_record(p_lead uuid, p_status text, p_line text, p_text_consent boolean default false, p_consent_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads;
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if p_status not in ('clear', 'listed') then raise exception 'invalid_status'; end if;
  if p_line not in ('unknown', 'landline', 'mobile', 'voip') then raise exception 'invalid_line'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
  update public.sales_leads set dnc_status = p_status, dnc_checked_at = now(), dnc_checked_by = auth.uid(), phone_line = p_line,
    text_consent_at = case when p_text_consent then coalesce(text_consent_at, now()) else text_consent_at end,
    text_consent_note = case when p_text_consent then left(btrim(coalesce(p_consent_note, '')), 300) else text_consent_note end,
    updated_at = now()
  where id = p_lead;
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body)
  values (p_lead, rep.id, auth.uid(), 'system', 'Do Not Call check: ' || case when p_status = 'clear' then 'not listed' else 'LISTED, no calls or texts' end
    || ' · line: ' || p_line || case when p_text_consent then ' · text consent recorded' else '' end);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.sales_crm_dnc_record(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.sales_crm_dnc_record(uuid, text, text, boolean, text) to authenticated;

create or replace function public.sales_crm_activity_add(p_lead uuid, p_kind text, p_body text, p_occurred_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_my_rep(); l public.sales_leads; v_at timestamptz := least(coalesce(p_occurred_at, now()), now());
begin
  if rep.id is null then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if p_kind not in ('call', 'email', 'text', 'meeting', 'note') then raise exception 'invalid_kind'; end if;
  select * into l from public.sales_leads where id = p_lead for update;
  if not found or not public.sales_crm_can_see(rep, l) then raise exception 'not_found'; end if;
  if p_kind in ('call', 'text', 'email') and l.do_not_contact then raise exception 'do_not_contact'; end if;
  if p_kind in ('call', 'text') then
    if l.dnc_status = 'listed' then raise exception 'dnc_listed'; end if;
    if l.dnc_status <> 'clear' then raise exception 'dnc_unchecked'; end if;
    if p_kind = 'text' and l.text_consent_at is null then raise exception 'text_needs_consent'; end if;
    if not public.sales_in_call_window(l.state, v_at) then raise exception 'outside_calling_hours'; end if;
  end if;
  insert into public.sales_activities (lead_id, rep_id, actor_id, kind, body, occurred_at)
  values (p_lead, rep.id, auth.uid(), p_kind, left(btrim(coalesce(p_body, '')), 4000), v_at);
  update public.sales_leads set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'), v_at),
    stage = case when stage = 'new' and p_kind in ('call', 'email', 'text', 'meeting') then 'contacted' else stage end, updated_at = now()
  where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;
