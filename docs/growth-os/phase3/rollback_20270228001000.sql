-- Rollback for supabase/migrations/20270228001000_marketing_measurement.sql.
-- Drops the Phase 3 measurement objects. Touch history is lost; nothing else is affected.
-- Rows recorded as 'subscription_cancel_scheduled' are deleted first so the old constraint can be restored.
-- Backfilled 'subscription_canceled' rows are kept: they use the webhook's own event ids and are correct.
drop view if exists public.mkt_revenue_facts;
drop function if exists public.mkt_link_visitor(uuid, uuid);
drop table if exists public.marketing_identity_links;
drop table if exists public.marketing_touches;
delete from public.analytics_events where event = 'subscription_cancel_scheduled';
alter table public.analytics_events drop constraint if exists analytics_events_event_check;
alter table public.analytics_events add constraint analytics_events_event_check check (event in (
  'landing_view', 'trade_selected', 'builder_started', 'signup_started', 'account_created', 'preview_opened',
  'export_succeeded', 'quota_reached', 'checkout_started', 'subscribed',
  'first_bid_started', 'bid_created', 'bid_activated', 'proposal_sent', 'subscription_renewed', 'subscription_canceled'
));
