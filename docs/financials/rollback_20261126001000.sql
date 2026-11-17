-- Rollback for 20261126001000_fin_v5_ar_job_summary.sql. Deploy the previous app version first.
-- Refuses while any bill payment exists (those are financial records; void them is not enough, keep the migration).
-- Restores the views and the bill RLS policy as defined in 20261124003000 (including its original behavior).
begin;
do $$ begin
  if to_regclass('public.fin_bill_payments') is not null and exists (select 1 from public.fin_bill_payments) then
    raise exception 'bill payments exist; keep this migration';
  end if;
end $$;
drop view if exists public.fin_ar_invoices_v;
drop view if exists public.fin_job_summary_v;
drop view if exists public.fin_bill_balances_v;
drop function if exists public.fin_job_assignees(uuid);
drop trigger if exists fin_bill_void_guard on public.fin_vendor_bills;
drop function if exists public.fin_bill_void_guard();
drop function if exists public.fin_bill_payment_void(uuid, text);
drop function if exists public.fin_bill_payment_record(uuid, jsonb, text);
drop table if exists public.fin_bill_payments;
drop function if exists public.fin_check_bill_paid();
drop view if exists public.fin_job_profitability_v;
drop view if exists public.fin_job_budget_v;
create view public.fin_job_budget_v with (security_invoker = true) as
with keys as (
  select job_id, cost_code_id from public.fin_budget_lines
  union select job_id, cost_code_id from public.fin_commitments where status <> 'void'
  union select job_id, cost_code_id from public.fin_job_costs_v)
select k.job_id, j.book_id, k.cost_code_id, cc.code, cc.name as cost_code_name, cc.trade_slug, cc.cost_type,
       coalesce((select sum(amount) from public.fin_budget_lines b where b.job_id = k.job_id and b.cost_code_id is not distinct from k.cost_code_id), 0) as estimated,
       coalesce((select sum(open_committed) from public.fin_commitment_balances_v c where c.job_id = k.job_id and c.cost_code_id is not distinct from k.cost_code_id), 0) as committed,
       coalesce((select sum(amount) from public.fin_job_costs_v a where a.job_id = k.job_id and a.cost_code_id is not distinct from k.cost_code_id), 0) as actual
  from keys k join public.fin_jobs j on j.id = k.job_id
  left join public.fin_cost_codes cc on cc.id = k.cost_code_id;
create view public.fin_job_profitability_v with (security_invoker = true) as
select c.job_id, c.book_id, c.job_number, c.name, c.status,
       c.current_contract as contract_value, c.invoiced as invoiced_revenue,
       coalesce(b.estimated, 0) as estimated_cost, coalesce(b.committed, 0) as committed_cost, coalesce(b.actual, 0) as actual_cost,
       coalesce(b.actual, 0) + coalesce(b.committed, 0) as committed_plus_actual,
       c.current_contract - coalesce(b.estimated, 0) as estimated_profit,
       c.current_contract - greatest(coalesce(b.estimated, 0), coalesce(b.actual, 0) + coalesce(b.committed, 0)) as projected_profit,
       c.invoiced - coalesce(b.actual, 0) as actual_profit_to_date,
       c.pending_changes
  from public.fin_job_contract_v c
  left join lateral (select sum(estimated) as estimated, sum(committed) as committed, sum(actual) as actual from public.fin_job_budget_v x where x.job_id = c.job_id) b on true;
revoke all on public.fin_job_budget_v, public.fin_job_profitability_v from anon, authenticated;
grant select on public.fin_job_budget_v, public.fin_job_profitability_v to authenticated;
drop policy if exists fin_vendor_bills_select on public.fin_vendor_bills;
create policy fin_vendor_bills_select on public.fin_vendor_bills for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_vendor_bill_lines l where l.bill_id = id and l.job_id is not null and public.fin_job_visible(l.job_id)));
commit;
