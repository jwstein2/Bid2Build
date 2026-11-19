-- Rollback for 20261117001001_growth_activation.sql. Removes only what it added.
-- Rows recorded with the new event names must go before the old check list can return.
drop function if exists public.growth_meaningful_estimates();
drop index if exists public.analytics_events_user_event_idx;
drop index if exists public.analytics_events_event_id_key;
alter table public.analytics_events drop column if exists estimate_id;
alter table public.analytics_events drop column if exists event_id;
delete from public.analytics_events where event in ('first_bid_started', 'bid_created', 'bid_activated', 'proposal_sent', 'subscription_renewed', 'subscription_canceled');
alter table public.analytics_events drop constraint if exists analytics_events_event_check;
alter table public.analytics_events add constraint analytics_events_event_check check (event in (
  'landing_view', 'trade_selected', 'builder_started', 'signup_started', 'account_created', 'preview_opened',
  'export_succeeded', 'quota_reached', 'checkout_started', 'subscribed'
));
