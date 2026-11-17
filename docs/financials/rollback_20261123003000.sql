-- Rollback for 20261123003000_fin_costs.sql (vendors, cost codes, budgets, commitments, bills, expenses, review queue).
-- Deploy the previous app version first. WARNING: drops every recorded vendor bill, expense and commitment.
-- Export them first. Run 20261123004000's rollback before this one.
begin;
drop policy if exists fin_vendor_bills_select on public.fin_vendor_bills;  -- reads fin_vendor_bill_lines
drop trigger if exists fin_contract_snapshots_budget on public.fin_contract_snapshots;
drop trigger if exists fin_business_config_codes on public.fin_business_config;
drop view if exists public.fin_job_profitability_v;
drop view if exists public.fin_job_budget_v;
drop view if exists public.fin_commitment_balances_v;
drop view if exists public.fin_job_costs_v;
drop table if exists public.fin_review_items;
drop table if exists public.fin_expenses;
drop table if exists public.fin_vendor_bill_lines;
drop table if exists public.fin_vendor_bills;
drop table if exists public.fin_commitment_revisions;
drop table if exists public.fin_commitments;
drop table if exists public.fin_vendors;
drop table if exists public.fin_budget_lines;
drop table if exists public.fin_cost_codes;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['fin_bill_approve', 'fin_bill_record', 'fin_bill_void', 'fin_budget_from_snapshot', 'fin_business_config_codes', 'fin_commitment_billed', 'fin_commitment_create', 'fin_commitment_current', 'fin_commitment_overrun_check', 'fin_commitment_revise', 'fin_commitment_set_status', 'fin_cost_code_save', 'fin_cost_codes_ensure', 'fin_cost_codes_guard', 'fin_cost_fill', 'fin_cost_rows_guard', 'fin_cost_type_label', 'fin_cost_types', 'fin_expense_decide', 'fin_expense_record', 'fin_review_add', 'fin_review_autoresolve', 'fin_review_items_guard', 'fin_review_resolve', 'fin_vendor_save', 'fin_vendors_no_delete']) loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;
commit;
