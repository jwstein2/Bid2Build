-- Sales Hub V8.4 P0: monthly commission accelerators, personal records and achievements, and the admin
-- Recognition & Incentives view.
--
-- Accelerators (James, 2026-11-19): a rep's qualifying new sales in a calendar month (America/Chicago)
-- set a bonus rate (default 5+ sales = 5%, 10+ = 10%, 15+ = 15%, 20+ = 20%) applied to that month's
-- sale-month commissions. Never to anniversaries, never to unpaid sign-ups or complimentary grants (those
-- have no commission line), and the rep's base rate never changes.
--
-- Safeguards:
--   * Off until the owner turns it on (accelerator_enabled), so the rates can be reviewed first.
--   * The tier is fixed only after the month has ended AND every qualifying sale has cleared its 30-day
--     refund hold. A sale refunded or canceled inside the hold simply doesn't count; nothing already
--     released is ever taken back (policy: no clawback).
--   * One accelerator line per qualifying sale (unique index on customer + kind), so re-runs and retries
--     can't pay twice. Lines are 'earned' and go through the existing statement approval and payout
--     recording; nothing here moves money.
--   * Rates are part of the versioned commission policy. A finalized month keeps the rates it was
--     finalized with.

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings, versioned with the rest of the policy
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_settings add column if not exists accelerator_enabled boolean not null default false;
alter table public.sales_settings add column if not exists accelerator_tiers jsonb not null
  default '[{"from":5,"pct":5},{"from":10,"pct":10},{"from":15,"pct":15},{"from":20,"pct":20}]'::jsonb;
-- The month the program started paying. Months before it are never paid retroactively.
alter table public.sales_settings add column if not exists accelerator_active_from date;

