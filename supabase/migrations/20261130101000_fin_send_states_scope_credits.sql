-- V6 P1-B, part 2: invoice send states and scope-removal credits (Scenario D).
-- Requires 20261124002000 (receivables), 20261124004000 (communications) and 20261130001000 (invoice delete).
--
--   1. fin_invoice_sends: "Mark as sent" for an invoice the contractor sent outside Built2Bid (own email,
--      printed, handed over). It feeds the status pipeline Draft -> Issued -> Email prepared -> Sent -> Paid.
--      A mark made by mistake is undone with a reason (kept, never deleted). An invoice with a live mark
--      can't be deleted as a mistake any more (the customer has seen it): void it instead.
--   2. Change orders on the job: a scope-removal change order (negative amount) is settled either by taking it
--      off a remaining payment (the existing milestone amendment) or with a credit memo linked to the change
--      order (fin_change_order_credit). A change order is settled one way only. Original signed documents and
--      issued invoices never change.
--   3. Alerts: a change order settled by credit no longer shows "change order affects billing", and credit
--      memos on the job count against "billed over contract".
-- Idempotent. Rollback: docs/financials/rollback_20261130101000.sql

-- 1. Sent outside Built2Bid -------------------------------------------------------------------------------
create table if not exists public.fin_invoice_sends (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  invoice_id  uuid not null references public.fin_invoices (id) on delete cascade,
  method      text not null check (method in ('own_email', 'printed', 'in_person', 'text', 'other')),
  sent_on     date not null,
  note        text check (char_length(note) <= 500),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  undone_by   uuid references auth.users (id) on delete set null,
  undone_at   timestamptz,
  undo_reason text check (char_length(undo_reason) <= 500),
  constraint fin_invoice_sends_undo check ((undone_at is null) = (undo_reason is null))
);
create index if not exists fin_invoice_sends_invoice_idx on public.fin_invoice_sends (invoice_id);
create unique index if not exists fin_invoice_sends_one_live on public.fin_invoice_sends (invoice_id) where undone_at is null;

create or replace function public.fin_invoice_sends_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- Only as part of deleting a mistaken invoice (cascade), never on its own.
    if exists (select 1 from public.fin_invoices where id = old.invoice_id) then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.undone_at is not null or (to_jsonb(new) - 'undone_by' - 'undone_at' - 'undo_reason') is distinct from (to_jsonb(old) - 'undone_by' - 'undone_at' - 'undo_reason') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists fin_invoice_sends_guard on public.fin_invoice_sends;
create trigger fin_invoice_sends_guard before update or delete on public.fin_invoice_sends
  for each row execute function public.fin_invoice_sends_guard();

alter table public.fin_invoice_sends enable row level security;
drop policy if exists fin_invoice_sends_select on public.fin_invoice_sends;
create policy fin_invoice_sends_select on public.fin_invoice_sends for select to authenticated
  using (public.fin_has_permission(book_id, 'view_company_financials')
         or exists (select 1 from public.fin_invoices i where i.id = invoice_id and public.fin_job_visible(i.job_id)));
revoke all on public.fin_invoice_sends from anon, authenticated;
grant select on public.fin_invoice_sends to authenticated;

create or replace function public.fin_invoice_mark_sent(p_invoice_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices; v_id uuid; v_method text := coalesce(nullif(p ->> 'method', ''), 'own_email');
        v_on date := coalesce(nullif(p ->> 'sentOn', '')::date, current_date);
begin
  select * into inv from public.fin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', true);
  if inv.status <> 'issued' then raise exception 'invoice_not_open' using errcode = '22023'; end if;
  if v_method not in ('own_email', 'printed', 'in_person', 'text', 'other') then raise exception 'bad_method' using errcode = '22023'; end if;
  if v_on > current_date + 1 or v_on < inv.issue_date - 1 then raise exception 'bad_date' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_invoice_sends where invoice_id = inv.id and undone_at is null) then raise exception 'already_marked_sent' using errcode = '22023'; end if;
  insert into public.fin_invoice_sends (book_id, invoice_id, method, sent_on, note, created_by)
  values (inv.book_id, inv.id, v_method, v_on, nullif(left(btrim(coalesce(p ->> 'note', '')), 500), ''), auth.uid()) returning id into v_id;
  perform public.fin_audit(inv.book_id, 'invoice.marked_sent', 'invoice', inv.id, jsonb_build_object('number', inv.number, 'method', v_method, 'sentOn', v_on));
  return v_id;
end $$;

