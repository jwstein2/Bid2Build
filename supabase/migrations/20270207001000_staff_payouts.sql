-- V8.1 Owner administration: Team & Staff, self-service staff onboarding, contractor payout ledger with
-- recipient-paid fees (test mode until the owner activates live), year-end tax readiness and the owner
-- Banking & Cash Flow designation.
--
-- Builds on, and does not change:
--   * Sales Portal / Hub (sales_reps, sales_statements, sales_commissions, sales_payouts, policy versions,
--     milestone and V3 compensation). Commission math, approval and entitlement rules are untouched: the
--     payout engine only pays statements the existing flow has already APPROVED.
--   * Read-only bank feeds (fin_bank_connections / fin_bank_accounts / fin_bank_balances, V6.9).
--   * Owner check public.is_admin() (admin_roles) and the append-only audit_logs table.
--
-- Safety: nothing here moves money. payout_settings.mode starts 'off'. Test mode only ever talks to the
-- in-app mock or a provider sandbox, and test payouts never mark a real statement paid. Live mode needs the
-- owner's explicit activation (checklist + approved fee policy + approved funding account) AND the
-- PAYOUTS_ALLOW_LIVE server variable. Safe to run more than once. Rollback: docs/staff-payouts/rollback_20270207001000.sql

-- ---------------------------------------------------------------------------------------------------
-- 1. Staff directory
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.staff_members (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid unique references auth.users (id) on delete set null,
  sales_rep_id       uuid unique references public.sales_reps (id) on delete set null,
  email              text not null unique check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  display_name       text not null check (char_length(btrim(display_name)) between 1 and 120),
  legal_first_name   text check (char_length(legal_first_name) <= 80),
  legal_last_name    text check (char_length(legal_last_name) <= 80),
  preferred_name     text check (char_length(preferred_name) <= 80),
  phone              text check (char_length(phone) <= 40),
  address_line1      text check (char_length(address_line1) <= 200),
  address_line2      text check (char_length(address_line2) <= 200),
  city               text check (char_length(city) <= 100),
  state              text check (char_length(state) <= 40),
  postal_code        text check (char_length(postal_code) <= 20),
  country            text not null default 'US' check (country ~ '^[A-Z]{2}$'),
  emergency_name     text check (char_length(emergency_name) <= 120),
  emergency_phone    text check (char_length(emergency_phone) <= 40),
  emergency_relation text check (char_length(emergency_relation) <= 60),
  job_title          text check (char_length(job_title) <= 120),
  department         text check (char_length(department) <= 80),
  start_date         date,
  end_date           date,
  manager_id         uuid references public.staff_members (id) on delete set null,
  status             text not null default 'invited' check (status in ('invited', 'onboarding', 'active', 'suspended', 'terminated')),
  -- What the administrator configured. Legal classification follows the law, not this label: anything not
  -- reviewed stays 'pending_review' and is never paid through the contractor workflow.
  classification     text not null default 'pending_review' check (classification in ('contractor_1099', 'employee_w2', 'vendor', 'pending_review')),
  classification_reviewed_at timestamptz,
  classification_reviewed_by uuid references auth.users (id) on delete set null,
  classification_note text check (char_length(classification_note) <= 1000),
  comp_types         text[] not null default '{}' check (comp_types <@ array['commission', 'hourly', 'salary', 'fixed_fee', 'bonus']::text[]),
  pay_rate_cents     integer check (pay_rate_cents is null or pay_rate_cents between 0 and 100000000),
  pay_unit           text check (pay_unit in ('hour', 'year', 'month', 'project')),
  pay_frequency      text check (pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'per_statement')),
  work_state         text check (work_state ~ '^[A-Z]{2}$'),
  -- Legally required alternatives when direct deposit can't be required (W-2: payroll provider or check).
  payment_method     text not null default 'ach' check (payment_method in ('ach', 'check', 'payroll')),
  -- People already on the team before V8.1: the fee disclosure is optional for them (no new deduction is imposed
  -- on an existing relationship). Until they accept it, Built2Bid pays their transfer fees.
  fee_ack_optional   boolean not null default false,
  banking_read       boolean not null default false,      -- explicit owner grant; never implies moving money
  banking_read_granted_at timestamptz,
  banking_read_granted_by uuid references auth.users (id) on delete set null,
  role_confirmed_at  timestamptz,
  security_confirmed_at timestamptz,
  onboarding_completed_at timestamptz,
  suspended_at       timestamptz,
  status_reason      text check (char_length(status_reason) <= 500),
  invited_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint staff_members_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists staff_members_status on public.staff_members (status);
drop trigger if exists staff_members_updated on public.staff_members;
create trigger staff_members_updated before update on public.staff_members for each row execute function public.set_updated_at();

-- Internal roles. The platform owner is admin_roles (is_admin) and is never stored here. Sales selling and
-- Sales Admin powers stay in sales_reps / sales_capabilities(); these rows describe the person in the staff
-- directory and grant the finance-side capabilities below.
create table if not exists public.staff_roles (
  staff_id   uuid not null references public.staff_members (id) on delete cascade,
  role       text not null check (role in ('sales_admin', 'sales_rep', 'finance', 'operations', 'external_accountant')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (staff_id, role)
);

-- ---------------------------------------------------------------------------------------------------
-- 2. Capabilities (server-side, least privilege)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.staff_capabilities(p_user uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members; v text[] := '{}'; r text[];
begin
  if p_user is null then return v; end if;
  if public.is_admin(p_user) then
    return array['staff.view', 'staff.manage', 'payouts.view', 'payouts.manage', 'payouts.activate', 'banking.view', 'banking.manage',
                 'tax.view', 'reports.export', 'reconcile', 'self.view'];
  end if;
  select * into m from public.staff_members where user_id = p_user;
  if not found or m.status in ('suspended', 'terminated') then return v; end if;
  v := array['self.view'];
  if m.status <> 'active' then return v; end if;
  select coalesce(array_agg(role), '{}') into r from public.staff_roles where staff_id = m.id;
  if r && array['finance', 'external_accountant'] then
    v := v || array['payouts.view', 'tax.view', 'reports.export', 'reconcile'];
    if m.banking_read then v := v || array['banking.view']; end if;
  end if;
  return v;
end $$;

create or replace function public.staff_my_capabilities() returns text[]
language sql stable security definer set search_path = public as $$ select public.staff_capabilities(auth.uid()) $$;

create or replace function public.staff_require_cap(p_caller uuid, p_cap text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (p_cap = any (public.staff_capabilities(p_caller))) then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.staff_require_owner(p_caller uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller is null or not public.is_admin(p_caller) then raise exception 'owner_only' using errcode = '42501'; end if;
end $$;

create or replace function public.staff_audit(p_actor uuid, p_action text, p_type text, p_id text, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details) values (p_actor, p_action, p_type, p_id, p_details)
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Invites (secure, expiring; only the SHA-256 of the token is stored)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff_members (id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at  timestamptz
);
create index if not exists staff_invites_staff on public.staff_invites (staff_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------
-- 4. Agreements (versioned text; acceptances are immutable evidence)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.staff_agreement_templates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('contractor_agreement', 'commission_agreement', 'payment_terms', 'fee_disclosure', 'employee_acknowledgement', 'mn_wage_notice', 'vendor_terms')),
  version     integer not null check (version > 0),
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 20000),
  applies_to  text[] not null check (applies_to <@ array['contractor_1099', 'employee_w2', 'vendor']::text[]),
  commission_only boolean not null default false,   -- only for people paid commission
  active      boolean not null default true,
  legal_status text not null default 'draft_pending_counsel' check (legal_status in ('draft_pending_counsel', 'counsel_approved')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, version)
);
create unique index if not exists staff_agreement_templates_one_active on public.staff_agreement_templates (kind) where active;

create table if not exists public.staff_agreement_acceptances (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff_members (id) on delete restrict,
  template_id uuid not null references public.staff_agreement_templates (id) on delete restrict,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  typed_name  text not null check (char_length(btrim(typed_name)) between 2 and 120),
  fee_policy_version integer,
  ip          text check (char_length(ip) <= 64),
  user_agent  text check (char_length(user_agent) <= 300),
  accepted_at timestamptz not null default now(),
  unique (staff_id, template_id)
);

create or replace function public.staff_guard_immutable() returns trigger language plpgsql as $$
begin raise exception 'immutable_record' using errcode = '42501'; end $$;
drop trigger if exists staff_agreement_acceptances_immutable on public.staff_agreement_acceptances;
create trigger staff_agreement_acceptances_immutable before update or delete on public.staff_agreement_acceptances
  for each row execute function public.staff_guard_immutable();

-- ---------------------------------------------------------------------------------------------------
-- 5. Tax documentation status. Full TINs are AES-256-GCM sealed by the server (PII_ENCRYPTION_KEY) and kept in
--    a service-role-only table; the app tables hold the last 4 only.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.staff_tax_profiles (
  staff_id          uuid primary key references public.staff_members (id) on delete cascade,
  w9_status         text not null default 'not_started' check (w9_status in ('not_started', 'submitted', 'verified', 'needs_correction')),
  w9_legal_name     text check (char_length(w9_legal_name) <= 200),
  w9_business_name  text check (char_length(w9_business_name) <= 200),
  w9_tax_class      text check (w9_tax_class in ('individual', 'c_corp', 's_corp', 'partnership', 'trust_estate', 'llc_c', 'llc_s', 'llc_p', 'other')),
  w9_exempt_payee_code text check (char_length(w9_exempt_payee_code) <= 4),
  tin_type          text check (tin_type in ('ssn', 'ein', 'itin')),
  tin_last4         text check (tin_last4 ~ '^[0-9]{4}$'),
  w9_signed_name    text check (char_length(w9_signed_name) <= 120),
  w9_signed_at      timestamptz,
  w9_verified_at    timestamptz,
  w9_verified_by    uuid references auth.users (id) on delete set null,
  backup_withholding boolean not null default false,  -- set only on an IRS notice; never estimated
  -- W-2 readiness. Forms themselves are completed in the payroll provider; this records status + who verified.
  w4_status         text not null default 'not_started' check (w4_status in ('not_started', 'completed_in_payroll', 'verified')),
  state_w4_status   text not null default 'not_started' check (state_w4_status in ('not_started', 'completed_in_payroll', 'verified', 'not_required')),
  i9_section1_status text not null default 'not_started' check (i9_section1_status in ('not_started', 'completed', 'verified')),
  i9_section2_verified_at timestamptz,
  i9_section2_verified_by uuid references auth.users (id) on delete set null,
  wage_notice_ack_at timestamptz,
  new_hire_reported_at date,
  updated_at        timestamptz not null default now(),
  constraint staff_tax_profiles_w9 check (w9_status = 'not_started' or (tin_type is not null and tin_last4 is not null and w9_signed_at is not null))
);
drop trigger if exists staff_tax_profiles_updated on public.staff_tax_profiles;
create trigger staff_tax_profiles_updated before update on public.staff_tax_profiles for each row execute function public.set_updated_at();

create table if not exists public.staff_tin_secrets (
  staff_id        uuid primary key references public.staff_members (id) on delete cascade,
  tin_ciphertext  text not null check (char_length(tin_ciphertext) between 16 and 1000),
  key_version     smallint not null default 1,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------
-- 6. Payout destinations: processor-hosted collection only. No routing or full account numbers, ever.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.staff_payout_destinations (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references public.staff_members (id) on delete cascade,
  provider          text not null check (provider in ('mock', 'stripe_global_payouts')),
  mode              text not null check (mode in ('test', 'live')),
  recipient_ref     text not null check (char_length(recipient_ref) between 1 and 200),
  payout_method_ref text check (char_length(payout_method_ref) <= 200),
  institution_name  text check (char_length(institution_name) <= 200),
  account_type      text not null default 'unknown' check (account_type in ('checking', 'savings', 'card', 'unknown')),
  last4             text check (last4 ~ '^[0-9]{4}$'),
  status            text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'disabled', 'replaced')),
  verified_at       timestamptz,
  eligible_from     timestamptz,                 -- bank-change safety hold
  is_current        boolean not null default true,
  created_at        timestamptz not null default now(),
  replaced_at       timestamptz
);
create unique index if not exists staff_payout_destinations_current on public.staff_payout_destinations (staff_id, mode) where is_current;

-- ---------------------------------------------------------------------------------------------------
-- 7. Payout configuration
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.payout_fee_policies (
  id                    uuid primary key default gen_random_uuid(),
  version               integer not null unique check (version > 0),
  provider              text not null check (provider in ('mock', 'stripe_global_payouts')),
  standard_fixed_cents  integer not null check (standard_fixed_cents between 0 and 10000),
  standard_bps          integer not null default 0 check (standard_bps between 0 and 1000),
  instant_enabled       boolean not null default false,
  instant_fixed_cents   integer not null default 0 check (instant_fixed_cents between 0 and 10000),
  instant_bps           integer not null default 0 check (instant_bps between 0 and 1000),
  instant_min_cents     integer not null default 0 check (instant_min_cents between 0 and 10000),
  monthly_account_cents integer not null default 0 check (monthly_account_cents between 0 and 10000),
  return_fee_cents      integer not null default 0 check (return_fee_cents between 0 and 10000),
  recipient_pays_standard boolean not null default true,
  recipient_pays_instant  boolean not null default true,
  disclosure            text not null check (char_length(disclosure) between 1 and 4000),
  source_note           text not null check (char_length(source_note) between 1 and 500),
  approved_at           timestamptz,
  approved_by           uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now()
);

create table if not exists public.payout_settings (
  id                     boolean primary key default true check (id),
  mode                   text not null default 'off' check (mode in ('off', 'test', 'live')),
  provider               text not null default 'mock' check (provider in ('mock', 'stripe_global_payouts')),
  paused                 boolean not null default false,
  paused_at              timestamptz,
  paused_by              uuid references auth.users (id) on delete set null,
  paused_reason          text check (char_length(paused_reason) <= 500),
  per_payout_limit_cents integer not null default 250000 check (per_payout_limit_cents between 100 and 100000000),
  daily_limit_cents      integer not null default 1000000 check (daily_limit_cents between 100 and 1000000000),
  review_above_cents     integer not null default 150000 check (review_above_cents between 100 and 100000000),
  bank_change_hold_hours integer not null default 72 check (bank_change_hold_hours between 0 and 720),
  pay_delay_days         integer not null default 1 check (pay_delay_days between 0 and 31),
  min_payout_cents       integer not null default 0 check (min_payout_cents between 0 and 100000),
  max_attempts           integer not null default 3 check (max_attempts between 1 and 10),
  fee_recovery_blocked_states text[] not null default '{}',
  fee_policy_id          uuid references public.payout_fee_policies (id),
  funding_label          text check (char_length(funding_label) <= 200),
  funding_approved_at    timestamptz,
  funding_approved_by    uuid references auth.users (id) on delete set null,
  live_activated_at      timestamptz,
  live_activated_by      uuid references auth.users (id) on delete set null,
  live_checklist         jsonb,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null
);

-- Fee schedule v1: Stripe Global Payouts public pricing (US local bank payout $1.50; debit card 1.5% + $0.75... see
-- source_note). NOT approved: until the owner approves a fee policy, Built2Bid pays every fee and nothing is deducted.
insert into public.payout_fee_policies (version, provider, standard_fixed_cents, standard_bps, instant_enabled, instant_fixed_cents, instant_bps, instant_min_cents,
  monthly_account_cents, return_fee_cents, recipient_pays_standard, recipient_pays_instant, disclosure, source_note)
values (1, 'stripe_global_payouts', 150, 0, false, 150, 75, 200, 0, 0, true, true,
  'Built2Bid LLC uses third-party payment providers to deliver contractor compensation electronically. Applicable account or transaction processing fees may be charged to the payment recipient, as disclosed before enrollment and subject to the contractor agreement and applicable law. Any permitted fee deducted from a payment will be itemized on the corresponding payout statement. Standard ACH payout: $1.50 per payout (the provider''s actual charge, no markup). Several commissions in the same pay period are combined into one payout, so you pay the fee once. Instant payout (optional, only if offered): $1.50 + 0.75%, minimum $2.00. Standard payouts are always free to choose and are never delayed to sell an instant payout.',
  'Stripe Global Payouts pricing (docs.stripe.com/global-payouts/pricing and stripe.com/pricing), checked 2026-11-20: US local bank payout $1.50; US debit card payout $1.50 + 0.75% (min $2). Confirm on the account''s pricing page before approving.')
on conflict (version) do nothing;

insert into public.payout_settings (id, fee_policy_id) select true, (select id from public.payout_fee_policies where version = 1)
on conflict (id) do nothing;

-- Year-end thresholds by tax year. Never hardcoded in the app; the owner verifies each year.
create table if not exists public.tax_reporting_thresholds (
  tax_year        integer primary key check (tax_year between 2020 and 2100),
  form            text not null default '1099-NEC' check (form = '1099-NEC'),
  threshold_cents integer not null check (threshold_cents between 0 and 100000000),
  verified        boolean not null default false,
  source_note     text not null check (char_length(source_note) between 1 and 500),
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);
insert into public.tax_reporting_thresholds (tax_year, threshold_cents, verified, source_note) values
  (2025, 60000, true, 'IRS 1099-NEC instructions: $600 for payments made in 2025.'),
  (2026, 200000, false, 'P.L. 119-21 (2025) raised the 1099-NEC/MISC threshold to $2,000 for payments made after 2025, indexed for inflation after 2026. Verify against the IRS 2026 1099-NEC instructions.')
on conflict (tax_year) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 8. Payout ledger
-- ---------------------------------------------------------------------------------------------------
create sequence if not exists public.payout_ref_seq;

create table if not exists public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,                    -- internal reference, e.g. B2B-PO-202612-000042
  staff_id           uuid not null references public.staff_members (id) on delete restrict,
  mode               text not null check (mode in ('test', 'live')),
  provider           text not null check (provider in ('mock', 'stripe_global_payouts')),
  speed              text not null default 'standard' check (speed in ('standard', 'instant')),
  gross_cents        integer not null check (gross_cents >= 0),
  adjustments_cents  integer not null default 0,
  fee_cents          integer not null default 0 check (fee_cents >= 0),     -- provider cost for this transfer
  fee_bearer         text not null default 'company' check (fee_bearer in ('recipient', 'company')),
  fee_reason         text check (char_length(fee_reason) <= 60),          -- why the company pays (if it does)
  fee_policy_version integer,
  net_cents          integer not null check (net_cents >= 0),             -- amount sent to the bank
  status             text not null default 'scheduled' check (status in ('scheduled', 'held', 'needs_approval', 'submitting', 'submitted', 'paid', 'failed', 'returned', 'canceled')),
  hold_reasons       text[] not null default '{}',
  scheduled_for      date not null,
  approved_at        timestamptz,
  approved_by        uuid references auth.users (id) on delete set null,
  destination_id     uuid references public.staff_payout_destinations (id) on delete restrict,
  funding_source     text check (char_length(funding_source) <= 200),
  idempotency_key    text not null unique,
  attempts           integer not null default 0,
  next_attempt_at    timestamptz,
  locked_at          timestamptz,
  submitted_at       timestamptz,
  provider_ref       text unique check (char_length(provider_ref) <= 200),
  settled_at         timestamptz,
  failed_at          timestamptz,
  failure_code       text check (char_length(failure_code) <= 80),
  failure_message    text check (char_length(failure_message) <= 300),
  reconciliation     text not null default 'unreconciled' check (reconciliation in ('unreconciled', 'matched', 'exception', 'not_applicable')),
  reconciled_note    text check (char_length(reconciled_note) <= 300),
  tax_year           integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payouts_net check (net_cents = greatest(gross_cents + adjustments_cents - case when fee_bearer = 'recipient' then fee_cents else 0 end, 0))
);
create index if not exists payouts_status on public.payouts (status, scheduled_for);
create index if not exists payouts_staff on public.payouts (staff_id, created_at desc);
drop trigger if exists payouts_updated on public.payouts;
create trigger payouts_updated before update on public.payouts for each row execute function public.set_updated_at();