create or replace function public.sales_policy_snapshot(s public.sales_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('annual_basis', s.annual_basis, 'refund_policy', s.refund_policy, 'value_scope', s.value_scope,
    'commission_years', s.commission_years, 'attribution_window_days', s.attribution_window_days, 'time_zone', s.time_zone,
    'first_month_cancel_voids', s.first_month_cancel_voids,
    'milestone_every', s.milestone_every, 'milestone_rates', s.milestone_rates, 'milestone_min_cents', s.milestone_min_cents,
    'milestone_flat', s.milestone_flat, 'accelerator_enabled', s.accelerator_enabled, 'accelerator_tiers', s.accelerator_tiers)
$$;

-- Record the (still disabled) accelerator rules in the current version without starting a new one.
update public.sales_policy_versions v set policy = public.sales_policy_snapshot(s)
from public.sales_settings s
where s.id and v.version = public.sales_policy_current_version() and not (v.policy ? 'accelerator_tiers');

-- Highest tier whose threshold the count reaches; 0 below the first tier.
create or replace function public.sales_accelerator_rate(p_tiers jsonb, p_count integer) returns numeric
language sql immutable set search_path = public as $$
  select coalesce((select (t ->> 'pct')::numeric from jsonb_array_elements(p_tiers) t
                   where (t ->> 'from')::integer <= p_count order by (t ->> 'from')::integer desc limit 1), 0)
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Ledger
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_commissions drop constraint if exists sales_commissions_kind_check;
alter table public.sales_commissions add constraint sales_commissions_kind_check check (kind in ('commission', 'clawback', 'bonus', 'accelerator'));
alter table public.sales_commissions drop constraint if exists sales_commissions_check;
alter table public.sales_commissions add constraint sales_commissions_check
  check ((kind in ('commission', 'bonus', 'accelerator') and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0));

create table if not exists public.sales_accelerators (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  period_month date not null check (extract(day from period_month) = 1),
  -- open: month in progress or sales still in their refund hold; final: tier fixed and lines created.
  status text not null default 'open' check (status in ('open', 'final')),
  sales_count integer not null default 0,
  base_cents integer not null default 0,
  qualifying uuid[] not null default '{}',           -- sale-month commission line ids
  pending_count integer not null default 0,          -- of those, still inside the refund hold
  dropped_count integer not null default 0,          -- canceled/refunded inside the hold (don't count)
  dropped_base_cents integer not null default 0,     -- refund adjustment, for the record
  rate numeric(5, 2) not null default 0,
  bonus_cents integer not null default 0,
  tiers jsonb,                                       -- accelerator rules used (frozen when final)
  policy_version integer,                            -- commission policy version used (frozen when final)
  enabled boolean not null default false,            -- program was on when finalized (off: preview only, no lines)
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (rep_id, period_month)
);
alter table public.sales_accelerators enable row level security;
revoke all on public.sales_accelerators from public, anon, authenticated;
grant all on public.sales_accelerators to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 3. Achievements (records, first sales, tiers). One per rep, kind and month, so a replayed
--    celebration never creates a second one. No cash here.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_achievements (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  kind text not null check (kind in ('first_sale', 'month_first_sale', 'record_sales', 'record_follow_ups', 'accelerator_tier')),
  period_month date not null,
  value numeric,
  detail jsonb,
  congratulated_at timestamptz,
  congratulated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rep_id, kind, period_month)
);
create index if not exists sales_achievements_recent on public.sales_achievements (created_at desc);
alter table public.sales_achievements enable row level security;
revoke all on public.sales_achievements from public, anon, authenticated;
grant all on public.sales_achievements to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 4. Evaluation (nightly cron; idempotent)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_accelerators_evaluate(p_rep uuid default null, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg public.sales_settings;
  v_month date := public.sales_month_of(p_now);
  m record;
  a public.sales_accelerators;
  v_total integer;
  n_final integer := 0; n_lines integer := 0;
begin
  select * into cfg from public.sales_settings where id;
  for m in
    select c.rep_id, c.period_month,
      array_agg(c.id order by c.created_at, c.id) filter (where c.status in ('pending', 'earned', 'approved', 'paid')) ids,
      count(*) filter (where c.status in ('pending', 'earned', 'approved', 'paid'))::integer cnt,
      coalesce(sum(c.amount_cents) filter (where c.status in ('pending', 'earned', 'approved', 'paid')), 0)::integer base,
      count(*) filter (where c.status = 'pending')::integer pend,
      count(*) filter (where c.status in ('canceled', 'ineligible', 'reversed'))::integer dropped,
      coalesce(sum(c.amount_cents) filter (where c.status in ('canceled', 'ineligible', 'reversed')), 0)::integer dropped_base
    from public.sales_commissions c
    where c.kind = 'commission' and c.year_no = 1 and (p_rep is null or c.rep_id = p_rep)
      and c.period_month >= v_month - interval '13 months'
    group by c.rep_id, c.period_month
  loop
    insert into public.sales_accelerators (rep_id, period_month) values (m.rep_id, m.period_month)
    on conflict (rep_id, period_month) do nothing;
    select * into a from public.sales_accelerators where rep_id = m.rep_id and period_month = m.period_month for update;
    continue when a.status = 'final';   -- a finalized month never changes
    a.rate := public.sales_accelerator_rate(cfg.accelerator_tiers, m.cnt);
    a.bonus_cents := round(m.base * a.rate / 100.0)::integer;
    update public.sales_accelerators set sales_count = m.cnt, base_cents = m.base, qualifying = coalesce(m.ids, '{}'),
      pending_count = m.pend, dropped_count = m.dropped, dropped_base_cents = m.dropped_base,
      rate = a.rate, bonus_cents = a.bonus_cents, tiers = cfg.accelerator_tiers, policy_version = public.sales_policy_current_version(),
      enabled = cfg.accelerator_enabled, updated_at = now()
    where id = a.id;
    -- Finalize once the month is over and no qualifying sale is still in its refund hold. While the
    -- program is off, months stay open as a preview (so turning it on later still pays eligible months
    -- from the activation month onward only; see below).
    if m.period_month < v_month and m.pend = 0 and cfg.accelerator_enabled
       and m.period_month >= coalesce(cfg.accelerator_active_from, v_month) then
      v_total := a.bonus_cents;
      if v_total > 0 then
        -- Split the month's bonus across its sales so the parts add up exactly to the total
        -- (largest remainder, ties by line id). One line per sale; the unique index blocks repeats.
        insert into public.sales_commissions (rep_id, user_id, year_no, kind, period_month, amount_cents, basis_detail, status, reason, earned_at, policy_version)
        select c.rep_id, c.user_id, 1, 'accelerator', v_month,
          s.fl + case when s.rk <= v_total - s.sum_fl then 1 else 0 end,
          jsonb_build_object('accelerator_id', a.id, 'sale_month', m.period_month, 'source_commission_id', c.id, 'base_cents', c.amount_cents,
                             'rate', a.rate, 'sales_count', m.cnt),
          'earned', 'accelerator_' || m.cnt, now(), public.sales_policy_current_version()
        from (
          select x.id, floor(x.amount_cents * a.rate / 100.0)::integer fl,
            sum(floor(x.amount_cents * a.rate / 100.0)::integer) over () sum_fl,
            row_number() over (order by (x.amount_cents * a.rate / 100.0) - floor(x.amount_cents * a.rate / 100.0) desc, x.id) rk
          from public.sales_commissions x where x.id = any (m.ids)
        ) s join public.sales_commissions c on c.id = s.id
        where c.user_id is not null
        on conflict (user_id, year_no, kind) do nothing;
        get diagnostics n_lines = row_count;
        insert into public.sales_achievements (rep_id, kind, period_month, value, detail)
        values (m.rep_id, 'accelerator_tier', m.period_month, a.rate, jsonb_build_object('sales', m.cnt, 'bonus_cents', v_total))
        on conflict do nothing;
      end if;
      update public.sales_accelerators set status = 'final', finalized_at = now() where id = a.id;
      n_final := n_final + 1;
    end if;
  end loop;
  return jsonb_build_object('finalized', n_final, 'lines', n_lines);
end $$;

-- Records and firsts. A "record" needs at least one earlier month with activity, so a brand-new rep's
-- first month is never compared against nothing, and every comparison is against the rep's own past.
create or replace function public.sales_achievements_evaluate(p_rep uuid default null, p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare v_month date := public.sales_month_of(p_now); v_prev date := (public.sales_month_of(p_now) - interval '1 month')::date; n integer := 0; k integer;
begin
  -- First paid sale ever, and the first paid sale of each month.
  insert into public.sales_achievements (rep_id, kind, period_month, value, detail)
  select x.rep_id, 'first_sale', min(x.first_paid_month), 1, '{}'::jsonb
  from public.sales_attributions x where x.first_paid_month is not null and (p_rep is null or x.rep_id = p_rep)
  group by x.rep_id
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;
  insert into public.sales_achievements (rep_id, kind, period_month, value)
  select distinct x.rep_id, 'month_first_sale', x.first_paid_month, 1
  from public.sales_attributions x where x.first_paid_month >= v_prev and (p_rep is null or x.rep_id = p_rep)
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;
  -- Last month beat every earlier month (paid sales; follow-ups).
  with monthly as (
    select x.rep_id, x.first_paid_month m, count(*)::integer v from public.sales_attributions x
    where x.first_paid_month is not null and (p_rep is null or x.rep_id = p_rep) group by 1, 2
  ), last as (select * from monthly where m = v_prev), prior as (select rep_id, max(v) best from monthly where m < v_prev group by 1)
  insert into public.sales_achievements (rep_id, kind, period_month, value, detail)
  select l.rep_id, 'record_sales', v_prev, l.v, jsonb_build_object('previous_best', p.best)
  from last l join prior p on p.rep_id = l.rep_id where l.v > p.best
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;
  with monthly as (
    select a.rep_id, public.sales_month_of(a.occurred_at) m, count(distinct (a.lead_id, date_trunc('day', a.occurred_at)))::integer v
    from public.sales_activities a where a.rep_id is not null and a.kind in ('call', 'text', 'meeting', 'note') and (p_rep is null or a.rep_id = p_rep)
      and a.occurred_at >= p_now - interval '13 months' group by 1, 2
  ), last as (select * from monthly where m = v_prev), prior as (select rep_id, max(v) best from monthly where m < v_prev group by 1)
  insert into public.sales_achievements (rep_id, kind, period_month, value, detail)
  select l.rep_id, 'record_follow_ups', v_prev, l.v, jsonb_build_object('previous_best', p.best)
  from last l join prior p on p.rep_id = l.rep_id where l.v > p.best and l.v >= 10
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Rep functions (signed-in rep, own rows only)
-- ---------------------------------------------------------------------------------------------------
-- This month's accelerator progress plus recent months. Amounts for open months are projections.
create or replace function public.sales_my_accelerator(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; cfg public.sales_settings; v_month date := public.sales_month_of(p_now);
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select * into cfg from public.sales_settings where id;
  return jsonb_build_object('enabled', cfg.accelerator_enabled, 'tiers', cfg.accelerator_tiers, 'month', v_month,
    'current', (select jsonb_build_object('sales', count(*), 'base_cents', coalesce(sum(c.amount_cents), 0))
                from public.sales_commissions c where c.rep_id = rep.id and c.kind = 'commission' and c.year_no = 1
                  and c.period_month = v_month and c.status in ('pending', 'earned', 'approved', 'paid')),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', a.period_month, 'status', a.status, 'sales', a.sales_count, 'base_cents', a.base_cents,
                          'rate', a.rate, 'bonus_cents', a.bonus_cents, 'pending', a.pending_count, 'enabled', a.enabled) order by a.period_month desc)
                        from (select * from public.sales_accelerators where rep_id = rep.id and period_month < v_month order by period_month desc limit 6) a), '[]'::jsonb));
