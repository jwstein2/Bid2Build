-- Sales Portal, Phase 1: sales staff, rep referral links, account-level attribution, the commission
-- ledger, month-end statements and owner-recorded payouts.
--
-- Separate from the customer referral program (20261115003001_referrals.sql): different tables, a
-- different link (/s/<code>), a different cookie, and nothing here changes Stripe or a customer's bill.
--
-- Security model
--   * RLS is on for every table and no role gets direct table grants. All access goes through
--     security definer functions.
--   * Owner functions (admin_sales_*) take p_caller, are callable only with the service role, and
--     re-check is_admin(p_caller). Every owner change writes audit_logs in the same transaction.
--   * Rep functions (sales_my_*) use auth.uid() and only return the caller's own rows. A rep never
--     sees a customer's bids, financials or operational data: only business name, contact email,
--     plan tier, subscription status and key dates for customers attributed to them.
--   * Billing hooks (sales_sync_billing, sales_invoice_refunded, sales_close_month) are service-role
--     only and are called from the signature-verified Stripe webhook and the month-end job.
--
-- Commission rules live in public.sales_settings (owner-editable, recorded in the audit log), not in
-- code. Until the owner confirms the policy, commissions are still tracked but cannot be approved or
-- paid.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Policy
-- ---------------------------------------------------------------------------
create table if not exists public.sales_settings (
  id boolean primary key default true check (id),
  -- Annual plans: 'divide_12' = annual price / 12; 'monthly_list' = the monthly plan's list price;
  -- 'full_payment' = the whole annual payment.
  annual_basis text not null default 'monthly_list' check (annual_basis in ('divide_12', 'monthly_list', 'full_payment')),
  -- 'month_end_clawback': refund before payout voids the commission, after payout it is deducted
  --   from the next statement. 'hold_30_no_clawback': commissions wait 30 days after payment; a
  --   refund in that window voids it, later refunds never affect the rep. 'never_reverse': refunds
  --   never change a commission.
  refund_policy text not null default 'month_end_clawback' check (refund_policy in ('month_end_clawback', 'hold_30_no_clawback', 'never_reverse')),
  -- What one month of "subscription value" includes: 'plan_seats' (plan + Enterprise seats),
  -- 'all_items' (also paid add-ons), 'base_plan' (main plan price only). Always before tax.
  value_scope text not null default 'all_items' check (value_scope in ('plan_seats', 'all_items', 'base_plan')),
  commission_years integer not null default 3 check (commission_years between 1 and 10),
  -- A link visit attributes an account created within this many days of the visit (or after it).
  attribution_window_days integer not null default 30 check (attribution_window_days between 1 and 365),
  -- Months are closed in this time zone (sale month / anniversary month boundaries).
  time_zone text not null default 'America/Chicago',
  policy_confirmed_at timestamptz,
  policy_confirmed_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.sales_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Sales staff
-- ---------------------------------------------------------------------------
create table if not exists public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  -- Linked the first time the invited person signs in to the sales portal with this verified email.
  user_id uuid unique references auth.users (id) on delete set null,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  -- 'rep' sees only their own customers and leads; 'manager' also sees the team's (later phases).
  role text not null default 'rep' check (role in ('rep', 'manager')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'removed')),
  code text not null unique check (code ~ '^[A-Z2-9]{6,12}$'),
  -- How the owner pays this person (free text, e.g. "ACH via Gusto"). Never bank numbers.
  payout_note text check (payout_note is null or char_length(payout_note) <= 300),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_reps_email_live on public.sales_reps (email) where status <> 'removed';

