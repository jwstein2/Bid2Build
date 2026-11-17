-- Rollback for 20261123001000_email_consent_and_delivery.sql. Drops the delivery metrics and the
-- consent audit trail (that history is lost). marketing_opt_in / marketing_opt_in_at are untouched.
drop function if exists public.purge_email_delivery_events();
drop view if exists public.email_delivery_daily;
drop table if exists public.email_delivery_events;
drop table if exists public.marketing_consent_events;
alter table public.profiles drop column if exists marketing_opt_out_at;
alter table public.profiles drop column if exists marketing_consent_version;
alter table public.profiles drop column if exists marketing_consent_source;
