-- BuildYourBid core schema
-- Conventions: uuid PKs, user_id on every user-owned row, RLS on every table,
-- money as numeric (never float), timestamps in UTC.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- First day of the current UTC calendar month. Quota periods reset at 00:00 UTC on the 1st.
create or replace function public.quota_period_start(at_time timestamptz default now()) returns date
language sql immutable as $$
  select (date_trunc('month', at_time at time zone 'utc'))::date
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text,
  -- Marketing consent is separate from account/transactional email and defaults to false.
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Business profile (one per account) & customers
-- ---------------------------------------------------------------------------
create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  company_name text not null default '' check (char_length(company_name) <= 200),
  contact_name text check (char_length(contact_name) <= 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 50),
  address text check (char_length(address) <= 500),
  website text check (char_length(website) <= 500),
  logo_path text check (char_length(logo_path) <= 500),
  license_number text check (char_length(license_number) <= 100),
  description text check (char_length(description) <= 2000),
  tagline text check (char_length(tagline) <= 200),
  primary_color text not null default '#1f3a5f' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text not null default '#c8702a' check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_layout text not null default 'left' check (logo_layout in ('left', 'center', 'stacked')),
  header_style text not null default 'solid' check (header_style in ('solid', 'line', 'minimal')),
  default_proposal_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger business_profiles_updated before update on public.business_profiles for each row execute function public.set_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 50),
  project_address text check (char_length(project_address) <= 500),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_user_idx on public.customers (user_id, name);
create trigger customers_updated before update on public.customers for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Estimates (normalized live working copy)
-- ---------------------------------------------------------------------------
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  title text not null default '' check (char_length(title) <= 300),
  trades text[] not null default '{}',
  estimate_number text not null default '' check (char_length(estimate_number) <= 50),
  estimate_date date not null default current_date,
  expiration_date date,
  status text not null default 'draft' check (status in ('draft', 'finalized', 'archived')),
  customer_name text not null default '' check (char_length(customer_name) <= 200),
  customer_email text check (char_length(customer_email) <= 320),
  customer_phone text check (char_length(customer_phone) <= 50),
  project_address text check (char_length(project_address) <= 500),
  customer_notes text check (char_length(customer_notes) <= 4000),
  location_zip text check (char_length(location_zip) <= 10),
  location_city text check (char_length(location_city) <= 100),
  location_state text check (char_length(location_state) <= 50),
  pricing_mode text not null default 'markup' check (pricing_mode in ('markup', 'margin')),
  pricing_percent numeric(9, 4) not null default 25,
  fixed_adjustment numeric(14, 2) not null default 0,
  adjustment_label text check (char_length(adjustment_label) <= 100),
  tax_rate numeric(7, 4) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  display_mode text not null default 'by_group' check (display_mode in ('by_group', 'project_total')),
  default_group_visibility text not null default 'names_only' check (default_group_visibility in ('group_total', 'names_only', 'itemized')),
  template_trade text,
  template_version integer,
  proposal_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- margin must stay below 100% (100% would divide by zero)
  constraint estimates_pricing_valid check (
    (pricing_mode = 'markup' and pricing_percent >= -100) or (pricing_mode = 'margin' and pricing_percent < 100)
  )
);
create index estimates_user_idx on public.estimates (user_id, updated_at desc);
create trigger estimates_updated before update on public.estimates for each row execute function public.set_updated_at();

create table public.estimate_groups (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 200),
  description text check (char_length(description) <= 4000),
  visibility text check (visibility in ('group_total', 'names_only', 'itemized')),
  pricing_mode text check (pricing_mode in ('markup', 'margin')),
  pricing_percent numeric(9, 4),
  sort_order integer not null default 0,
  constraint groups_pricing_pair check ((pricing_mode is null) = (pricing_percent is null)),
  constraint groups_pricing_valid check (
    pricing_mode is null or (pricing_mode = 'markup' and pricing_percent >= -100) or (pricing_mode = 'margin' and pricing_percent < 100)
  )
);
create index estimate_groups_estimate_idx on public.estimate_groups (estimate_id, sort_order);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  group_id uuid not null references public.estimate_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 300),
  description text check (char_length(description) <= 4000),
  category text check (char_length(category) <= 100),
  cost_type text not null default 'material' check (cost_type in ('material', 'labor', 'equipment', 'subcontractor', 'overhead', 'contingency', 'permit', 'delivery', 'labor_burden', 'other')),
  treatment text not null default 'marked_up' check (treatment in ('marked_up', 'pass_through')),
  quantity numeric(14, 4) not null default 0 check (quantity >= 0),
  unit text not null default 'each' check (char_length(unit) <= 40),
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  taxable boolean not null default true,
  pricing_mode text check (pricing_mode in ('markup', 'margin')),
  pricing_percent numeric(9, 4),
  show_on_proposal boolean not null default true,
  notes text check (char_length(notes) <= 4000),
  sort_order integer not null default 0,
  constraint items_pricing_pair check ((pricing_mode is null) = (pricing_percent is null)),
  constraint items_pricing_valid check (
    pricing_mode is null or (pricing_mode = 'markup' and pricing_percent >= -100) or (pricing_mode = 'margin' and pricing_percent < 100)
  )
);
create index estimate_items_estimate_idx on public.estimate_items (estimate_id, group_id, sort_order);