-- Visits and funnel milestones per rep. No IP address, user agent or other personal data.
create table if not exists public.sales_link_events (
  id bigint generated always as identity primary key,
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  kind text not null check (kind in ('visit', 'signup', 'estimate', 'install', 'purchase')),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sales_link_events_rep on public.sales_link_events (rep_id, kind, created_at);
create unique index if not exists sales_link_events_once on public.sales_link_events (rep_id, kind, user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Attribution: one rep per customer account, stored on the account (not a cookie)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_attributions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rep_id uuid not null references public.sales_reps (id),
  source text not null check (source in ('link', 'manual')),
  code text,
  attributed_at timestamptz not null default now(),
  company_id uuid,
  plan text,
  sub_status text,
  stripe_subscription_id text,
  -- Commission basis: one month of qualifying subscription value in cents (before tax), per policy.
  -- Updated from every subscription change, so an upgrade counts as soon as it happens.
  basis_cents integer check (basis_cents is null or basis_cents >= 0),
  basis_detail jsonb,
  basis_updated_at timestamptz,
  first_paid_at timestamptz,
  first_paid_month date,
  last_paid_at timestamptz,
  -- Set when the owner ends the attribution (no further commissions are created).
  ended_at timestamptz,
  ended_reason text
);
create index if not exists sales_attributions_rep on public.sales_attributions (rep_id);

create table if not exists public.sales_attribution_history (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  from_rep uuid references public.sales_reps (id),
  to_rep uuid references public.sales_reps (id),
  action text not null check (action in ('linked', 'assigned', 'reassigned', 'ended')),
  reason text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Commission ledger, statements and payouts
-- ---------------------------------------------------------------------------
create table if not exists public.sales_statements (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  period_month date not null check (extract(day from period_month) = 1),
  status text not null default 'open' check (status in ('open', 'approved', 'paid')),
  total_cents integer not null default 0,
  line_count integer not null default 0,
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  unique (rep_id, period_month)
);

create table if not exists public.sales_commissions (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  user_id uuid references auth.users (id) on delete set null,
  -- 1 = sale month, 2 and 3 = anniversary months (up to sales_settings.commission_years).
  year_no integer not null check (year_no between 1 and 10),
  kind text not null default 'commission' check (kind in ('commission', 'clawback')),
  period_month date not null check (extract(day from period_month) = 1),
  amount_cents integer not null,
  basis_detail jsonb,
  status text not null check (status in ('pending', 'earned', 'approved', 'paid', 'ineligible', 'canceled', 'reversed')),
  reason text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  statement_id uuid references public.sales_statements (id),
  created_at timestamptz not null default now(),
  earned_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((kind = 'commission' and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0))
);
-- One commission per customer per year, and at most one clawback for it: no duplicate payouts.
create unique index if not exists sales_commissions_once on public.sales_commissions (user_id, year_no, kind);
create index if not exists sales_commissions_rep on public.sales_commissions (rep_id, status, period_month);
create index if not exists sales_commissions_invoice on public.sales_commissions (stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists sales_commissions_statement on public.sales_commissions (statement_id);

create table if not exists public.sales_payouts (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  -- One payout per statement: recording the same statement twice is refused.
  statement_id uuid not null unique references public.sales_statements (id),
  amount_cents integer not null,
  method text not null check (method in ('ach', 'check', 'payroll', 'paypal', 'other')),
  reference text check (reference is null or char_length(reference) <= 200),
  paid_on date not null,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.sales_settings enable row level security;
alter table public.sales_reps enable row level security;
alter table public.sales_link_events enable row level security;
alter table public.sales_attributions enable row level security;
alter table public.sales_attribution_history enable row level security;
alter table public.sales_statements enable row level security;
alter table public.sales_commissions enable row level security;
alter table public.sales_payouts enable row level security;
revoke all on public.sales_settings, public.sales_reps, public.sales_link_events, public.sales_attributions,
  public.sales_attribution_history, public.sales_statements, public.sales_commissions, public.sales_payouts
  from public, anon, authenticated;
grant all on public.sales_settings, public.sales_reps, public.sales_link_events, public.sales_attributions,
  public.sales_attribution_history, public.sales_statements, public.sales_commissions, public.sales_payouts
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.sales_month_of(p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select date_trunc('month', p_at at time zone coalesce((select time_zone from public.sales_settings where id), 'America/Chicago'))::date
$$;

create or replace function public.sales_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  v text;
begin
  loop
    b := uuid_send(gen_random_uuid());
    v := '';
    for i in 0..7 loop
      v := v || substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.sales_reps where code = v);
  end loop;
  return v;
end $$;

-- Customer tier label for the rep's customer list.
create or replace function public.sales_tier(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.subscriptions s where s.user_id = p_user and s.status = 'trialing') then 'trial'
    when exists (select 1 from public.subscriptions s where s.user_id = p_user and s.status in ('active', 'past_due') and s.plan = 'enterprise') then 'enterprise'
    when exists (select 1 from public.subscriptions s where s.user_id = p_user and s.status in ('active', 'past_due')) then 'standard'
    when coalesce((select e.tier from public.user_entitlement(p_user) e), 'free') <> 'free' then 'complimentary'
    else 'free'
  end
$$;

-- Recompute a statement's totals from its lines.
create or replace function public.sales_statement_refresh(p_statement uuid) returns void
language sql security definer set search_path = public as $$
  update public.sales_statements st set
    total_cents = coalesce((select sum(c.amount_cents) from public.sales_commissions c where c.statement_id = st.id and c.status in ('earned', 'approved', 'paid')), 0),
    line_count = (select count(*) from public.sales_commissions c where c.statement_id = st.id)
  where st.id = p_statement
$$;

create or replace function public.sales_audit(p_actor uuid, p_action text, p_type text, p_id text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details) values (p_actor, p_action, p_type, p_id, p_details)
$$;

-- ---------------------------------------------------------------------------
-- 6. Link visits and attribution (service role: the /s/<code> route and the signed-in layout)
-- ---------------------------------------------------------------------------
create or replace function public.sales_log_visit(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rep uuid;
begin
  select id into v_rep from public.sales_reps where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if v_rep is null then return false; end if;
  insert into public.sales_link_events (rep_id, kind) values (v_rep, 'visit');
  return true;
end $$;

-- Record that an account arrived through a rep's link. Idempotent. Returns a short result code.
-- Rules: active rep; one rep per account (never reassigned here); not the rep's own account; not an
-- internal/test/demo account; never had a subscription; created within the window of the visit.
create or replace function public.sales_record_attribution(p_user uuid, p_code text, p_visit_at timestamptz default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  cfg public.sales_settings;
  v_email text; v_created timestamptz;
begin
  if p_user is null then return 'unknown_code'; end if;
  select * into rep from public.sales_reps where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if not found then return 'unknown_code'; end if;
  if exists (select 1 from public.sales_attributions where user_id = p_user) then return 'already_attributed'; end if;
  select * into cfg from public.sales_settings where id;
  select lower(email), created_at into v_email, v_created from auth.users where id = p_user;
  if not found then return 'unknown_code'; end if;
  if rep.user_id = p_user or v_email = rep.email
     or exists (select 1 from public.sales_reps r where r.user_id = p_user and r.status <> 'removed') then
    return 'ineligible:sales_staff';
  end if;
  if public.referral_excluded(p_user) is not null then return 'ineligible:' || public.referral_excluded(p_user); end if;
  if exists (select 1 from public.subscriptions s where s.user_id = p_user) then return 'existing_customer'; end if;
  if v_created < coalesce(least(p_visit_at, now()), now()) - make_interval(days => cfg.attribution_window_days) then
    return 'existing_account';
  end if;
  insert into public.sales_attributions (user_id, rep_id, source, code) values (p_user, rep.id, 'link', rep.code)
  on conflict (user_id) do nothing;
  if not found then return 'already_attributed'; end if;
  insert into public.sales_attribution_history (user_id, to_rep, action) values (p_user, rep.id, 'linked');
  insert into public.sales_link_events (rep_id, kind, user_id) values (rep.id, 'signup', p_user) on conflict do nothing;
  return 'recorded';
end $$;

-- Funnel milestone for an attributed account (first estimate, web app installed). Idempotent.
create or replace function public.sales_record_milestone(p_user uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rep uuid;
begin
  if p_kind not in ('estimate', 'install') then return false; end if;
  select rep_id into v_rep from public.sales_attributions where user_id = p_user and ended_at is null;
  if v_rep is null then return false; end if;
  insert into public.sales_link_events (rep_id, kind, user_id) values (v_rep, p_kind, p_user) on conflict do nothing;
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Billing hooks (service role: Stripe webhook)
-- ---------------------------------------------------------------------------
-- Called for every subscription change and paid invoice of an account. Keeps the attribution's plan,
-- status and commission basis current, and creates the commission for the sale month (first non-zero
-- paid invoice) and for each anniversary month in which the customer pays.
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
          case when rep.status = 'removed' then 'ineligible' when v_basis is null then 'pending' else 'pending' end,
          case when rep.status = 'removed' then 'rep_removed' when v_basis is null then 'basis_missing' else null end,
          p_invoice_id, p_subscription_id)
  on conflict (user_id, year_no, kind) do nothing;
  if found then v_created := 'year_' || v_year; end if;
  return jsonb_build_object('action', coalesce('created_' || v_created, 'synced'));
end $$;

-- A Stripe invoice was refunded (charge.refunded). Applies sales_settings.refund_policy.
create or replace function public.sales_invoice_refunded(p_invoice_id text, p_full boolean, p_refunded_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg public.sales_settings;
  c public.sales_commissions;
  v_out text := 'none';
begin
  if p_invoice_id is null then return jsonb_build_object('action', 'none'); end if;
  select * into cfg from public.sales_settings where id;
  select * into c from public.sales_commissions where stripe_invoice_id = p_invoice_id and kind = 'commission' for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  if not p_full then
    update public.sales_commissions set reason = left(coalesce(reason || '; ', '') || 'partial refund ' || to_char(p_refunded_at, 'YYYY-MM-DD') || ', review', 300), updated_at = now() where id = c.id;
    return jsonb_build_object('action', 'flagged_partial');
  end if;
  if cfg.refund_policy = 'never_reverse' then return jsonb_build_object('action', 'kept_by_policy'); end if;

  if c.status in ('pending', 'earned', 'approved') then
    if cfg.refund_policy = 'hold_30_no_clawback' and c.created_at < p_refunded_at - interval '30 days' then
      return jsonb_build_object('action', 'kept_by_policy');
    end if;
    update public.sales_commissions set status = 'reversed', reversed_at = now(), reason = 'invoice_refunded', updated_at = now() where id = c.id;
    if c.statement_id is not null then perform public.sales_statement_refresh(c.statement_id); end if;
    v_out := 'reversed';
  elsif c.status = 'paid' and cfg.refund_policy = 'month_end_clawback' then
    insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, status, reason, stripe_invoice_id, stripe_subscription_id, earned_at)
    values (c.rep_id, c.user_id, c.year_no, 'clawback', public.sales_month_of(p_refunded_at), -c.amount_cents, 'earned', 'invoice_refunded_after_payout', null, c.stripe_subscription_id, now())
    on conflict (user_id, year_no, kind) do nothing;
    if found then v_out := 'clawback'; end if;
  end if;
  return jsonb_build_object('action', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Month-end close (service role: daily job; owners can also run it from the Sales Hub)
-- ---------------------------------------------------------------------------
-- Idempotent. For every month before the current one:
--   * an anniversary month with no paid invoice becomes an 'ineligible' line (so the history is clear);
--   * pending commissions become earned (hold_30 policy: once 30 days old);
--   * earned lines without a statement are put on that rep's open statement for the last closed month.
create or replace function public.sales_close_month(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg public.sales_settings;
  v_current date;
  v_closing date;
  a record;
  n integer;
  v_ann date;
  v_missed integer := 0;
  v_earned integer := 0;
  v_lines integer := 0;
  r record;
  v_statement uuid;
begin
  select * into cfg from public.sales_settings where id;
  v_current := public.sales_month_of(p_now);
  v_closing := (v_current - interval '1 month')::date;

  for a in select * from public.sales_attributions where first_paid_month is not null and ended_at is null loop
    for n in 2..cfg.commission_years loop
      v_ann := (a.first_paid_month + make_interval(months => 12 * (n - 1)))::date;
      exit when v_ann >= v_current;
      insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason)
      values (a.rep_id, a.user_id, n, 'commission', v_ann, 0, a.basis_detail, 'ineligible', 'no_paid_invoice_in_anniversary_month')
      on conflict (user_id, year_no, kind) do nothing;
      if found then v_missed := v_missed + 1; end if;
    end loop;
  end loop;

  update public.sales_commissions set status = 'earned', earned_at = p_now, updated_at = now()
  where status = 'pending' and kind = 'commission' and period_month < v_current and amount_cents > 0
    and (cfg.refund_policy <> 'hold_30_no_clawback' or created_at <= p_now - interval '30 days');
  get diagnostics v_earned = row_count;

  for r in select distinct c.rep_id from public.sales_commissions c where c.status = 'earned' and c.statement_id is null and c.period_month < v_current loop
    insert into public.sales_statements (rep_id, period_month) values (r.rep_id, v_closing) on conflict (rep_id, period_month) do nothing;
    select id into v_statement from public.sales_statements where rep_id = r.rep_id and period_month = v_closing and status = 'open';
    continue when v_statement is null; -- already approved: lines wait for next month's statement
    update public.sales_commissions set statement_id = v_statement, updated_at = now()
    where rep_id = r.rep_id and status = 'earned' and statement_id is null and period_month < v_current;
    get diagnostics n = row_count;
    v_lines := v_lines + n;
    perform public.sales_statement_refresh(v_statement);
  end loop;

  return jsonb_build_object('closing_month', v_closing, 'missed_anniversaries', v_missed, 'earned', v_earned, 'statement_lines', v_lines);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Rep functions (authenticated; own rows only)
-- ---------------------------------------------------------------------------
-- The caller's sales staff record. Links an invited record on first sign-in with the same verified email.
create or replace function public.sales_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select * into rep from public.sales_reps where user_id = auth.uid();
  if not found then
    select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
    if v_email is null or v_confirmed is null then return null; end if;
    update public.sales_reps set user_id = auth.uid(), status = case when status = 'invited' then 'active' else status end,
      activated_at = coalesce(activated_at, now()), updated_at = now()
    where email = v_email and user_id is null and status in ('invited', 'active')
    returning * into rep;
    if not found then return null; end if;
  end if;
  if rep.status not in ('active') then return jsonb_build_object('status', rep.status); end if;
  return jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'role', rep.role, 'status', rep.status, 'code', rep.code);
end $$;

-- Rep dashboard: link funnel, attributed customers (limited fields), commissions and statements.
create or replace function public.sales_my_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rep public.sales_reps;
  cfg public.sales_settings;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into cfg from public.sales_settings where id;
  return jsonb_build_object(
    'rep', jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'role', rep.role, 'code', rep.code),
    'policy', jsonb_build_object('annual_basis', cfg.annual_basis, 'refund_policy', cfg.refund_policy, 'value_scope', cfg.value_scope, 'commission_years', cfg.commission_years, 'confirmed', cfg.policy_confirmed_at is not null),
    'funnel', jsonb_build_object(
      'visits', (select count(*) from public.sales_link_events e where e.rep_id = rep.id and e.kind = 'visit'),
      'visits_30d', (select count(*) from public.sales_link_events e where e.rep_id = rep.id and e.kind = 'visit' and e.created_at > now() - interval '30 days'),
      'signups', (select count(*) from public.sales_attributions x where x.rep_id = rep.id),
      'activated', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and exists (select 1 from public.estimates es where es.user_id = x.user_id)),
      'installs', (select count(*) from public.sales_link_events e where e.rep_id = rep.id and e.kind = 'install'),
      'paying', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and x.first_paid_at is not null and x.sub_status in ('active', 'past_due', 'trialing') and x.ended_at is null),
      'purchased', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and x.first_paid_at is not null),
      'canceled', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and x.first_paid_at is not null and x.sub_status in ('canceled', 'unpaid', 'incomplete_expired'))
    ),
    'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'business', nullif(bp.company_name, ''), 'email', u.email, 'tier', public.sales_tier(x.user_id),
        'plan', x.plan, 'sub_status', x.sub_status, 'signed_up_at', u.created_at, 'attributed_at', x.attributed_at,
        'first_paid_at', x.first_paid_at, 'last_paid_at', x.last_paid_at, 'basis_cents', x.basis_cents,
        'has_estimate', exists (select 1 from public.estimates es where es.user_id = x.user_id), 'ended', x.ended_at is not null,
        'next_anniversary', case when x.first_paid_month is null or x.ended_at is not null then null else (
          select min((x.first_paid_month + make_interval(months => 12 * k))::date) from generate_series(1, cfg.commission_years - 1) k
          where (x.first_paid_month + make_interval(months => 12 * k))::date >= public.sales_month_of(now())) end
      ) order by x.attributed_at desc)
      from public.sales_attributions x join auth.users u on u.id = x.user_id left join public.business_profiles bp on bp.user_id = x.user_id
      where x.rep_id = rep.id), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'business', nullif(bp.company_name, ''), 'email', u.email, 'year_no', c.year_no, 'kind', c.kind,
        'period_month', c.period_month, 'amount_cents', c.amount_cents, 'status', c.status, 'reason', c.reason, 'paid_at', c.paid_at
      ) order by c.period_month desc, c.created_at desc)
      from public.sales_commissions c left join auth.users u on u.id = c.user_id left join public.business_profiles bp on bp.user_id = c.user_id
      where c.rep_id = rep.id), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'period_month', s.period_month, 'status', s.status, 'total_cents', s.total_cents, 'line_count', s.line_count,
        'paid_at', s.paid_at, 'paid_on', p.paid_on, 'method', p.method
      ) order by s.period_month desc)
      from public.sales_statements s left join public.sales_payouts p on p.statement_id = s.id
      where s.rep_id = rep.id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 10. Owner functions (service role, re-check is_admin)
