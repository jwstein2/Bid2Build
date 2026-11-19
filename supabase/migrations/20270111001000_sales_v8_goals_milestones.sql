-- Sales Hub V8: team goals + milestone gift-box bonuses. Requires 20270110001000. Safe to re-run.
--
-- Team goals (James, 2026-11-19): one team target per month shown on every Sales Hub dashboard. The
-- target is computed in the app (src/lib/sales/goals.ts) from verified paid sales: new customers whose
-- first payment landed in the month. The owner can override a month's target.
--
-- Milestone bonuses (James, 2026-11-19): a progressive curve of Built2Bid gift boxes.
--   10 accounts: flat $25 + badge.  25 accounts: flat $75 + badge.
--   50 accounts and every 50 after: rate x collected revenue (before tax, net of refunds) from the rep's
--   accounts that are STILL ACTIVE, paid since the previous percentage box (first box: since the first
--   sale). Rates 3% at 50, 4% for 100-200, 5% from 250 on, $150 minimum.
-- Lifetime accounts count toward milestones even if they later cancel, except a customer who canceled in
-- the first month or was fully refunded. Amounts are fixed after a 30-day refund hold, revealed only
-- when the rep opens the box, and paid on the next statement after the owner approves. Fixed formula,
-- no random cash. Nothing here moves money.

-- ---------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_settings add column if not exists team_goal_floor integer not null default 5 check (team_goal_floor between 0 and 10000);
alter table public.sales_settings add column if not exists milestone_every integer not null default 50 check (milestone_every between 1 and 10000);
alter table public.sales_settings add column if not exists milestone_rates jsonb not null
  default '[{"from":50,"pct":3},{"from":100,"pct":4},{"from":250,"pct":5}]'::jsonb check (jsonb_typeof(milestone_rates) = 'array');
alter table public.sales_settings add column if not exists milestone_min_cents integer not null default 15000 check (milestone_min_cents between 0 and 1000000);
-- Early flat-amount boxes before the percentage boxes start.
alter table public.sales_settings add column if not exists milestone_flat jsonb not null
  default '[{"at":10,"cents":2500,"badge":"First 10"},{"at":25,"cents":7500,"badge":"25 Club"}]'::jsonb check (jsonb_typeof(milestone_flat) = 'array');