-- ---------------------------------------------------------------------------
-- Immutable finalized versions + generated documents
-- ---------------------------------------------------------------------------
create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version_number integer not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Frozen inputs (estimate, business profile, proposal config, template versions) so a version
  -- always reproduces the exact pricing assumptions that existed when it was generated.
  snapshot jsonb not null,
  -- The customer-facing document that was rendered.
  proposal jsonb not null,
  total_cost numeric(14, 2) not null,
  subtotal numeric(14, 2) not null,
  tax numeric(14, 2) not null,
  total numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  unique (estimate_id, content_hash),
  unique (estimate_id, version_number)
);
create index estimate_versions_user_idx on public.estimate_versions (user_id, created_at desc);

create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  bytes integer,
  created_at timestamptz not null default now(),
  unique (version_id)
);

-- ---------------------------------------------------------------------------
-- Usage quota
-- ---------------------------------------------------------------------------
create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  exports_used integer not null default 0 check (exports_used >= 0),
  primary key (user_id, period_start)
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null unique references public.estimate_versions (id) on delete cascade,
  period_start date not null,
  counted_against_quota boolean not null,
  created_at timestamptz not null default now()
);
create index usage_events_period_idx on public.usage_events (period_start);

-- ---------------------------------------------------------------------------
-- Billing (written only by the server with the service role from verified Stripe webhooks)
-- ---------------------------------------------------------------------------
create table public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  plan text check (plan in ('monthly', 'annual')),
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  -- Stripe event time of the last applied update; older events never overwrite newer state.
  source_event_created timestamptz not null,
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id);

create table public.stripe_events (
  id text primary key,
  type text not null,
  event_created timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- ---------------------------------------------------------------------------
-- Reusable content: saved items, assemblies, user templates
-- ---------------------------------------------------------------------------
create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  description text check (char_length(description) <= 4000),
  cost_type text not null default 'material',
  treatment text not null default 'marked_up' check (treatment in ('marked_up', 'pass_through')),
  unit text not null default 'each',
  unit_cost numeric(14, 4) check (unit_cost >= 0),
  taxable boolean not null default true,
  trade text,
  created_at timestamptz not null default now()
);
create index saved_items_user_idx on public.saved_items (user_id, name);

create table public.assemblies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  trade text,
  created_at timestamptz not null default now()
);
create table public.assembly_items (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references public.assemblies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  cost_type text not null default 'material',
  treatment text not null default 'marked_up',
  quantity numeric(14, 4) not null default 1 check (quantity >= 0),
  unit text not null default 'each',
  unit_cost numeric(14, 4) check (unit_cost >= 0),
  taxable boolean not null default true,
  sort_order integer not null default 0
);

create table public.user_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in ('estimate', 'proposal')),
  definition jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Trade catalog (public read, admin write via server)
-- ---------------------------------------------------------------------------
create table public.trade_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  icon text,
  family text,
  featured boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true
);

-- Versioned: publishing creates a new row; estimates record the version they started from.
create table public.trade_templates (
  id uuid primary key default gen_random_uuid(),
  trade_slug text not null references public.trade_categories (slug) on update cascade,
  version integer not null,
  definition jsonb not null,
  published boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (trade_slug, version)
);

-- ---------------------------------------------------------------------------
-- Pricing data architecture
-- ---------------------------------------------------------------------------
create table public.pricing_sources (
  id text primary key,
  display_name text not null,
  kind text not null check (kind in ('supplier_quote', 'licensed_dataset', 'modeled', 'user_history')),
  enabled boolean not null default false,
  config jsonb not null default '{}', -- never secrets; credentials live in env vars
  monthly_request_cap integer,
  updated_at timestamptz not null default now()
);