create table if not exists public.payout_items (
  id           uuid primary key default gen_random_uuid(),
  payout_id    uuid not null references public.payouts (id) on delete cascade,
  mode         text not null check (mode in ('test', 'live')),
  source_kind  text not null check (source_kind in ('sales_statement')),
  source_id    uuid not null,
  amount_cents integer not null,
  description  text check (char_length(description) <= 200),
  active       boolean not null default true,      -- false once the payout is canceled/failed so the source can be paid again
  created_at   timestamptz not null default now()
);
-- Duplicate-payment guard: one active payout per source per mode.
create unique index if not exists payout_items_once on public.payout_items (mode, source_kind, source_id) where active;

create table if not exists public.payout_events (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique check (char_length(event_id) between 1 and 200),   -- provider event id (idempotent)
  payout_id    uuid references public.payouts (id) on delete restrict,
  provider_ref text check (char_length(provider_ref) <= 200),
  kind         text not null check (kind in ('processing', 'posted', 'failed', 'returned', 'canceled')),
  occurred_at  timestamptz not null,
  failure_code text check (char_length(failure_code) <= 80),
  verified     boolean not null default false,     -- signature-verified provider webhook (or owner test simulation)
  source       text not null default 'webhook' check (source in ('webhook', 'poll', 'test_simulation')),
  received_at  timestamptz not null default now()
);

