-- Rollback for 20270111001000_sales_v8_goals_milestones.sql. Bonus lines already in the ledger are removed
-- only if never paid; review before running.
drop function if exists public.sales_my_progress(timestamptz);
drop function if exists public.sales_my_team_goal();
drop function if exists public.admin_sales_team_goal(uuid);
drop function if exists public.admin_sales_team_goal_set(uuid, integer, integer, text);
drop function if exists public.sales_team_goal_raw(uuid, timestamptz);
drop table if exists public.sales_team_goals;
drop function if exists public.admin_sales_milestone_rules_save(uuid, integer, jsonb, integer, jsonb, text);
drop function if exists public.admin_sales_milestone_void(uuid, uuid, text);
drop function if exists public.admin_sales_milestone_approve(uuid, uuid);
drop function if exists public.admin_sales_milestones(uuid);
drop function if exists public.sales_my_milestone_open(uuid);
drop function if exists public.sales_my_milestones();
drop function if exists public.sales_milestone_json(public.sales_milestone_awards);
drop function if exists public.sales_milestones_evaluate(uuid, timestamptz);
drop function if exists public.sales_milestone_accounts(uuid);
drop table if exists public.sales_milestone_awards;
delete from public.sales_commissions where kind = 'bonus' and status <> 'paid';
do $$ begin
  if not exists (select 1 from public.sales_commissions where kind = 'bonus') then
    alter table public.sales_commissions drop constraint if exists sales_commissions_kind_check;
    alter table public.sales_commissions add constraint sales_commissions_kind_check check (kind in ('commission', 'clawback'));
    alter table public.sales_commissions drop constraint if exists sales_commissions_check;
    alter table public.sales_commissions add constraint sales_commissions_check check ((kind = 'commission' and amount_cents >= 0) or (kind = 'clawback' and amount_cents <= 0));
  end if;
end $$;
drop function if exists public.sales_revenue_refunded(text, integer);
drop function if exists public.sales_record_revenue(uuid, text, integer, integer, timestamptz);
drop table if exists public.sales_revenue;
drop function if exists public.sales_milestone_rate(jsonb, integer);
create or replace function public.sales_policy_snapshot(s public.sales_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('annual_basis', s.annual_basis, 'refund_policy', s.refund_policy, 'value_scope', s.value_scope,
    'commission_years', s.commission_years, 'attribution_window_days', s.attribution_window_days, 'time_zone', s.time_zone,
    'first_month_cancel_voids', s.first_month_cancel_voids)
$$;
alter table public.sales_settings drop column if exists milestone_flat, drop column if exists milestone_min_cents, drop column if exists milestone_rates,
  drop column if exists milestone_every, drop column if exists team_goal_floor;