create table public.pricing_cache (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.pricing_sources (id) on delete cascade,
  item_key text not null,
  region_key text not null,
  unit text not null,
  amount numeric(14, 4) not null check (amount >= 0),
  currency text not null default 'USD',
  observed_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (source_id, item_key, region_key, unit)
);

-- ---------------------------------------------------------------------------
-- Operations: logs, flags, admin, audit, analytics
-- ---------------------------------------------------------------------------
create table public.import_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  url_host text,
  status text not null check (status in ('success', 'partial', 'failed', 'blocked')),
  error_code text,
  created_at timestamptz not null default now()
);

create table public.pdf_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  estimate_id uuid,
  error text not null,
  created_at timestamptz not null default now()
);

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  units integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

create table public.admin_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'support')),
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- Product analytics: no bid contents, only event names, trade, and anonymous ids.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  anon_id text check (char_length(anon_id) <= 64),
  event text not null check (event in ('landing_view', 'trade_selected', 'builder_started', 'signup_started', 'account_created', 'preview_opened', 'export_succeeded', 'quota_reached', 'checkout_started', 'subscribed')),
  trade text,
  created_at timestamptz not null default now()
);
create index analytics_events_time_idx on public.analytics_events (created_at, event);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.business_profiles enable row level security;
alter table public.customers enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_groups enable row level security;
alter table public.estimate_items enable row level security;
alter table public.estimate_versions enable row level security;
alter table public.generated_documents enable row level security;
alter table public.usage_counters enable row level security;
alter table public.usage_events enable row level security;
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.saved_items enable row level security;
alter table public.assemblies enable row level security;
alter table public.assembly_items enable row level security;
alter table public.user_templates enable row level security;
alter table public.trade_categories enable row level security;
alter table public.trade_templates enable row level security;
alter table public.pricing_sources enable row level security;
alter table public.pricing_cache enable row level security;
alter table public.import_logs enable row level security;
alter table public.pdf_errors enable row level security;
alter table public.api_usage enable row level security;
alter table public.feature_flags enable row level security;
alter table public.admin_roles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.analytics_events enable row level security;

-- Own profile
create policy profiles_own_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Full CRUD on rows the user owns
do $$
declare t text;
begin
  foreach t in array array['business_profiles', 'customers', 'estimates', 'saved_items', 'assemblies', 'user_templates'] loop
    execute format('create policy %1$s_own_all on public.%1$s for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Child rows: must be owned AND attached to a parent the user owns
create policy estimate_groups_own_all on public.estimate_groups for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.estimates e where e.id = estimate_id and e.user_id = (select auth.uid())));
create policy estimate_items_own_all on public.estimate_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.estimate_groups g where g.id = group_id and g.estimate_id = estimate_items.estimate_id and g.user_id = (select auth.uid()))
  );
create policy assembly_items_own_all on public.assembly_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.assemblies a where a.id = assembly_id and a.user_id = (select auth.uid())));

-- Read-only to owner; writes happen only through security-definer functions / service role
create policy estimate_versions_own_select on public.estimate_versions for select to authenticated using (user_id = (select auth.uid()));
create policy generated_documents_own_select on public.generated_documents for select to authenticated using (user_id = (select auth.uid()));
create policy usage_counters_own_select on public.usage_counters for select to authenticated using (user_id = (select auth.uid()));
create policy usage_events_own_select on public.usage_events for select to authenticated using (user_id = (select auth.uid()));
create policy subscriptions_own_select on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy billing_customers_own_select on public.billing_customers for select to authenticated using (user_id = (select auth.uid()));

-- Public catalog reads
create policy trade_categories_read on public.trade_categories for select to anon, authenticated using (active);
create policy trade_templates_read on public.trade_templates for select to anon, authenticated using (published);
create policy feature_flags_read on public.feature_flags for select to anon, authenticated using (true);
-- pricing_sources / pricing_cache / logs / admin / audit / analytics / stripe_events: no policies => service role only.

-- ---------------------------------------------------------------------------
-- Grants: tables are reachable only as RLS allows. Writes to versions, usage, billing are not granted.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.business_profiles, public.customers, public.estimates, public.estimate_groups,
  public.estimate_items, public.saved_items, public.assemblies, public.assembly_items, public.user_templates to authenticated;
grant select on public.estimate_versions, public.generated_documents, public.usage_counters, public.usage_events,
  public.subscriptions, public.billing_customers to authenticated;
grant select on public.trade_categories, public.trade_templates, public.feature_flags to anon, authenticated;