-- Owner Banking & Cash Flow: which explicitly authorized book holds Built2Bid LLC's business bank feeds, and
-- which of its accounts are excluded (e.g. personal) from company totals. Plus payroll provider status.
create table if not exists public.owner_finance_settings (
  id                   boolean primary key default true check (id),
  company_book_id      uuid references public.fin_books (id) on delete set null,
  designated_at        timestamptz,
  designated_by        uuid references auth.users (id) on delete set null,
  excluded_account_ids uuid[] not null default '{}',
  payroll_provider     text check (char_length(payroll_provider) <= 80),
  payroll_status       text not null default 'not_configured' check (payroll_status in ('not_configured', 'evaluating', 'connected')),
  updated_at           timestamptz not null default now()
);
insert into public.owner_finance_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 9. RLS: every table locked to the service role; people read their own data through security-definer functions.
-- ---------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['staff_members', 'staff_roles', 'staff_invites', 'staff_agreement_templates', 'staff_agreement_acceptances', 'staff_tax_profiles',
    'staff_tin_secrets', 'staff_payout_destinations', 'payout_fee_policies', 'payout_settings', 'tax_reporting_thresholds', 'payouts', 'payout_items',
    'payout_events', 'owner_finance_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage on sequence public.payout_ref_seq to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 10. Seed agreement templates (DRAFT, pending counsel). They never change commission terms: the commission
--     agreement points to the authoritative policy version in the Sales Hub.
-- ---------------------------------------------------------------------------------------------------
insert into public.staff_agreement_templates (kind, version, title, body, applies_to, commission_only) values
('contractor_agreement', 1, 'Independent Contractor Agreement',
 'DRAFT pending attorney review. You provide services to Built2Bid LLC as an independent contractor, not an employee. You control how, when and where you do the work, supply your own tools, may work for others, and are responsible for your own taxes, insurance and business expenses. Built2Bid does not withhold income or employment taxes from contractor payments except where the law requires it (for example backup withholding on an IRS notice). Either party may end the relationship at any time with written notice; compensation already earned under the agreed terms remains payable. You will keep Built2Bid customer and business information confidential.',
 array['contractor_1099'], false),
('commission_agreement', 1, 'Commission Agreement',
 'DRAFT pending attorney review. Your commissions are calculated by the Built2Bid Sales Hub under the commission policy version in force when each commission is earned (shown on the Sales Hub "How you get paid" page and stamped on every commission line). Nothing in this onboarding changes those percentages, durations, holds or eligibility rules. Earned commissions are paid after the monthly statement is approved, by the payout method in your Payout Settings.',
 array['contractor_1099', 'employee_w2'], true),
('payment_terms', 1, 'Payment Terms',
 'DRAFT pending attorney review. Approved compensation is paid on the scheduled pay date by standard ACH to the bank account you connect through our payment provider''s secure page. Several amounts in the same pay period are combined into one payment. Each payment has a statement showing gross compensation, any adjustments, any disclosed processing fee and the net amount. You can change your bank account at any time; for your protection a change is held for a short verification period before payments go to the new account, and we email you about it. Payments are never delayed to reduce fees, and you never have to buy faster delivery to receive pay that is due.',
 array['contractor_1099', 'vendor'], false),
('fee_disclosure', 1, 'Banking & Payment Processing Fees',
 'Built2Bid LLC uses third-party payment providers to deliver contractor compensation electronically. Applicable account or transaction processing fees may be charged to the payment recipient, as disclosed before enrollment and subject to the contractor agreement and applicable law. Any permitted fee deducted from a payment will be itemized on the corresponding payout statement. The current rates are shown on this page before you accept; there is no markup and no fee to join or to keep a Built2Bid sales account.',
 array['contractor_1099', 'vendor'], false),
('employee_acknowledgement', 1, 'Employee Acknowledgements',
 'DRAFT pending attorney review. Your wages, commissions and bonuses are paid through Built2Bid''s payroll provider with the withholding the law requires. You are never charged for receiving your wages, for payroll processing or for employer taxes. Direct deposit is optional where the law requires an alternative; you may choose a paper check.',
 array['employee_w2'], false),
('mn_wage_notice', 1, 'Minnesota Employee Notice (Minn. Stat. 181.032)',
 'DRAFT pending attorney review. At the start of employment Minnesota requires a written notice with: your rate(s) of pay and basis (hourly, salary, commission), allowances claimed against minimum wage, paid leave and how it accrues, deductions that may be made, the number of days in the pay period, the regular payday and the date of the first payday, the employer''s legal name and any other names used, its physical address and phone number, and whether you are exempt from overtime. The completed notice for your position is shown on the next screen from your profile; acknowledge that you received it.',
 array['employee_w2'], false),
('vendor_terms', 1, 'Vendor Payment Terms',
 'DRAFT pending attorney review. Vendor invoices are paid under the separately agreed vendor terms. Processing-fee treatment follows those terms and the fee disclosure.',
 array['vendor'], false)
on conflict (kind, version) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 11. Backfill the directory from the Sales Hub, and keep it in sync for new reps. Classification stays
--     'pending_review': nobody is assumed to be a 1099 contractor because they use the sales portal.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.staff_from_sales_rep() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.status = 'removed' then return new; end if;
  insert into public.staff_members (email, display_name, phone, sales_rep_id, user_id, status, comp_types, work_state, job_title, department)
  values (new.email, new.full_name, new.phone, new.id, new.user_id,
    case new.status when 'active' then 'active' when 'suspended' then 'suspended' else 'invited' end,
    case when coalesce(new.sells, true) then array['commission'] else '{}'::text[] end,
    new.work_state, case when new.role = 'admin' then 'Sales Administrator' else 'Sales Representative' end, 'Sales')
  on conflict (email) do update set sales_rep_id = coalesce(public.staff_members.sales_rep_id, excluded.sales_rep_id),
    user_id = coalesce(public.staff_members.user_id, excluded.user_id)
  returning id into v_id;
  if v_id is not null then
    if coalesce(new.sells, true) then insert into public.staff_roles (staff_id, role) values (v_id, 'sales_rep') on conflict do nothing; end if;
    if new.role = 'admin' then insert into public.staff_roles (staff_id, role) values (v_id, 'sales_admin') on conflict do nothing; end if;
  end if;
  return new;
exception when unique_violation then
  return new;   -- the user or rep is already linked to another directory row: leave both as they are
end $$;
drop trigger if exists sales_reps_staff_sync on public.sales_reps;
create trigger sales_reps_staff_sync after insert on public.sales_reps for each row execute function public.staff_from_sales_rep();

-- Keep the user link in step when a rep accepts their invite.
create or replace function public.staff_link_from_sales_rep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.user_id is distinct from old.user_id then
    update public.staff_members set user_id = new.user_id where sales_rep_id = new.id and user_id is null
      and not exists (select 1 from public.staff_members x where x.user_id = new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists sales_reps_staff_link on public.sales_reps;
create trigger sales_reps_staff_link after update of user_id on public.sales_reps for each row execute function public.staff_link_from_sales_rep();


create or replace function public.staff_from_sales_rep_backfill(r public.sales_reps) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.staff_members (email, display_name, phone, sales_rep_id, user_id, status, comp_types, work_state, job_title, department, fee_ack_optional)
  values (r.email, r.full_name, r.phone, r.id,
    case when exists (select 1 from public.staff_members x where x.user_id = r.user_id) then null else r.user_id end,
    case r.status when 'active' then 'active' when 'suspended' then 'suspended' else 'invited' end,
    case when coalesce(r.sells, true) then array['commission'] else '{}'::text[] end,
    r.work_state, case when r.role = 'admin' then 'Sales Administrator' else 'Sales Representative' end, 'Sales', true)
  on conflict (email) do update set sales_rep_id = coalesce(public.staff_members.sales_rep_id, excluded.sales_rep_id)
  returning id into v_id;
  if coalesce(r.sells, true) then insert into public.staff_roles (staff_id, role) values (v_id, 'sales_rep') on conflict do nothing; end if;
  if r.role = 'admin' then insert into public.staff_roles (staff_id, role) values (v_id, 'sales_admin') on conflict do nothing; end if;
end $$;
revoke execute on function public.staff_from_sales_rep_backfill(public.sales_reps) from public, anon, authenticated;

do $$ declare r public.sales_reps; begin
  for r in select s.* from public.sales_reps s where s.status <> 'removed' and not exists (select 1 from public.staff_members m where m.sales_rep_id = s.id) loop
    perform public.staff_from_sales_rep_backfill(r);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 12. Onboarding status (computed from the data, so it can't drift)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.staff_required_agreements(m public.staff_members) returns setof public.staff_agreement_templates
language sql stable security definer set search_path = public as $$
  select t.* from public.staff_agreement_templates t
  where t.active and m.classification <> 'pending_review' and m.classification = any (t.applies_to)
    and (not t.commission_only or 'commission' = any (m.comp_types))
  order by case t.kind when 'contractor_agreement' then 1 when 'employee_acknowledgement' then 1 when 'commission_agreement' then 2 when 'payment_terms' then 3
    when 'mn_wage_notice' then 3 when 'fee_disclosure' then 4 else 5 end
$$;

create or replace function public.staff_onboarding_status(p_staff uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members; t public.staff_tax_profiles; d public.staff_payout_destinations; s public.payout_settings;
  v_personal boolean; v_agree boolean; v_tax text; v_pay text; v_mode text; v_missing jsonb;
begin
  select * into m from public.staff_members where id = p_staff;
  if not found then return null; end if;
  select * into t from public.staff_tax_profiles where staff_id = p_staff;
  select * into s from public.payout_settings where id;
  v_mode := case when s.mode = 'live' then 'live' else 'test' end;
  select * into d from public.staff_payout_destinations where staff_id = p_staff and mode = v_mode and is_current;
  v_personal := m.legal_first_name is not null and m.legal_last_name is not null and m.phone is not null and m.address_line1 is not null
    and m.city is not null and m.state is not null and m.postal_code is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title)), '[]'::jsonb) into v_missing
    from public.staff_required_agreements(m) r
    where not exists (select 1 from public.staff_agreement_acceptances a where a.staff_id = m.id and a.template_id = r.id)
      and not (r.kind = 'fee_disclosure' and m.fee_ack_optional);
  v_agree := m.classification <> 'pending_review' and jsonb_array_length(v_missing) = 0;
  v_tax := case
    when m.classification in ('contractor_1099', 'vendor') then case when t.w9_status in ('submitted', 'verified') then 'done' else 'todo' end
    when m.classification = 'employee_w2' then case when t.wage_notice_ack_at is not null and t.w4_status <> 'not_started' and t.i9_section1_status <> 'not_started' then 'done' else 'todo' end
    else 'blocked' end;
  v_pay := case
    when m.classification = 'employee_w2' then 'payroll'
    when m.classification = 'pending_review' then 'blocked'
    when m.payment_method = 'check' then 'done'
    when d.id is not null and d.status in ('pending', 'verified') then 'done'
    else 'todo' end;
  return jsonb_build_object(
    'classification', m.classification, 'status', m.status,
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'personal', 'label', 'Personal information', 'state', case when v_personal then 'done' else 'todo' end),
      jsonb_build_object('key', 'role', 'label', 'Role and classification', 'state', case when m.classification = 'pending_review' then 'blocked' when m.role_confirmed_at is not null then 'done' else 'todo' end),
      jsonb_build_object('key', 'agreements', 'label', 'Agreements', 'state', case when m.classification = 'pending_review' then 'blocked' when v_agree then 'done' else 'todo' end),
      jsonb_build_object('key', 'tax', 'label', case when m.classification = 'employee_w2' then 'Employment forms' else 'Tax form (W-9)' end, 'state', v_tax),
      jsonb_build_object('key', 'payout', 'label', case when m.classification = 'employee_w2' then 'Pay through payroll' else 'Payout bank account' end, 'state', v_pay),
      jsonb_build_object('key', 'security', 'label', 'Account security', 'state', case when m.security_confirmed_at is not null then 'done' else 'todo' end),
      jsonb_build_object('key', 'confirm', 'label', 'Confirm and finish', 'state', case when m.onboarding_completed_at is not null then 'done' else 'todo' end)),
    'missing_agreements', v_missing,
    'complete', m.onboarding_completed_at is not null);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 13. Owner: staff management
-- ---------------------------------------------------------------------------------------------------
create or replace function public.staff_member_json(m public.staff_members) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(m) || jsonb_build_object(
    'roles', coalesce((select jsonb_agg(role order by role) from public.staff_roles where staff_id = m.id), '[]'::jsonb),
    'manager_name', (select display_name from public.staff_members x where x.id = m.manager_id),
    'sales_rep', (select jsonb_build_object('id', r.id, 'role', r.role, 'status', r.status, 'code', r.code) from public.sales_reps r where r.id = m.sales_rep_id),
    'onboarding', public.staff_onboarding_status(m.id),
    'tax', (select jsonb_build_object('w9_status', t.w9_status, 'tin_type', t.tin_type, 'tin_last4', t.tin_last4, 'w9_tax_class', t.w9_tax_class,
        'w9_legal_name', t.w9_legal_name, 'w9_business_name', t.w9_business_name, 'w9_signed_at', t.w9_signed_at, 'w9_verified_at', t.w9_verified_at,
        'w4_status', t.w4_status, 'state_w4_status', t.state_w4_status, 'i9_section1_status', t.i9_section1_status, 'i9_section2_verified_at', t.i9_section2_verified_at,
        'wage_notice_ack_at', t.wage_notice_ack_at, 'new_hire_reported_at', t.new_hire_reported_at, 'backup_withholding', t.backup_withholding)
      from public.staff_tax_profiles t where t.staff_id = m.id),
    'destinations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'mode', d.mode, 'provider', d.provider, 'institution_name', d.institution_name,
        'account_type', d.account_type, 'last4', d.last4, 'status', d.status, 'verified_at', d.verified_at, 'eligible_from', d.eligible_from, 'created_at', d.created_at)
        order by d.created_at desc) from public.staff_payout_destinations d where d.staff_id = m.id and d.is_current), '[]'::jsonb),
    'agreements', coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'version', t.version, 'title', t.title, 'accepted_at', a.accepted_at, 'typed_name', a.typed_name)
        order by a.accepted_at) from public.staff_agreement_acceptances a join public.staff_agreement_templates t on t.id = a.template_id where a.staff_id = m.id), '[]'::jsonb),
    'invite', (select jsonb_build_object('expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at, 'created_at', i.created_at)
      from public.staff_invites i where i.staff_id = m.id order by i.created_at desc limit 1))
$$;