-- Milestone rules are part of the commission policy: changing them makes a new policy version.
create or replace function public.sales_policy_snapshot(s public.sales_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('annual_basis', s.annual_basis, 'refund_policy', s.refund_policy, 'value_scope', s.value_scope,
    'commission_years', s.commission_years, 'attribution_window_days', s.attribution_window_days, 'time_zone', s.time_zone,
    'first_month_cancel_voids', s.first_month_cancel_voids,
    'milestone_every', s.milestone_every, 'milestone_rates', s.milestone_rates, 'milestone_min_cents', s.milestone_min_cents,
    'milestone_flat', s.milestone_flat)
$$;

-- Record the milestone rules in the current version without starting a new one (they are part of V8).
update public.sales_policy_versions v set policy = public.sales_policy_snapshot(s)
from public.sales_settings s
where s.id and v.version = public.sales_policy_current_version() and not (v.policy ? 'milestone_every');

-- The rate for box number n x every (e.g. account 150 -> 4).
create or replace function public.sales_milestone_rate(p_rates jsonb, p_accounts integer) returns numeric
language sql immutable set search_path = public as $$
  select coalesce((select (r ->> 'pct')::numeric from jsonb_array_elements(p_rates) r
    where (r ->> 'from')::integer <= p_accounts order by (r ->> 'from')::integer desc limit 1), 0)
$$;

-- ---------------------------------------------------------------------------------------------------
-- Collected revenue per paid invoice (Stripe webhook). Before tax; refunds reduce it.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_revenue (
  invoice_id text primary key check (char_length(invoice_id) <= 255),
  rep_id uuid not null references public.sales_reps (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  gross_cents integer not null check (gross_cents >= 0),
  revenue_cents integer not null check (revenue_cents >= 0 and revenue_cents <= gross_cents),
  refunded_cents integer not null default 0,
  paid_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (refunded_cents between 0 and revenue_cents)
);
create index if not exists sales_revenue_rep on public.sales_revenue (rep_id, paid_at);
create index if not exists sales_revenue_user on public.sales_revenue (user_id);
alter table public.sales_revenue enable row level security;

create or replace function public.sales_record_revenue(p_user uuid, p_invoice_id text, p_gross_cents integer, p_revenue_cents integer, p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.sales_attributions;
begin
  if p_invoice_id is null or coalesce(p_gross_cents, 0) <= 0 then return jsonb_build_object('action', 'none'); end if;
  select * into a from public.sales_attributions where user_id = p_user;
  if not found then return jsonb_build_object('action', 'none'); end if;
  insert into public.sales_revenue (invoice_id, rep_id, user_id, gross_cents, revenue_cents, paid_at)
  values (p_invoice_id, a.rep_id, p_user, p_gross_cents, least(greatest(coalesce(p_revenue_cents, p_gross_cents), 0), p_gross_cents), coalesce(p_paid_at, now()))
  on conflict (invoice_id) do nothing;
  return jsonb_build_object('action', case when found then 'recorded' else 'duplicate' end);
end $$;

-- A refund of p_refunded_gross_cents (the charge's total refunded so far) on the invoice.
create or replace function public.sales_revenue_refunded(p_invoice_id text, p_refunded_gross_cents integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sales_revenue;
begin
  select * into r from public.sales_revenue where invoice_id = p_invoice_id for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  update public.sales_revenue set refunded_cents = least(revenue_cents,
    greatest(refunded_cents, round(greatest(p_refunded_gross_cents, 0)::numeric * revenue_cents / nullif(gross_cents, 0))::integer))
  where invoice_id = p_invoice_id;
  return jsonb_build_object('action', 'updated');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Milestone awards (one per rep per box)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_milestone_awards (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  milestone integer not null check (milestone > 0),          -- account number: 50, 100, 150, ...
  pct numeric(5, 2) not null check (pct >= 0 and pct <= 20),
  flat_cents integer check (flat_cents is null or flat_cents between 0 and 1000000),  -- early flat boxes
  badge text check (badge is null or char_length(badge) <= 60),
  min_cents integer not null default 0 check (min_cents >= 0),
  window_start timestamptz not null,                           -- previous percentage box (or first sale)
  reached_at timestamptz not null,                             -- first payment of the milestone account
  unlocks_at timestamptz not null,                             -- reached_at + 30-day refund hold
  revenue_cents integer check (revenue_cents is null or revenue_cents >= 0),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  status text not null default 'locked' check (status in ('locked', 'ready', 'approved', 'void')),
  opened_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  commission_id uuid references public.sales_commissions (id),
  policy_version integer,
  created_at timestamptz not null default now(),
  unique (rep_id, milestone)
);
alter table public.sales_milestone_awards enable row level security;

-- A bonus line in the commission ledger, so it rides the normal statement, approval and payout flow.
alter table public.sales_commissions drop constraint if exists sales_commissions_kind_check;
alter table public.sales_commissions add constraint sales_commissions_kind_check check (kind in ('commission', 'clawback', 'bonus'));
alter table public.sales_commissions drop constraint if exists sales_commissions_check;
alter table public.sales_commissions add constraint sales_commissions_check
  check ((kind in ('commission', 'bonus') and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0));

-- Accounts that count toward milestones, in order of first payment.
create or replace function public.sales_milestone_accounts(p_rep uuid) returns table (user_id uuid, first_paid_at timestamptz, n bigint)
language sql stable security definer set search_path = public as $$
  select x.user_id, x.first_paid_at, row_number() over (order by x.first_paid_at, x.user_id)
  from public.sales_attributions x
  where x.rep_id = p_rep and x.first_paid_at is not null
    and not (x.cancel_requested_at is not null and x.cancel_requested_at <= x.first_paid_at + interval '1 month')
    and not exists (select 1 from public.sales_revenue r where r.user_id = x.user_id having sum(r.revenue_cents - r.refunded_cents) <= 0)
$$;

-- Create boxes for milestones reached, and fix the amount of boxes whose refund hold has passed.
create or replace function public.sales_milestones_evaluate(p_rep uuid default null, p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare cfg public.sales_settings; rep record; acc record; w record; v_prev timestamptz; v_first timestamptz; v_rev integer;
  v_flat jsonb; v_changed integer := 0;
begin
  select * into cfg from public.sales_settings where id;
  for rep in select id from public.sales_reps where (p_rep is null or id = p_rep) and status in ('active', 'suspended') loop
    select min(first_paid_at) into v_first from public.sales_milestone_accounts(rep.id);
    for acc in select * from public.sales_milestone_accounts(rep.id) a order by a.n loop
      select f into v_flat from jsonb_array_elements(cfg.milestone_flat) f where (f ->> 'at')::integer = acc.n limit 1;
      continue when v_flat is null and (acc.n < cfg.milestone_every or acc.n % cfg.milestone_every <> 0);
      select reached_at into v_prev from public.sales_milestone_awards
        where rep_id = rep.id and milestone < acc.n and status <> 'void' and flat_cents is null order by milestone desc limit 1;
      insert into public.sales_milestone_awards (rep_id, milestone, pct, flat_cents, badge, min_cents, window_start, reached_at, unlocks_at, policy_version)
      values (rep.id, acc.n, case when v_flat is null then public.sales_milestone_rate(cfg.milestone_rates, acc.n::integer) else 0 end,
        (v_flat ->> 'cents')::integer, v_flat ->> 'badge', case when v_flat is null then cfg.milestone_min_cents else 0 end,
        coalesce(v_prev, v_first - interval '1 second'), acc.first_paid_at, acc.first_paid_at + interval '30 days', public.sales_policy_current_version())
      on conflict (rep_id, milestone) do nothing;
      if found then v_changed := v_changed + 1; end if;
    end loop;
  end loop;
  for w in select * from public.sales_milestone_awards where status = 'locked' and unlocks_at <= p_now and (p_rep is null or rep_id = p_rep) for update loop
    -- Revenue from the rep's accounts that are still active, paid after the previous percentage box's
    -- milestone payment and up to this one's.
    select coalesce(sum(r.revenue_cents - r.refunded_cents), 0) into v_rev
    from public.sales_revenue r join public.sales_attributions x on x.user_id = r.user_id
    where r.rep_id = w.rep_id and r.paid_at <= w.reached_at and r.paid_at > w.window_start
      and x.ended_at is null and x.sub_status in ('active', 'trialing', 'past_due');
    update public.sales_milestone_awards set revenue_cents = v_rev,
      amount_cents = coalesce(w.flat_cents, greatest(w.min_cents, round(v_rev * w.pct / 100.0)::integer)), status = 'ready'
    where id = w.id;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

-- Rep view of an award. The amount is only included once the rep has opened the box.
create or replace function public.sales_milestone_json(w public.sales_milestone_awards) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', w.id, 'milestone', w.milestone, 'pct', w.pct, 'flat', w.flat_cents is not null, 'badge', w.badge, 'reached_at', w.reached_at, 'unlocks_at', w.unlocks_at,
    'status', case when w.status = 'void' then 'void' when w.status = 'locked' then 'locked' when w.opened_at is null then 'ready'
      when c.status = 'paid' then 'paid' when w.status = 'approved' then 'approved' else 'opened' end,
    'opened_at', w.opened_at,
    'amount_cents', case when w.opened_at is not null then w.amount_cents end,
    'revenue_cents', case when w.opened_at is not null then w.revenue_cents end)
  from (select 1) _ left join public.sales_commissions c on c.id = w.commission_id
$$;

create or replace function public.sales_my_milestones() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; cfg public.sales_settings; v_count integer;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  perform public.sales_milestones_evaluate(rep.id);
  select * into cfg from public.sales_settings where id;
  select count(*) into v_count from public.sales_milestone_accounts(rep.id);
  return jsonb_build_object('accounts', v_count, 'every', cfg.milestone_every, 'rates', cfg.milestone_rates, 'min_cents', cfg.milestone_min_cents,
    'flat', cfg.milestone_flat,
    'awards', coalesce((select jsonb_agg(public.sales_milestone_json(w) order by w.milestone) from public.sales_milestone_awards w where w.rep_id = rep.id), '[]'::jsonb));
end $$;

create or replace function public.sales_my_milestone_open(p_award uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps; w public.sales_milestone_awards;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into w from public.sales_milestone_awards where id = p_award and rep_id = rep.id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if w.status not in ('ready', 'approved') then raise exception 'not_ready' using errcode = '22023'; end if;
  if w.opened_at is null then
    update public.sales_milestone_awards set opened_at = now() where id = w.id returning * into w;
    perform public.sales_audit(auth.uid(), 'sales.milestone_opened', 'sales_milestone_awards', w.id::text, jsonb_build_object('milestone', w.milestone, 'amount_cents', w.amount_cents));
  end if;
  return public.sales_milestone_json(w);
end $$;

create or replace function public.admin_sales_milestones(p_caller uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  perform public.sales_milestones_evaluate(null);
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'rep_id', w.rep_id, 'rep_name', r.full_name, 'milestone', w.milestone, 'pct', w.pct,
      'flat_cents', w.flat_cents, 'badge', w.badge, 'min_cents', w.min_cents, 'window_start', w.window_start, 'reached_at', w.reached_at, 'unlocks_at', w.unlocks_at, 'revenue_cents', w.revenue_cents,
      'amount_cents', w.amount_cents, 'status', w.status, 'opened_at', w.opened_at, 'approved_at', w.approved_at, 'void_reason', w.void_reason,
      'commission_status', c.status, 'policy_version', w.policy_version) order by w.reached_at desc)
    from public.sales_milestone_awards w join public.sales_reps r on r.id = w.rep_id left join public.sales_commissions c on c.id = w.commission_id), '[]'::jsonb);
end $$;

-- Owner approval: the bonus becomes an earned ledger line dated this month, so the next month-end close
-- puts it on the rep's statement ("bonus on the next paycheck").
create or replace function public.admin_sales_milestone_approve(p_caller uuid, p_award uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.sales_milestone_awards; v_line uuid;
begin
  perform public.sales_require_admin(p_caller);
  select * into w from public.sales_milestone_awards where id = p_award for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if w.status <> 'ready' then raise exception 'not_ready' using errcode = '22023'; end if;
  insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, earned_at)
  values (w.rep_id, null, 1, 'bonus', public.sales_month_of(now()), w.amount_cents,
    jsonb_build_object('milestone', w.milestone, 'pct', w.pct, 'flat_cents', w.flat_cents, 'revenue_cents', w.revenue_cents, 'min_cents', w.min_cents, 'award_id', w.id),
    'earned', 'milestone_' || w.milestone, now())
  returning id into v_line;
  update public.sales_milestone_awards set status = 'approved', approved_at = now(), approved_by = p_caller, commission_id = v_line where id = w.id;
  perform public.sales_audit(p_caller, 'sales.milestone_approved', 'sales_milestone_awards', w.id::text, jsonb_build_object('milestone', w.milestone, 'amount_cents', w.amount_cents, 'rep_id', w.rep_id));
  return jsonb_build_object('commission_id', v_line, 'amount_cents', w.amount_cents);
end $$;

create or replace function public.admin_sales_milestone_void(p_caller uuid, p_award uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare w public.sales_milestone_awards;
begin
  perform public.sales_require_admin(p_caller);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into w from public.sales_milestone_awards where id = p_award for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if w.status not in ('locked', 'ready') then raise exception 'already_approved' using errcode = '22023'; end if;
  update public.sales_milestone_awards set status = 'void', void_reason = left(trim(p_reason), 300) where id = w.id;
  perform public.sales_audit(p_caller, 'sales.milestone_voided', 'sales_milestone_awards', w.id::text, jsonb_build_object('reason', left(trim(p_reason), 300)));
end $$;

create or replace function public.admin_sales_milestone_rules_save(p_caller uuid, p_every integer, p_rates jsonb, p_min_cents integer, p_flat jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_last integer := 0;
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
  if jsonb_typeof(p_flat) <> 'array' or jsonb_array_length(p_flat) > 10 then raise exception 'invalid_milestones' using errcode = '22023'; end if;
  v_last := 0;
  for r in select * from jsonb_array_elements(p_flat) loop
    if (r ->> 'at') is null or (r ->> 'cents') is null or (r ->> 'at')::integer <= v_last or (r ->> 'at')::integer >= p_every
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

-- ---------------------------------------------------------------------------------------------------
-- Team goals
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_team_goals (
  month date primary key check (extract(day from month) = 1),
  target integer not null check (target between 0 and 100000),
  note text check (note is null or char_length(note) <= 300),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.sales_team_goals enable row level security;

-- Raw numbers for the goal board: verified paid sales (first payments) this month and the 3 before it.
create or replace function public.sales_team_goal_raw(p_rep uuid, p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  with m as (select public.sales_month_of(p_now) as cur),
  sales as (select public.sales_month_of(x.first_paid_at) as month, x.rep_id from public.sales_attributions x, m
            where x.first_paid_at is not null and public.sales_month_of(x.first_paid_at) >= (m.cur - interval '3 months')::date)
  select jsonb_build_object(
    'month', m.cur,
    'now', p_now,
    'time_zone', (select time_zone from public.sales_settings where id),
    'current', (select count(*) from sales s where s.month = m.cur),
    'mine', case when p_rep is null then null else (select count(*) from sales s where s.month = m.cur and s.rep_id = p_rep) end,
    'history', jsonb_build_array(
      (select count(*) from sales s where s.month = (m.cur - interval '1 month')::date),
      (select count(*) from sales s where s.month = (m.cur - interval '2 months')::date),
      (select count(*) from sales s where s.month = (m.cur - interval '3 months')::date)),
    'active_reps', (select count(*) from public.sales_reps where status = 'active' and user_id is not null),
    'floor', (select team_goal_floor from public.sales_settings where id),
    'override', (select jsonb_build_object('target', g.target, 'note', g.note) from public.sales_team_goals g where g.month = m.cur))
  from m
$$;

create or replace function public.sales_my_team_goal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return public.sales_team_goal_raw(rep.id);
end $$;

create or replace function public.admin_sales_team_goal(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return public.sales_team_goal_raw(null);
end $$;

-- p_target null clears the override (back to the automatic target).
create or replace function public.admin_sales_team_goal_set(p_caller uuid, p_target integer, p_floor integer, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_month date := public.sales_month_of(now());
begin
  perform public.sales_require_admin(p_caller);
  if (p_target is not null and (p_target < 0 or p_target > 100000)) or (p_floor is not null and (p_floor < 0 or p_floor > 10000)) then
    raise exception 'invalid_goal' using errcode = '22023';
  end if;
  if p_target is null then delete from public.sales_team_goals where month = v_month;
  else
    insert into public.sales_team_goals (month, target, note, set_by) values (v_month, p_target, left(p_note, 300), p_caller)
    on conflict (month) do update set target = excluded.target, note = excluded.note, set_by = excluded.set_by, set_at = now();
  end if;
  if p_floor is not null then update public.sales_settings set team_goal_floor = p_floor, updated_at = now() where id; end if;
  perform public.sales_audit(p_caller, 'sales.team_goal_set', 'sales_team_goals', v_month::text, jsonb_build_object('target', p_target, 'floor', p_floor));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Quests, XP and monthly rank (computed from real work; no cash). Counts only; the app turns them into
-- quests and XP (src/lib/sales/quests.ts). Emails are never counted, so blasting email earns nothing.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_my_progress(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; tz text; v_day timestamptz; v_week timestamptz; v_month timestamptz;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select coalesce(time_zone, 'America/Chicago') into tz from public.sales_settings where id;
  v_day := date_trunc('day', p_now at time zone tz) at time zone tz;
  v_week := date_trunc('week', p_now at time zone tz) at time zone tz;
  v_month := date_trunc('month', p_now at time zone tz) at time zone tz;
  return jsonb_build_object('now', p_now, 'periods', (
    select jsonb_object_agg(p.name, jsonb_build_object(
      'calls', (select count(*) from public.sales_activities a where a.rep_id = rep.id and a.kind = 'call' and a.occurred_at >= p.since),
      'meetings', (select count(*) from public.sales_activities a where a.rep_id = rep.id and a.kind = 'meeting' and a.occurred_at >= p.since),
      -- Distinct leads touched by a call, text, meeting or note (one per lead per day at most).
      'follow_ups', (select count(distinct (a.lead_id, date_trunc('day', a.occurred_at at time zone tz))) from public.sales_activities a
                     where a.rep_id = rep.id and a.kind in ('call', 'text', 'meeting', 'note') and a.occurred_at >= p.since),
      'tasks_done', (select count(*) from public.sales_tasks t where t.rep_id = rep.id and t.done_at >= p.since),
      'paid_accounts', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and x.first_paid_at >= p.since)))
    from (values ('day', v_day), ('week', v_week), ('month', v_month)) p(name, since)));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_milestone_rate(jsonb, integer)', 'public.sales_record_revenue(uuid, text, integer, integer, timestamptz)',
    'public.sales_revenue_refunded(text, integer)', 'public.sales_milestone_accounts(uuid)', 'public.sales_milestones_evaluate(uuid, timestamptz)',
    'public.sales_milestone_json(public.sales_milestone_awards)', 'public.admin_sales_milestones(uuid)', 'public.admin_sales_milestone_approve(uuid, uuid)',
    'public.admin_sales_milestone_void(uuid, uuid, text)', 'public.admin_sales_milestone_rules_save(uuid, integer, jsonb, integer, jsonb, text)',
    'public.sales_team_goal_raw(uuid, timestamptz)', 'public.admin_sales_team_goal(uuid)', 'public.admin_sales_team_goal_set(uuid, integer, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.sales_my_progress(timestamptz)', 'public.sales_my_milestones()', 'public.sales_my_milestone_open(uuid)', 'public.sales_my_team_goal()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on public.sales_revenue, public.sales_milestone_awards, public.sales_team_goals from anon, authenticated;
grant all on public.sales_revenue, public.sales_milestone_awards, public.sales_team_goals to service_role;
