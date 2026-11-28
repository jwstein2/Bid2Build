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
