-- Growth engine, PR 3: outbound ad-platform conversion queue (Meta Conversions API).
--
-- Additive. One row per (platform, event_id): the same business event can never be sent twice, and
-- the browser Pixel uses the same event_id so Meta deduplicates the pair. Rows are only written while
-- META_CAPI_ENABLED=true and only for accounts that allowed ad measurement. The payload holds the
-- event name, time, source URL, a SHA-256 hash of the normalized email and of the account id, and the
-- _fbp/_fbc browser ids when known. Never names, addresses, bid amounts, margins or proposal content.
-- Service role only (RLS on, no policies). Rollback: docs/growth/rollback_20261117002000.sql

create table public.ad_conversions (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('meta')),
  event_id text not null check (char_length(event_id) <= 200),
  event_name text not null check (char_length(event_name) <= 64),
  user_id uuid references auth.users (id) on delete set null,
  payload jsonb not null check (pg_column_size(payload) <= 4096),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (char_length(last_error) <= 500),
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (platform, event_id)
);
create index ad_conversions_pending_idx on public.ad_conversions (status, created_at) where status in ('pending', 'failed');
alter table public.ad_conversions enable row level security;
revoke all on public.ad_conversions from anon, authenticated;
