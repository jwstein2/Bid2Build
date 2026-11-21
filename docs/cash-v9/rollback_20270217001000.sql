-- Rollback for 20270217001000_cash_v9.sql (V9 cash-flow forecasting and early warnings).
-- Removes ONLY what V9 added: its settings, milestone progress rules, commitment terms, forecast overrides, alerts and
-- snapshots. No invoice, payment, milestone, trigger, commitment, bill, schedule, shift or time entry is touched.
-- Milestone triggers already confirmed through V9 stay recorded (they are ordinary fin_milestone_triggers rows).
drop function if exists public.fin_cash_settings_save(uuid, jsonb);
drop function if exists public.fin_collection_terms_save(uuid, uuid, jsonb);
drop function if exists public.fin_milestone_progress_rule_save(uuid, jsonb);
drop function if exists public.fin_milestone_progress_confirm(uuid, jsonb);
drop function if exists public.fin_commitment_terms_save(uuid, jsonb);
drop function if exists public.fin_forecast_override_save(uuid, jsonb);
drop function if exists public.fin_cash_alert_set(uuid, jsonb);
drop function if exists public.fin_cash_alerts_sync(uuid, jsonb);
drop function if exists public.fin_cash_alerts_mark_notified(uuid[]);
drop function if exists public.fin_forecast_snapshot_save(uuid, jsonb);
drop function if exists public.fin_forecast_labor(uuid, date, date);
drop table if exists public.fin_forecast_snapshots;
drop table if exists public.fin_cash_alerts;
drop table if exists public.fin_forecast_overrides;
drop table if exists public.fin_commitment_terms;
drop table if exists public.fin_milestone_progress_rules;
drop table if exists public.fin_customer_collection_terms;
drop table if exists public.fin_cash_settings;
