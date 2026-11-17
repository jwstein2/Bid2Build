-- Rollback for 20261201007000_fin_reports_pl.sql (company Reports + P&L).
-- Read-only objects only: dropping them loses no data. Safe to run more than once.
drop function if exists public.fin_report_pl(uuid, text, date, date);
drop view if exists public.fin_report_entries_v;
