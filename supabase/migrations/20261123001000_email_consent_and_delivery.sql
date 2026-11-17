-- Email deliverability audit (2026-11-17): marketing-consent record + delivery metrics.
--
-- * Additive only. No existing row is changed: the new profile columns start null.
-- * profiles: which notice and where consent was given, and when it was withdrawn. marketing_opt_in
--   still defaults to false; sign-in codes and account email never read any of these columns.
-- * marketing_consent_events: append-only audit trail of consent changes (service role writes;
--   each person can read their own rows).
-- * email_delivery_events: provider delivery events from the Resend webhook (sent, delivered, delayed,
--   bounced, complained, failed). Stores the stream and recipient DOMAIN only, never an address,
--   subject or body. Service role only. Kept 400 days by the purge function below.
-- * email_delivery_daily: per-day, per-stream counts for the owner (security_invoker, service role).
-- Rollback: supabase/rollback/20261123001000_email_consent_and_delivery_down.sql

alter table public.profiles add column if not exists marketing_consent_source text
  check (marketing_consent_source is null or char_length(marketing_consent_source) <= 40);
alter table public.profiles add column if not exists marketing_consent_version text
  check (marketing_consent_version is null or char_length(marketing_consent_version) <= 40);
alter table public.profiles add column if not exists marketing_opt_out_at timestamptz;

create table if not exists public.marketing_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  opted_in boolean not null,
  source text not null check (char_length(source) <= 40),
  notice_version text not null check (char_length(notice_version) <= 40),
  notice_text text check (notice_text is null or char_length(notice_text) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists marketing_consent_events_user_idx on public.marketing_consent_events (user_id, created_at desc);
alter table public.marketing_consent_events enable row level security;
drop policy if exists "consent events: read own" on public.marketing_consent_events;
create policy "consent events: read own" on public.marketing_consent_events
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.marketing_consent_events from anon, authenticated;
grant select on public.marketing_consent_events to authenticated;
grant all on public.marketing_consent_events to service_role;

create table if not exists public.email_delivery_events (
  id bigint generated always as identity primary key,
  provider text not null default 'resend' check (char_length(provider) <= 20),
  provider_event_id text not null unique check (char_length(provider_event_id) <= 120),
  provider_email_id text check (provider_email_id is null or char_length(provider_email_id) <= 100),
  kind text not null check (kind in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed')),
  stream text not null check (stream in ('auth', 'transactional', 'project', 'trial', 'other')),
  recipient_domain text check (recipient_domain is null or char_length(recipient_domain) <= 253),
  bounce_type text check (bounce_type is null or char_length(bounce_type) <= 40),
  bounce_subtype text check (bounce_subtype is null or char_length(bounce_subtype) <= 60),
  email_created_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists email_delivery_events_time_idx on public.email_delivery_events (received_at desc);
create index if not exists email_delivery_events_stream_idx on public.email_delivery_events (stream, kind, received_at desc);
alter table public.email_delivery_events enable row level security;
revoke all on public.email_delivery_events from anon, authenticated;
grant all on public.email_delivery_events to service_role;

create or replace view public.email_delivery_daily with (security_invoker = true) as
select
  date_trunc('day', received_at)::date as day,
  stream,
  count(*) filter (where kind = 'sent') as sent,
  count(*) filter (where kind = 'delivered') as delivered,
  count(*) filter (where kind = 'delayed') as delayed,
  count(*) filter (where kind = 'bounced') as bounced,
  count(*) filter (where kind = 'complained') as complained,
  count(*) filter (where kind = 'failed') as failed,
  count(*) filter (where kind = 'suppressed') as suppressed,
  round(percentile_cont(0.5) within group (order by extract(epoch from received_at - email_created_at))
    filter (where kind = 'delivered' and email_created_at is not null)::numeric, 1) as median_delivery_s
from public.email_delivery_events
group by 1, 2;
revoke all on public.email_delivery_daily from anon, authenticated;
grant select on public.email_delivery_daily to service_role;

create or replace function public.purge_email_delivery_events() returns integer
language sql security definer set search_path = '' as $$
  with d as (delete from public.email_delivery_events where received_at < now() - interval '400 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.purge_email_delivery_events() from public, anon, authenticated;
grant execute on function public.purge_email_delivery_events() to service_role;
