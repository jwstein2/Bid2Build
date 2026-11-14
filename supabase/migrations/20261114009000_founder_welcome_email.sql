-- Founder welcome email: a durable, idempotent outbox for the one-time "thank you" email sent after a
-- customer's FIRST paid subscription invoice (Stripe invoice.paid with billing_reason=subscription_create).
--
-- * unique (kind, user_id): at most one welcome job per user, ever. Webhook retries, renewals,
--   upgrades, seat changes and re-subscriptions can't create a second one.
-- * Additive only: one new table, no changes to existing tables, functions or data.
-- * Existing paying customers are recorded as 'skipped' (reason prelaunch) so nobody receives an
--   unsolicited backfill email. Delete those rows only if the owner approves a backfill.
-- * Service role only (RLS on, no policies): customers can't read or write it.
-- * Sending stays OFF until FOUNDER_EMAIL_ENABLED=true and a provider key are set (see docs/email/FOUNDER_EMAIL.md).

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('founder_welcome')),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Needed only until delivery; cleared after a successful send.
  to_email text,
  -- What triggered the job (Stripe invoice id), for support and auditing.
  source_ref text,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (kind, user_id)
);
create index if not exists email_outbox_status_idx on public.email_outbox (status, created_at);

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
grant all on public.email_outbox to service_role;

-- No backfill emails: every account that already has (or had) a paid subscription is marked skipped.
insert into public.email_outbox (kind, user_id, status, last_error)
select distinct 'founder_welcome', s.user_id, 'skipped', 'prelaunch: subscribed before the welcome email existed'
from public.subscriptions s
where s.status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused')
on conflict (kind, user_id) do nothing;