create or replace function public.admin_staff_list(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.staff_require_cap(p_caller, 'staff.view');
  return coalesce((select jsonb_agg(public.staff_member_json(m) order by (m.status = 'terminated'), m.display_name) from public.staff_members m), '[]'::jsonb);
end $$;

create or replace function public.admin_staff_get(p_caller uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members;
begin
  perform public.staff_require_cap(p_caller, 'staff.view');
  select * into m from public.staff_members where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return public.staff_member_json(m);
end $$;

-- Create or update a staff member's professional record (owner only). Personal fields the person fills in
-- themselves during onboarding are not overwritten here unless given.
create or replace function public.admin_staff_save(p_caller uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members; v_old public.staff_members; v_roles text[]; v_class text;
begin
  perform public.staff_require_owner(p_caller);
  v_class := coalesce(p ->> 'classification', 'pending_review');
  if p_id is null then
    insert into public.staff_members (email, display_name, job_title, department, start_date, manager_id, classification, comp_types, pay_rate_cents, pay_unit,
      pay_frequency, work_state, payment_method, invited_by, classification_reviewed_at, classification_reviewed_by, classification_note)
    values (lower(btrim(p ->> 'email')), btrim(p ->> 'display_name'), nullif(btrim(p ->> 'job_title'), ''), nullif(btrim(p ->> 'department'), ''),
      nullif(p ->> 'start_date', '')::date, nullif(p ->> 'manager_id', '')::uuid, v_class,
      coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'comp_types') x), '{}'), nullif(p ->> 'pay_rate_cents', '')::integer,
      nullif(p ->> 'pay_unit', ''), nullif(p ->> 'pay_frequency', ''), nullif(upper(btrim(p ->> 'work_state')), ''),
      coalesce(nullif(p ->> 'payment_method', ''), case when v_class = 'employee_w2' then 'payroll' else 'ach' end), p_caller,
      case when v_class <> 'pending_review' then now() end, case when v_class <> 'pending_review' then p_caller end, nullif(btrim(p ->> 'classification_note'), ''))
    returning * into m;
    perform public.staff_audit(p_caller, 'staff.created', 'staff_member', m.id::text, jsonb_build_object('classification', m.classification));
  else
    select * into v_old from public.staff_members where id = p_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.staff_members set
      display_name = coalesce(nullif(btrim(p ->> 'display_name'), ''), display_name),
      job_title = case when p ? 'job_title' then nullif(btrim(p ->> 'job_title'), '') else job_title end,
      department = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
      start_date = case when p ? 'start_date' then nullif(p ->> 'start_date', '')::date else start_date end,
      end_date = case when p ? 'end_date' then nullif(p ->> 'end_date', '')::date else end_date end,
      manager_id = case when p ? 'manager_id' then nullif(p ->> 'manager_id', '')::uuid else manager_id end,
      classification = v_class,
      classification_reviewed_at = case when v_class is distinct from v_old.classification or coalesce((p ->> 'mark_reviewed')::boolean, false) then case when v_class <> 'pending_review' then now() end else classification_reviewed_at end,
      classification_reviewed_by = case when v_class is distinct from v_old.classification or coalesce((p ->> 'mark_reviewed')::boolean, false) then case when v_class <> 'pending_review' then p_caller end else classification_reviewed_by end,
      classification_note = case when p ? 'classification_note' then nullif(btrim(p ->> 'classification_note'), '') else classification_note end,
      comp_types = case when p ? 'comp_types' then coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'comp_types') x), '{}') else comp_types end,
      pay_rate_cents = case when p ? 'pay_rate_cents' then nullif(p ->> 'pay_rate_cents', '')::integer else pay_rate_cents end,
      pay_unit = case when p ? 'pay_unit' then nullif(p ->> 'pay_unit', '') else pay_unit end,
      pay_frequency = case when p ? 'pay_frequency' then nullif(p ->> 'pay_frequency', '') else pay_frequency end,
      work_state = case when p ? 'work_state' then nullif(upper(btrim(p ->> 'work_state')), '') else work_state end,
      payment_method = case when v_class = 'employee_w2' and coalesce(p ->> 'payment_method', payment_method) = 'ach' then 'payroll'
        when p ? 'payment_method' then p ->> 'payment_method' else payment_method end
    where id = p_id returning * into m;
    if m.manager_id = m.id then raise exception 'manager_self' using errcode = '22023'; end if;
    perform public.staff_audit(p_caller, 'staff.updated', 'staff_member', m.id::text,
      jsonb_build_object('classification_from', v_old.classification, 'classification_to', m.classification));
  end if;
  if p ? 'roles' then
    v_roles := coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'roles') x), '{}');
    delete from public.staff_roles where staff_id = m.id and not (role = any (v_roles));
    insert into public.staff_roles (staff_id, role, granted_by) select m.id, x, p_caller from unnest(v_roles) x on conflict do nothing;
    perform public.staff_audit(p_caller, 'staff.roles_set', 'staff_member', m.id::text, jsonb_build_object('roles', v_roles));
  end if;
  return public.staff_member_json(m);
end $$;

-- Suspend / reactivate / terminate. Suspension also pauses the person's Sales Hub access. Removing someone from
-- the Sales Hub stays a separate Sales Hub action because it can affect commission eligibility under the policy.
create or replace function public.admin_staff_set_status(p_caller uuid, p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members; v_old text;
begin
  perform public.staff_require_owner(p_caller);
  if p_status not in ('active', 'suspended', 'terminated') then raise exception 'bad_status' using errcode = '22023'; end if;
  select status into v_old from public.staff_members where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status = 'active' and v_old not in ('suspended', 'onboarding') then raise exception 'cannot_activate' using errcode = '22023'; end if;
  update public.staff_members set status = p_status, status_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    suspended_at = case when p_status = 'suspended' then now() else null end,
    end_date = case when p_status = 'terminated' then coalesce(end_date, current_date) else end_date end
  where id = p_id returning * into m;
  if m.sales_rep_id is not null then
    if p_status in ('suspended', 'terminated') then
      update public.sales_reps set status = 'suspended', updated_at = now() where id = m.sales_rep_id and status = 'active';
    elsif p_status = 'active' then
      update public.sales_reps set status = 'active', updated_at = now() where id = m.sales_rep_id and status = 'suspended' and user_id is not null;
    end if;
  end if;
  -- New automatic payouts stop at once; anything already submitted to the bank can't be recalled here.
  if p_status in ('suspended', 'terminated') then
    update public.payouts set status = 'held', hold_reasons = array(select distinct unnest(hold_reasons || array['not_active']))
    where staff_id = p_id and status in ('scheduled', 'needs_approval');
  end if;
  update public.staff_invites set revoked_at = now() where staff_id = p_id and accepted_at is null and revoked_at is null and p_status <> 'active';
  perform public.staff_audit(p_caller, 'staff.status_' || p_status, 'staff_member', p_id::text, jsonb_build_object('from', v_old, 'reason', p_reason));
  return public.staff_member_json(m);
end $$;

create or replace function public.admin_staff_banking_grant(p_caller uuid, p_id uuid, p_grant boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  update public.staff_members set banking_read = p_grant, banking_read_granted_at = case when p_grant then now() end,
    banking_read_granted_by = case when p_grant then p_caller end where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.staff_audit(p_caller, case when p_grant then 'staff.banking_read_granted' else 'staff.banking_read_revoked' end, 'staff_member', p_id::text, null);
end $$;

-- Owner verification of tax/employment items.
create or replace function public.admin_staff_tax_verify(p_caller uuid, p_id uuid, p_item text, p_date date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  insert into public.staff_tax_profiles (staff_id) values (p_id) on conflict do nothing;
  if p_item = 'w9' then
    update public.staff_tax_profiles set w9_status = 'verified', w9_verified_at = now(), w9_verified_by = p_caller where staff_id = p_id and w9_status = 'submitted';
  elsif p_item = 'w9_correction' then
    update public.staff_tax_profiles set w9_status = 'needs_correction' where staff_id = p_id and w9_status in ('submitted', 'verified');
  elsif p_item = 'w4' then
    update public.staff_tax_profiles set w4_status = 'verified' where staff_id = p_id and w4_status = 'completed_in_payroll';
  elsif p_item = 'state_w4' then
    update public.staff_tax_profiles set state_w4_status = 'verified' where staff_id = p_id and state_w4_status = 'completed_in_payroll';
  elsif p_item = 'state_w4_not_required' then
    update public.staff_tax_profiles set state_w4_status = 'not_required' where staff_id = p_id;
  elsif p_item = 'i9_section2' then
    update public.staff_tax_profiles set i9_section2_verified_at = now(), i9_section2_verified_by = p_caller, i9_section1_status = 'verified'
    where staff_id = p_id and i9_section1_status <> 'not_started';
  elsif p_item = 'new_hire_reported' then
    update public.staff_tax_profiles set new_hire_reported_at = coalesce(p_date, current_date) where staff_id = p_id;
  else
    raise exception 'bad_item' using errcode = '22023';
  end if;
  perform public.staff_audit(p_caller, 'staff.tax_verified', 'staff_member', p_id::text, jsonb_build_object('item', p_item));
end $$;

create or replace function public.admin_staff_invite_create(p_caller uuid, p_id uuid, p_token_hash text, p_days integer default 7) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members; i public.staff_invites;
begin
  perform public.staff_require_owner(p_caller);
  select * into m from public.staff_members where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status in ('suspended', 'terminated') then raise exception 'not_invitable' using errcode = '22023'; end if;
  update public.staff_invites set revoked_at = now() where staff_id = p_id and accepted_at is null and revoked_at is null;
  insert into public.staff_invites (staff_id, token_hash, expires_at, created_by)
  values (p_id, p_token_hash, now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 14))), p_caller) returning * into i;
  perform public.staff_audit(p_caller, 'staff.invite_created', 'staff_member', p_id::text, jsonb_build_object('expires_at', i.expires_at));
  return jsonb_build_object('expires_at', i.expires_at, 'email', m.email, 'display_name', m.display_name);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 14. Invite acceptance (signed-in person)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.staff_invite_lookup(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i public.staff_invites; m public.staff_members;
begin
  select * into i from public.staff_invites where token_hash = p_token_hash;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into m from public.staff_members where id = i.staff_id;
  return jsonb_build_object(
    'status', case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked' when i.expires_at < now() then 'expired' else 'valid' end,
    'display_name', m.display_name, 'job_title', m.job_title,
    'email_hint', left(m.email, 2) || '•••@' || split_part(m.email, '@', 2), 'expires_at', i.expires_at);
end $$;

create or replace function public.staff_invite_accept(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.staff_invites; m public.staff_members; v_uid uuid := auth.uid(); v_email text; v_verified boolean;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select lower(email), email_confirmed_at is not null into v_email, v_verified from auth.users where id = v_uid;
  select * into i from public.staff_invites where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if i.accepted_at is not null then return jsonb_build_object('status', case when i.accepted_by = v_uid then 'ok' else 'accepted' end); end if;
  if i.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if i.expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
  if not coalesce(v_verified, false) then return jsonb_build_object('status', 'unverified'); end if;
  select * into m from public.staff_members where id = i.staff_id for update;
  -- Staff records hold sensitive data, so the invite opens only for the email it was sent to.
  if m.email <> v_email then return jsonb_build_object('status', 'email_mismatch'); end if;
  if m.user_id is not null and m.user_id <> v_uid then return jsonb_build_object('status', 'other_account'); end if;
  if exists (select 1 from public.staff_members x where x.user_id = v_uid and x.id <> m.id) then return jsonb_build_object('status', 'other_record'); end if;
  if m.status in ('suspended', 'terminated') then return jsonb_build_object('status', 'revoked'); end if;
  update public.staff_members set user_id = v_uid, status = case when status = 'invited' then 'onboarding' else status end where id = m.id;
  update public.staff_invites set accepted_at = now(), accepted_by = v_uid where id = i.id;
  insert into public.staff_tax_profiles (staff_id) values (m.id) on conflict do nothing;
  perform public.staff_audit(v_uid, 'staff.invite_accepted', 'staff_member', m.id::text, null);
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 15. Self-service (auth.uid() only ever reaches the caller's own record)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.staff_self() returns public.staff_members
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members;
begin
  select * into m from public.staff_members where user_id = auth.uid();
  if not found then raise exception 'not_staff' using errcode = '42501'; end if;
  if m.status in ('suspended', 'terminated') then raise exception 'staff_inactive' using errcode = '42501'; end if;
  return m;
end $$;

create or replace function public.staff_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members;
begin
  select * into m from public.staff_members where user_id = auth.uid();
  if not found then return null; end if;
  if m.status in ('suspended', 'terminated') then return jsonb_build_object('status', m.status); end if;
  return public.staff_member_json(m) || jsonb_build_object('caps', to_jsonb(public.staff_capabilities(auth.uid())),
    'required_agreements', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'version', r.version, 'title', r.title, 'body', r.body,
      'legal_status', r.legal_status, 'optional', r.kind = 'fee_disclosure' and m.fee_ack_optional, 'accepted', exists (select 1 from public.staff_agreement_acceptances a where a.staff_id = m.id and a.template_id = r.id)))
      from public.staff_required_agreements(m) r), '[]'::jsonb),
    'fee_policy', (select jsonb_build_object('version', f.version, 'standard_fixed_cents', f.standard_fixed_cents, 'standard_bps', f.standard_bps,
      'instant_enabled', f.instant_enabled, 'instant_fixed_cents', f.instant_fixed_cents, 'instant_bps', f.instant_bps, 'instant_min_cents', f.instant_min_cents,
      'monthly_account_cents', f.monthly_account_cents, 'disclosure', f.disclosure, 'approved', f.approved_at is not null)
      from public.payout_settings s join public.payout_fee_policies f on f.id = s.fee_policy_id where s.id),
    'payout_mode', (select mode from public.payout_settings where id));
end $$;

