-- Rollback for 20261211001000_fin_book_local_dates.sql: back to comparing with current_date (UTC).
create or replace view public.fin_milestone_status_v with (security_invoker = true) as
select x.*,
       case when x.paid >= x.current_amount and x.current_amount > 0 then 'paid'
            when x.paid > 0 then 'partially_paid'
            when x.invoiced > 0 then 'invoiced'
            when x.triggered_at is not null or x.due_rule = 'date' and x.due_on <= current_date then 'ready_to_invoice'
            else 'not_triggered' end as state,
       (x.due_on is not null and x.due_on < current_date and x.paid < x.current_amount) as overdue,
       case when x.due_on is not null and x.due_on < current_date and x.paid < x.current_amount then current_date - x.due_on else 0 end as days_overdue
  from (
    select m.id as milestone_id, m.book_id, m.job_id, m.seq, m.description, m.basis, m.percent, m.amount as original_amount,
           public.fin_milestone_amount(m.id) as current_amount, m.trigger_kind, m.due_rule, m.is_deposit, m.source, m.change_order_id,
           public.fin_milestone_triggered_at(m.id) as triggered_at, public.fin_milestone_due_on(m.id) as due_on,
           coalesce((select sum(i.total) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as invoiced,
           coalesce((select count(*) from public.fin_invoices i where i.milestone_id = m.id and i.status = 'issued'), 0) as active_invoices,
           coalesce((select sum(a.amount) from public.fin_payment_allocations a join public.fin_invoices i on i.id = a.invoice_id
                      where i.milestone_id = m.id and i.status = 'issued' and a.reversed_at is null), 0)
             + coalesce((select sum(c.amount) from public.fin_credit_applications c join public.fin_invoices i on i.id = c.invoice_id
                      where i.milestone_id = m.id and i.status = 'issued' and c.reversed_at is null), 0) as paid
      from public.fin_payment_milestones m) x;

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
           coalesce((select sum(public.fin_invoice_applied(i.id)) from public.fin_invoices i where i.job_id = c.job_id and i.status = 'issued'), 0) as collected,
           coalesce((select sum(cm.amount) from public.fin_credit_memos cm where cm.job_id = c.job_id and cm.status = 'issued'), 0) as credited
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
  select job_id, 'billed_over_contract', 'action_required', 'billed_over_contract:' || job_id, jsonb_build_object('invoiced', invoiced::text, 'contract', current_contract::text, 'credited', credited::text)
    from jobs where invoiced - credited > current_contract
  union all
  select job_id, 'completion_with_balance', 'warning', 'completion_with_balance:' || job_id, jsonb_build_object('outstanding', (current_contract - collected)::text)
    from jobs where least(rec_done, hist_done) is not null and current_contract - collected > 0
  union all
  select j.id, 'change_order_affects_billing', 'warning', 'change_order_affects_billing:' || cc.change_order_id, jsonb_build_object('changeOrderId', cc.change_order_id, 'amount', cc.amount::text)
    from public.fin_contract_changes cc join public.fin_jobs j on j.id = cc.job_id
   where cc.book_id = p_book_id and cc.kind = 'change_order' and j.status = 'open'
     and not exists (select 1 from public.fin_payment_milestones m where m.change_order_id = cc.change_order_id and m.job_id = cc.job_id)
     and not exists (select 1 from public.fin_credit_memos cm where cm.change_order_id = cc.change_order_id and cm.job_id = cc.job_id and cm.status = 'issued' and cm.amount = -cc.amount)
     and coalesce((select sum(delta) from public.fin_milestone_amendments a where a.change_order_id = cc.change_order_id and a.job_id = cc.job_id and a.status = 'approved'), 0) <> cc.amount
$$;

drop function if exists public.fin_book_today(uuid);