end $$;

-- Monthly counts for the last 13 months (for personal bests: each rep against their own history).
create or replace function public.sales_my_records(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps; tz text;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  select coalesce(time_zone, 'America/Chicago') into tz from public.sales_settings where id;
  return jsonb_build_object('months', (
    select jsonb_agg(jsonb_build_object('month', mm.m,
      'calls', (select count(*) from public.sales_activities a where a.rep_id = rep.id and a.kind = 'call' and public.sales_month_of(a.occurred_at) = mm.m),
      'meetings', (select count(*) from public.sales_activities a where a.rep_id = rep.id and a.kind = 'meeting' and public.sales_month_of(a.occurred_at) = mm.m),
      'follow_ups', (select count(distinct (a.lead_id, date_trunc('day', a.occurred_at at time zone tz))) from public.sales_activities a
                     where a.rep_id = rep.id and a.kind in ('call', 'text', 'meeting', 'note') and public.sales_month_of(a.occurred_at) = mm.m),
      'tasks_done', (select count(*) from public.sales_tasks t where t.rep_id = rep.id and public.sales_month_of(t.done_at) = mm.m),
      'paid_accounts', (select count(*) from public.sales_attributions x where x.rep_id = rep.id and x.first_paid_month = mm.m)) order by mm.m)
    from (select generate_series(public.sales_month_of(p_now) - interval '12 months', public.sales_month_of(p_now), interval '1 month')::date m) mm),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'month', s.period_month, 'value', s.value, 'detail', s.detail, 'at', s.created_at) order by s.created_at desc)
                              from (select * from public.sales_achievements where rep_id = rep.id order by created_at desc limit 20) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Admin: Recognition & Incentives
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_incentives(p_caller uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.sales_settings; v_month date := public.sales_month_of(p_now);
begin
  perform public.sales_require_cap(p_caller, 'view_all_reps');
  select * into cfg from public.sales_settings where id;
  return jsonb_build_object(
    'enabled', cfg.accelerator_enabled, 'tiers', cfg.accelerator_tiers, 'active_from', cfg.accelerator_active_from, 'month', v_month,
    -- Incentive cost against collected revenue (before tax, net of refunds), last 6 months.
    'cost', coalesce((select jsonb_agg(jsonb_build_object('month', mm.m,
        'revenue_cents', (select coalesce(sum(r.revenue_cents - coalesce(r.refunded_cents, 0)), 0) from public.sales_revenue r where public.sales_month_of(r.paid_at) = mm.m),
        'base_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.kind = 'commission' and c.period_month = mm.m and c.status in ('pending', 'earned', 'approved', 'paid')),
        'accelerator_cents', (select coalesce(sum(a.bonus_cents), 0) from public.sales_accelerators a where a.period_month = mm.m),
        'accelerator_final', (select coalesce(bool_and(a.status = 'final'), true) from public.sales_accelerators a where a.period_month = mm.m),
        'box_cents', (select coalesce(sum(w.amount_cents), 0) from public.sales_milestone_awards w where w.status in ('ready', 'approved') and public.sales_month_of(w.reached_at) = mm.m)) order by mm.m desc)
      from (select generate_series(v_month - interval '5 months', v_month, interval '1 month')::date m) mm), '[]'::jsonb),
    'accelerators', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'rep_id', a.rep_id, 'rep_name', r.full_name, 'month', a.period_month, 'status', a.status,
        'sales', a.sales_count, 'pending', a.pending_count, 'dropped', a.dropped_count, 'dropped_base_cents', a.dropped_base_cents, 'base_cents', a.base_cents,
        'rate', a.rate, 'bonus_cents', a.bonus_cents, 'enabled', a.enabled, 'policy_version', a.policy_version, 'finalized_at', a.finalized_at,
        'paid_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.kind = 'accelerator' and c.status = 'paid' and (c.basis_detail ->> 'accelerator_id')::uuid = a.id),
        'approved_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.kind = 'accelerator' and c.status = 'approved' and (c.basis_detail ->> 'accelerator_id')::uuid = a.id))
        order by a.period_month desc, r.full_name)
      from public.sales_accelerators a join public.sales_reps r on r.id = a.rep_id where a.period_month >= v_month - interval '5 months'), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rep_id', s.rep_id, 'rep_name', r.full_name, 'kind', s.kind, 'month', s.period_month,
        'value', s.value, 'detail', s.detail, 'at', s.created_at, 'congratulated_at', s.congratulated_at) order by s.created_at desc)
      from (select * from public.sales_achievements order by created_at desc limit 60) s join public.sales_reps r on r.id = s.rep_id), '[]'::jsonb),
    'recent_sales', coalesce((select jsonb_agg(jsonb_build_object('rep_id', x.rep_id, 'rep_name', r.full_name, 'business', nullif(bp.company_name, ''), 'plan', x.plan,
        'first_paid_at', x.first_paid_at) order by x.first_paid_at desc)
      from (select * from public.sales_attributions where first_paid_at is not null order by first_paid_at desc limit 15) x
      join public.sales_reps r on r.id = x.rep_id left join public.business_profiles bp on bp.user_id = x.user_id), '[]'::jsonb),
    -- Lifetime milestone accounts per selling rep, for "upcoming milestones".
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('rep_id', r.id, 'rep_name', r.full_name, 'accounts', (select count(*) from public.sales_milestone_accounts(r.id))))
      from public.sales_reps r where r.status = 'active' and r.sells), '[]'::jsonb));
