-- V6 P1-B: daily accounting corrections.
--   * Possible-duplicate expenses (Scenario B): when an expense is entered that matches another live expense in
--     the same book (same amount, within 3 days, same vendor or payee), it goes to the Needs review queue as
--     "Possible duplicate". Nothing is changed or hidden automatically: a person decides.
--   * fin_expense_mark_duplicate: voids the duplicate (with "Duplicate of EXP-x" as the reason), keeps the
--     original, closes the review items and writes the audit log. Posted records are never deleted.
--
-- Safe to run more than once. Requires 20261124003000_fin_costs.sql.
-- Rollback: docs/financials/rollback_20261128001000.sql

create or replace function public.fin_expense_duplicate_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.fin_expenses;
begin
  select * into d from public.fin_expenses x
   where x.book_id = new.book_id and x.id <> new.id and x.amount = new.amount
     and x.status not in ('void', 'rejected')
     and abs(x.spent_on - new.spent_on) <= 3
     and ((new.vendor_id is not null and x.vendor_id = new.vendor_id)
       or (nullif(btrim(new.payee), '') is not null and lower(btrim(x.payee)) = lower(btrim(new.payee)))
       or (new.vendor_id is null and nullif(btrim(new.payee), '') is null and x.vendor_id is null and nullif(btrim(x.payee), '') is null
           and x.job_id is not distinct from new.job_id))
   order by x.seq
   limit 1;
  if found then
    perform public.fin_review_add(new.book_id, 'duplicate_suspected', 'expense', new.id, new.job_id,
      jsonb_build_object('duplicateOfId', d.id, 'duplicateOf', d.number, 'amount', new.amount::text, 'spentOn', d.spent_on));
  end if;
  return null;
end $$;
revoke execute on function public.fin_expense_duplicate_check() from public, anon, authenticated;

drop trigger if exists fin_expense_duplicate_check on public.fin_expenses;
create trigger fin_expense_duplicate_check after insert on public.fin_expenses
  for each row execute function public.fin_expense_duplicate_check();

-- Void p_expense_id as a duplicate of p_keep_id. Same permission rules as voiding an expense.
create or replace function public.fin_expense_mark_duplicate(p_expense_id uuid, p_keep_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.fin_expenses; k public.fin_expenses;
begin
  if p_expense_id = p_keep_id then raise exception 'same_record' using errcode = '22023'; end if;
  select * into x from public.fin_expenses where id = p_expense_id;
  select * into k from public.fin_expenses where id = p_keep_id;
  if x.id is null or k.id is null or x.book_id <> k.book_id then raise exception 'not_found' using errcode = 'P0002'; end if;
  if k.status in ('void', 'rejected') then raise exception 'keep_is_void' using errcode = '22023'; end if;
  perform public.fin_expense_decide(x.id, 'void', 'Duplicate of ' || k.number);
  perform public.fin_review_autoresolve('duplicate_suspected', 'expense', x.id, 'Voided as a duplicate of ' || k.number);
  perform public.fin_review_autoresolve('duplicate_suspected', 'expense', k.id, 'Kept; ' || x.number || ' voided as its duplicate');
  perform public.fin_audit(x.book_id, 'expense.duplicate', 'expense', x.id, jsonb_build_object('keptId', k.id, 'kept', k.number, 'voided', x.number));
end $$;
revoke execute on function public.fin_expense_mark_duplicate(uuid, uuid) from public, anon;
grant execute on function public.fin_expense_mark_duplicate(uuid, uuid) to authenticated;
