-- Sales Compensation Model V3 (James, 2026-11-19). Requires 20270111001000 (milestones), 20270113001000
-- (roles) and 20270119002000 (compliance). Safe to re-run. Nothing here moves money.
--
-- What changes
--   * Milestone schedule: $25 at 10, $75 at 25, then a percentage box every 25 qualifying customers:
--     3% at 50 and 75, 4% at 100-225, 5% at 250 and every 25 after. No minimum. One award per
--     representative per threshold, ever (unique (rep_id, milestone), unchanged).
--   * Bonus formula: qualifying active attributed MRR x milestone rate, rounded half-up to the cent,
--     computed once when the milestone is earned and frozen in a hashed snapshot. Never recalculated.
--   * Qualification (proposed risk control, flagged for owner + counsel): a customer counts once they
--     reach a second successful billing cycle (monthly), or are a month past their first payment without
--     a first-month cancellation (annual and other prepaid plans). The previous rule ("counts at first
--     payment") stays available as milestone_qualification = 'first_payment'.
--   * Separate incentive programs with jurisdiction controls. The randomized activity bonus program is
--     registered DISABLED and can't be enabled without a current documented legal approval for a state.
--     Standard commissions are not governed by any flag.
--
-- What stays
--   * Standard commissions (one month of the plan, sale month + 2 anniversaries, 30-day hold, first-month
--     cancel rule, upgrade at anniversary, month-end statements): untouched.
--   * Referral attribution (90-day window, server-side sales_attributions, one row per customer): untouched.
--   * Awards created under the V2 rules keep their V2 calculation (rule_set = 'v2_window').
--
-- MRR definition (one definition, used everywhere in this file):
--   customer MRR = least(list MRR, collected MRR) for an attributed customer whose subscription is
--   'active' (not trialing, past_due, unpaid or canceled), whose attribution hasn't been ended, who
--   didn't cancel within their first month, and whose latest full-period invoice (not a proration, not
--   disputed) was collected for more than $0 after refunds.
--     list MRR      = every recurring item on the subscription (plan, Enterprise seats, add-ons) at its
--                     price divided by the months in its billing period ($199/yr -> $16.58).
--     collected MRR = that invoice's pre-tax amount actually paid, minus refunds, divided by the months
--                     it covers. Taking the smaller of the two removes discounts, taxes, refunds and
--                     unpaid amounts, and an upgrade counts once it has actually been paid for.
--   Complimentary access and free plans have no paid invoice, so they never count.
--   Rep qualifying active attributed MRR = sum of customer MRR over the rep's qualifying customers.

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings (versioned with the rest of the commission policy)
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_settings add column if not exists milestone_model text not null default 'v2_window';
alter table public.sales_settings drop constraint if exists sales_settings_milestone_model_check;
alter table public.sales_settings add constraint sales_settings_milestone_model_check check (milestone_model in ('v2_window', 'v3_active_mrr'));
alter table public.sales_settings add column if not exists milestone_qualification text not null default 'first_payment';
alter table public.sales_settings drop constraint if exists sales_settings_milestone_qualification_check;
alter table public.sales_settings add constraint sales_settings_milestone_qualification_check check (milestone_qualification in ('first_payment', 'second_cycle'));