create or replace function public.staff_my_profile_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members := public.staff_self();
begin
  update public.staff_members set
    legal_first_name = nullif(btrim(p ->> 'legal_first_name'), ''), legal_last_name = nullif(btrim(p ->> 'legal_last_name'), ''),
    preferred_name = nullif(btrim(p ->> 'preferred_name'), ''), phone = nullif(btrim(p ->> 'phone'), ''),
    address_line1 = nullif(btrim(p ->> 'address_line1'), ''), address_line2 = nullif(btrim(p ->> 'address_line2'), ''),
    city = nullif(btrim(p ->> 'city'), ''), state = nullif(upper(btrim(p ->> 'state')), ''), postal_code = nullif(btrim(p ->> 'postal_code'), ''),
    country = coalesce(nullif(upper(btrim(p ->> 'country')), ''), 'US'),
    emergency_name = nullif(btrim(p ->> 'emergency_name'), ''), emergency_phone = nullif(btrim(p ->> 'emergency_phone'), ''),
    emergency_relation = nullif(btrim(p ->> 'emergency_relation'), '')
  where id = m.id returning * into m;
  return public.staff_onboarding_status(m.id);
end $$;

create or replace function public.staff_my_role_confirm() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members := public.staff_self();
begin
  if m.classification = 'pending_review' then raise exception 'classification_pending' using errcode = '22023'; end if;
  update public.staff_members set role_confirmed_at = now() where id = m.id;
  return public.staff_onboarding_status(m.id);
end $$;

