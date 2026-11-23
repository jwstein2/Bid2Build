-- Growth OS Phase 3: unified marketing measurement (docs/growth-os/phase3/README.md).
--
-- Adds, without changing any existing table's columns:
--   1. marketing_touches: every tagged visit (campaign tags, ad click id type or outside referrer) a browser made,
--      first-party, keyed by an anonymous visitor id and linked to the account at sign-in. Gives first-touch and
--      last-touch reporting. No email, name, IP address or click id value is stored.
--   2. marketing_identity_links: anonymous visitor id -> account, first account wins (a shared device never
--      reassigns a visitor), and mkt_link_visitor() to attach a visitor's earlier touches to the account.
--   3. mkt_revenue_facts: net revenue per paid live Stripe invoice (pre-tax, minus refunds in proportion, zero after
--      a lost chargeback), one row per invoice id, read from billing_invoice_facts. Marketing reports use this
--      instead of list-price MRR, so each dollar is counted once.
--   4. analytics_events: event name 'subscription_cancel_scheduled' (cancel at period end), plus an idempotent
--      backfill of 'subscription_canceled' from subscriptions.ended_at for cancellations recorded before the event
--      existed.
--
-- Service role only (RLS on, no grants to anon/authenticated). Safe to run more than once.
-- Rollback: docs/growth-os/phase3/rollback_20270228001000.sql

-- ---------------------------------------------------------------------------------------------------
-- 1. Touches
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.marketing_touches (
  id            bigint generated always as identity primary key,
  visitor_id    uuid not null,
  user_id       uuid references auth.users (id) on delete set null,
  touch_at      timestamptz not null,
  channel       text not null check (char_length(channel) between 1 and 32),
  utm_source    text check (char_length(utm_source) <= 200),
  utm_medium    text check (char_length(utm_medium) <= 200),
  utm_campaign  text check (char_length(utm_campaign) <= 200),
  utm_content   text check (char_length(utm_content) <= 200),
  utm_term      text check (char_length(utm_term) <= 200),
  campaign_id   text check (char_length(campaign_id) <= 128),
  ref_code      text check (char_length(ref_code) <= 64),
  landing_path  text check (char_length(landing_path) <= 500),
  referrer_host text check (char_length(referrer_host) <= 253),
  click_id_type text check (click_id_type in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id')),
  device_type   text check (device_type in ('mobile', 'tablet', 'desktop')),
  -- sha256(visitor | touch time | tags), so a cookie replayed on every page load stores each touch once.
  dedupe_key    text not null unique check (char_length(dedupe_key) = 64),
  created_at    timestamptz not null default now()
);
create index if not exists marketing_touches_user on public.marketing_touches (user_id, touch_at) where user_id is not null;
create index if not exists marketing_touches_visitor on public.marketing_touches (visitor_id, touch_at);
alter table public.marketing_touches enable row level security;
revoke all on public.marketing_touches from public, anon, authenticated;
grant all on public.marketing_touches to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2. Anonymous visitor -> account
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.marketing_identity_links (
  visitor_id uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  linked_at  timestamptz not null default now()
);
create index if not exists marketing_identity_links_user on public.marketing_identity_links (user_id);
alter table public.marketing_identity_links enable row level security;
revoke all on public.marketing_identity_links from public, anon, authenticated;
grant all on public.marketing_identity_links to service_role;

-- Link a visitor to an account (first account wins) and attach that visitor's unlinked touches to it.
-- Returns the number of touches attached by this call (0 when the visitor belongs to another account).
create or replace function public.mkt_link_visitor(p_visitor uuid, p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_n integer;
begin
  if p_visitor is null or p_user is null then return 0; end if;
  insert into public.marketing_identity_links (visitor_id, user_id) values (p_visitor, p_user) on conflict (visitor_id) do nothing;
  select user_id into v_owner from public.marketing_identity_links where visitor_id = p_visitor;
  if v_owner is distinct from p_user then return 0; end if;
  update public.marketing_touches set user_id = p_user where visitor_id = p_visitor and user_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mkt_link_visitor(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mkt_link_visitor(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 3. Net revenue per paid invoice (one row per Stripe invoice id: the primary key of billing_invoice_facts)
-- ---------------------------------------------------------------------------------------------------
create or replace view public.mkt_revenue_facts as
with f as (
  select invoice_id, user_id, subscription_id, billing_reason, paid_at, period_start, period_end, amount_paid_cents, refunded_cents, dispute_status,
         coalesce(nullif(pretax_paid_cents, 0), amount_paid_cents) as gross_cents
  from public.billing_invoice_facts
  where livemode and status = 'paid' and currency = 'usd' and amount_paid_cents > 0
)
select invoice_id, user_id, subscription_id, billing_reason, paid_at, period_start, period_end,
       gross_cents,
       least(gross_cents, round(refunded_cents::numeric * gross_cents / amount_paid_cents)::integer) as refund_cents,
       (dispute_status = 'lost') as disputed_lost,
       case when dispute_status = 'lost' then 0
            else greatest(0, gross_cents - least(gross_cents, round(refunded_cents::numeric * gross_cents / amount_paid_cents)::integer)) end as net_cents
from f;
revoke all on public.mkt_revenue_facts from public, anon, authenticated;
grant select on public.mkt_revenue_facts to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 4. Events: scheduled cancellation + backfill of past cancellations
-- ---------------------------------------------------------------------------------------------------
alter table public.analytics_events drop constraint if exists analytics_events_event_check;
alter table public.analytics_events add constraint analytics_events_event_check check (event in (
  'landing_view', 'trade_selected', 'builder_started', 'signup_started', 'account_created', 'preview_opened',
  'export_succeeded', 'quota_reached', 'checkout_started', 'subscribed',
  'first_bid_started', 'bid_created', 'bid_activated', 'proposal_sent', 'subscription_renewed', 'subscription_canceled',
  'subscription_cancel_scheduled'
));

-- Same event_id the webhook uses, so a later webhook redelivery can't add a second row.
insert into public.analytics_events (user_id, event, event_id, created_at)
select s.user_id, 'subscription_canceled', 'subscription_canceled:' || s.stripe_subscription_id, s.ended_at
from public.subscriptions s
where s.ended_at is not null
on conflict (event_id) do nothing;
