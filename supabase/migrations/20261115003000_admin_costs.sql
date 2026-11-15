-- Owner command center V3: Tech Stack & Costs.
--
-- Purely additive. Creates two owner-only tables and one aggregate-only reporting function. No
-- existing table, row, subscription, grant or entitlement is changed. Safe to run more than once.
-- Rollback: supabase/rollback/20261115003000_admin_costs_down.sql
--
-- 1. admin_services: the owner's record of each provider Built2Bid uses (plan, recurring charge,
--    billing interval, renewal date, Built2Bid allocation %, budget, where the number came from).
--    A NULL amount means "unknown", never zero.
-- 2. admin_expenses: dated charges (manual entries and imported invoices). (service_key,
--    external_id) is unique, so the same invoice or transaction id can never be counted twice.
--    Advertising spend stays in public.marketing_costs and is not entered here.
-- 3. admin_platform_usage(): database size, storage bytes/objects per bucket and auth user count,
--    as aggregates only (no row contents), for the owner's usage monitors.
--
-- Access: service role only (RLS on, no policies, grants revoked), like the other admin tables.

create table if not exists public.admin_services (
  provider_key text primary key check (provider_key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  purpose text check (char_length(purpose) <= 200),
  category text not null check (category in ('hosting', 'database', 'domains', 'email', 'payments', 'ai', 'automation', 'marketing', 'prospecting', 'devtools', 'monitoring', 'other')),
  status text not null default 'unknown' check (status in ('active', 'connected_unused', 'development', 'proposed', 'discontinued', 'unknown')),
  plan text check (char_length(plan) <= 80),
  cost_type text not null default 'fixed' check (cost_type in ('fixed', 'variable', 'marketing', 'other')),
  amount_cents integer check (amount_cents between 0 and 100000000),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'annual', 'usage', 'one_time', 'none')),
  next_renewal date,
  allocation_pct smallint not null default 100 check (allocation_pct between 0 and 100),
  budget_monthly_cents integer check (budget_monthly_cents between 0 and 100000000),
  cost_source text not null default 'unknown' check (cost_source in ('verified', 'provider_api', 'invoice', 'manual', 'estimated', 'unknown')),
  dashboard_url text check (dashboard_url ~ '^https://' and char_length(dashboard_url) <= 300),
  invoice_ref text check (char_length(invoice_ref) <= 200),
  notes text check (char_length(notes) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists admin_services_updated on public.admin_services;
create trigger admin_services_updated before update on public.admin_services
  for each row execute function public.set_updated_at();
alter table public.admin_services enable row level security;
revoke all on public.admin_services from anon, authenticated;
grant all on public.admin_services to service_role;

create table if not exists public.admin_expenses (
  id bigint generated always as identity primary key,
  service_key text not null check (service_key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  incurred_on date not null,
  amount_cents integer not null check (amount_cents between -100000000 and 100000000),
  kind text not null default 'fixed' check (kind in ('fixed', 'variable', 'marketing', 'other')),
  source text not null default 'manual' check (source in ('manual', 'invoice', 'provider_api')),
  external_id text check (char_length(external_id) <= 120),
  note text check (char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (service_key, external_id)
);
create index if not exists admin_expenses_date_idx on public.admin_expenses (incurred_on);
alter table public.admin_expenses enable row level security;
revoke all on public.admin_expenses from anon, authenticated;
grant all on public.admin_expenses to service_role;

create or replace function public.admin_platform_usage() returns jsonb
language sql stable security definer set search_path = public, storage, auth as $$
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'auth_users', (select count(*) from auth.users),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'objects', n, 'bytes', b) order by bucket_id)
      from (select bucket_id, count(*) n, coalesce(sum((metadata->>'size')::bigint), 0) b from storage.objects group by bucket_id) s
    ), '[]'::jsonb),
    'measured_at', now()
  );
$$;
revoke all on function public.admin_platform_usage() from public, anon, authenticated;
grant execute on function public.admin_platform_usage() to service_role;