create or replace function public.staff_my_agreement_accept(p_template uuid, p_body_sha256 text, p_typed_name text, p_ip text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members := public.staff_self(); t public.staff_agreement_templates; v_fee integer;
begin
  select * into t from public.staff_required_agreements(m) r where r.id = p_template;
  if not found then raise exception 'not_required' using errcode = '22023'; end if;
  if encode(sha256(convert_to(t.body, 'UTF8')), 'hex') <> p_body_sha256 then raise exception 'agreement_changed' using errcode = '22023'; end if;
  if t.kind = 'fee_disclosure' then select f.version into v_fee from public.payout_settings s join public.payout_fee_policies f on f.id = s.fee_policy_id where s.id; end if;
  insert into public.staff_agreement_acceptances (staff_id, template_id, body_sha256, typed_name, fee_policy_version, ip, user_agent)
  values (m.id, t.id, p_body_sha256, btrim(p_typed_name), v_fee, left(p_ip, 64), left(p_user_agent, 300)) on conflict (staff_id, template_id) do nothing;
  return public.staff_onboarding_status(m.id);
end $$;

-- W-9 store: called by the server after it seals the TIN (service role only; p_user is the verified session user).
create or replace function public.staff_w9_store(p_user uuid, p_legal_name text, p_business_name text, p_tax_class text, p_exempt_code text,
  p_tin_type text, p_tin_last4 text, p_tin_ciphertext text, p_signed_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members;
begin
  select * into m from public.staff_members where user_id = p_user and status in ('invited', 'onboarding', 'active');
  if not found then raise exception 'not_staff' using errcode = '42501'; end if;
  if m.classification not in ('contractor_1099', 'vendor') then raise exception 'w9_not_applicable' using errcode = '22023'; end if;
  insert into public.staff_tax_profiles (staff_id) values (m.id) on conflict do nothing;
  update public.staff_tax_profiles set w9_status = 'submitted', w9_legal_name = btrim(p_legal_name), w9_business_name = nullif(btrim(coalesce(p_business_name, '')), ''),
    w9_tax_class = p_tax_class, w9_exempt_payee_code = nullif(btrim(coalesce(p_exempt_code, '')), ''), tin_type = p_tin_type, tin_last4 = p_tin_last4,
    w9_signed_name = btrim(p_signed_name), w9_signed_at = now(), w9_verified_at = null, w9_verified_by = null
  where staff_id = m.id;
  insert into public.staff_tin_secrets (staff_id, tin_ciphertext) values (m.id, p_tin_ciphertext)
  on conflict (staff_id) do update set tin_ciphertext = excluded.tin_ciphertext, updated_at = now();
  perform public.staff_audit(p_user, 'staff.w9_submitted', 'staff_member', m.id::text, jsonb_build_object('tin_type', p_tin_type));
  return public.staff_onboarding_status(m.id);
end $$;

-- W-2 items the employee confirms (the forms themselves live in the payroll provider).
create or replace function public.staff_my_employment_item(p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members := public.staff_self();
begin
  if m.classification <> 'employee_w2' then raise exception 'not_employee' using errcode = '22023'; end if;
  insert into public.staff_tax_profiles (staff_id) values (m.id) on conflict do nothing;
  if p_item = 'w4' then update public.staff_tax_profiles set w4_status = 'completed_in_payroll' where staff_id = m.id and w4_status = 'not_started';
  elsif p_item = 'state_w4' then update public.staff_tax_profiles set state_w4_status = 'completed_in_payroll' where staff_id = m.id and state_w4_status = 'not_started';
  elsif p_item = 'i9_section1' then update public.staff_tax_profiles set i9_section1_status = 'completed' where staff_id = m.id and i9_section1_status = 'not_started';
  elsif p_item = 'wage_notice' then update public.staff_tax_profiles set wage_notice_ack_at = coalesce(wage_notice_ack_at, now()) where staff_id = m.id;
  else raise exception 'bad_item' using errcode = '22023'; end if;
  return public.staff_onboarding_status(m.id);
end $$;

create or replace function public.staff_my_payment_method(p_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members := public.staff_self();
begin
  if p_method not in ('ach', 'check', 'payroll') then raise exception 'bad_method' using errcode = '22023'; end if;
  if m.classification = 'employee_w2' and p_method = 'ach' then p_method := 'payroll'; end if;
  if m.classification <> 'employee_w2' and p_method = 'payroll' then raise exception 'bad_method' using errcode = '22023'; end if;
  update public.staff_members set payment_method = p_method where id = m.id;
  return public.staff_onboarding_status(m.id);
end $$;

-- Called by the server after it confirmed an aal2 (two-step) session for p_user.
create or replace function public.staff_security_confirm(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.staff_members set security_confirmed_at = coalesce(security_confirmed_at, now()) where user_id = p_user and status in ('onboarding', 'active');
end $$;

create or replace function public.staff_my_finish() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members := public.staff_self(); s jsonb; v_todo integer;
begin
  s := public.staff_onboarding_status(m.id);
  select count(*) into v_todo from jsonb_array_elements(s -> 'steps') x where x ->> 'key' <> 'confirm' and x ->> 'state' in ('todo', 'blocked');
  if v_todo > 0 then raise exception 'steps_incomplete' using errcode = '22023'; end if;
  update public.staff_members set onboarding_completed_at = coalesce(onboarding_completed_at, now()),
    status = case when status = 'onboarding' then 'active' else status end where id = m.id;
  perform public.staff_audit(auth.uid(), 'staff.onboarding_completed', 'staff_member', m.id::text, null);
  return public.staff_onboarding_status(m.id);
end $$;

-- Payout destination recorded from the processor's hosted onboarding (server only). A change of bank starts the
-- safety hold; the server emails the person and alerts the owner.
create or replace function public.staff_destination_record(p_user uuid, p_provider text, p_mode text, p_recipient_ref text, p_method_ref text,
  p_institution text, p_account_type text, p_last4 text, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.staff_members; prev public.staff_payout_destinations; d public.staff_payout_destinations; s public.payout_settings; v_change boolean;
begin
  select * into m from public.staff_members where user_id = p_user and status in ('onboarding', 'active');
  if not found then raise exception 'not_staff' using errcode = '42501'; end if;
  if m.classification not in ('contractor_1099', 'vendor') then raise exception 'payout_not_applicable' using errcode = '22023'; end if;
  select * into s from public.payout_settings where id;
  select * into prev from public.staff_payout_destinations where staff_id = m.id and mode = p_mode and is_current for update;
  v_change := prev.id is not null and (prev.payout_method_ref is distinct from p_method_ref or prev.recipient_ref is distinct from p_recipient_ref);
  if prev.id is not null and not v_change then
    update public.staff_payout_destinations set institution_name = coalesce(p_institution, institution_name), account_type = coalesce(p_account_type, account_type),
      last4 = coalesce(p_last4, last4), status = p_status, verified_at = case when p_status = 'verified' then coalesce(verified_at, now()) else verified_at end
    where id = prev.id returning * into d;
    return jsonb_build_object('destination', to_jsonb(d), 'changed', false);
  end if;
  if prev.id is not null then
    update public.staff_payout_destinations set is_current = false, status = 'replaced', replaced_at = now() where id = prev.id;
  end if;
  insert into public.staff_payout_destinations (staff_id, provider, mode, recipient_ref, payout_method_ref, institution_name, account_type, last4, status, verified_at, eligible_from)
  values (m.id, p_provider, p_mode, p_recipient_ref, p_method_ref, p_institution, coalesce(p_account_type, 'unknown'), p_last4, p_status,
    case when p_status = 'verified' then now() end,
    case when v_change then now() + make_interval(hours => s.bank_change_hold_hours) else now() end)
  returning * into d;
  perform public.staff_audit(p_user, case when v_change then 'staff.bank_changed' else 'staff.bank_connected' end, 'staff_member', m.id::text,
    jsonb_build_object('mode', p_mode, 'last4', p_last4, 'institution', p_institution, 'hold_until', d.eligible_from));
  return jsonb_build_object('destination', to_jsonb(d), 'changed', v_change, 'email', m.email, 'name', coalesce(m.preferred_name, m.display_name));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 16. Fees
-- ---------------------------------------------------------------------------------------------------
create or replace function public.payout_fee_cents(p_gross integer, p_speed text, f public.payout_fee_policies) returns integer
language sql immutable as $$
  select case when f.id is null or p_gross <= 0 then 0
    when p_speed = 'instant' then greatest(f.instant_fixed_cents + ceil(p_gross::numeric * f.instant_bps / 10000)::integer, f.instant_min_cents)
    else f.standard_fixed_cents + ceil(p_gross::numeric * f.standard_bps / 10000)::integer end
$$;

-- Who pays the transfer fee, and why. Anything not clearly allowed falls back to Built2Bid paying it.
create or replace function public.payout_fee_bearer(m public.staff_members, f public.payout_fee_policies, p_speed text, p_gross integer, p_fee integer, s public.payout_settings)
returns table (bearer text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if f.id is null or f.approved_at is null then return query select 'company', 'fee_policy_not_approved'; return; end if;
  if (p_speed = 'instant' and not f.recipient_pays_instant) or (p_speed = 'standard' and not f.recipient_pays_standard) then
    return query select 'company', 'policy_company_pays'; return; end if;
  if m.classification not in ('contractor_1099', 'vendor') then return query select 'company', 'not_contractor'; return; end if;
  if m.work_state is not null and m.work_state = any (s.fee_recovery_blocked_states) then return query select 'company', 'jurisdiction_blocked'; return; end if;
  if not exists (select 1 from public.staff_agreement_acceptances a join public.staff_agreement_templates t on t.id = a.template_id
                 where a.staff_id = m.id and t.kind = 'fee_disclosure' and a.fee_policy_version = f.version) then
    return query select 'company', 'no_fee_acknowledgement'; return; end if;
  if p_gross - p_fee <= 0 then return query select 'company', 'fee_exceeds_gross'; return; end if;
  return query select 'recipient', null::text;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 17. Prerequisites
-- ---------------------------------------------------------------------------------------------------
create or replace function public.payout_blockers(p_staff uuid, p_mode text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members; d public.staff_payout_destinations; v text[] := '{}'; v_missing integer; t public.staff_tax_profiles;
begin
  select * into m from public.staff_members where id = p_staff;
  if not found then return array['no_staff_record']; end if;
  if m.status <> 'active' then v := array_append(v, 'not_active'); end if;
  if m.classification = 'employee_w2' then v := array_append(v, 'payroll_required');
  elsif m.classification = 'pending_review' then v := array_append(v, 'classification_review');
  end if;
  select count(*) into v_missing from public.staff_required_agreements(m) r
    where r.kind <> 'fee_disclosure' and not exists (select 1 from public.staff_agreement_acceptances a where a.staff_id = m.id and a.template_id = r.id);
  if m.classification in ('contractor_1099', 'vendor') and v_missing > 0 then v := array_append(v, 'agreements_missing'); end if;
  select * into t from public.staff_tax_profiles where staff_id = p_staff;
  if m.classification in ('contractor_1099', 'vendor') and coalesce(t.w9_status, 'not_started') not in ('submitted', 'verified') then v := array_append(v, 'w9_missing'); end if;
  if m.payment_method = 'check' then v := array_append(v, 'pays_by_check');
  else
    select * into d from public.staff_payout_destinations where staff_id = p_staff and mode = p_mode and is_current;
    if d.id is null then v := array_append(v, 'no_bank');
    elsif d.status <> 'verified' then v := array_append(v, 'bank_unverified');
    elsif d.eligible_from > now() then v := array_append(v, 'bank_change_hold');
    end if;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 18. Planner: approved, unpaid Sales Hub statements -> one batched payout per person per run.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.payout_plan(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; f public.payout_fee_policies; r record; m public.staff_members; p public.payouts;
  v_mode text; v_created integer := 0; v_refreshed integer := 0; v_fee integer; fb record; v_blockers text[]; v_status text; v_gross integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('payout_plan')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into s from public.payout_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off'); end if;
  v_mode := s.mode;
  select * into f from public.payout_fee_policies where id = s.fee_policy_id;

  for r in
    select sm.id as staff_id, array_agg(st.id order by st.period_month) as statements, sum(st.total_cents)::integer as total
    from public.sales_statements st
    join public.staff_members sm on sm.sales_rep_id = st.rep_id
    where st.status = 'approved' and st.total_cents > 0
      and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
      and not exists (select 1 from public.payout_items i where i.mode = v_mode and i.source_kind = 'sales_statement' and i.source_id = st.id and i.active)
      and sm.classification in ('contractor_1099', 'vendor')
    group by sm.id
  loop
    select * into m from public.staff_members where id = r.staff_id;
    v_gross := r.total;
    v_fee := public.payout_fee_cents(v_gross, 'standard', f);
    select * into fb from public.payout_fee_bearer(m, f, 'standard', v_gross, v_fee, s);
    v_blockers := public.payout_blockers(m.id, v_mode);
    if v_gross < s.min_payout_cents then v_blockers := array_append(v_blockers, 'below_minimum'); end if;
    v_status := case when cardinality(v_blockers) > 0 then 'held' when v_gross > s.review_above_cents then 'needs_approval' else 'scheduled' end;
    insert into public.payouts (ref, staff_id, mode, provider, gross_cents, fee_cents, fee_bearer, fee_reason, fee_policy_version, net_cents, status, hold_reasons,
      scheduled_for, idempotency_key, funding_source)
    values ('B2B-PO-' || to_char(p_now at time zone 'America/Chicago', 'YYYYMM') || '-' || lpad(nextval('public.payout_ref_seq')::text, 6, '0') || case when v_mode = 'test' then '-T' else '' end,
      m.id, v_mode, s.provider, v_gross, v_fee, fb.bearer, fb.reason, f.version,
      greatest(v_gross - case when fb.bearer = 'recipient' then v_fee else 0 end, 0), v_status, v_blockers,
      ((p_now at time zone 'America/Chicago')::date + s.pay_delay_days), gen_random_uuid()::text, s.funding_label)
    returning * into p;
    insert into public.payout_items (payout_id, mode, source_kind, source_id, amount_cents, description)
    select p.id, v_mode, 'sales_statement', st.id, st.total_cents, 'Sales statement ' || to_char(st.period_month, 'Mon YYYY')
    from public.sales_statements st where st.id = any (r.statements);
    v_created := v_created + 1;
  end loop;

  -- Re-check held payouts: a prerequisite fixed since the last run releases them.
  for p in select * from public.payouts where status = 'held' and mode = v_mode for update skip locked loop
    v_blockers := public.payout_blockers(p.staff_id, v_mode);
    if p.gross_cents < s.min_payout_cents then v_blockers := array_append(v_blockers, 'below_minimum'); end if;
    if cardinality(v_blockers) = 0 then
      update public.payouts set status = case when p.gross_cents > s.review_above_cents and p.approved_at is null then 'needs_approval' else 'scheduled' end,
        hold_reasons = '{}' where id = p.id;
      v_refreshed := v_refreshed + 1;
    elsif v_blockers is distinct from p.hold_reasons then
      update public.payouts set hold_reasons = v_blockers where id = p.id;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'released', v_refreshed, 'mode', v_mode);
end $$;

-- Claim due payouts for submission. FOR UPDATE SKIP LOCKED + status change = two overlapping runs never send the
-- same payout. Limits are enforced here; a payout over a limit waits for the owner (needs_approval).
create or replace function public.payout_claim_due(p_limit integer default 25, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; p public.payouts; d public.staff_payout_destinations; v_out jsonb := '[]'; v_today_cents bigint; v_blockers text[];
begin
  select * into s from public.payout_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off', 'payouts', '[]'::jsonb); end if;
  if s.paused then return jsonb_build_object('skipped', 'paused', 'payouts', '[]'::jsonb); end if;
  if s.mode = 'live' and (s.live_activated_at is null or s.provider = 'mock') then return jsonb_build_object('skipped', 'live_not_activated', 'payouts', '[]'::jsonb); end if;
  -- Submissions stuck in 'submitting' (process died mid-call) are retried with the SAME idempotency key.
  update public.payouts set status = 'scheduled', locked_at = null where status = 'submitting' and locked_at < p_now - interval '15 minutes' and mode = s.mode;
  select coalesce(sum(net_cents), 0) into v_today_cents from public.payouts
    where mode = s.mode and status in ('submitting', 'submitted', 'paid') and (submitted_at at time zone 'America/Chicago')::date = (p_now at time zone 'America/Chicago')::date;
  for p in select * from public.payouts where mode = s.mode and status = 'scheduled' and scheduled_for <= (p_now at time zone 'America/Chicago')::date
           and (next_attempt_at is null or next_attempt_at <= p_now) order by scheduled_for, created_at limit greatest(1, least(p_limit, 100)) for update skip locked loop
    v_blockers := public.payout_blockers(p.staff_id, s.mode);
    if cardinality(v_blockers) > 0 then
      update public.payouts set status = 'held', hold_reasons = v_blockers where id = p.id; continue;
    end if;
    if p.net_cents <= 0 then
      update public.payouts set status = 'held', hold_reasons = array['zero_amount'] where id = p.id; continue;
    end if;
    if p.net_cents > s.per_payout_limit_cents and p.approved_at is null then
      update public.payouts set status = 'needs_approval', hold_reasons = array['over_per_payout_limit'] where id = p.id; continue;
    end if;
    if v_today_cents + p.net_cents > s.daily_limit_cents then
      update public.payouts set next_attempt_at = date_trunc('day', p_now at time zone 'America/Chicago') at time zone 'America/Chicago' + interval '1 day', hold_reasons = array['daily_limit']
      where id = p.id; continue;
    end if;
    select * into d from public.staff_payout_destinations where staff_id = p.staff_id and mode = s.mode and is_current;
    update public.payouts set status = 'submitting', locked_at = p_now, attempts = attempts + 1, destination_id = d.id, hold_reasons = '{}' where id = p.id;
    v_today_cents := v_today_cents + p.net_cents;
    v_out := v_out || jsonb_build_object('id', p.id, 'ref', p.ref, 'net_cents', p.net_cents, 'idempotency_key', p.idempotency_key, 'provider', p.provider,
      'mode', p.mode, 'recipient_ref', d.recipient_ref, 'payout_method_ref', d.payout_method_ref, 'attempts', p.attempts + 1);
  end loop;
  return jsonb_build_object('mode', s.mode, 'provider', s.provider, 'payouts', v_out);
end $$;

create or replace function public.payout_mark_submitted(p_id uuid, p_provider_ref text, p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payouts set status = 'submitted', provider_ref = p_provider_ref, submitted_at = p_now, locked_at = null, next_attempt_at = null
  where id = p_id and status = 'submitting';
end $$;

-- Submission error. Retryable errors back off (15 min, 1 h, 4 h ...) until max_attempts, then fail with an alert.
create or replace function public.payout_mark_submit_error(p_id uuid, p_code text, p_message text, p_retryable boolean, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare p public.payouts; s public.payout_settings;
begin
  select * into s from public.payout_settings where id;
  select * into p from public.payouts where id = p_id and status = 'submitting' for update;
  if not found then return 'ignored'; end if;
  if p_retryable and p.attempts < s.max_attempts then
    update public.payouts set status = 'scheduled', locked_at = null, failure_code = left(p_code, 80), failure_message = left(p_message, 300),
      next_attempt_at = p_now + (interval '15 minutes' * power(4, p.attempts - 1)) where id = p_id;
    return 'retry';
  end if;
  update public.payouts set status = 'failed', locked_at = null, failed_at = p_now, failure_code = left(p_code, 80), failure_message = left(p_message, 300) where id = p_id;
  update public.payout_items set active = false where payout_id = p_id;
  return 'failed';
end $$;

-- Provider evidence. Idempotent on the provider event id; status only moves forward (a late 'processing' never
-- overwrites 'paid'). 'posted' is the only thing that marks a payout paid. In LIVE mode a paid payout marks its
-- Sales Hub statements paid (same rows admin_sales_payout_record writes); TEST payouts never touch them.
create or replace function public.payout_apply_event(p_event_id text, p_provider_ref text, p_kind text, p_occurred_at timestamptz, p_failure_code text,
  p_verified boolean, p_source text default 'webhook') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.payouts; v_rank_old integer; v_rank_new integer; st record;
begin
  if not p_verified then raise exception 'unverified_event' using errcode = '42501'; end if;
  select * into p from public.payouts where provider_ref = p_provider_ref for update;
  insert into public.payout_events (event_id, payout_id, provider_ref, kind, occurred_at, failure_code, verified, source)
  values (p_event_id, p.id, p_provider_ref, p_kind, p_occurred_at, p_failure_code, p_verified, p_source) on conflict (event_id) do nothing;
  if not found then return jsonb_build_object('status', 'duplicate'); end if;
  if p.id is null then return jsonb_build_object('status', 'unknown_payout'); end if;
  v_rank_old := case p.status when 'submitted' then 1 when 'paid' then 2 when 'failed' then 3 when 'canceled' then 3 when 'returned' then 4 else 0 end;
  v_rank_new := case p_kind when 'processing' then 1 when 'posted' then 2 when 'failed' then 3 when 'canceled' then 3 when 'returned' then 4 end;
  if v_rank_new <= v_rank_old then return jsonb_build_object('status', 'stale'); end if;

  if p_kind = 'posted' then
    update public.payouts set status = 'paid', settled_at = p_occurred_at, tax_year = extract(year from p_occurred_at at time zone 'America/Chicago')::integer where id = p.id;
    if p.mode = 'live' then
      for st in select s.* from public.payout_items i join public.sales_statements s on s.id = i.source_id
                where i.payout_id = p.id and i.source_kind = 'sales_statement' and i.active and s.status = 'approved' for update of s loop
        insert into public.sales_payouts (rep_id, statement_id, amount_cents, method, reference, paid_on, recorded_by)
        values (st.rep_id, st.id, st.total_cents, 'ach', p.ref || ' / ' || p_provider_ref, (p_occurred_at at time zone 'America/Chicago')::date, null)
        on conflict (statement_id) do nothing;
        update public.sales_commissions set status = 'paid', paid_at = p_occurred_at, updated_at = now() where statement_id = st.id and status = 'approved';
        update public.sales_statements set status = 'paid', paid_at = p_occurred_at where id = st.id;
      end loop;
    end if;
  elsif p_kind in ('failed', 'canceled') then
    update public.payouts set status = p_kind, failed_at = p_occurred_at, failure_code = left(p_failure_code, 80) where id = p.id;
    update public.payout_items set active = false where payout_id = p.id;
    if p_failure_code in ('account_closed', 'invalid_account_number', 'no_account', 'recipient_rejected') then
      update public.staff_payout_destinations set status = 'failed' where id = p.destination_id;
    end if;
  elsif p_kind = 'returned' then
    -- The bank sent the money back: it is still owed. Undo the paid marks so the statement is paid again once the
    -- person fixes their bank account. Earned amounts are never reduced.
    update public.payouts set status = 'returned', failed_at = p_occurred_at, failure_code = left(p_failure_code, 80) where id = p.id;
    update public.payout_items set active = false where payout_id = p.id;
    update public.staff_payout_destinations set status = 'failed' where id = p.destination_id;
    if p.mode = 'live' then
      for st in select i.source_id from public.payout_items i where i.payout_id = p.id and i.source_kind = 'sales_statement' loop
        delete from public.sales_payouts where statement_id = st.source_id and reference like p.ref || ' / %';
        update public.sales_commissions set status = 'approved', paid_at = null, updated_at = now() where statement_id = st.source_id and status = 'paid';
        update public.sales_statements set status = 'approved', paid_at = null where id = st.source_id and status = 'paid';
      end loop;
    end if;
  else
    update public.payouts set status = case when status = 'submitting' then 'submitted' else status end where id = p.id;
  end if;
  perform public.staff_audit(null, 'payout.' || p_kind, 'payout', p.id::text, jsonb_build_object('ref', p.ref, 'mode', p.mode, 'event', p_event_id, 'source', p_source));
  return jsonb_build_object('status', 'applied', 'payout_id', p.id, 'staff_id', p.staff_id, 'kind', p_kind, 'mode', p.mode);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 19. Owner controls
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_payout_settings_save(p_caller uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; v_old public.payout_settings;
begin
  perform public.staff_require_owner(p_caller);
  select * into v_old from public.payout_settings where id for update;
  if coalesce(p ->> 'mode', v_old.mode) = 'live' and v_old.mode <> 'live' then raise exception 'use_activation' using errcode = '22023'; end if;
  update public.payout_settings set
    mode = case when p ->> 'mode' in ('off', 'test') then p ->> 'mode' else mode end,
    provider = case when v_old.mode = 'live' then provider else coalesce(nullif(p ->> 'provider', ''), provider) end,
    per_payout_limit_cents = coalesce((p ->> 'per_payout_limit_cents')::integer, per_payout_limit_cents),
    daily_limit_cents = coalesce((p ->> 'daily_limit_cents')::integer, daily_limit_cents),
    review_above_cents = coalesce((p ->> 'review_above_cents')::integer, review_above_cents),
    bank_change_hold_hours = coalesce((p ->> 'bank_change_hold_hours')::integer, bank_change_hold_hours),
    pay_delay_days = coalesce((p ->> 'pay_delay_days')::integer, pay_delay_days),
    min_payout_cents = coalesce((p ->> 'min_payout_cents')::integer, min_payout_cents),
    fee_recovery_blocked_states = case when p ? 'fee_recovery_blocked_states' then coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(p -> 'fee_recovery_blocked_states') x), '{}') else fee_recovery_blocked_states end,
    -- Leaving live mode for any reason clears the activation: going live again needs a fresh activation.
    live_activated_at = case when p ->> 'mode' in ('off', 'test') then null else live_activated_at end,
    live_activated_by = case when p ->> 'mode' in ('off', 'test') then null else live_activated_by end,
    updated_at = now(), updated_by = p_caller
  where id returning * into s;
  perform public.staff_audit(p_caller, 'payout.settings_saved', 'payout_settings', 'settings',
    jsonb_build_object('from', to_jsonb(v_old) - 'live_checklist', 'to', to_jsonb(s) - 'live_checklist'));
  return to_jsonb(s);
end $$;

create or replace function public.admin_payout_pause(p_caller uuid, p_paused boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  update public.payout_settings set paused = p_paused, paused_at = case when p_paused then now() end, paused_by = case when p_paused then p_caller end,
    paused_reason = case when p_paused then nullif(btrim(coalesce(p_reason, '')), '') end, updated_at = now(), updated_by = p_caller where id;
  perform public.staff_audit(p_caller, case when p_paused then 'payout.paused' else 'payout.resumed' end, 'payout_settings', 'settings', jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_fee_policy_approve(p_caller uuid, p_version integer) returns void
language plpgsql security definer set search_path = public as $$
declare f public.payout_fee_policies;
begin
  perform public.staff_require_owner(p_caller);
  update public.payout_fee_policies set approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, p_caller) where version = p_version returning * into f;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.payout_settings set fee_policy_id = f.id, updated_at = now(), updated_by = p_caller where id;
  perform public.staff_audit(p_caller, 'payout.fee_policy_approved', 'payout_fee_policy', f.id::text, jsonb_build_object('version', p_version));
end $$;

create or replace function public.admin_funding_approve(p_caller uuid, p_label text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  if char_length(btrim(coalesce(p_label, ''))) < 3 then raise exception 'label_required' using errcode = '22023'; end if;
  update public.payout_settings set funding_label = btrim(p_label), funding_approved_at = now(), funding_approved_by = p_caller,
    -- A new or changed funding account always needs a fresh live activation.
    live_activated_at = null, live_activated_by = null, mode = case when mode = 'live' then 'test' else mode end, updated_at = now(), updated_by = p_caller where id;
  perform public.staff_audit(p_caller, 'payout.funding_approved', 'payout_settings', 'settings', jsonb_build_object('label', btrim(p_label)));
end $$;

-- The one explicit owner step that turns on real money movement. Every checklist item must be confirmed.
create or replace function public.admin_payout_activate_live(p_caller uuid, p_checklist jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; k text; v_required text[] := array['provider_approved', 'provider_live_keys', 'funding_confirmed', 'fee_policy_reviewed',
  'agreements_reviewed_by_counsel', 'tax_reporting_plan', 'classification_reviewed', 'limits_reviewed', 'test_run_passed'];
begin
  perform public.staff_require_owner(p_caller);
  select * into s from public.payout_settings where id for update;
  foreach k in array v_required loop
    if coalesce((p_checklist ->> k)::boolean, false) is not true then raise exception 'checklist_incomplete:%', k using errcode = '22023'; end if;
  end loop;
  if s.provider = 'mock' then raise exception 'provider_is_mock' using errcode = '22023'; end if;
  if s.funding_approved_at is null then raise exception 'funding_not_approved' using errcode = '22023'; end if;
  if not exists (select 1 from public.payout_fee_policies where id = s.fee_policy_id and approved_at is not null) then raise exception 'fee_policy_not_approved' using errcode = '22023'; end if;
  update public.payout_settings set mode = 'live', live_activated_at = now(), live_activated_by = p_caller, live_checklist = p_checklist, paused = false,
    updated_at = now(), updated_by = p_caller where id returning * into s;
  perform public.staff_audit(p_caller, 'payout.live_activated', 'payout_settings', 'settings', p_checklist);
  return to_jsonb(s);
end $$;

create or replace function public.admin_payout_approve(p_caller uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  update public.payouts set status = 'scheduled', approved_at = now(), approved_by = p_caller, hold_reasons = '{}' where id = p_id and status = 'needs_approval';
  if not found then raise exception 'not_awaiting_approval' using errcode = '22023'; end if;
  perform public.staff_audit(p_caller, 'payout.approved', 'payout', p_id::text, null);
end $$;

create or replace function public.admin_payout_cancel(p_caller uuid, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  update public.payouts set status = 'canceled', failure_message = left(nullif(btrim(coalesce(p_reason, '')), ''), 300), failed_at = now()
  where id = p_id and status in ('scheduled', 'held', 'needs_approval');
  if not found then raise exception 'not_cancelable' using errcode = '22023'; end if;
  update public.payout_items set active = false where payout_id = p_id;
  perform public.staff_audit(p_caller, 'payout.canceled', 'payout', p_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- Test mode only: simulate the provider's settlement events against the in-app mock provider.
create or replace function public.admin_payout_simulate(p_caller uuid, p_id uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.payouts;
begin
  perform public.staff_require_owner(p_caller);
  select * into p from public.payouts where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.mode <> 'test' or p.provider <> 'mock' then raise exception 'test_mock_only' using errcode = '42501'; end if;
  if p.provider_ref is null then raise exception 'not_submitted' using errcode = '22023'; end if;
  return public.payout_apply_event('sim_' || gen_random_uuid()::text, p.provider_ref, p_kind, now(),
    case when p_kind in ('failed', 'returned') then 'account_closed' end, true, 'test_simulation');
end $$;

create or replace function public.admin_payout_reconcile(p_caller uuid, p_id uuid, p_state text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_cap(p_caller, 'reconcile');
  if p_state not in ('unreconciled', 'matched', 'exception', 'not_applicable') then raise exception 'bad_state' using errcode = '22023'; end if;
  update public.payouts set reconciliation = p_state, reconciled_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300) where id = p_id;
  perform public.staff_audit(p_caller, 'payout.reconciled', 'payout', p_id::text, jsonb_build_object('state', p_state));
end $$;

create or replace function public.admin_tax_threshold_save(p_caller uuid, p_year integer, p_cents integer, p_verified boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  insert into public.tax_reporting_thresholds (tax_year, threshold_cents, verified, source_note, updated_by, updated_at)
  values (p_year, p_cents, p_verified, p_note, p_caller, now())
  on conflict (tax_year) do update set threshold_cents = excluded.threshold_cents, verified = excluded.verified, source_note = excluded.source_note,
    updated_by = p_caller, updated_at = now();
  perform public.staff_audit(p_caller, 'tax.threshold_saved', 'tax_year', p_year::text, jsonb_build_object('cents', p_cents, 'verified', p_verified));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 20. Reads: payment center, tax year, cost report, my payouts
-- ---------------------------------------------------------------------------------------------------
create or replace function public.payout_json(p public.payouts) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'idempotency_key' - 'locked_at' || jsonb_build_object(
    'staff_name', (select coalesce(m.preferred_name, m.display_name) from public.staff_members m where m.id = p.staff_id),
    'destination', (select jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'account_type', d.account_type) from public.staff_payout_destinations d where d.id = p.destination_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('source_kind', i.source_kind, 'source_id', i.source_id, 'amount_cents', i.amount_cents, 'description', i.description, 'active', i.active)
      order by i.created_at) from public.payout_items i where i.payout_id = p.id), '[]'::jsonb))
$$;

create or replace function public.admin_payouts_overview(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.payout_settings;
begin
  perform public.staff_require_cap(p_caller, 'payouts.view');
  select * into s from public.payout_settings where id;
  return jsonb_build_object(
    'settings', to_jsonb(s),
    'fee_policies', coalesce((select jsonb_agg(to_jsonb(f) order by f.version desc) from public.payout_fee_policies f), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(public.payout_json(p) order by p.created_at desc) from (select * from public.payouts order by created_at desc limit 500) p), '[]'::jsonb),
    -- Approved statements that can't be paid by contractor ACH: W-2 (payroll), unclassified, or no directory record.
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('statement_id', st.id, 'period_month', st.period_month, 'total_cents', st.total_cents,
        'rep_name', r.full_name, 'staff_id', sm.id, 'reason', case when sm.id is null then 'no_staff_record' when sm.classification = 'employee_w2' then 'payroll_required'
          when sm.classification = 'pending_review' then 'classification_review' else 'other' end) order by st.period_month)
      from public.sales_statements st join public.sales_reps r on r.id = st.rep_id left join public.staff_members sm on sm.sales_rep_id = st.rep_id
      where st.status = 'approved' and st.total_cents > 0 and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)
        and (sm.id is null or sm.classification not in ('contractor_1099', 'vendor'))), '[]'::jsonb),
    'liabilities', jsonb_build_object(
      'approved_unpaid_cents', (select coalesce(sum(st.total_cents), 0) from public.sales_statements st where st.status = 'approved' and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)),
      'earned_unapproved_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.status = 'earned'),
      'pending_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.status = 'pending')),
    'recipients', (select count(*) from public.staff_members where classification in ('contractor_1099', 'vendor') and status = 'active'));
end $$;

create or replace function public.admin_payout_tax_year(p_caller uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare th public.tax_reporting_thresholds;
begin
  perform public.staff_require_cap(p_caller, 'tax.view');
  select * into th from public.tax_reporting_thresholds where tax_year = p_year;
  return jsonb_build_object('year', p_year, 'threshold', to_jsonb(th),
    'people', coalesce((select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object('staff_id', m.id, 'name', coalesce(t.w9_legal_name, m.display_name), 'classification', m.classification,
        'gross_paid_cents', coalesce(sum(p.gross_cents), 0), 'fees_recipient_cents', coalesce(sum(p.fee_cents) filter (where p.fee_bearer = 'recipient'), 0),
        'net_paid_cents', coalesce(sum(p.net_cents), 0), 'payouts', count(p.id),
        'w9_status', coalesce(t.w9_status, 'not_started'), 'tin_on_file', t.tin_last4 is not null, 'tin_type', t.tin_type, 'tax_class', t.w9_tax_class,
        'backup_withholding', coalesce(t.backup_withholding, false),
        -- Corporations are generally exempt from 1099-NEC (attorney fees aside); flagged, not decided.
        'likely_exempt', coalesce(t.w9_tax_class in ('c_corp', 's_corp', 'llc_c', 'llc_s'), false),
        'over_threshold', th.tax_year is not null and coalesce(sum(p.gross_cents), 0) >= th.threshold_cents,
        'missing', array_remove(array[case when t.tin_last4 is null then 'tin' end, case when coalesce(t.w9_status, 'not_started') = 'not_started' then 'w9' end,
          case when m.address_line1 is null then 'address' end], null)) as x
      from public.staff_members m
      left join public.staff_tax_profiles t on t.staff_id = m.id
      left join public.payouts p on p.staff_id = m.id and p.mode = 'live' and p.status = 'paid' and p.tax_year = p_year
      where m.classification in ('contractor_1099', 'vendor') or exists (select 1 from public.payouts q where q.staff_id = m.id and q.mode = 'live' and q.tax_year = p_year)
      group by m.id, t.staff_id) z), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('staff_id', m.id, 'name', m.display_name, 'status', m.status)) from public.staff_members m where m.classification = 'employee_w2'), '[]'::jsonb),
    'payroll', (select to_jsonb(o) - 'excluded_account_ids' - 'company_book_id' from public.owner_finance_settings o where o.id));
end $$;

create or replace function public.admin_payout_cost_report(p_caller uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start date := date_trunc('month', p_month)::date; v_end date := (date_trunc('month', p_month) + interval '1 month')::date; f public.payout_fee_policies;
begin
  perform public.staff_require_cap(p_caller, 'payouts.view');
  select fp.* into f from public.payout_settings s join public.payout_fee_policies fp on fp.id = s.fee_policy_id where s.id;
  return (select jsonb_build_object('month', v_start, 'mode', coalesce(max(p.mode), (select mode from public.payout_settings where id)),
      'recipients', count(distinct p.staff_id), 'transfers', count(p.id),
      'gross_cents', coalesce(sum(p.gross_cents), 0), 'provider_fees_cents', coalesce(sum(p.fee_cents), 0),
      'recipient_fees_cents', coalesce(sum(p.fee_cents) filter (where p.fee_bearer = 'recipient'), 0),
      'company_fees_cents', coalesce(sum(p.fee_cents) filter (where p.fee_bearer = 'company'), 0),
      'unrecoverable', coalesce((select jsonb_object_agg(reason, n) from (select fee_reason as reason, count(*) n from public.payouts q
        where q.fee_bearer = 'company' and q.status = 'paid' and q.settled_at >= v_start and q.settled_at < v_end group by fee_reason) z), '{}'::jsonb),
      'avg_cost_per_recipient_cents', case when count(distinct p.staff_id) > 0 then round(coalesce(sum(p.fee_cents), 0)::numeric / count(distinct p.staff_id)) end,
      'monthly_account_cents', coalesce(f.monthly_account_cents, 0) * count(distinct p.staff_id),
      'items_batched', (select count(*) from public.payout_items i join public.payouts q on q.id = i.payout_id where q.status = 'paid' and q.settled_at >= v_start and q.settled_at < v_end),
      'batching_savings_cents', greatest(0, (select count(*) from public.payout_items i join public.payouts q on q.id = i.payout_id where q.status = 'paid' and q.settled_at >= v_start and q.settled_at < v_end) - count(p.id) filter (where p.status = 'paid')) * coalesce(f.standard_fixed_cents, 0),
      'returned', count(p.id) filter (where p.status = 'returned'),
      'comparison', jsonb_build_object('note', 'Per $500 payout, standard ACH, from public pricing checked 2026-11-20',
        'stripe_global_payouts_cents', 150, 'stripe_connect_express_cents', 200 + 25 + 125))
    from public.payouts p where p.status in ('paid', 'returned') and p.settled_at >= v_start and p.settled_at < v_end);
end $$;

create or replace function public.staff_my_payouts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.staff_members := public.staff_self(); v_year integer := extract(year from now() at time zone 'America/Chicago')::integer;
begin
  return jsonb_build_object(
    'payouts', coalesce((select jsonb_agg(public.payout_json(p) order by p.created_at desc) from public.payouts p where p.staff_id = m.id), '[]'::jsonb),
    'ytd', jsonb_build_object('year', v_year,
      'gross_cents', (select coalesce(sum(gross_cents), 0) from public.payouts where staff_id = m.id and mode = 'live' and status = 'paid' and tax_year = v_year),
      'fees_cents', (select coalesce(sum(fee_cents), 0) from public.payouts where staff_id = m.id and mode = 'live' and status = 'paid' and tax_year = v_year and fee_bearer = 'recipient'),
      'net_cents', (select coalesce(sum(net_cents), 0) from public.payouts where staff_id = m.id and mode = 'live' and status = 'paid' and tax_year = v_year)),
    'blockers', to_jsonb(public.payout_blockers(m.id, (select case when mode = 'live' then 'live' else 'test' end from public.payout_settings where id))),
    'destination', (select jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'account_type', d.account_type, 'status', d.status,
        'eligible_from', d.eligible_from, 'mode', d.mode, 'verified_at', d.verified_at)
      from public.staff_payout_destinations d join public.payout_settings s on s.id where d.staff_id = m.id and d.is_current and d.mode = case when s.mode = 'live' then 'live' else 'test' end),
    'classification', m.classification, 'payment_method', m.payment_method);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 21. Owner Banking & Cash Flow (read-only)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_banking_designate(p_caller uuid, p_book uuid, p_excluded uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_owner(p_caller);
  if p_book is not null and not exists (
    select 1 from public.fin_books b where b.id = p_book and (b.owner_user_id = p_caller
      or exists (select 1 from public.company_members cm where cm.company_id = b.company_id and cm.user_id = p_caller and cm.role = 'owner' and cm.status = 'active'))) then
    raise exception 'book_not_owned' using errcode = '42501';
  end if;
  update public.owner_finance_settings set company_book_id = p_book, designated_at = case when p_book is null then null else now() end,
    designated_by = case when p_book is null then null else p_caller end, excluded_account_ids = coalesce(p_excluded, '{}'), updated_at = now() where id;
  perform public.staff_audit(p_caller, 'banking.designated', 'fin_book', coalesce(p_book::text, 'none'), jsonb_build_object('excluded', p_excluded));
end $$;

create or replace function public.admin_banking_overview(p_caller uuid, p_since date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.owner_finance_settings;
begin
  perform public.staff_require_cap(p_caller, 'banking.view');
  select * into o from public.owner_finance_settings where id;
  return jsonb_build_object(
    'designated', o.company_book_id is not null, 'designated_at', o.designated_at,
    'book_name', (select name from public.fin_books where id = o.company_book_id),
    'books_available', case when public.is_admin(p_caller) then coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name))
       from public.fin_books b where b.owner_user_id = p_caller
          or exists (select 1 from public.company_members cm where cm.company_id = b.company_id and cm.user_id = p_caller and cm.role = 'owner' and cm.status = 'active')), '[]'::jsonb) else '[]'::jsonb end,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'last4', a.last4, 'institution_name', a.institution_name,
        'source', a.source, 'excluded', a.id = any (o.excluded_account_ids),
        'current', bal.current_balance, 'available', bal.available_balance, 'as_of', bal.as_of,
        'connection_status', c.status, 'last_success_at', c.last_success_at, 'sandbox', coalesce(c.sandbox, false)) order by a.is_primary desc, a.name)
      from public.fin_bank_accounts a
      left join public.fin_bank_connections c on c.id = a.connection_id
      left join lateral (select current_balance, available_balance, as_of from public.fin_bank_balances b where b.account_id = a.id order by as_of desc limit 1) bal on true
      where a.book_id = o.company_book_id and a.status = 'active'), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'account_id', t.account_id, 'posted_on', t.posted_on, 'description', t.description, 'amount', t.amount)
        order by t.posted_on desc, t.id) from (select * from public.fin_bank_transactions t
          where t.book_id = o.company_book_id and t.posted_on >= p_since and not (t.account_id = any (o.excluded_account_ids)) order by t.posted_on desc limit 2000) t), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', mo, 'in', i, 'out', ou) order by mo) from (
        select date_trunc('month', t.posted_on)::date mo, sum(t.amount) filter (where t.amount > 0) i, -sum(t.amount) filter (where t.amount < 0) ou
        from public.fin_bank_transactions t where t.book_id = o.company_book_id and t.posted_on >= (date_trunc('month', current_date) - interval '11 months')::date
          and not (t.account_id = any (o.excluded_account_ids)) group by 1) z), '[]'::jsonb),
    'cash_events', coalesce((select jsonb_agg(jsonb_build_object('label', e.label, 'amount', e.amount, 'direction', e.direction, 'expected_on', e.expected_on, 'recurrence', e.recurrence, 'certainty', e.certainty))
      from public.fin_cash_events e where e.book_id = o.company_book_id and e.status = 'active' and e.expected_on <= current_date + 60), '[]'::jsonb),
    'payouts_upcoming', coalesce((select jsonb_agg(jsonb_build_object('ref', p.ref, 'net_cents', p.net_cents, 'scheduled_for', p.scheduled_for, 'status', p.status, 'mode', p.mode))
      from public.payouts p where p.status in ('scheduled', 'needs_approval', 'held', 'submitting', 'submitted')), '[]'::jsonb),
    'payouts_paid', coalesce((select jsonb_agg(jsonb_build_object('ref', p.ref, 'net_cents', p.net_cents, 'fee_cents', p.fee_cents, 'fee_bearer', p.fee_bearer, 'settled_at', p.settled_at, 'mode', p.mode))
      from public.payouts p where p.status = 'paid' and p.settled_at >= p_since), '[]'::jsonb),
    'liabilities', jsonb_build_object(
      'approved_unpaid_cents', (select coalesce(sum(st.total_cents), 0) from public.sales_statements st where st.status = 'approved' and not exists (select 1 from public.sales_payouts sp where sp.statement_id = st.id)),
      'earned_unapproved_cents', (select coalesce(sum(c.amount_cents), 0) from public.sales_commissions c where c.status = 'earned')),
    'software_monthly_cents', (select coalesce(sum(case billing_interval when 'monthly' then amount_cents when 'annual' then amount_cents / 12 else 0 end * allocation_pct / 100), 0)
      from public.admin_services where status = 'active' and amount_cents is not null),
    'payroll_status', o.payroll_status);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 22. Grants: owner/admin functions are service-role only (each re-checks the caller); self functions are for