-- ---------------------------------------------------------------------------
create or replace function public.sales_require_admin(p_caller uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller is null or not public.is_admin(p_caller) then raise exception 'not_authorized' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_sales_hub(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.sales_settings;
begin
  perform public.sales_require_admin(p_caller);
  select * into cfg from public.sales_settings where id;
  return jsonb_build_object(
    'settings', to_jsonb(cfg),
    'reps', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'email', r.email, 'full_name', r.full_name, 'phone', r.phone, 'role', r.role, 'status', r.status, 'code', r.code,
        'payout_note', r.payout_note, 'linked', r.user_id is not null, 'created_at', r.created_at, 'activated_at', r.activated_at,
        'visits', (select count(*) from public.sales_link_events e where e.rep_id = r.id and e.kind = 'visit'),
        'signups', (select count(*) from public.sales_attributions x where x.rep_id = r.id),
        'paying', (select count(*) from public.sales_attributions x where x.rep_id = r.id and x.first_paid_at is not null and x.sub_status in ('active', 'past_due', 'trialing') and x.ended_at is null),
        'earned_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.rep_id = r.id and c.status in ('earned', 'approved')),
        'pending_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.rep_id = r.id and c.status = 'pending'),
        'paid_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.rep_id = r.id and c.status = 'paid')
      ) order by r.status = 'removed', r.full_name) from public.sales_reps r), '[]'::jsonb),
    'attributions', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', x.user_id, 'email', u.email, 'business', nullif(bp.company_name, ''), 'rep_id', x.rep_id, 'rep_name', r.full_name,
        'source', x.source, 'attributed_at', x.attributed_at, 'tier', public.sales_tier(x.user_id), 'plan', x.plan, 'sub_status', x.sub_status,
        'basis_cents', x.basis_cents, 'first_paid_at', x.first_paid_at, 'ended_at', x.ended_at, 'ended_reason', x.ended_reason
      ) order by x.attributed_at desc)
      from public.sales_attributions x join public.sales_reps r on r.id = x.rep_id join auth.users u on u.id = x.user_id
      left join public.business_profiles bp on bp.user_id = x.user_id), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'rep_id', c.rep_id, 'rep_name', r.full_name, 'email', u.email, 'business', nullif(bp.company_name, ''),
        'year_no', c.year_no, 'kind', c.kind, 'period_month', c.period_month, 'amount_cents', c.amount_cents, 'status', c.status,
        'reason', c.reason, 'statement_id', c.statement_id, 'stripe_invoice_id', c.stripe_invoice_id, 'created_at', c.created_at
      ) order by c.period_month desc, c.created_at desc)
      from public.sales_commissions c join public.sales_reps r on r.id = c.rep_id left join auth.users u on u.id = c.user_id
      left join public.business_profiles bp on bp.user_id = c.user_id), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'rep_id', s.rep_id, 'rep_name', r.full_name, 'payout_note', r.payout_note, 'period_month', s.period_month, 'status', s.status,
        'total_cents', s.total_cents, 'line_count', s.line_count, 'approved_at', s.approved_at, 'paid_at', s.paid_at,
        'payout', (select jsonb_build_object('method', p.method, 'reference', p.reference, 'paid_on', p.paid_on, 'amount_cents', p.amount_cents) from public.sales_payouts p where p.statement_id = s.id)
      ) order by s.period_month desc, r.full_name)
      from public.sales_statements s join public.sales_reps r on r.id = s.rep_id), '[]'::jsonb)
  );
