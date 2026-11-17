-- Rollback for 20261123002000_fin_receivables.sql (jobs, contract baselines, payment milestones, invoices,
-- payments, credits, refunds, billing alerts). Deploy the previous app version first.
-- WARNING: drops every invoice, payment, credit memo and refund. Export them first. Run 004 and 003 first.
-- Change orders, estimates and customers are untouched (finance only ever pointed at them).
begin;
drop trigger if exists change_orders_fin_sync on public.change_orders;
drop function if exists public.fin_allocate_internal(public.fin_payments, jsonb);   -- takes the fin_payments row type
alter table public.fin_business_config drop column if exists require_billing_exception_approval;
drop view if exists public.fin_milestone_status_v;
drop view if exists public.fin_customer_balances_v;
drop view if exists public.fin_credit_memo_balances_v;
drop view if exists public.fin_payment_balances_v;
drop view if exists public.fin_invoice_balances_v;
drop view if exists public.fin_job_contract_v;
drop table if exists public.fin_alerts;
drop table if exists public.fin_refunds;
drop table if exists public.fin_credit_applications;
drop table if exists public.fin_credit_memos;
drop table if exists public.fin_payment_allocations;
drop table if exists public.fin_payments;
drop table if exists public.fin_invoice_lines;
drop table if exists public.fin_invoices;
drop table if exists public.fin_milestone_amendments;
drop table if exists public.fin_milestone_triggers;
drop table if exists public.fin_payment_milestones;
drop table if exists public.fin_contract_changes;
drop table if exists public.fin_contract_snapshots;
drop table if exists public.fin_jobs;
drop table if exists public.fin_idempotency;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['fin_alert_candidates', 'fin_alert_set_status', 'fin_alerts_guard', 'fin_alerts_refresh', 'fin_allocate_internal', 'fin_allocation_reverse', 'fin_change_order_milestones_add', 'fin_change_order_sync', 'fin_check_receivable_totals', 'fin_contract_deduction_add', 'fin_credit_application_reverse', 'fin_credit_apply_internal', 'fin_credit_available', 'fin_credit_memo_apply', 'fin_credit_memo_issue', 'fin_credit_memo_void', 'fin_guard_lifecycle', 'fin_idem_begin', 'fin_idem_finish', 'fin_invoice_applied', 'fin_invoice_delete_draft', 'fin_invoice_discrepancies', 'fin_invoice_issue', 'fin_invoice_lines_guard', 'fin_invoice_save', 'fin_invoice_void', 'fin_invoices_guard', 'fin_job_open', 'fin_job_set_status', 'fin_job_visible', 'fin_jobs_guard', 'fin_milestone_amendment_decide', 'fin_milestone_amendment_request', 'fin_milestone_amendments_guard', 'fin_milestone_amount', 'fin_milestone_due_on', 'fin_milestone_trigger_record', 'fin_milestone_triggered_at', 'fin_milestones_from_snapshot', 'fin_payment_allocate', 'fin_payment_record', 'fin_payment_unapplied', 'fin_payment_verify', 'fin_payment_void', 'fin_refund_record', 'fin_refund_void', 'fin_schedule_amounts']) loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;
commit;