create or replace function public.fin_invoice_unmark_sent(p_invoice_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices; v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  select * into inv from public.fin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', true);
  if v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
  update public.fin_invoice_sends set undone_at = now(), undone_by = auth.uid(), undo_reason = v_reason where invoice_id = inv.id and undone_at is null;
  if not found then raise exception 'not_marked_sent' using errcode = '22023'; end if;
  perform public.fin_audit(inv.book_id, 'invoice.unmarked_sent', 'invoice', inv.id, jsonb_build_object('number', inv.number, 'reason', v_reason));
end $$;
revoke execute on function public.fin_invoice_mark_sent(uuid, jsonb), public.fin_invoice_unmark_sent(uuid, text) from public, anon;
grant execute on function public.fin_invoice_mark_sent(uuid, jsonb), public.fin_invoice_unmark_sent(uuid, text) to authenticated;

-- A live "sent" mark means the customer has it: deleting as a mistake is refused (void instead).
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
    when exists (select 1 from public.fin_invoice_sends where invoice_id = i.id and undone_at is null) then 'already_sent'
  end
  from (select p_invoice_id as pid) x left join public.fin_invoices i on i.id = x.pid
$$;
revoke execute on function public.fin_invoice_delete_blocker(uuid) from public, anon, authenticated;

-- 2. Scope-removal credits ---------------------------------------------------------------------------------
alter table public.fin_credit_memos add column if not exists change_order_id uuid references public.change_orders (id) on delete restrict;
create index if not exists fin_credit_memos_co_idx on public.fin_credit_memos (change_order_id) where change_order_id is not null;
create unique index if not exists fin_credit_memos_one_live_co on public.fin_credit_memos (book_id, change_order_id) where change_order_id is not null and status = 'issued';

-- A change order is settled one way only per job: its own milestones, an amendment, or a credit.
create or replace function public.fin_change_order_settle_once() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.change_order_id is not null
     and exists (select 1 from public.fin_credit_memos where change_order_id = new.change_order_id and job_id = new.job_id and status = 'issued') then
    raise exception 'already_billed_plan' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists fin_payment_milestones_co_once on public.fin_payment_milestones;
create trigger fin_payment_milestones_co_once before insert on public.fin_payment_milestones
  for each row execute function public.fin_change_order_settle_once();
drop trigger if exists fin_milestone_amendments_co_once on public.fin_milestone_amendments;
create trigger fin_milestone_amendments_co_once before insert on public.fin_milestone_amendments
  for each row execute function public.fin_change_order_settle_once();

create or replace function public.fin_change_order_credit(p_job_id uuid, p jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.fin_jobs; co public.change_orders; n record; m public.fin_credit_memos; v_prior jsonb;
begin
  select * into j from public.fin_jobs where id = p_job_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(j.book_id, 'create_invoices', true);
  v_prior := public.fin_idem_begin(j.book_id, p_idempotency_key, 'change_order.credit');
  if v_prior is not null then return v_prior; end if;
  select * into co from public.change_orders where id = (p ->> 'changeOrderId')::uuid and estimate_id = j.estimate_id for share;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if co.status not in ('approved', 'signed') then raise exception 'not_approved' using errcode = '22023'; end if;
  if co.amount >= 0 then raise exception 'not_a_reduction' using errcode = '22023'; end if;
  if exists (select 1 from public.fin_payment_milestones where change_order_id = co.id and job_id = j.id)
     or exists (select 1 from public.fin_milestone_amendments where change_order_id = co.id and job_id = j.id and status <> 'rejected')
     or exists (select 1 from public.fin_credit_memos where change_order_id = co.id and job_id = j.id and status = 'issued') then
    raise exception 'already_billed_plan' using errcode = '22023';
  end if;
  select * into n from public.fin_next_number(j.book_id, 'credit_memo');
  insert into public.fin_credit_memos (book_id, customer_id, job_id, invoice_id, seq, number, issue_date, amount, reason, created_by, change_order_id)
  values (j.book_id, j.customer_id, j.id, null, n.seq, n.label, current_date, -co.amount,
          left('Change order #' || co.number || ': ' || co.title || ' (scope removed)', 500), auth.uid(), co.id)
  returning * into m;
  perform public.fin_credit_apply_internal(m.id, p -> 'applyTo');
  perform public.fin_audit(j.book_id, 'credit_memo.issued', 'credit_memo', m.id,
    jsonb_build_object('number', m.number, 'amount', m.amount::text, 'changeOrderId', co.id, 'changeOrderNumber', co.number));
  return public.fin_idem_finish(j.book_id, p_idempotency_key, jsonb_build_object('creditMemoId', m.id, 'number', m.number, 'available', public.fin_credit_available(m.id)::text));
end $$;
revoke execute on function public.fin_change_order_credit(uuid, jsonb, text) from public, anon;
grant execute on function public.fin_change_order_credit(uuid, jsonb, text) to authenticated;

-- 3. Alerts ------------------------------------------------------------------------------------------------
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
revoke execute on function public.fin_alert_candidates(uuid) from public, anon, authenticated;