end $$;

-- Add or update a sales staff member. Email identifies the person; a new person gets a permanent code.
create or replace function public.admin_sales_rep_save(
  p_caller uuid, p_id uuid, p_email text, p_full_name text, p_phone text, p_role text, p_status text, p_payout_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.sales_require_admin(p_caller);
  if p_role not in ('rep', 'manager') then raise exception 'invalid_role'; end if;
  if p_status not in ('invited', 'active', 'suspended', 'removed') then raise exception 'invalid_status'; end if;
  if exists (select 1 from public.admin_roles a join auth.users u on u.id = a.user_id where lower(u.email) = v_email) then
    raise exception 'owner_cannot_be_rep';
  end if;
  if p_id is null then
    insert into public.sales_reps (email, full_name, phone, role, status, code, payout_note, invited_by, user_id, activated_at)
    values (v_email, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''), p_role, 'invited', public.sales_new_code(), nullif(btrim(coalesce(p_payout_note, '')), ''), p_caller, null, null)
    returning * into rep;
    perform public.sales_audit(p_caller, 'sales.rep_invited', 'sales_rep', rep.id::text, jsonb_build_object('email', v_email, 'role', p_role));
  else
    select * into rep from public.sales_reps where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    update public.sales_reps set
      email = case when user_id is null then v_email else email end,
      full_name = btrim(p_full_name), phone = nullif(btrim(coalesce(p_phone, '')), ''), role = p_role,
      -- An invited person becomes active only by signing in; the owner can suspend, remove or restore.
      status = case when p_status = 'active' and user_id is null then 'invited' when p_status = 'invited' and user_id is not null then 'active' else p_status end,
      payout_note = nullif(btrim(coalesce(p_payout_note, '')), ''), updated_at = now()
    where id = p_id returning * into rep;
    perform public.sales_audit(p_caller, 'sales.rep_updated', 'sales_rep', rep.id::text, jsonb_build_object('role', rep.role, 'status', rep.status));
  end if;
  return to_jsonb(rep);
