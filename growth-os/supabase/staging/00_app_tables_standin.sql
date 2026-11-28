-- STAGING ONLY (project built2bid-growth-staging). NEVER run on production or on a database that already
-- has the Built2Bid app schema.
--
-- The staging project holds no customer data and not the whole app. Growth OS reads only a handful of app
-- tables (through growth_read views and growth_api.contact_eligibility / crm_apply), so this file creates
-- just those tables with the same names, columns and constraints that Growth OS touches, copied from
-- supabase/migrations (core_schema, growth_funnel, admin_reporting, customer_communications,
-- sales_lead_import, sales_email_deliverability, creator_outreach_crm). If one of those columns changes in
-- the app, change it here too; tests/db/growth-os.test.ts runs against the real app migrations.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'support')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin(p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = p_user_id and role = 'admin')
$$;

create table if not exists public.admin_account_labels (
  user_id uuid primary key references auth.users (id) on delete cascade,
  label text not null check (label in ('genuine', 'internal', 'test', 'demo')),
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  plan text check (plan in ('monthly', 'annual')),
  source_event_created timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  anon_id text,
  event text not null check (event in ('landing_view', 'trade_selected', 'builder_started', 'signup_started', 'account_created',
    'preview_opened', 'export_succeeded', 'quota_reached', 'checkout_started', 'subscribed', 'first_bid_started', 'bid_created',
    'bid_activated', 'proposal_sent', 'subscription_renewed', 'subscription_canceled', 'subscription_cancel_scheduled')),
  trade text,
  event_id text unique check (char_length(event_id) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  email_norm text not null unique check (email_norm = lower(btrim(email_norm)) and position('@' in email_norm) > 1),
  user_id uuid unique references auth.users (id) on delete set null,
  stage text not null default 'prospect' check (stage in ('prospect', 'contacted', 'engaged', 'replied', 'interested', 'signed_up', 'activated', 'paid', 'churned')),
  stage_changed_at timestamptz not null default now(),
  source text, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  landing_path text, first_touch_at timestamptz,
  unsubscribed_at timestamptz, suppressed_at timestamptz,
  suppression_reason text check (suppression_reason in ('unsubscribed', 'bounced', 'customer', 'complaint', 'manual', 'deleted_account')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  event text not null check (char_length(event) <= 64),
  source text not null check (source in ('instantly', 'app', 'stripe', 'admin')),
  campaign_id text,
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  meta jsonb check (meta is null or pg_column_size(meta) <= 4096),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.comm_suppressions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,
  email text not null check (email = lower(email)),
  scope text not null check (scope in ('marketing', 'project_updates', 'all')),
  reason text not null check (reason in ('unsubscribe', 'stop_request', 'ambiguous_opt_out', 'bounce', 'complaint', 'manual')),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_suppressions (
  key text primary key check (key ~ '^(e|d|p):.+'),
  reason text not null default 'opted_out',
  created_at timestamptz not null default now()
);

create table if not exists public.sales_bad_emails (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  reason text not null default 'bounced',
  created_at timestamptz not null default now()
);

create table if not exists public.creator_outreach_suppressions (
  email text primary key check (email = lower(btrim(email))),
  reason text not null check (reason in ('unsubscribe', 'bounce', 'declined', 'owner')),
  created_at timestamptz not null default now()
);

-- Same posture as production: RLS on, nothing granted to browser roles.
do $$ declare t text; begin
  foreach t in array array['profiles', 'admin_roles', 'admin_account_labels', 'subscriptions', 'analytics_events', 'leads',
                           'lead_events', 'comm_suppressions', 'sales_suppressions', 'sales_bad_emails', 'creator_outreach_suppressions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