create or replace function public.sales_policy_snapshot(s public.sales_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('annual_basis', s.annual_basis, 'refund_policy', s.refund_policy, 'value_scope', s.value_scope,
    'commission_years', s.commission_years, 'attribution_window_days', s.attribution_window_days, 'time_zone', s.time_zone,
    'first_month_cancel_voids', s.first_month_cancel_voids,
    'milestone_every', s.milestone_every, 'milestone_rates', s.milestone_rates, 'milestone_min_cents', s.milestone_min_cents,
    'milestone_flat', s.milestone_flat, 'accelerator_enabled', s.accelerator_enabled, 'accelerator_tiers', s.accelerator_tiers,
    'milestone_model', s.milestone_model, 'milestone_qualification', s.milestone_qualification)
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Revenue facts the qualification and MRR rules need
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_revenue add column if not exists period_months numeric(7, 3) check (period_months is null or period_months > 0);
alter table public.sales_revenue add column if not exists billing_reason text check (billing_reason is null or char_length(billing_reason) <= 60);
alter table public.sales_revenue add column if not exists disputed_at timestamptz;

alter table public.sales_attributions add column if not exists mrr_list_cents integer check (mrr_list_cents is null or mrr_list_cents >= 0);
alter table public.sales_attributions add column if not exists mrr_detail jsonb;
alter table public.sales_attributions add column if not exists mrr_updated_at timestamptz;

-- Records a paid invoice (idempotent on invoice id) plus its billing period and reason.
create or replace function public.sales_record_revenue_v3(p_user uuid, p_invoice_id text, p_gross_cents integer, p_revenue_cents integer, p_paid_at timestamptz,
  p_period_months numeric, p_billing_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.sales_record_revenue(p_user, p_invoice_id, p_gross_cents, p_revenue_cents, p_paid_at);
  update public.sales_revenue set
    period_months = coalesce(period_months, case when p_period_months > 0 then p_period_months end),
    billing_reason = coalesce(billing_reason, left(p_billing_reason, 60))
  where invoice_id = p_invoice_id;
  return r;
end $$;

-- Chargebacks: a disputed invoice stops counting (qualification and MRR) until the dispute is won.
create or replace function public.sales_revenue_disputed(p_invoice_id text, p_disputed boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.sales_revenue set disputed_at = case when p_disputed then coalesce(disputed_at, now()) end where invoice_id = p_invoice_id;
  return jsonb_build_object('action', case when found then 'updated' else 'none' end);
end $$;

-- List MRR from the webhook (every recurring item / months per period). Detail is kept for the audit trail.
create or replace function public.sales_set_mrr(p_user uuid, p_mrr_cents integer, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  update public.sales_attributions set mrr_list_cents = greatest(0, p_mrr_cents), mrr_detail = p_detail, mrr_updated_at = now() where user_id = p_user;
$$;

-- Months covered by one billing period of the plan, from the invoice or the stored basis (monthly default).
create or replace function public.sales_period_months(p_invoice_months numeric, p_basis jsonb) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(p_invoice_months,
    (select max((l ->> 'months')::numeric) from jsonb_array_elements(coalesce(p_basis -> 'lines', '[]'::jsonb)) l where l ->> 'kind' = 'plan'),
    (select max((l ->> 'months')::numeric) from jsonb_array_elements(coalesce(p_basis -> 'lines', '[]'::jsonb)) l),
    1)
$$;

-- Invoices that count as a billing cycle: collected (net of refunds) and not disputed, and not a mid-period proration.
create or replace function public.sales_cycle_invoices(p_user uuid) returns table (invoice_id text, paid_at timestamptz, net_cents integer, period_months numeric)
language sql stable security definer set search_path = public as $$
  select r.invoice_id, r.paid_at, r.revenue_cents - r.refunded_cents, r.period_months
  from public.sales_revenue r
  where r.user_id = p_user and r.disputed_at is null and r.revenue_cents - r.refunded_cents > 0
    and coalesce(r.billing_reason, 'subscription_cycle') <> 'subscription_update'
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Qualification and MRR
-- ---------------------------------------------------------------------------------------------------
-- When a customer started counting toward milestones, or null if they don't (yet).
create or replace function public.sales_customer_qualified_at(p_user uuid, p_now timestamptz default now()) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare a public.sales_attributions; v_mode text; v_first record; v_second timestamptz; v_months numeric; v_at timestamptz;
begin
  select * into a from public.sales_attributions where user_id = p_user;
  if not found or a.first_paid_at is null then return null; end if;
  -- First-month cancellation never counts (both rule sets).
  if a.cancel_requested_at is not null and a.cancel_requested_at <= a.first_paid_at + interval '1 month' then return null; end if;
  -- Fully refunded (or never actually collected) customers never count, whatever the rule set.
  if exists (select 1 from public.sales_revenue r where r.user_id = p_user)
     and not exists (select 1 from public.sales_cycle_invoices(p_user)) then return null; end if;
  select coalesce(milestone_qualification, 'first_payment') into v_mode from public.sales_settings where id;
  if v_mode = 'first_payment' then
    return case when a.first_paid_at <= p_now then a.first_paid_at end;
  end if;
  -- second_cycle: the first collected cycle invoice decides monthly vs prepaid.
  select * into v_first from public.sales_cycle_invoices(p_user) c order by c.paid_at, c.invoice_id limit 1;
  if not found then return null; end if;
  v_months := public.sales_period_months(v_first.period_months, a.basis_detail);
  if v_months > 1 then
    -- Annual / prepaid: no second payment is due for months, so a month past the first payment without
    -- a first-month cancellation (and without a refund or dispute of that payment) is the checkpoint.
    v_at := v_first.paid_at + interval '1 month';
  else
    select c.paid_at into v_second from public.sales_cycle_invoices(p_user) c
      where c.paid_at > v_first.paid_at order by c.paid_at, c.invoice_id limit 1;
    v_at := v_second;
  end if;
  return case when v_at is not null and v_at <= p_now then v_at end;
end $$;

-- One customer's MRR under the definition at the top of this file (0 when not active and paying).
create or replace function public.sales_customer_mrr(p_user uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare a public.sales_attributions; v_inv record; v_collected integer;
begin
  select * into a from public.sales_attributions where user_id = p_user;
  if not found or a.first_paid_at is null or a.ended_at is not null or coalesce(a.sub_status, '') <> 'active' then return 0; end if;
  if a.cancel_requested_at is not null and a.cancel_requested_at <= a.first_paid_at + interval '1 month' then return 0; end if;
  -- Latest full-period invoice, whatever its state: if it was refunded or disputed the customer isn't paying.
  select r.revenue_cents - r.refunded_cents as net, r.disputed_at, r.period_months into v_inv
  from public.sales_revenue r
  where r.user_id = p_user and coalesce(r.billing_reason, 'subscription_cycle') <> 'subscription_update'
  order by r.paid_at desc, r.invoice_id desc limit 1;
  if not found then
    -- Paid before revenue tracking began: fall back to list MRR.
    return coalesce(a.mrr_list_cents, 0);
  end if;
  if v_inv.disputed_at is not null or v_inv.net <= 0 then return 0; end if;
  v_collected := round(v_inv.net::numeric / public.sales_period_months(v_inv.period_months, a.basis_detail))::integer;
  return greatest(0, least(v_collected, coalesce(a.mrr_list_cents, v_collected)));
end $$;

-- Qualifying customers in the order they qualified (n = 1, 2, 3 ...).
create or replace function public.sales_milestone_customers(p_rep uuid, p_now timestamptz default now())
returns table (user_id uuid, qualified_at timestamptz, n bigint)
language sql stable security definer set search_path = public as $$
  select q.user_id, q.at, row_number() over (order by q.at, q.user_id)
  from (select x.user_id, public.sales_customer_qualified_at(x.user_id, p_now) as at
        from public.sales_attributions x where x.rep_id = p_rep and x.first_paid_at is not null) q
  where q.at is not null
$$;

-- Kept for the screens that already use it (counts, upcoming milestones). Same rules as above.
create or replace function public.sales_milestone_accounts(p_rep uuid) returns table (user_id uuid, first_paid_at timestamptz, n bigint)
language sql stable security definer set search_path = public as $$
  select c.user_id, c.qualified_at, c.n from public.sales_milestone_customers(p_rep, now()) c
$$;

-- Qualifying active attributed MRR for a rep, with the per-customer breakdown used in snapshots.
create or replace function public.sales_rep_mrr(p_rep uuid, p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select m.user_id, public.sales_customer_mrr(m.user_id) as mrr from public.sales_milestone_customers(p_rep, p_now) m)
  select jsonb_build_object(
    'mrr_cents', coalesce((select sum(mrr) from c), 0)::integer,
    'paying_customers', (select count(*) from c where mrr > 0),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'mrr_cents', mrr) order by user_id) from c where mrr > 0), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Schedule helpers
-- ---------------------------------------------------------------------------------------------------
-- The rule at threshold n, or null when n isn't a milestone: {"at", "flat_cents"} or {"at", "pct"}.
create or replace function public.sales_milestone_rule(s public.sales_settings, p_n integer) returns jsonb
language plpgsql immutable set search_path = public as $$
declare f jsonb; v_first integer;
begin
  if p_n is null or p_n < 1 then return null; end if;
  select x into f from jsonb_array_elements(s.milestone_flat) x where (x ->> 'at')::integer = p_n limit 1;
  if f is not null then return jsonb_build_object('at', p_n, 'flat_cents', (f ->> 'cents')::integer, 'badge', f ->> 'badge'); end if;
  select min((r ->> 'from')::integer) into v_first from jsonb_array_elements(s.milestone_rates) r;
  if p_n >= greatest(coalesce(v_first, s.milestone_every), s.milestone_every) and p_n % s.milestone_every = 0 then
    return jsonb_build_object('at', p_n, 'pct', public.sales_milestone_rate(s.milestone_rates, p_n));
  end if;
  return null;
end $$;

create or replace function public.sales_next_milestone(s public.sales_settings, p_count integer) returns jsonb
language plpgsql immutable set search_path = public as $$
declare n integer := greatest(coalesce(p_count, 0), 0) + 1;
begin
  while public.sales_milestone_rule(s, n) is null and n < p_count + 100000 loop n := n + 1; end loop;
  return public.sales_milestone_rule(s, n);
end $$;

create or replace function public.sales_current_milestone(s public.sales_settings, p_count integer) returns jsonb
language plpgsql immutable set search_path = public as $$
declare n integer := coalesce(p_count, 0);
begin
  while n > 0 and public.sales_milestone_rule(s, n) is null loop n := n - 1; end loop;
  return case when n > 0 then public.sales_milestone_rule(s, n) end;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Incentive programs and jurisdictions
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_reps add column if not exists work_state text check (work_state is null or work_state ~ '^[A-Z]{2}$');
alter table public.sales_reps add column if not exists work_locality text check (work_locality is null or char_length(work_locality) <= 120);
alter table public.sales_reps add column if not exists work_location_updated_at timestamptz;

create table if not exists public.sales_incentive_programs (
  key text primary key check (key in ('standard_commission', 'milestone_bonus', 'randomized_activity_bonus')),
  name text not null,
  kind text not null check (kind in ('earned_commission', 'guaranteed_bonus', 'randomized_bonus')),
  enabled boolean not null default false,
  requires_jurisdiction_approval boolean not null default true,
  -- Future eligibility ends here (prospective only; anything earned before it stands).
  eligibility_ended_at timestamptz,
  emergency_disabled_at timestamptz,
  emergency_reason text check (emergency_reason is null or char_length(emergency_reason) <= 300),
  unavailable_message text not null check (char_length(unavailable_message) <= 300),
  description text check (description is null or char_length(description) <= 600),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.sales_incentive_programs enable row level security;

insert into public.sales_incentive_programs (key, name, kind, enabled, requires_jurisdiction_approval, unavailable_message, description) values
  ('standard_commission', 'Standard subscription commissions', 'earned_commission', true, false,
   'Standard commissions are always tracked.', 'One month of the customer''s qualifying subscription, at the sale and on up to two anniversaries. Not controlled by any program switch.'),
  ('milestone_bonus', 'Customer milestone bonuses', 'guaranteed_bonus', true, false,
   'Milestone bonuses aren''t offered for your work location right now. Bonuses you already earned are still yours.',
   'One-time bonuses at 10, 25, 50 and every 25 qualifying customers after that. Changes are prospective only.'),
  ('randomized_activity_bonus', 'Randomized activity bonus', 'randomized_bonus', false, true,
   'The activity bonus drawing isn''t offered in your work location. It only runs where the company has documented legal approval.',
   'Qualifying calls and emails would raise the chance of a supplemental cash award. Off until legal review approves it for a jurisdiction.')
on conflict (key) do nothing;

create table if not exists public.sales_program_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references public.sales_incentive_programs (key),
  state text not null check (state ~ '^[A-Z]{2}$'),
  locality text check (locality is null or char_length(locality) <= 120),     -- null = statewide
  status text not null check (status in ('approved', 'not_approved', 'prohibited')),
  legal_reference text check (legal_reference is null or char_length(legal_reference) <= 300),  -- memo / opinion id
  reviewed_by text check (reviewed_by is null or char_length(reviewed_by) <= 120),            -- counsel name
  effective_from date not null,
  expires_on date,
  notes text check (notes is null or char_length(notes) <= 600),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 300),
  expiry_logged_at timestamptz,
  check (expires_on is null or expires_on > effective_from),
  check (status <> 'approved' or (legal_reference is not null and reviewed_by is not null))
);
create index if not exists sales_program_jurisdictions_key on public.sales_program_jurisdictions (program_key, state);
alter table public.sales_program_jurisdictions enable row level security;

-- Append-only history of every activation, deactivation and approval change.
create table if not exists public.sales_program_events (
  id bigint generated always as identity primary key,
  program_key text not null,
  action text not null check (char_length(action) <= 60),
  actor_id uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.sales_program_events enable row level security;

create or replace function public.sales_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'append_only' using errcode = '42501';
end $$;
drop trigger if exists sales_program_events_append_only on public.sales_program_events;
create trigger sales_program_events_append_only before update or delete on public.sales_program_events
  for each row execute function public.sales_append_only();

create or replace function public.sales_program_log(p_key text, p_action text, p_actor uuid, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.sales_program_events (program_key, action, actor_id, details) values (p_key, p_action, p_actor, coalesce(p_details, '{}'::jsonb));
$$;

-- Is a program available to a rep on a date? Based on the rep's own work location, never headquarters.
create or replace function public.sales_program_status(p_key text, p_rep uuid, p_on date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.sales_incentive_programs; rep public.sales_reps; v_block text; v_ok boolean; v_expired boolean;
begin
  select * into p from public.sales_incentive_programs where key = p_key;
  if not found then return jsonb_build_object('available', false, 'reason', 'unknown_program', 'message', 'Not offered.'); end if;
  if p.kind = 'earned_commission' then return jsonb_build_object('available', true, 'reason', 'always', 'message', null); end if;
  if p.emergency_disabled_at is not null then return jsonb_build_object('available', false, 'reason', 'emergency_disabled', 'message', p.unavailable_message); end if;
  if not p.enabled then return jsonb_build_object('available', false, 'reason', 'disabled', 'message', p.unavailable_message); end if;
  if p.eligibility_ended_at is not null and p_on >= (p.eligibility_ended_at at time zone 'America/Chicago')::date then
    return jsonb_build_object('available', false, 'reason', 'eligibility_ended', 'message', p.unavailable_message);
  end if;
  select * into rep from public.sales_reps where id = p_rep;
  -- A current not-approved / prohibited entry for the rep's state (or their locality) always blocks.
  select j.status into v_block from public.sales_program_jurisdictions j
  where j.program_key = p_key and j.revoked_at is null and j.status in ('not_approved', 'prohibited') and rep.work_state is not null
    and j.state = rep.work_state and (j.locality is null or lower(j.locality) = lower(coalesce(rep.work_locality, '')))
    and j.effective_from <= p_on and (j.expires_on is null or j.expires_on > p_on)
  limit 1;
  if v_block is not null then return jsonb_build_object('available', false, 'reason', 'jurisdiction_' || v_block, 'message', p.unavailable_message); end if;
  if not p.requires_jurisdiction_approval then return jsonb_build_object('available', true, 'reason', 'enabled', 'message', null); end if;
  if rep.work_state is null then return jsonb_build_object('available', false, 'reason', 'work_location_missing', 'message', p.unavailable_message); end if;
  select true into v_ok from public.sales_program_jurisdictions j
  where j.program_key = p_key and j.revoked_at is null and j.status = 'approved' and j.state = rep.work_state
    and (j.locality is null or lower(j.locality) = lower(coalesce(rep.work_locality, '')))
    and j.effective_from <= p_on and (j.expires_on is null or j.expires_on > p_on)
  limit 1;
  if v_ok then return jsonb_build_object('available', true, 'reason', 'approved', 'message', null); end if;
  select true into v_expired from public.sales_program_jurisdictions j
  where j.program_key = p_key and j.revoked_at is null and j.status = 'approved' and j.state = rep.work_state and j.expires_on is not null and j.expires_on <= p_on limit 1;
  return jsonb_build_object('available', false, 'reason', case when v_expired then 'approval_expired' else 'not_approved' end, 'message', p.unavailable_message);
end $$;

-- Daily sweep: log approvals that expired (they stop working on their expiry date automatically).
create or replace function public.sales_programs_sweep(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare j record; n integer := 0;
begin
  for j in select * from public.sales_program_jurisdictions where status = 'approved' and revoked_at is null and expiry_logged_at is null
           and expires_on is not null and expires_on <= (p_now at time zone 'America/Chicago')::date for update loop
    update public.sales_program_jurisdictions set expiry_logged_at = p_now where id = j.id;
    perform public.sales_program_log(j.program_key, 'approval_expired', null, jsonb_build_object('jurisdiction_id', j.id, 'state', j.state, 'locality', j.locality, 'expires_on', j.expires_on));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Awards: V3 columns, statuses, tamper evidence
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_milestone_awards add column if not exists rule_set text not null default 'v2_window';
alter table public.sales_milestone_awards drop constraint if exists sales_milestone_awards_rule_set_check;
alter table public.sales_milestone_awards add constraint sales_milestone_awards_rule_set_check check (rule_set in ('v2_window', 'v3_active_mrr'));
alter table public.sales_milestone_awards add column if not exists mrr_cents integer check (mrr_cents is null or mrr_cents >= 0);
alter table public.sales_milestone_awards add column if not exists qualifying_customers integer;
alter table public.sales_milestone_awards add column if not exists snapshot jsonb;
alter table public.sales_milestone_awards add column if not exists snapshot_hash text;
alter table public.sales_milestone_awards drop constraint if exists sales_milestone_awards_status_check;
alter table public.sales_milestone_awards add constraint sales_milestone_awards_status_check check (status in ('locked', 'ready', 'approved', 'void', 'ineligible'));

create or replace function public.sales_snapshot_hash(p jsonb) returns text
language sql immutable set search_path = public as $$ select encode(sha256(convert_to(p::text, 'UTF8')), 'hex') $$;

-- Once an amount is fixed, the calculation can't change, and awards are never deleted (only voided).
create or replace function public.sales_milestone_awards_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'awards_are_permanent' using errcode = '42501'; end if;
  if old.amount_cents is not null and (
       new.rep_id is distinct from old.rep_id or new.milestone is distinct from old.milestone or new.pct is distinct from old.pct
       or new.flat_cents is distinct from old.flat_cents or new.revenue_cents is distinct from old.revenue_cents
       or new.mrr_cents is distinct from old.mrr_cents or new.amount_cents is distinct from old.amount_cents
       or new.reached_at is distinct from old.reached_at or new.rule_set is distinct from old.rule_set
       or new.snapshot is distinct from old.snapshot or new.snapshot_hash is distinct from old.snapshot_hash
       or new.policy_version is distinct from old.policy_version or new.qualifying_customers is distinct from old.qualifying_customers) then
    raise exception 'award_calculation_locked' using errcode = '42501';
  end if;
  if old.status in ('approved') and new.status <> old.status then raise exception 'award_calculation_locked' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists sales_milestone_awards_guard on public.sales_milestone_awards;
create trigger sales_milestone_awards_guard before update or delete on public.sales_milestone_awards
  for each row execute function public.sales_milestone_awards_guard();

-- Rep disputes of a milestone award (the award itself is never edited; outcomes are recorded here).
create table if not exists public.sales_milestone_disputes (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.sales_milestone_awards (id),
  rep_id uuid not null references public.sales_reps (id),
  note text not null check (char_length(note) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'denied')),
  resolution text check (resolution is null or char_length(resolution) <= 1000),
  adjustment_cents integer check (adjustment_cents is null or adjustment_cents between 0 and 1000000),
  adjustment_commission_id uuid references public.sales_commissions (id),
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists sales_milestone_disputes_open on public.sales_milestone_disputes (award_id) where status = 'open';
alter table public.sales_milestone_disputes enable row level security;

-- ---------------------------------------------------------------------------------------------------
-- 7. Award engine
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_milestones_evaluate(p_rep uuid default null, p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare cfg public.sales_settings; rep record; acc record; w record; v_prev timestamptz; v_first timestamptz; v_rev integer;
  v_rule jsonb; v_changed integer := 0; v_mrr jsonb; v_amount integer; v_snap jsonb; v_prog jsonb; v_version integer;
begin
  select * into cfg from public.sales_settings where id;
  v_version := public.sales_policy_current_version();
  -- Removed reps are included so a milestone reached before their last day is still created.
  for rep in select id, removed_at from public.sales_reps where (p_rep is null or id = p_rep) and status in ('active', 'suspended', 'removed') loop
    select min(qualified_at) into v_first from public.sales_milestone_customers(rep.id, p_now);
    for acc in select * from public.sales_milestone_customers(rep.id, p_now) a order by a.n loop
      exit when rep.removed_at is not null and acc.qualified_at > rep.removed_at;
      v_rule := public.sales_milestone_rule(cfg, acc.n::integer);
      continue when v_rule is null;
      continue when exists (select 1 from public.sales_milestone_awards where rep_id = rep.id and milestone = acc.n);
      if cfg.milestone_model = 'v3_active_mrr' then
        v_prog := public.sales_program_status('milestone_bonus', rep.id, (acc.qualified_at at time zone 'America/Chicago')::date);
        if not (v_prog ->> 'available')::boolean then
          v_snap := jsonb_build_object('model', 'v3_active_mrr', 'threshold', acc.n, 'reached_at', acc.qualified_at, 'computed_at', p_now,
            'policy_version', v_version, 'program', v_prog, 'result', 'not eligible: milestone program unavailable for this representative');
          insert into public.sales_milestone_awards (rep_id, milestone, pct, flat_cents, badge, min_cents, window_start, reached_at, unlocks_at,
            status, void_reason, rule_set, qualifying_customers, snapshot, snapshot_hash, policy_version)
          values (rep.id, acc.n, coalesce((v_rule ->> 'pct')::numeric, 0), (v_rule ->> 'flat_cents')::integer, v_rule ->> 'badge', 0, acc.qualified_at, acc.qualified_at, acc.qualified_at,
            'ineligible', left('Program unavailable: ' || (v_prog ->> 'reason'), 300), 'v3_active_mrr', acc.n, v_snap, public.sales_snapshot_hash(v_snap), v_version)
          on conflict (rep_id, milestone) do nothing;
          if found then v_changed := v_changed + 1; end if;
          continue;
        end if;
        v_mrr := public.sales_rep_mrr(rep.id, p_now);
        v_amount := coalesce((v_rule ->> 'flat_cents')::integer,
          greatest(cfg.milestone_min_cents, round((v_mrr ->> 'mrr_cents')::numeric * (v_rule ->> 'pct')::numeric / 100.0)::integer));
        v_snap := jsonb_build_object(
          'model', 'v3_active_mrr', 'threshold', acc.n, 'qualifying_customers', acc.n, 'reached_at', acc.qualified_at, 'computed_at', p_now,
          'rule', v_rule, 'min_cents', cfg.milestone_min_cents, 'mrr_cents', (v_mrr ->> 'mrr_cents')::integer,
          'paying_customers', (v_mrr ->> 'paying_customers')::integer, 'mrr_customers', v_mrr -> 'customers',
          'amount_cents', v_amount, 'policy_version', v_version, 'qualification', cfg.milestone_qualification, 'program', v_prog,
          'formula', case when v_rule ? 'flat_cents' then 'flat amount' else 'qualifying active attributed MRR x rate, rounded half-up to the cent' end,
          'mrr_definition', 'least(list MRR, collected MRR) per active paying qualifying customer; annual / 12; pre-tax, net of refunds; excludes disputed, trialing, past_due, canceled, complimentary');
        insert into public.sales_milestone_awards (rep_id, milestone, pct, flat_cents, badge, min_cents, window_start, reached_at, unlocks_at,
          revenue_cents, mrr_cents, amount_cents, status, rule_set, qualifying_customers, snapshot, snapshot_hash, policy_version)
        values (rep.id, acc.n, coalesce((v_rule ->> 'pct')::numeric, 0), (v_rule ->> 'flat_cents')::integer, v_rule ->> 'badge',
          case when v_rule ? 'flat_cents' then 0 else cfg.milestone_min_cents end, acc.qualified_at, acc.qualified_at, acc.qualified_at,
          null, (v_mrr ->> 'mrr_cents')::integer, v_amount, 'ready', 'v3_active_mrr', acc.n, v_snap, public.sales_snapshot_hash(v_snap), v_version)
        on conflict (rep_id, milestone) do nothing;
        if found then
          v_changed := v_changed + 1;
          perform public.sales_audit(null, 'sales.milestone_earned', 'sales_milestone_awards', rep.id::text || ':' || acc.n,
            jsonb_build_object('milestone', acc.n, 'amount_cents', v_amount, 'mrr_cents', (v_mrr ->> 'mrr_cents')::integer, 'hash', public.sales_snapshot_hash(v_snap)));
        end if;
      else
        -- V2 rules (kept for owners who switch back): a locked box whose amount is fixed after a 30-day hold.
        select reached_at into v_prev from public.sales_milestone_awards
          where rep_id = rep.id and milestone < acc.n and status <> 'void' and flat_cents is null order by milestone desc limit 1;
        insert into public.sales_milestone_awards (rep_id, milestone, pct, flat_cents, badge, min_cents, window_start, reached_at, unlocks_at, policy_version)
        values (rep.id, acc.n, coalesce((v_rule ->> 'pct')::numeric, 0), (v_rule ->> 'flat_cents')::integer, v_rule ->> 'badge',
          case when v_rule ? 'flat_cents' then 0 else cfg.milestone_min_cents end,
          coalesce(v_prev, v_first - interval '1 second'), acc.qualified_at, acc.qualified_at + interval '30 days', v_version)
        on conflict (rep_id, milestone) do nothing;
        if found then v_changed := v_changed + 1; end if;
      end if;
    end loop;
  end loop;
  -- V2 boxes: fix the amount once the refund hold has passed.
  for w in select * from public.sales_milestone_awards where status = 'locked' and rule_set = 'v2_window' and unlocks_at <= p_now and (p_rep is null or rep_id = p_rep) for update loop
    select coalesce(sum(r.revenue_cents - r.refunded_cents), 0) into v_rev
    from public.sales_revenue r join public.sales_attributions x on x.user_id = r.user_id
    where r.rep_id = w.rep_id and r.paid_at <= w.reached_at and r.paid_at > w.window_start
      and x.ended_at is null and x.sub_status in ('active', 'trialing', 'past_due');
    v_snap := jsonb_build_object('model', 'v2_window', 'threshold', w.milestone, 'reached_at', w.reached_at, 'window_start', w.window_start,
      'revenue_cents', v_rev, 'pct', w.pct, 'flat_cents', w.flat_cents, 'min_cents', w.min_cents, 'computed_at', p_now, 'policy_version', w.policy_version,
      'formula', 'still-active customers'' collected revenue since the previous percentage box x rate, at least the minimum');
    update public.sales_milestone_awards set revenue_cents = v_rev,
      amount_cents = coalesce(w.flat_cents, greatest(w.min_cents, round(v_rev * w.pct / 100.0)::integer)), status = 'ready',
      snapshot = v_snap || jsonb_build_object('amount_cents', coalesce(w.flat_cents, greatest(w.min_cents, round(v_rev * w.pct / 100.0)::integer))),
      snapshot_hash = public.sales_snapshot_hash(v_snap || jsonb_build_object('amount_cents', coalesce(w.flat_cents, greatest(w.min_cents, round(v_rev * w.pct / 100.0)::integer))))
    where id = w.id;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

-- Rep view of an award. The amount (and its calculation) is only included once the rep opens the box.
create or replace function public.sales_milestone_json(w public.sales_milestone_awards) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', w.id, 'milestone', w.milestone, 'pct', w.pct, 'flat', w.flat_cents is not null, 'badge', w.badge, 'reached_at', w.reached_at, 'unlocks_at', w.unlocks_at,
    'rule_set', w.rule_set,
    'status', case when w.status = 'void' then 'void' when w.status = 'ineligible' then 'ineligible' when w.status = 'locked' then 'locked'
      when exists (select 1 from public.sales_milestone_disputes d where d.award_id = w.id and d.status = 'open') then 'disputed'
      when w.opened_at is null then 'ready'
      when c.status = 'paid' then 'paid' when w.status = 'approved' then 'approved' else 'opened' end,
    'opened_at', w.opened_at,
    'void_reason', case when w.status in ('void', 'ineligible') then w.void_reason end,
    'amount_cents', case when w.opened_at is not null then w.amount_cents end,
    'revenue_cents', case when w.opened_at is not null then w.revenue_cents end,
    'mrr_cents', case when w.opened_at is not null then w.mrr_cents end,
    'qualifying_customers', w.qualifying_customers,
    'snapshot_hash', case when w.opened_at is not null then w.snapshot_hash end)
  from (select 1) _ left join public.sales_commissions c on c.id = w.commission_id
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Approval: the ledger line carries the snapshot reference
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_milestone_approve_v82(p_caller uuid, p_award uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.sales_milestone_awards; v_line uuid;
begin
  perform public.sales_require_admin(p_caller);
  select * into w from public.sales_milestone_awards where id = p_award for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if w.status <> 'ready' then raise exception 'not_ready' using errcode = '22023'; end if;
  if exists (select 1 from public.sales_milestone_disputes d where d.award_id = w.id and d.status = 'open') then raise exception 'disputed' using errcode = '22023'; end if;
  insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, earned_at)
  values (w.rep_id, null, 1, 'bonus', public.sales_month_of(now()), w.amount_cents,
    jsonb_build_object('milestone', w.milestone, 'pct', w.pct, 'flat_cents', w.flat_cents, 'revenue_cents', w.revenue_cents, 'mrr_cents', w.mrr_cents,
      'min_cents', w.min_cents, 'award_id', w.id, 'rule_set', w.rule_set, 'snapshot_hash', w.snapshot_hash),
    'earned', 'milestone_' || w.milestone, now())
  returning id into v_line;
  update public.sales_milestone_awards set status = 'approved', approved_at = now(), approved_by = p_caller, commission_id = v_line where id = w.id;
  perform public.sales_audit(p_caller, 'sales.milestone_approved', 'sales_milestone_awards', w.id::text, jsonb_build_object('milestone', w.milestone, 'amount_cents', w.amount_cents, 'rep_id', w.rep_id));
  return jsonb_build_object('commission_id', v_line, 'amount_cents', w.amount_cents);
end $$;

-- Approvals list: adds the V3 fields (MRR, rule set, snapshot fingerprint).
create or replace function public.admin_sales_milestones(p_caller uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  perform public.sales_milestones_evaluate(null);
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'rep_id', w.rep_id, 'rep_name', r.full_name, 'milestone', w.milestone, 'pct', w.pct,
      'flat_cents', w.flat_cents, 'badge', w.badge, 'min_cents', w.min_cents, 'window_start', w.window_start, 'reached_at', w.reached_at, 'unlocks_at', w.unlocks_at, 'revenue_cents', w.revenue_cents,
      'mrr_cents', w.mrr_cents, 'rule_set', w.rule_set, 'snapshot_hash', w.snapshot_hash, 'qualifying_customers', w.qualifying_customers,
      'amount_cents', w.amount_cents, 'status', w.status, 'opened_at', w.opened_at, 'approved_at', w.approved_at, 'void_reason', w.void_reason,
      'disputed', exists (select 1 from public.sales_milestone_disputes d where d.award_id = w.id and d.status = 'open'),
      'commission_status', c.status, 'policy_version', w.policy_version) order by w.reached_at desc)
    from public.sales_milestone_awards w join public.sales_reps r on r.id = w.rep_id left join public.sales_commissions c on c.id = w.commission_id), '[]'::jsonb);
end $$;

-- Flat boxes may sit at any threshold below the first percentage box (V3 has a flat $75 at 25 with every = 25).
create or replace function public.admin_sales_milestone_rules_save_v82(p_caller uuid, p_every integer, p_rates jsonb, p_min_cents integer, p_flat jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_last integer := 0; v_first integer;
begin
  perform public.sales_require_admin(p_caller);
  if p_every is null or p_every < 1 or p_every > 10000 or p_min_cents is null or p_min_cents < 0 or p_min_cents > 1000000
     or jsonb_typeof(p_rates) <> 'array' or jsonb_array_length(p_rates) not between 1 and 10 then
    raise exception 'invalid_milestones' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rates) loop
    if (r ->> 'from') is null or (r ->> 'pct') is null or (r ->> 'from')::integer <= v_last or (r ->> 'pct')::numeric < 0 or (r ->> 'pct')::numeric > 20 then
      raise exception 'invalid_milestones' using errcode = '22023';
    end if;
    v_last := (r ->> 'from')::integer;
  end loop;
  v_first := (p_rates -> 0 ->> 'from')::integer;
  if jsonb_typeof(p_flat) <> 'array' or jsonb_array_length(p_flat) > 10 then raise exception 'invalid_milestones' using errcode = '22023'; end if;
  v_last := 0;
  for r in select * from jsonb_array_elements(p_flat) loop
    if (r ->> 'at') is null or (r ->> 'cents') is null or (r ->> 'at')::integer <= v_last or (r ->> 'at')::integer >= greatest(v_first, p_every)
       or (r ->> 'cents')::integer < 0 or (r ->> 'cents')::integer > 1000000 then
      raise exception 'invalid_milestones' using errcode = '22023';
    end if;
    v_last := (r ->> 'at')::integer;
  end loop;
  perform set_config('sales.policy_note', coalesce(left(p_note, 500), 'Milestone bonus rules changed'), true);
  update public.sales_settings set milestone_every = p_every, milestone_rates = p_rates, milestone_min_cents = p_min_cents, milestone_flat = p_flat, updated_at = now() where id;
  perform public.sales_audit(p_caller, 'sales.milestone_rules_saved', 'sales_settings', 'milestones', jsonb_build_object('every', p_every, 'rates', p_rates, 'min_cents', p_min_cents, 'flat', p_flat));
  return jsonb_build_object('version', public.sales_policy_current_version());
end $$;

-- Owner: which model and qualification rule apply to milestones reached from now on.
create or replace function public.admin_sales_milestone_model_save(p_caller uuid, p_model text, p_qualification text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if p_model not in ('v2_window', 'v3_active_mrr') or p_qualification not in ('first_payment', 'second_cycle') then raise exception 'invalid_milestones' using errcode = '22023'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  perform set_config('sales.policy_note', left(btrim(p_note), 500), true);
  update public.sales_settings set milestone_model = p_model, milestone_qualification = p_qualification, updated_by = p_caller, updated_at = now() where id;
  perform public.sales_audit(p_caller, 'sales.milestone_model_saved', 'sales_settings', 'milestones', jsonb_build_object('model', p_model, 'qualification', p_qualification));
  return jsonb_build_object('version', public.sales_policy_current_version());
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. Rep: compensation dashboard, disputes
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_compensation_for(p_rep uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.sales_settings; v_q integer; v_mrr jsonb; v_cur jsonb; v_next jsonb; v_est integer;
begin
  select * into cfg from public.sales_settings where id;
  select count(*) into v_q from public.sales_milestone_customers(p_rep, p_now);
  v_mrr := public.sales_rep_mrr(p_rep, p_now);
  v_cur := public.sales_current_milestone(cfg, v_q);
  v_next := public.sales_next_milestone(cfg, v_q);
  v_est := coalesce((v_next ->> 'flat_cents')::integer, greatest(cfg.milestone_min_cents, round((v_mrr ->> 'mrr_cents')::numeric * coalesce((v_next ->> 'pct')::numeric, 0) / 100.0)::integer));
  return jsonb_build_object(
    'model', cfg.milestone_model, 'qualification', cfg.milestone_qualification,
    'attributed', (select count(*) from public.sales_attributions where rep_id = p_rep),
    'qualifying', v_q,
    'active_paying', (select count(*) from public.sales_attributions x where x.rep_id = p_rep and public.sales_customer_mrr(x.user_id) > 0),
    'qualifying_mrr_cents', (v_mrr ->> 'mrr_cents')::integer,
    'current', v_cur, 'next', v_next, 'remaining', greatest(0, coalesce((v_next ->> 'at')::integer, v_q) - v_q),
    'next_estimate_cents', v_est, 'next_is_estimate', not (v_next ? 'flat_cents'),
    'bonus_earned_cents', (select coalesce(sum(amount_cents), 0) from public.sales_milestone_awards where rep_id = p_rep and status in ('ready', 'approved')),
    'bonus_paid_cents', (select coalesce(sum(w.amount_cents), 0) from public.sales_milestone_awards w join public.sales_commissions c on c.id = w.commission_id where w.rep_id = p_rep and c.status = 'paid'),
    'bonus_pending_cents', (select coalesce(sum(w.amount_cents), 0) from public.sales_milestone_awards w left join public.sales_commissions c on c.id = w.commission_id
                             where w.rep_id = p_rep and (w.status in ('ready', 'locked') or (w.status = 'approved' and c.status is distinct from 'paid')) and w.amount_cents is not null),
    'commission_earned_cents', (select coalesce(sum(amount_cents), 0) from public.sales_commissions where rep_id = p_rep and kind in ('commission', 'clawback', 'accelerator') and status in ('earned', 'approved', 'paid')),
    'commission_pending_cents', (select coalesce(sum(amount_cents), 0) from public.sales_commissions where rep_id = p_rep and kind in ('commission', 'accelerator') and status = 'pending'),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('paid_on', p.paid_on, 'amount_cents', p.amount_cents, 'method', p.method, 'period_month', s.period_month,
        'commission_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.statement_id = s.id and c.kind in ('commission', 'clawback', 'accelerator')),
        'bonus_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.statement_id = s.id and c.kind not in ('commission', 'clawback', 'accelerator')))
        order by p.paid_on desc) from public.sales_payouts p join public.sales_statements s on s.id = p.statement_id where p.rep_id = p_rep), '[]'::jsonb),
    'programs', jsonb_build_object(
      'milestone_bonus', public.sales_program_status('milestone_bonus', p_rep, (p_now at time zone 'America/Chicago')::date),
      'randomized_activity_bonus', public.sales_program_status('randomized_activity_bonus', p_rep, (p_now at time zone 'America/Chicago')::date)),
    'schedule', jsonb_build_object('every', cfg.milestone_every, 'rates', cfg.milestone_rates, 'flat', cfg.milestone_flat, 'min_cents', cfg.milestone_min_cents));
end $$;

create or replace function public.sales_my_compensation() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  perform public.sales_milestones_evaluate(rep.id);
  return public.sales_compensation_for(rep.id);
end $$;

create or replace function public.sales_my_milestone_dispute(p_award uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; v_id uuid;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.sales_milestone_awards where id = p_award and rep_id = rep.id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  begin
    insert into public.sales_milestone_disputes (award_id, rep_id, note) values (p_award, rep.id, left(btrim(p_note), 1000)) returning id into v_id;
  exception when unique_violation then raise exception 'already_disputed' using errcode = '22023';
  end;
  perform public.sales_audit(auth.uid(), 'sales.milestone_disputed', 'sales_milestone_awards', p_award::text, jsonb_build_object('dispute_id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Owner: compensation view, calculation inspection, disputes, programs, payroll
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_compensation(p_caller uuid, p_months integer default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_from date;
begin
  perform public.sales_require_cap(p_caller, 'payout_operations');
  perform public.sales_milestones_evaluate(null);
  v_from := (public.sales_month_of(now()) - make_interval(months => greatest(1, least(coalesce(p_months, 12), 36)) - 1))::date;
  return jsonb_build_object(
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', m.month,
        'revenue_cents', (select coalesce(sum(r.revenue_cents - r.refunded_cents), 0) from public.sales_revenue r where public.sales_month_of(r.paid_at) = m.month),
        'commission_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.period_month = m.month and c.kind in ('commission', 'clawback', 'accelerator') and c.status in ('pending', 'earned', 'approved', 'paid')),
        'bonus_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.period_month = m.month and c.kind not in ('commission', 'clawback', 'accelerator') and c.status in ('pending', 'earned', 'approved', 'paid')),
        'paid_cents', (select coalesce(sum(p.amount_cents), 0) from public.sales_payouts p where date_trunc('month', p.paid_on)::date = m.month)) order by m.month desc)
      from (select generate_series(v_from, public.sales_month_of(now()), interval '1 month')::date as month) m), '[]'::jsonb),
    'reps', coalesce((select jsonb_agg(x.j order by x.name) from (
      select r.full_name as name, (public.sales_compensation_for(r.id) - 'payouts' - 'schedule' - 'programs') || jsonb_build_object(
        'rep_id', r.id, 'rep_name', r.full_name, 'status', r.status, 'work_state', r.work_state, 'work_locality', r.work_locality,
        'ever_paid', (select count(*) from public.sales_attributions a where a.rep_id = r.id and a.first_paid_at is not null),
        'revenue_cents', (select coalesce(sum(v.revenue_cents - v.refunded_cents), 0) from public.sales_revenue v where v.rep_id = r.id),
        'paid_out_cents', (select coalesce(sum(p.amount_cents), 0) from public.sales_payouts p where p.rep_id = r.id),
        'obligation_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.rep_id = r.id and c.status in ('earned', 'approved'))
          + (select coalesce(sum(w.amount_cents), 0) from public.sales_milestone_awards w where w.rep_id = r.id and w.status = 'ready')) as j
      from public.sales_reps r where r.sells or exists (select 1 from public.sales_attributions a where a.rep_id = r.id)) x), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'rep_id', w.rep_id, 'rep_name', r.full_name, 'milestone', w.milestone, 'rule_set', w.rule_set,
        'pct', w.pct, 'flat_cents', w.flat_cents, 'mrr_cents', w.mrr_cents, 'revenue_cents', w.revenue_cents, 'amount_cents', w.amount_cents, 'status', w.status,
        'reached_at', w.reached_at, 'policy_version', w.policy_version, 'snapshot', w.snapshot, 'snapshot_hash', w.snapshot_hash,
        'hash_ok', w.snapshot is null or w.snapshot_hash = public.sales_snapshot_hash(w.snapshot), 'void_reason', w.void_reason,
        'commission_status', c.status) order by w.reached_at desc)
      from public.sales_milestone_awards w join public.sales_reps r on r.id = w.rep_id left join public.sales_commissions c on c.id = w.commission_id), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'award_id', d.award_id, 'rep_name', r.full_name, 'milestone', w.milestone, 'note', d.note,
        'status', d.status, 'resolution', d.resolution, 'adjustment_cents', d.adjustment_cents, 'created_at', d.created_at, 'resolved_at', d.resolved_at) order by d.created_at desc)
      from public.sales_milestone_disputes d join public.sales_milestone_awards w on w.id = d.award_id join public.sales_reps r on r.id = d.rep_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'details', l.details) order by l.created_at desc)
      from (select * from public.audit_logs where action in ('sales.commission_set', 'sales.milestone_voided', 'sales.milestone_adjusted', 'sales.milestone_dispute_resolved')
            order by created_at desc limit 50) l), '[]'::jsonb));
