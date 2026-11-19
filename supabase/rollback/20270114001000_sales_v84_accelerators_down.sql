-- Rollback for 20270114001000_sales_v84_accelerators.sql. Accelerator commission lines already created
-- are kept (they may be on approved or paid statements); only the program, ledger and achievements go.
drop function if exists public.admin_sales_achievement_congratulate(uuid, uuid);
drop function if exists public.admin_sales_accelerator_rules_save(uuid, boolean, jsonb, text);
drop function if exists public.admin_sales_incentives(uuid, timestamptz);
drop function if exists public.sales_my_records(timestamptz);
drop function if exists public.sales_my_accelerator(timestamptz);
drop function if exists public.sales_achievements_evaluate(uuid, timestamptz);
drop function if exists public.sales_accelerators_evaluate(uuid, timestamptz);
drop function if exists public.sales_accelerator_rate(jsonb, integer);
drop table if exists public.sales_achievements;
drop table if exists public.sales_accelerators;
create or replace function public.sales_policy_snapshot(s public.sales_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('annual_basis', s.annual_basis, 'refund_policy', s.refund_policy, 'value_scope', s.value_scope,
    'commission_years', s.commission_years, 'attribution_window_days', s.attribution_window_days, 'time_zone', s.time_zone,
    'first_month_cancel_voids', s.first_month_cancel_voids,
    'milestone_every', s.milestone_every, 'milestone_rates', s.milestone_rates, 'milestone_min_cents', s.milestone_min_cents,
    'milestone_flat', s.milestone_flat)
$$;
alter table public.sales_settings drop column if exists accelerator_active_from;
alter table public.sales_settings drop column if exists accelerator_tiers;
alter table public.sales_settings drop column if exists accelerator_enabled;
-- The 'accelerator' kind stays allowed if any such lines exist.
do $$ begin
  if not exists (select 1 from public.sales_commissions where kind = 'accelerator') then
    alter table public.sales_commissions drop constraint if exists sales_commissions_kind_check;
    alter table public.sales_commissions add constraint sales_commissions_kind_check check (kind in ('commission', 'clawback', 'bonus'));
    alter table public.sales_commissions drop constraint if exists sales_commissions_check;
    alter table public.sales_commissions add constraint sales_commissions_check
      check ((kind in ('commission', 'bonus') and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0));
  end if;
end $$;