end $$;

-- Assign (or reassign) a customer account to a rep by hand. A reason is required and recorded.
-- Reassigning never moves commissions already created; future ones go to the new rep.
create or replace function public.admin_sales_attribution_set(p_caller uuid, p_customer_email text, p_rep uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  prev public.sales_attributions;
  rep public.sales_reps;
begin
  perform public.sales_require_admin(p_caller);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_customer_email, ''))) limit 1;
  if v_user is null then raise exception 'customer_not_found'; end if;
  select * into rep from public.sales_reps where id = p_rep and status in ('active', 'invited', 'suspended');
  if not found then raise exception 'rep_not_found'; end if;
  if rep.user_id = v_user or exists (select 1 from public.sales_reps r where r.user_id = v_user and r.status <> 'removed') then raise exception 'customer_is_sales_staff'; end if;
  select * into prev from public.sales_attributions where user_id = v_user for update;
  if found then
    if prev.rep_id = p_rep and prev.ended_at is null then return jsonb_build_object('action', 'unchanged'); end if;
    update public.sales_attributions set rep_id = p_rep, source = 'manual', ended_at = null, ended_reason = null where user_id = v_user;
    insert into public.sales_attribution_history (user_id, from_rep, to_rep, action, reason, actor_id) values (v_user, prev.rep_id, p_rep, 'reassigned', btrim(p_reason), p_caller);
    perform public.sales_audit(p_caller, 'sales.attribution_reassigned', 'user', v_user::text, jsonb_build_object('from', prev.rep_id, 'to', p_rep, 'reason', btrim(p_reason)));
    return jsonb_build_object('action', 'reassigned');
  end if;
  insert into public.sales_attributions (user_id, rep_id, source) values (v_user, p_rep, 'manual');
  -- Bring in the current subscription so a later anniversary is recognized.
  update public.sales_attributions x set stripe_subscription_id = s.stripe_subscription_id, sub_status = s.status, plan = s.plan, company_id = s.company_id
  from (select * from public.subscriptions where user_id = v_user order by updated_at desc limit 1) s where x.user_id = v_user;
  insert into public.sales_attribution_history (user_id, to_rep, action, reason, actor_id) values (v_user, p_rep, 'assigned', btrim(p_reason), p_caller);
  perform public.sales_audit(p_caller, 'sales.attribution_assigned', 'user', v_user::text, jsonb_build_object('to', p_rep, 'reason', btrim(p_reason)));
  return jsonb_build_object('action', 'assigned');