end $$;

create or replace function public.admin_sales_milestone_dispute_resolve(p_caller uuid, p_dispute uuid, p_outcome text, p_resolution text, p_adjustment_cents integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.sales_milestone_disputes; w public.sales_milestone_awards; v_line uuid;
begin
  perform public.sales_require_cap(p_caller, 'adjust_commissions');
  if p_outcome not in ('upheld', 'denied') or char_length(btrim(coalesce(p_resolution, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_adjustment_cents is not null and (p_adjustment_cents < 0 or p_adjustment_cents > 1000000 or p_outcome <> 'upheld') then raise exception 'invalid' using errcode = '22023'; end if;
  select * into d from public.sales_milestone_disputes where id = p_dispute for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if d.status <> 'open' then raise exception 'already_resolved' using errcode = '22023'; end if;
  select * into w from public.sales_milestone_awards where id = d.award_id;
  if public.sales_is_own_rep(p_caller, w.rep_id) then raise exception 'cannot_approve_own' using errcode = '42501'; end if;
  -- An upheld dispute pays any difference as a separate, auditable bonus line; the award itself never changes.
  if coalesce(p_adjustment_cents, 0) > 0 then
    insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, earned_at)
    values (w.rep_id, null, 1, 'bonus', public.sales_month_of(now()), p_adjustment_cents,
      jsonb_build_object('award_id', w.id, 'milestone', w.milestone, 'dispute_id', d.id, 'adjustment', true), 'earned', 'milestone_adjustment_' || w.milestone, now())
    returning id into v_line;
  end if;
  update public.sales_milestone_disputes set status = p_outcome, resolution = left(btrim(p_resolution), 1000), adjustment_cents = p_adjustment_cents,
    adjustment_commission_id = v_line, resolved_by = p_caller, resolved_at = now() where id = d.id;
  perform public.sales_audit(p_caller, 'sales.milestone_dispute_resolved', 'sales_milestone_awards', w.id::text,
    jsonb_build_object('dispute_id', d.id, 'outcome', p_outcome, 'adjustment_cents', p_adjustment_cents));
  return jsonb_build_object('commission_id', v_line);
end $$;

create or replace function public.admin_sales_programs(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return jsonb_build_object(
    'programs', coalesce((select jsonb_agg(to_jsonb(p) order by case p.key when 'standard_commission' then 0 when 'milestone_bonus' then 1 else 2 end) from public.sales_incentive_programs p), '[]'::jsonb),
    'jurisdictions', coalesce((select jsonb_agg(to_jsonb(j) || jsonb_build_object('current', j.revoked_at is null and j.effective_from <= current_date and (j.expires_on is null or j.expires_on > current_date))
      order by j.program_key, j.state, j.created_at desc) from public.sales_program_jurisdictions j), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from public.sales_program_events order by id desc limit 100) e), '[]'::jsonb),
    'reps', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.full_name, 'status', r.status, 'work_state', r.work_state, 'work_locality', r.work_locality,
      'milestone_bonus', public.sales_program_status('milestone_bonus', r.id), 'randomized_activity_bonus', public.sales_program_status('randomized_activity_bonus', r.id)) order by r.full_name)
      from public.sales_reps r where r.status in ('invited', 'active', 'suspended')), '[]'::jsonb));
