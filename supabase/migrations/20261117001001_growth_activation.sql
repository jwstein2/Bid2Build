-- Growth engine, PR 1: product activation events.
--
-- Additive only. Widens the analytics_events event list, adds a stable event_id for idempotent
-- (deduplicated) recording, an optional estimate reference, and one admin-only read function for the
-- 7-day activation metric. No existing row, policy or function is changed.
-- Rollback: docs/growth/rollback_20261117001000.sql
--
-- Event names keep the existing conventions (the growth spec's names in brackets):
--   account_created [CompleteRegistration], preview_opened [proposal_previewed],
--   export_succeeded [pdf_exported], subscribed [paid_subscription_started].
-- New: first_bid_started, bid_created (an estimate first saved with 3+ meaningful line items),
--   bid_activated (account met the 7-day activation rule), proposal_sent (signing link created),
--   subscription_renewed, subscription_canceled.

alter table public.analytics_events drop constraint if exists analytics_events_event_check;
alter table public.analytics_events add constraint analytics_events_event_check check (event in (
  'landing_view', 'trade_selected', 'builder_started', 'signup_started', 'account_created', 'preview_opened',
  'export_succeeded', 'quota_reached', 'checkout_started', 'subscribed',
  'first_bid_started', 'bid_created', 'bid_activated', 'proposal_sent', 'subscription_renewed', 'subscription_canceled'
));

-- Stable id per business event (e.g. "bid_created:<estimate id>"). Recording the same id twice is a
-- no-op, so autosave, refreshes, callback retries and webhook redeliveries never double count.
alter table public.analytics_events add column if not exists event_id text check (char_length(event_id) <= 200);
create unique index if not exists analytics_events_event_id_key on public.analytics_events (event_id);
alter table public.analytics_events add column if not exists estimate_id uuid references public.estimates (id) on delete set null;
create index if not exists analytics_events_user_event_idx on public.analytics_events (user_id, event, created_at);

-- Estimates with at least 3 meaningful line items (named, quantity > 0, unit cost > 0), with the time
-- they first reached that: the bid_created event when recorded, otherwise the estimate's last update
-- (a conservative stand-in for bids saved before the event existed). Returns ids and times only:
-- no prices, item names or customer details leave the database. Service role (owner reports) only.
create or replace function public.growth_meaningful_estimates()
returns table (estimate_id uuid, user_id uuid, reached_at timestamptz, from_event boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.user_id, coalesce(ev.at, e.updated_at), ev.at is not null
  from public.estimates e
  join (
    select i.estimate_id from public.estimate_items i
    where btrim(i.name) <> '' and i.quantity > 0 and i.unit_cost > 0
    group by i.estimate_id having count(*) >= 3
  ) m on m.estimate_id = e.id
  left join lateral (
    select min(a.created_at) as at from public.analytics_events a where a.event = 'bid_created' and a.estimate_id = e.id
  ) ev on true;
$$;
revoke all on function public.growth_meaningful_estimates() from public, anon, authenticated;
grant execute on function public.growth_meaningful_estimates() to service_role;