--     signed-in users and only touch auth.uid()'s own record.
-- ---------------------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'staff_capabilities(uuid)', 'staff_require_cap(uuid, text)', 'staff_require_owner(uuid)', 'staff_audit(uuid, text, text, text, jsonb)',
    'staff_onboarding_status(uuid)', 'staff_member_json(public.staff_members)', 'staff_required_agreements(public.staff_members)',
    'admin_staff_list(uuid)', 'admin_staff_get(uuid, uuid)', 'admin_staff_save(uuid, uuid, jsonb)', 'admin_staff_set_status(uuid, uuid, text, text)',
    'admin_staff_banking_grant(uuid, uuid, boolean)', 'admin_staff_tax_verify(uuid, uuid, text, date)', 'admin_staff_invite_create(uuid, uuid, text, integer)',
    'staff_invite_lookup(text)', 'staff_w9_store(uuid, text, text, text, text, text, text, text, text)', 'staff_security_confirm(uuid)',
    'staff_destination_record(uuid, text, text, text, text, text, text, text, text)',
    'payout_fee_bearer(public.staff_members, public.payout_fee_policies, text, integer, integer, public.payout_settings)', 'payout_blockers(uuid, text)',
    'payout_plan(timestamptz)', 'payout_claim_due(integer, timestamptz)', 'payout_mark_submitted(uuid, text, timestamptz)',
    'payout_mark_submit_error(uuid, text, text, boolean, timestamptz)', 'payout_apply_event(text, text, text, timestamptz, text, boolean, text)',
    'admin_payout_settings_save(uuid, jsonb)', 'admin_payout_pause(uuid, boolean, text)', 'admin_fee_policy_approve(uuid, integer)', 'admin_funding_approve(uuid, text)',
    'admin_payout_activate_live(uuid, jsonb)', 'admin_payout_approve(uuid, uuid)', 'admin_payout_cancel(uuid, uuid, text)', 'admin_payout_simulate(uuid, uuid, text)',
    'admin_payout_reconcile(uuid, uuid, text, text)', 'admin_tax_threshold_save(uuid, integer, integer, boolean, text)', 'payout_json(public.payouts)',
    'admin_payouts_overview(uuid)', 'admin_payout_tax_year(uuid, integer)', 'admin_payout_cost_report(uuid, date)',
    'admin_banking_designate(uuid, uuid, uuid[])', 'admin_banking_overview(uuid, date)', 'staff_from_sales_rep()', 'staff_link_from_sales_rep()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['staff_my_capabilities()', 'staff_invite_accept(text)', 'staff_self()', 'staff_me()', 'staff_my_profile_save(jsonb)', 'staff_my_role_confirm()',
    'staff_my_agreement_accept(uuid, text, text, text, text)', 'staff_my_employment_item(text)', 'staff_my_payment_method(text)', 'staff_my_finish()', 'staff_my_payouts()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
