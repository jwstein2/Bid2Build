-- Growth OS Phase 3: one-shot staging run for built2bid-growth-staging (NEVER production).
-- Generated from 01_standins.sql, the migration (applied, re-applied, rolled back, applied again) and 02_verify.sql.
-- Runs as one transaction in the SQL editor: if any check fails, nothing is kept.
-- Ends with the migration applied, synthetic rows removed, and a results table.

-- ===== 01 stand-ins =====
-- Growth OS Phase 3 staging stand-ins (built2bid-growth-staging only; never run on production).
-- The staging project carries only minimal copies of app tables (Phase 4's growth-os/supabase/staging/00_app_tables_standin.sql).
-- The Phase 3 migration also reads billing_invoice_facts and subscriptions.ended_at, so this adds those, copied
-- column for column from supabase/migrations/20270223001000_commission_reconciliation.sql and production's subscriptions.
create table if not exists public.billing_invoice_facts (
  invoice_id         text primary key check (char_length(invoice_id) between 3 and 255),
  livemode           boolean not null,
  user_id            uuid references auth.users (id) on delete set null,
  stripe_customer_id text check (char_length(stripe_customer_id) <= 255),
  subscription_id    text check (char_length(subscription_id) <= 255),
  status             text not null check (status in ('draft', 'open', 'paid', 'uncollectible', 'void')),
  billing_reason     text check (char_length(billing_reason) <= 60),
  currency           text not null default 'usd' check (char_length(currency) = 3),
  amount_due_cents   integer not null default 0 check (amount_due_cents >= 0),
  amount_paid_cents  integer not null default 0 check (amount_paid_cents >= 0),
  pretax_paid_cents  integer not null default 0 check (pretax_paid_cents >= 0),
  refunded_cents     integer not null default 0 check (refunded_cents >= 0),
  dispute_status     text check (dispute_status in ('open', 'won', 'lost')),
  paid_at            timestamptz,
  failed_at          timestamptz,
  refunded_at        timestamptz,
  period_start       timestamptz,
  period_end         timestamptz,
  stripe_created     timestamptz,
  first_source       text not null check (first_source in ('webhook', 'reconcile')),
  last_source        text not null check (last_source in ('webhook', 'reconcile')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists billing_invoice_facts_user on public.billing_invoice_facts (user_id, paid_at desc);
create index if not exists billing_invoice_facts_paid on public.billing_invoice_facts (paid_at) where status = 'paid';
alter table public.billing_invoice_facts enable row level security;
revoke all on public.billing_invoice_facts from public, anon, authenticated;
grant all on public.billing_invoice_facts to service_role;
-- Production's subscriptions has these; the staging stand-in doesn't.
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists canceled_at timestamptz;
alter table public.subscriptions add column if not exists ended_at timestamptz;

-- ===== migration (first apply) =====
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

-- ===== migration (re-run: must be a no-op) =====
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

-- ===== rollback =====
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
do $$ begin
  if to_regclass('public.marketing_touches') is not null or to_regclass('public.mkt_revenue_facts') is not null or to_regprocedure('public.mkt_link_visitor(uuid,uuid)') is not null
  then raise exception 'rollback left Phase 3 objects behind'; end if;
end $$;

-- ===== migration (re-apply after rollback) =====
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

-- ===== 02 checks =====
-- Growth OS Phase 3 staging checks. Synthetic rows only (syn-p3 ids, @example.test emails), removed at the end.
-- Run after 01_standins.sql and the migration. Any failed check raises, so the whole run rolls back.
create temp table if not exists p3_results (n serial, check_name text, pass boolean, detail text) on commit preserve rows;
truncate p3_results;
do $$
declare
  u1 uuid := 'a3a3a3a3-0000-4000-8000-000000000001'; u2 uuid := 'a3a3a3a3-0000-4000-8000-000000000002';
  v1 uuid := 'b3b3b3b3-0000-4000-8000-000000000001'; v2 uuid := 'b3b3b3b3-0000-4000-8000-000000000002';
  n integer; s bigint; ok boolean;
begin
  insert into auth.users (id, email, aud, role, created_at, updated_at) values
    (u1, 'syn-p3-1@example.test', 'authenticated', 'authenticated', now(), now()),
    (u2, 'syn-p3-2@example.test', 'authenticated', 'authenticated', now(), now());

  -- Touches: three visits by one browser before sign-in, one by another.
  insert into public.marketing_touches (visitor_id, touch_at, channel, utm_source, utm_medium, utm_campaign, landing_path, click_id_type, device_type, dedupe_key) values
    (v1, now() - interval '10 days', 'google_ads', 'google', 'cpc', 'b2b-google-signup-202611', '/bids/roofing', 'gclid', 'mobile', repeat('1', 64)),
    (v1, now() - interval '7 days', 'organic_social', null, null, null, '/pricing', null, 'mobile', repeat('2', 64)),
    (v1, now() - interval '5 days', 'email_outreach', 'instantly', 'email', 'cold_outreach', '/pricing', null, 'mobile', repeat('3', 64)),
    (v2, now() - interval '4 days', 'google_ads', 'google', 'cpc', 'b2b-google-signup-202611', '/bids/painting', 'gclid', 'desktop', repeat('4', 64));
  -- Replayed cookie: same dedupe key stores nothing new.
  insert into public.marketing_touches (visitor_id, touch_at, channel, dedupe_key) values (v1, now() - interval '10 days', 'google_ads', repeat('1', 64)) on conflict (dedupe_key) do nothing;
  select count(*) into n from public.marketing_touches where visitor_id in (v1, v2);
  insert into p3_results (check_name, pass, detail) values ('touch dedupe: replayed touch stored once', n = 4, n || ' rows');

  n := public.mkt_link_visitor(v1, u1);
  insert into p3_results (check_name, pass, detail) values ('sign-in links the visitor''s 3 earlier touches', n = 3, n || ' attached');
  n := public.mkt_link_visitor(v1, u2);
  insert into p3_results (check_name, pass, detail) values ('shared browser: a second account gets nothing', n = 0 and (select user_id from public.marketing_identity_links where visitor_id = v1) = u1, n || ' attached');
  n := public.mkt_link_visitor(v1, u1);
  insert into p3_results (check_name, pass, detail) values ('linking again is a no-op', n = 0, n || ' attached');
  n := public.mkt_link_visitor(v2, u2);
  insert into p3_results (check_name, pass, detail) values ('second visitor linked to second account', n = 1, n || ' attached');

  -- Revenue: one row per invoice, net of refunds and lost disputes, live USD only.
  insert into public.billing_invoice_facts (invoice_id, livemode, user_id, subscription_id, status, billing_reason, currency, amount_due_cents, amount_paid_cents, pretax_paid_cents, refunded_cents, dispute_status, paid_at, first_source, last_source) values
    ('in_synp3_1', true,  u1, 'sub_synp3_1', 'paid', 'subscription_create', 'usd', 1999, 1999, 1999, 0,    null,   now() - interval '4 days', 'webhook', 'webhook'),
    ('in_synp3_2', true,  u1, 'sub_synp3_1', 'paid', 'subscription_cycle',  'usd', 1999, 1999, 1999, 500,  null,   now() - interval '1 day',  'webhook', 'webhook'),
    ('in_synp3_3', false, u1, 'sub_synp3_1', 'paid', 'subscription_create', 'usd', 1999, 1999, 1999, 0,    null,   now(),                     'webhook', 'webhook'),
    ('in_synp3_4', true,  u2, 'sub_synp3_2', 'paid', 'subscription_create', 'usd', 1999, 1999, 1999, 0,    'lost', now() - interval '2 days', 'webhook', 'webhook'),
    ('in_synp3_5', true,  u2, 'sub_synp3_2', 'paid', 'subscription_create', 'usd', 2179, 2179, 1999, 2179, null,   now() - interval '2 days', 'webhook', 'webhook'),
    ('in_synp3_6', true,  u2, 'sub_synp3_2', 'open', 'subscription_cycle',  'usd', 1999, 0,    0,    0,    null,   null,                      'webhook', 'webhook');
  insert into public.billing_invoice_facts (invoice_id, livemode, status, first_source, last_source) values ('in_synp3_1', true, 'paid', 'webhook', 'webhook') on conflict (invoice_id) do nothing;
  select count(*), coalesce(sum(net_cents), 0) into n, s from public.mkt_revenue_facts where invoice_id like 'in_synp3_%';
  insert into p3_results (check_name, pass, detail) values ('revenue view: live paid invoices only (test mode and unpaid excluded)', n = 4, n || ' invoices');
  insert into p3_results (check_name, pass, detail) values ('net revenue $19.99 + $19.99 - $5.00 refund, lost dispute and full refund = $0', s = 3498, '$' || to_char(s / 100.0, 'FM999990.00'));
  select (net_cents = 0 and refund_cents = 1999) into ok from public.mkt_revenue_facts where invoice_id = 'in_synp3_5';
  insert into p3_results (check_name, pass, detail) values ('refund is pre-tax and in proportion', coalesce(ok, false), 'full refund of a taxed invoice');

  -- Events: the new event name is accepted, and the event id keeps it to one row.
  insert into public.analytics_events (user_id, event, event_id) values (u1, 'subscription_cancel_scheduled', 'subscription_cancel_scheduled:sub_synp3_1:1');
  insert into public.analytics_events (user_id, event, event_id) values (u1, 'subscription_cancel_scheduled', 'subscription_cancel_scheduled:sub_synp3_1:1') on conflict (event_id) do nothing;
  select count(*) into n from public.analytics_events where event_id = 'subscription_cancel_scheduled:sub_synp3_1:1';
  insert into p3_results (check_name, pass, detail) values ('subscription_cancel_scheduled accepted and deduplicated', n = 1, n || ' row');

  -- Privileges: service role only.
  ok := not has_table_privilege('anon', 'public.marketing_touches', 'select') and not has_table_privilege('authenticated', 'public.marketing_touches', 'select')
    and not has_table_privilege('anon', 'public.marketing_identity_links', 'select') and not has_table_privilege('authenticated', 'public.marketing_identity_links', 'select')
    and not has_table_privilege('anon', 'public.mkt_revenue_facts', 'select') and not has_table_privilege('authenticated', 'public.mkt_revenue_facts', 'select')
    and not has_function_privilege('anon', 'public.mkt_link_visitor(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.mkt_link_visitor(uuid, uuid)', 'execute')
    and has_table_privilege('service_role', 'public.marketing_touches', 'insert') and has_function_privilege('service_role', 'public.mkt_link_visitor(uuid, uuid)', 'execute');
  insert into p3_results (check_name, pass, detail) values ('anon and signed-in users can''t read touches, links or revenue', ok, 'service_role only');
  select bool_and(relrowsecurity) into ok from pg_class where oid in ('public.marketing_touches'::regclass, 'public.marketing_identity_links'::regclass);
  insert into p3_results (check_name, pass, detail) values ('row level security on', ok, '');

  -- Cleanup: remove every synthetic row.
  delete from public.analytics_events where user_id in (u1, u2);
  delete from public.billing_invoice_facts where invoice_id like 'in_synp3_%';
  delete from public.marketing_touches where visitor_id in (v1, v2);
  delete from auth.users where id in (u1, u2);
  select (select count(*) from public.marketing_touches where visitor_id in (v1, v2)) + (select count(*) from public.marketing_identity_links where user_id in (u1, u2))
       + (select count(*) from public.billing_invoice_facts where invoice_id like 'in_synp3_%') + (select count(*) from auth.users where id in (u1, u2)) into n;
  insert into p3_results (check_name, pass, detail) values ('synthetic rows removed', n = 0, n || ' left');

  if exists (select 1 from p3_results where not pass) then
    raise exception 'Phase 3 staging check failed: %', (select string_agg(check_name || ' (' || detail || ')', '; ') from p3_results where not pass);
  end if;
end $$;
insert into p3_results (check_name, pass, detail) values ('migration re-runs cleanly, rollback removes it, re-apply works', true, 'reached the end');
select n, check_name, case when pass then 'PASS' else 'FAIL' end as result, detail from p3_results order by n;
