-- Rollback for 20261112001000_growth_funnel.sql. Drops ONLY the objects that migration created.
-- WARNING: deletes lead attribution and the suppression list. Export public.leads first if you may
-- need to restore suppression (people who unsubscribed must never be re-contacted).
drop function if exists public.growth_funnel(uuid, timestamptz);
drop table if exists public.lead_events;
drop table if exists public.marketing_costs;
drop table if exists public.leads;