end $$;

create or replace function public.admin_sales_attribution_end(p_caller uuid, p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev public.sales_attributions;
begin
  perform public.sales_require_admin(p_caller);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into prev from public.sales_attributions where user_id = p_user for update;
  if not found or prev.ended_at is not null then raise exception 'not_found'; end if;
  update public.sales_attributions set ended_at = now(), ended_reason = btrim(p_reason) where user_id = p_user;
  update public.sales_commissions set status = 'canceled', reason = 'attribution_ended', updated_at = now() where user_id = p_user and status = 'pending';
  insert into public.sales_attribution_history (user_id, from_rep, action, reason, actor_id) values (p_user, prev.rep_id, 'ended', btrim(p_reason), p_caller);
  perform public.sales_audit(p_caller, 'sales.attribution_ended', 'user', p_user::text, jsonb_build_object('rep', prev.rep_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('action', 'ended');
end $$;

-- Owner adjustment of one commission line: mark ineligible/canceled (with reason), or restore an
-- ineligible line to earned with an amount (e.g. a late anniversary payment).
create or replace function public.admin_sales_commission_set(p_caller uuid, p_id uuid, p_status text, p_amount_cents integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.sales_commissions;
begin
  perform public.sales_require_admin(p_caller);
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  if p_status not in ('pending', 'earned', 'ineligible', 'canceled') then raise exception 'invalid_status'; end if;
  select * into c from public.sales_commissions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if c.status in ('approved', 'paid') then raise exception 'locked_after_approval'; end if;
  update public.sales_commissions set status = p_status,
    amount_cents = case when p_amount_cents is null then amount_cents when kind = 'clawback' then -abs(p_amount_cents) else abs(p_amount_cents) end,
    earned_at = case when p_status = 'earned' then coalesce(earned_at, now()) else earned_at end,
    statement_id = case when p_status in ('ineligible', 'canceled') then null else statement_id end,
    reason = btrim(p_reason), updated_at = now()
  where id = p_id returning * into c;
  if c.statement_id is not null then perform public.sales_statement_refresh(c.statement_id); end if;
  perform public.sales_statement_refresh(s.id) from public.sales_statements s where s.status = 'open' and s.rep_id = c.rep_id;
  perform public.sales_audit(p_caller, 'sales.commission_adjusted', 'sales_commission', p_id::text, jsonb_build_object('status', p_status, 'amount_cents', c.amount_cents, 'reason', btrim(p_reason)));
  return to_jsonb(c);
end $$;

create or replace function public.admin_sales_statement_approve(p_caller uuid, p_statement uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_statements;
begin
  perform public.sales_require_admin(p_caller);
  if (select policy_confirmed_at from public.sales_settings where id) is null then raise exception 'policy_not_confirmed'; end if;
  select * into s from public.sales_statements where id = p_statement for update;
  if not found then raise exception 'not_found'; end if;
  if s.status <> 'open' then raise exception 'already_approved'; end if;
  perform public.sales_statement_refresh(p_statement);
  update public.sales_commissions set status = 'approved', approved_at = now(), updated_at = now() where statement_id = p_statement and status = 'earned';
  update public.sales_statements set status = 'approved', approved_at = now(), approved_by = p_caller where id = p_statement returning * into s;
  perform public.sales_audit(p_caller, 'sales.statement_approved', 'sales_statement', p_statement::text, jsonb_build_object('total_cents', s.total_cents, 'rep', s.rep_id));
  return to_jsonb(s);
end $$;

-- Record that the owner paid an approved statement outside Built2Bid. Nothing is sent to a bank or Stripe.
create or replace function public.admin_sales_payout_record(p_caller uuid, p_statement uuid, p_method text, p_reference text, p_paid_on date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales_statements; p public.sales_payouts;
begin
  perform public.sales_require_admin(p_caller);
  select * into s from public.sales_statements where id = p_statement for update;
  if not found then raise exception 'not_found'; end if;
  if s.status = 'paid' or exists (select 1 from public.sales_payouts where statement_id = p_statement) then raise exception 'already_paid'; end if;
  if s.status <> 'approved' then raise exception 'approve_first'; end if;
  insert into public.sales_payouts (rep_id, statement_id, amount_cents, method, reference, paid_on, recorded_by)
  values (s.rep_id, s.id, s.total_cents, p_method, nullif(btrim(coalesce(p_reference, '')), ''), coalesce(p_paid_on, current_date), p_caller)
  returning * into p;
  update public.sales_commissions set status = 'paid', paid_at = now(), updated_at = now() where statement_id = p_statement and status = 'approved';
  update public.sales_statements set status = 'paid', paid_at = now() where id = p_statement;
  perform public.sales_audit(p_caller, 'sales.payout_recorded', 'sales_statement', p_statement::text, jsonb_build_object('amount_cents', p.amount_cents, 'method', p_method));
  return to_jsonb(p);
end $$;

create or replace function public.admin_sales_settings_save(
  p_caller uuid, p_annual_basis text, p_refund_policy text, p_value_scope text, p_commission_years integer,
  p_attribution_window_days integer, p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.sales_settings;
begin
  perform public.sales_require_admin(p_caller);
  update public.sales_settings set annual_basis = p_annual_basis, refund_policy = p_refund_policy, value_scope = p_value_scope,
    commission_years = p_commission_years, attribution_window_days = p_attribution_window_days,
    policy_confirmed_at = case when p_confirm then now() else policy_confirmed_at end,
    policy_confirmed_by = case when p_confirm then p_caller else policy_confirmed_by end,
    updated_at = now(), updated_by = p_caller
  where id returning * into cfg;
  perform public.sales_audit(p_caller, 'sales.policy_saved', 'sales_settings', 'policy', to_jsonb(cfg) - 'updated_by' - 'policy_confirmed_by');
  return to_jsonb(cfg);
end $$;

create or replace function public.admin_sales_close_month(p_caller uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.sales_require_admin(p_caller);
  v := public.sales_close_month(now());
  perform public.sales_audit(p_caller, 'sales.month_closed', 'sales_settings', 'close', v);
  return v;
end $$;

-- The current commission policy (service role; the webhook prices the basis with it).
create or replace function public.sales_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'policy_confirmed_by' - 'updated_by' from public.sales_settings s where id
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_month_of(timestamptz)', 'public.sales_new_code()', 'public.sales_tier(uuid)', 'public.sales_statement_refresh(uuid)',
    'public.sales_audit(uuid, text, text, text, jsonb)', 'public.sales_log_visit(text)', 'public.sales_record_attribution(uuid, text, timestamptz)',
    'public.sales_record_milestone(uuid, text)',
    'public.sales_sync_billing(uuid, text, text, text, uuid, integer, jsonb, text, integer, timestamptz)',
    'public.sales_invoice_refunded(text, boolean, timestamptz)', 'public.sales_close_month(timestamptz)',
    'public.sales_require_admin(uuid)', 'public.admin_sales_hub(uuid)',
    'public.admin_sales_rep_save(uuid, uuid, text, text, text, text, text, text)',
    'public.admin_sales_attribution_set(uuid, text, uuid, text)', 'public.admin_sales_attribution_end(uuid, uuid, text)',
    'public.admin_sales_commission_set(uuid, uuid, text, integer, text)', 'public.admin_sales_statement_approve(uuid, uuid)',
    'public.admin_sales_payout_record(uuid, uuid, text, text, date)',
    'public.admin_sales_settings_save(uuid, text, text, text, integer, integer, boolean)', 'public.admin_sales_close_month(uuid)',
    'public.sales_policy()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

revoke execute on function public.sales_me(), public.sales_my_overview() from public, anon;
grant execute on function public.sales_me(), public.sales_my_overview() to authenticated;
