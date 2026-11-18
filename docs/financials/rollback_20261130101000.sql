-- Rollback for 20261130101000_fin_send_states_scope_credits.sql (invoice send states + scope-removal credits).
-- Restores the delete blocker from 20261130001000 and the alert rules from 20261124002000. "Sent" marks and the
-- credit memo -> change order link are dropped (the credit memos themselves stay).
drop function if exists public.fin_change_order_credit(uuid, jsonb, text);
drop trigger if exists fin_payment_milestones_co_once on public.fin_payment_milestones;
drop trigger if exists fin_milestone_amendments_co_once on public.fin_milestone_amendments;
drop function if exists public.fin_change_order_settle_once();
drop index if exists public.fin_credit_memos_one_live_co;
drop index if exists public.fin_credit_memos_co_idx;
alter table public.fin_credit_memos drop column if exists change_order_id;
drop function if exists public.fin_invoice_mark_sent(uuid, jsonb);
drop function if exists public.fin_invoice_unmark_sent(uuid, text);
drop table if exists public.fin_invoice_sends;
drop function if exists public.fin_invoice_sends_guard();

create or replace function public.fin_invoice_delete_blocker(p_invoice_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when i.id is null then 'not_found'
    when i.status = 'void' then 'record_immutable'
    when exists (select 1 from public.fin_payment_allocations where invoice_id = i.id) then 'invoice_has_payments'
    when exists (select 1 from public.fin_credit_applications where invoice_id = i.id)
      or exists (select 1 from public.fin_credit_memos where invoice_id = i.id) then 'has_credits'
    when exists (select 1 from public.fin_invoice_lines where applies_invoice_id = i.id) then 'deposit_applied'
    when exists (select 1 from public.fin_invoice_disputes where invoice_id = i.id) then 'has_dispute'
    when exists (select 1 from public.comm_messages where fin_invoice_id = i.id and status not in ('draft', 'canceled', 'skipped')) then 'already_emailed'
  end
  from (select p_invoice_id as pid) x left join public.fin_invoices i on i.id = x.pid
$$;
revoke execute on function public.fin_invoice_delete_blocker(uuid) from public, anon, authenticated;

create or replace function public.fin_alert_candidates(p_book_id uuid)
returns table (job_id uuid, kind text, severity text, dedupe_key text, details jsonb)
language sql stable security definer set search_path = public as $$
  with ms as (
    select m.*, public.fin_milestone_triggered_at(m.id) as t_at, public.fin_milestone_due_on(m.id) as due_on, public.fin_milestone_amount(m.id) as cur,
           coalesce((select sum(i.total) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as invoiced,
           (select count(*) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued') as n_inv,
           coalesce((select sum(public.fin_invoice_applied(i.id)) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as paid
      from public.fin_payment_milestones m where m.book_id = p_book_id),
  jobs as (
    select c.*, (select min(coalesce(h.effective_at, h.created_at)) from public.estimate_stage_history h where h.estimate_id = c.estimate_id and h.to_stage = 'in_progress') as hist_start,
           (select min(coalesce(h.effective_at, h.created_at)) from public.estimate_stage_history h where h.estimate_id = c.estimate_id and h.to_stage = 'completed') as hist_done,
           (select min(t.occurred_at) from public.fin_milestone_triggers t where t.job_id = c.job_id and t.trigger_kind = 'project_start_confirmed') as rec_start,
           (select min(t.occurred_at) from public.fin_milestone_triggers t where t.job_id = c.job_id and t.trigger_kind = 'final_completion_confirmed') as rec_done,
           coalesce((select sum(public.fin_invoice_applied(i.id)) from public.fin_invoices i where i.job_id = c.job_id and i.status = 'issued'), 0) as collected
      from public.fin_job_contract_v c where c.book_id = p_book_id and c.status = 'open')
  select job_id, 'deposit_not_invoiced', 'action_required', 'deposit_not_invoiced:' || id, jsonb_build_object('milestoneId', id, 'amount', cur::text)
    from ms where is_deposit and t_at is not null and n_inv = 0
  union all
  select job_id, 'deposit_overdue', 'action_required', 'deposit_overdue:' || id, jsonb_build_object('milestoneId', id, 'dueOn', due_on, 'unpaid', (cur - paid)::text)
    from ms where is_deposit and due_on < current_date and paid < cur
  union all
  select ms.job_id, 'start_with_prestart_unpaid', 'warning', 'start_with_prestart_unpaid:' || ms.id, jsonb_build_object('milestoneId', ms.id, 'unpaid', (ms.cur - ms.paid)::text)
    from ms join jobs j on j.job_id = ms.job_id
   where ms.trigger_kind = 'agreement_signed' and ms.paid < ms.cur and coalesce(least(j.rec_start, j.hist_start), null) is not null
  union all
  select job_id, 'milestone_ready_not_invoiced', 'warning', 'milestone_ready_not_invoiced:' || id, jsonb_build_object('milestoneId', id, 'amount', cur::text)
    from ms where not is_deposit and t_at is not null and n_inv = 0
  union all
  select i.job_id, 'invoice_milestone_mismatch', 'info', 'invoice_milestone_mismatch:' || i.id, jsonb_build_object('invoiceId', i.id, 'discrepancies', i.discrepancies, 'reason', i.exception_reason)
    from public.fin_invoices i where i.book_id = p_book_id and i.status = 'issued'
     and exists (select 1 from jsonb_array_elements(i.discrepancies) d where d ->> 'code' in ('amount_differs', 'due_date_differs', 'not_triggered'))
  union all
  select job_id, 'duplicate_milestone_invoice', 'warning', 'duplicate_milestone_invoice:' || id, jsonb_build_object('milestoneId', id, 'invoices', n_inv)
    from ms where n_inv > 1
  union all
  select job_id, 'billed_over_contract', 'action_required', 'billed_over_contract:' || job_id, jsonb_build_object('invoiced', invoiced::text, 'contract', current_contract::text)
    from jobs where invoiced > current_contract
  union all
  select job_id, 'completion_with_balance', 'warning', 'completion_with_balance:' || job_id, jsonb_build_object('outstanding', (current_contract - collected)::text)
    from jobs where least(rec_done, hist_done) is not null and current_contract - collected > 0
  union all
  select j.id, 'change_order_affects_billing', 'warning', 'change_order_affects_billing:' || cc.change_order_id, jsonb_build_object('changeOrderId', cc.change_order_id, 'amount', cc.amount::text)
    from public.fin_contract_changes cc join public.fin_jobs j on j.id = cc.job_id
   where cc.book_id = p_book_id and cc.kind = 'change_order' and j.status = 'open'
     and not exists (select 1 from public.fin_payment_milestones m where m.change_order_id = cc.change_order_id)
     and coalesce((select sum(delta) from public.fin_milestone_amendments a where a.change_order_id = cc.change_order_id and a.status = 'approved'), 0) <> cc.amount
$$;
revoke execute on function public.fin_alert_candidates(uuid) from public, anon, authenticated;