end $$;

-- Owner: turn a bonus program on or off for the future. Standard commissions can't be switched off here.
create or replace function public.admin_sales_program_set(p_caller uuid, p_key text, p_enabled boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.sales_incentive_programs;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into p from public.sales_incentive_programs where key = p_key for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.kind = 'earned_commission' then raise exception 'standard_not_toggleable' using errcode = '22023'; end if;
  if p_enabled and p.requires_jurisdiction_approval and not exists (
       select 1 from public.sales_program_jurisdictions j where j.program_key = p_key and j.status = 'approved' and j.revoked_at is null
         and j.effective_from <= current_date and (j.expires_on is null or j.expires_on > current_date)) then
    raise exception 'approval_required' using errcode = '22023';
  end if;
  update public.sales_incentive_programs set enabled = p_enabled,
    eligibility_ended_at = case when p_enabled then null else now() end, updated_at = now(), updated_by = p_caller where key = p_key;
  perform public.sales_program_log(p_key, case when p_enabled then 'enabled' else 'disabled' end, p_caller, jsonb_build_object('note', left(btrim(p_note), 500)));
  perform public.sales_audit(p_caller, 'sales.program_' || case when p_enabled then 'enabled' else 'disabled' end, 'sales_incentive_programs', p_key, jsonb_build_object('note', left(btrim(p_note), 500)));
end $$;

-- Emergency stop: any Sales Administrator can stop a bonus program at once; only the owner can clear it.
create or replace function public.admin_sales_program_emergency(p_caller uuid, p_key text, p_stop boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  if not p_stop then perform public.sales_require_cap(p_caller, 'edit_commission_policies'); end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_key = 'standard_commission' then raise exception 'standard_not_toggleable' using errcode = '22023'; end if;
  update public.sales_incentive_programs set emergency_disabled_at = case when p_stop then now() end,
    emergency_reason = case when p_stop then left(btrim(p_reason), 300) end, updated_at = now(), updated_by = p_caller where key = p_key;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.sales_program_log(p_key, case when p_stop then 'emergency_stop' else 'emergency_cleared' end, p_caller, jsonb_build_object('reason', left(btrim(p_reason), 300)));
  perform public.sales_audit(p_caller, 'sales.program_' || case when p_stop then 'emergency_stop' else 'emergency_cleared' end, 'sales_incentive_programs', p_key, jsonb_build_object('reason', left(btrim(p_reason), 300)));
end $$;

-- Owner: record a jurisdiction decision. Rows are never edited; a change is a new row (and a revoke).
create or replace function public.admin_sales_jurisdiction_save(p_caller uuid, p_key text, p_state text, p_locality text, p_status text, p_legal_reference text,
  p_reviewed_by text, p_effective_from date, p_expires_on date, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if p_key = 'standard_commission' then raise exception 'standard_not_toggleable' using errcode = '22023'; end if;
  if p_status = 'approved' and (coalesce(btrim(p_legal_reference), '') = '' or coalesce(btrim(p_reviewed_by), '') = '') then raise exception 'approval_documentation_required' using errcode = '22023'; end if;
  insert into public.sales_program_jurisdictions (program_key, state, locality, status, legal_reference, reviewed_by, effective_from, expires_on, notes, recorded_by)
  values (p_key, upper(btrim(p_state)), nullif(btrim(p_locality), ''), p_status, nullif(btrim(p_legal_reference), ''), nullif(btrim(p_reviewed_by), ''),
    coalesce(p_effective_from, current_date), p_expires_on, nullif(btrim(p_notes), ''), p_caller)
  returning id into v_id;
  perform public.sales_program_log(p_key, 'jurisdiction_' || p_status, p_caller, jsonb_build_object('jurisdiction_id', v_id, 'state', upper(btrim(p_state)), 'locality', nullif(btrim(p_locality), ''),
    'legal_reference', p_legal_reference, 'reviewed_by', p_reviewed_by, 'effective_from', p_effective_from, 'expires_on', p_expires_on));
  perform public.sales_audit(p_caller, 'sales.jurisdiction_saved', 'sales_program_jurisdictions', v_id::text, jsonb_build_object('program', p_key, 'state', p_state, 'status', p_status));
  return v_id;
end $$;

create or replace function public.admin_sales_jurisdiction_revoke(p_caller uuid, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.sales_program_jurisdictions;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  update public.sales_program_jurisdictions set revoked_at = now(), revoked_by = p_caller, revoke_reason = left(btrim(p_reason), 300)
  where id = p_id and revoked_at is null returning * into j;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.sales_program_log(j.program_key, 'jurisdiction_revoked', p_caller, jsonb_build_object('jurisdiction_id', j.id, 'state', j.state, 'reason', left(btrim(p_reason), 300)));
end $$;

-- Rep's actual working jurisdiction (not headquarters).
create or replace function public.admin_sales_rep_work_location(p_caller uuid, p_rep uuid, p_state text, p_locality text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  perform public.sales_require_cap(p_caller, 'manage_reps');
  if p_state is not null and btrim(p_state) <> '' and upper(btrim(p_state)) !~ '^[A-Z]{2}$' then raise exception 'invalid' using errcode = '22023'; end if;
  select work_state, work_locality into v_old from public.sales_reps where id = p_rep for update;
  if not found then raise exception 'rep_not_found' using errcode = 'P0002'; end if;
  update public.sales_reps set work_state = nullif(upper(btrim(p_state)), ''), work_locality = nullif(btrim(p_locality), ''), work_location_updated_at = now() where id = p_rep;
  perform public.sales_program_log('milestone_bonus', 'rep_work_location', p_caller, jsonb_build_object('rep_id', p_rep, 'from', jsonb_build_object('state', v_old.work_state, 'locality', v_old.work_locality),
    'to', jsonb_build_object('state', nullif(upper(btrim(p_state)), ''), 'locality', nullif(btrim(p_locality), ''))));
end $$;

-- Payroll export and reconciliation for one month's statements: every line, labeled standard commission
-- or one-time bonus, with the statement total and recorded payout checked against the lines.
create or replace function public.admin_sales_payroll_export(p_caller uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'payout_operations');
  return jsonb_build_object('month', date_trunc('month', p_month)::date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('rep_id', r.id, 'rep_name', r.full_name, 'rep_email', r.email, 'work_state', r.work_state,
        'line_id', c.id, 'kind', c.kind, 'category', case when c.kind in ('commission', 'clawback', 'accelerator') then 'standard_commission' else 'one_time_bonus' end,
        'year_no', c.year_no, 'reason', c.reason, 'amount_cents', c.amount_cents, 'status', c.status, 'policy_version', c.policy_version,
        'statement_id', s.id, 'statement_status', s.status, 'paid_on', p.paid_on, 'method', p.method, 'reference', p.reference) order by r.full_name, c.kind, c.created_at)
      from public.sales_statements s join public.sales_reps r on r.id = s.rep_id join public.sales_commissions c on c.statement_id = s.id
      left join public.sales_payouts p on p.statement_id = s.id
      where s.period_month = date_trunc('month', p_month)::date and c.status not in ('canceled', 'ineligible', 'reversed')), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object('statement_id', s.id, 'rep_name', r.full_name, 'status', s.status, 'statement_total_cents', s.total_cents,
        'lines_total_cents', t.total, 'payout_cents', p.amount_cents, 'reconciled', s.total_cents = t.total and (p.amount_cents is null or p.amount_cents = s.total_cents)) order by r.full_name)
      from public.sales_statements s join public.sales_reps r on r.id = s.rep_id
      left join public.sales_payouts p on p.statement_id = s.id
      cross join lateral (select coalesce(sum(c.amount_cents), 0)::integer as total from public.sales_commissions c where c.statement_id = s.id and c.status not in ('canceled', 'ineligible', 'reversed')) t
      where s.period_month = date_trunc('month', p_month)::date), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Switch to V3 (one new policy version). Prod had no attributed customers or awards when this was
--     written (2026-11-19), so no earned bonus is affected; awards made under V2 would keep V2 math.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.sales_settings where id and milestone_model = 'v2_window' and milestone_every = 50 and milestone_min_cents = 15000) then
    perform set_config('sales.policy_note', 'Compensation Model V3 (James, 2026-11-19): milestones every 25 qualifying customers (3% at 50-75, 4% at 100-225, 5% from 250), '
      || 'one-time bonus = qualifying active attributed MRR x rate, no minimum, snapshot when earned; qualification at the second billing cycle (annual: one month after payment). Pending owner/counsel confirmation.', true);
    update public.sales_settings set milestone_model = 'v3_active_mrr', milestone_qualification = 'second_cycle', milestone_every = 25,
      milestone_rates = '[{"from":50,"pct":3},{"from":100,"pct":4},{"from":250,"pct":5}]'::jsonb, milestone_min_cents = 0,
      milestone_flat = '[{"at":10,"cents":2500,"badge":"First 10"},{"at":25,"cents":7500,"badge":"25 Club"}]'::jsonb, updated_at = now()
    where id;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_record_revenue_v3(uuid, text, integer, integer, timestamptz, numeric, text)', 'public.sales_revenue_disputed(text, boolean)',
    'public.sales_set_mrr(uuid, integer, jsonb)', 'public.sales_period_months(numeric, jsonb)', 'public.sales_cycle_invoices(uuid)',
    'public.sales_customer_qualified_at(uuid, timestamptz)', 'public.sales_customer_mrr(uuid)', 'public.sales_milestone_customers(uuid, timestamptz)',
    'public.sales_milestone_accounts(uuid)', 'public.sales_rep_mrr(uuid, timestamptz)',
    'public.sales_milestone_rule(public.sales_settings, integer)', 'public.sales_next_milestone(public.sales_settings, integer)',
    'public.sales_current_milestone(public.sales_settings, integer)', 'public.sales_program_log(text, text, uuid, jsonb)',
    'public.sales_program_status(text, uuid, date)', 'public.sales_programs_sweep(timestamptz)', 'public.sales_snapshot_hash(jsonb)',
    'public.sales_milestones_evaluate(uuid, timestamptz)', 'public.sales_milestone_json(public.sales_milestone_awards)',
    'public.admin_sales_milestone_approve_v82(uuid, uuid)', 'public.admin_sales_milestones(uuid)', 'public.admin_sales_milestone_rules_save_v82(uuid, integer, jsonb, integer, jsonb, text)',
    'public.admin_sales_milestone_model_save(uuid, text, text, text)', 'public.sales_compensation_for(uuid, timestamptz)',
    'public.admin_sales_compensation(uuid, integer)', 'public.admin_sales_milestone_dispute_resolve(uuid, uuid, text, text, integer)',
    'public.admin_sales_programs(uuid)', 'public.admin_sales_program_set(uuid, text, boolean, text)', 'public.admin_sales_program_emergency(uuid, text, boolean, text)',
    'public.admin_sales_jurisdiction_save(uuid, text, text, text, text, text, text, date, date, text)', 'public.admin_sales_jurisdiction_revoke(uuid, uuid, text)',
    'public.admin_sales_rep_work_location(uuid, uuid, text, text)', 'public.admin_sales_payroll_export(uuid, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.sales_my_compensation()', 'public.sales_my_milestone_dispute(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on public.sales_incentive_programs, public.sales_program_jurisdictions, public.sales_program_events, public.sales_milestone_disputes from anon, authenticated;
grant all on public.sales_incentive_programs, public.sales_program_jurisdictions, public.sales_program_events, public.sales_milestone_disputes to service_role;
