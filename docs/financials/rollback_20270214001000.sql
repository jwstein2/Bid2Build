-- Rollback for 20270214001000_fin_general_ledger.sql (general ledger).
-- Run in the Supabase SQL Editor only if you need to undo it. The ledger is derived from invoices, payments, bills
-- and expenses, which are untouched; manual, opening and payroll journal entries ARE deleted with it, so export
-- them first (Financials -> Accounting -> General ledger -> Export) if any were posted.
drop function if exists public.fin_gl_activity(uuid, uuid, date, date);
drop function if exists public.fin_gl_balances(uuid, date, date);
drop function if exists public.fin_gl_lock_period(uuid, date, text);
drop function if exists public.fin_gl_payroll_post(uuid, jsonb);
drop function if exists public.fin_gl_account_save(uuid, jsonb);
drop function if exists public.fin_gl_journal_reverse(uuid, date, text);
drop function if exists public.fin_gl_journal_post(uuid, jsonb, text);
drop function if exists public.fin_gl_sync(uuid);
drop function if exists public.fin_gl_sync_internal(uuid);
drop function if exists public.fin_gl_reverse_internal(uuid, date, text, text);
drop function if exists public.fin_gl_post(uuid, date, text, text, text, text, jsonb, uuid);
drop function if exists public.fin_gl_account(uuid, text);
drop function if exists public.fin_gl_ensure_chart(uuid);
drop table if exists public.fin_journal_lines;
drop table if exists public.fin_journal_entries;
drop table if exists public.fin_gl_accounts;
drop function if exists public.fin_journal_check();
