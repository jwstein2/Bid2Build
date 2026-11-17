-- Delete an issued invoice that was a genuine mistake, safely.
--   An issued invoice can be deleted only when nothing else depends on it yet:
--     * no payment was ever applied to it (even one later reversed)
--     * no credit was ever applied to or issued against it
--     * a later invoice doesn't deduct it as a deposit
--     * no dispute was opened on it
--     * no email for it was sent, queued or scheduled (unsent drafts are removed with it)
--   Everything else stays Void-only. A reason is required, and the full invoice (lines included) is kept in
--   the audit log as invoice.deleted. If it was the most recent invoice number, that number is released and
--   reused; otherwise the number stays retired and the audit entry explains the gap.
--
-- Safe to run more than once. Requires 20261124005000_fin_customer_merge.sql (keeps its merge rule in the guard).
-- Rollback: docs/financials/rollback_20261130001000.sql

-- The guards still refuse every delete of an issued invoice, except the one fin_invoice_delete_mistake is
-- removing inside its own transaction (b2b.fin_invoice_delete = that invoice's id).
create or replace function public.fin_invoices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and public.fin_merge_only_customer(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not (old.status = 'issued' and coalesce(current_setting('b2b.fin_invoice_delete', true), '') = old.id::text) then
      raise exception 'record_immutable' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'void' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if old.status = 'issued' and not (new.status = 'void'
      and (to_jsonb(new) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'updated_at')
          = (to_jsonb(old) - 'status' - 'voided_by' - 'voided_at' - 'void_reason' - 'updated_at')) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'void' then raise exception 'bad_state' using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.fin_invoice_lines_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.fin_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'DELETE' and v_status = 'issued' and coalesce(current_setting('b2b.fin_invoice_delete', true), '') = old.invoice_id::text then
    return old;
  end if;
  if v_status is distinct from 'draft' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;

-- Why an invoice can't be deleted (null = it can). Internal: called only by fin_invoice_delete_mistake.
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

create or replace function public.fin_invoice_delete_mistake(p_invoice_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.fin_invoices; v_block text; v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
        v_snapshot jsonb; v_released boolean := false;
begin
  select * into inv from public.fin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(inv.book_id, 'create_invoices', true);
  if inv.status = 'draft' then
    perform public.fin_invoice_delete_draft(inv.id);
    return jsonb_build_object('deleted', true, 'number', null, 'numberReleased', false);
  end if;
  if v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
  perform 1 from public.fin_payment_allocations where invoice_id = inv.id for share;
  v_block := public.fin_invoice_delete_blocker(inv.id);
  if v_block is not null then raise exception '%', v_block using errcode = '22023'; end if;
  v_snapshot := to_jsonb(inv) || jsonb_build_object('lines',
    coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.fin_invoice_lines l where l.invoice_id = inv.id), '[]'::jsonb));
  delete from public.comm_messages where fin_invoice_id = inv.id and status in ('draft', 'canceled', 'skipped');
  perform set_config('b2b.fin_invoice_delete', inv.id::text, true);
  delete from public.fin_invoice_lines where invoice_id = inv.id;
  delete from public.fin_invoices where id = inv.id;
  perform set_config('b2b.fin_invoice_delete', '', true);
  -- Release the number only if nothing was numbered after it, so numbering stays gapless.
  update public.fin_number_sequences set next_value = next_value - 1
   where book_id = inv.book_id and doc_type = 'invoice' and next_value - 1 = inv.seq;
  v_released := found;
  perform public.fin_audit(inv.book_id, 'invoice.deleted', 'invoice', inv.id, jsonb_build_object('number', inv.number, 'total', inv.total::text,
    'reason', v_reason, 'numberReleased', v_released, 'invoice', v_snapshot));
  return jsonb_build_object('deleted', true, 'number', inv.number, 'numberReleased', v_released);
end $$;
revoke execute on function public.fin_invoice_delete_mistake(uuid, text) from public, anon;
grant execute on function public.fin_invoice_delete_mistake(uuid, text) to authenticated;