end $$;

-- Owner only: the rates, and turning the program on or off. A new policy version each time.
create or replace function public.admin_sales_accelerator_rules_save(p_caller uuid, p_enabled boolean, p_tiers jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_last integer := 0; v_pct numeric := 0; cfg public.sales_settings;
begin
  perform public.sales_require_cap(p_caller, 'edit_commission_policies');
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) not between 1 and 10 then raise exception 'invalid_tiers' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_tiers) loop
    if (r ->> 'from') is null or (r ->> 'pct') is null or (r ->> 'from')::integer <= v_last or (r ->> 'from')::integer > 1000
       or (r ->> 'pct')::numeric <= v_pct or (r ->> 'pct')::numeric > 50 then
      raise exception 'invalid_tiers' using errcode = '22023';
    end if;
    v_last := (r ->> 'from')::integer; v_pct := (r ->> 'pct')::numeric;
  end loop;
  select * into cfg from public.sales_settings where id;
  perform set_config('sales.policy_note', coalesce(left(p_note, 500), 'Accelerator rules changed'), true);
  update public.sales_settings set accelerator_tiers = p_tiers, accelerator_enabled = coalesce(p_enabled, false),
    -- Turning it on starts paying from the current month; earlier months are never paid retroactively.
    accelerator_active_from = case when coalesce(p_enabled, false) and not cfg.accelerator_enabled then public.sales_month_of(now()) else accelerator_active_from end,
    updated_at = now() where id;
  perform public.sales_audit(p_caller, 'sales.accelerator_rules_saved', 'sales_settings', 'accelerators', jsonb_build_object('enabled', p_enabled, 'tiers', p_tiers));
  return jsonb_build_object('version', public.sales_policy_current_version());
end $$;

-- Mark that the owner congratulated someone (the message itself is sent outside Built2Bid for now).
create or replace function public.admin_sales_achievement_congratulate(p_caller uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_require_cap(p_caller, 'view_all_reps');
  update public.sales_achievements set congratulated_at = coalesce(congratulated_at, now()), congratulated_by = coalesce(congratulated_by, p_caller) where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public.sales_audit(p_caller, 'sales.achievement_congratulated', 'sales_achievements', p_id::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_accelerator_rate(jsonb, integer)', 'public.sales_accelerators_evaluate(uuid, timestamptz)', 'public.sales_achievements_evaluate(uuid, timestamptz)',
    'public.admin_sales_incentives(uuid, timestamptz)', 'public.admin_sales_accelerator_rules_save(uuid, boolean, jsonb, text)',
    'public.admin_sales_achievement_congratulate(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on function public.sales_my_accelerator(timestamptz), public.sales_my_records(timestamptz) from public, anon;
grant execute on function public.sales_my_accelerator(timestamptz), public.sales_my_records(timestamptz) to authenticated;
