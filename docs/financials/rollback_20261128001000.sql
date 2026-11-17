-- Rollback for 20261128001000_fin_v6_corrections.sql. Deploy the previous app version first.
-- Keeps every expense and review item (voided duplicates stay voided, with their audit entries).
begin;
drop trigger if exists fin_expense_duplicate_check on public.fin_expenses;
drop function if exists public.fin_expense_duplicate_check();
drop function if exists public.fin_expense_mark_duplicate(uuid, uuid);
commit;
