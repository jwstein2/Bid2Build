-- Built2Bid Affiliate Hub (James, 2026-11-20, Parts 3-8 of the HR / 10-year commissions / Affiliate spec).
-- Requires 20270207001000 (payout ledger) and 20270209001000 (sales ten-year term). Safe to re-run.
--
-- Separate from the HR system (pm_*), from internal sales reps (sales_*) and from the customer referral program
-- (referral_*, "refer a contractor, get a month free"). Affiliates are independent partners (mostly YouTube creators)
-- who refer contractors through a permanent link /a/<CODE>.
--
-- Commission policy (configurable, versioned; defaults below):
--   * One qualifying month of the customer's eligible paid subscription value, once per eligible year, for at most
--     10 annual events per referred customer. Never monthly, never up front.
--   * Year 1 = the first qualifying paid subscription invoice. Year N = the date N-1 years later (the anniversary).
--   * An anniversary qualifies when a qualifying paid invoice (not a proration, not fully refunded, not disputed)
--     covers that date ("paid-through" rule), so annual plans, monthly plans and a switch between them all work.
--     A missed anniversary (no covering payment within the grace days) is ineligible; the term never restarts
--     after upgrades, billing-cycle changes, cancellation or reactivation.
--     If a covering invoice is recorded late (webhook delay, backfill), the daily job turns that ineligible line
--     into a commission with reason 'late_invoice' (only while it is still ineligible for 'not_paid_on_anniversary').
--   * Amount = the covering invoice's eligible monthly value, from actual billing data:
--       round(L * least(1, P / (Ld * M)))  [half-up, to the cent, once per invoice]
--       P  = pre-tax amount actually paid, net of refunds (no sales tax, no failed/unpaid amounts)
--       M  = months the invoice covers (annual = 12)
--       Ld = list value per month (every recurring item at price / months; Enterprise seats included)
--       L  = Ld when annual_basis = 'divide_12' (default: annual value / 12), or the monthly-list value when the owner
--            chooses 'monthly_list' (the Sales Hub rule). Discounts reduce the amount proportionally.
--   * 30-day hold after the anniversary payment, then re-checked (refund, chargeback, eligibility, compliance) and
--     moved to payable. A refund/chargeback during the hold reverses it; after payout it is flagged for review only
--     (no automatic recovery until counsel approves clawback terms).
--   * Attribution: the account must be created through the link (after the click, within attribution_window_days).
--     One owner per customer: whichever verified source (sales rep or affiliate) is recorded first at account
--     creation keeps the customer. Never two full commissions on one subscription.
--
-- Money: nothing here moves money. Affiliate payouts reuse the V8.1 payout ledger (payouts / payout_items /
-- payout_events, same provider, limits, idempotency and owner activation) and are additionally gated by
-- affiliate_settings.payouts_enabled (OFF). Only provider ids and bank name / last 4 are stored; W-9 TINs are sealed
-- by the server like staff W-9s. Recruitment emails are OFF. YouTube imports need YOUTUBE_API_KEY (not set).
-- Rollback: docs/affiliates/rollback_20270210001000.sql

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings + policy versions
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.affiliate_settings (
  id                        boolean primary key default true check (id),
  applications_open         boolean not null default true,
  commission_years          integer not null default 10 check (commission_years between 1 and 10),
  hold_days                 integer not null default 30 check (hold_days between 0 and 120),
  grace_days                integer not null default 30 check (grace_days between 0 and 90),
  attribution_window_days   integer not null default 90 check (attribution_window_days between 1 and 365),
  annual_basis              text not null default 'divide_12' check (annual_basis in ('divide_12', 'monthly_list')),
  annual_basis_approved_at  timestamptz,               -- owner approval of the annual-plan rule (differs from Sales)
  after_payout_refunds      text not null default 'review_only' check (after_payout_refunds in ('review_only', 'recover_next_payout')),
  termination_future        text not null default 'continue_without_cause' check (termination_future in ('continue_without_cause', 'stop_all')),
  payouts_enabled           boolean not null default false,
  min_payout_cents          integer not null default 2500 check (min_payout_cents between 0 and 100000),
  recruitment_emails        boolean not null default false,
  max_signups_per_ip_day    integer not null default 3 check (max_signups_per_ip_day between 1 and 100),
  forecast_monthly_churn_bps integer not null default 300 check (forecast_monthly_churn_bps between 0 and 5000),
  forecast_annual_upgrade_bps integer not null default 0 check (forecast_annual_upgrade_bps between -5000 and 5000),
  policy_confirmed_at       timestamptz,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users (id) on delete set null
);
insert into public.affiliate_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.affiliate_policy_versions (
  version    integer primary key,
  policy     jsonb not null,
  note       text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.affiliate_policy_snapshot(s public.affiliate_settings) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('commission_years', s.commission_years, 'hold_days', s.hold_days, 'grace_days', s.grace_days,
    'attribution_window_days', s.attribution_window_days, 'annual_basis', s.annual_basis, 'after_payout_refunds', s.after_payout_refunds,
    'termination_future', s.termination_future, 'min_payout_cents', s.min_payout_cents)
$$;
create or replace function public.affiliate_policy_current_version() returns integer
language sql stable security definer set search_path = public as $$ select coalesce(max(version), 0) from public.affiliate_policy_versions $$;

insert into public.affiliate_policy_versions (version, policy, note)
select 1, public.affiliate_policy_snapshot(s), 'Launch policy (James, 2026-11-20): one month of eligible value per year for up to 10 years, 30-day hold, annual plans at annual value / 12 (pending owner approval)'
from public.affiliate_settings s where s.id on conflict (version) do nothing;

create or replace function public.affiliate_settings_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.affiliate_policy_snapshot(new) is distinct from public.affiliate_policy_snapshot(old) then
    insert into public.affiliate_policy_versions (version, policy, created_by, note)
    values (public.affiliate_policy_current_version() + 1, public.affiliate_policy_snapshot(new), new.updated_by, nullif(current_setting('affiliate.policy_note', true), ''));
  end if;
  return new;
end $$;
drop trigger if exists affiliate_settings_version on public.affiliate_settings;
create trigger affiliate_settings_version after update on public.affiliate_settings for each row execute function public.affiliate_settings_version();

-- ---------------------------------------------------------------------------------------------------
-- 2. Affiliates, channels, corrections, invitations, education, agreements
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.affiliates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid unique references auth.users (id) on delete set null,
  email             text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  code              text not null unique check (code ~ '^[A-Z2-9]{6,12}$'),
  status            text not null default 'invited' check (status in ('invited', 'applied', 'onboarding', 'pending_review', 'active', 'suspended', 'terminated', 'rejected')),
  source            text not null check (source in ('invite', 'application')),
  legal_name        text check (char_length(legal_name) <= 200),
  display_name      text check (char_length(display_name) <= 120),
  business_name     text check (char_length(business_name) <= 200),
  phone             text check (char_length(phone) <= 40),
  address_line1     text check (char_length(address_line1) <= 200),
  address_line2     text check (char_length(address_line2) <= 200),
  city              text check (char_length(city) <= 100),
  state             text check (char_length(state) <= 60),
  postal_code       text check (char_length(postal_code) <= 20),
  country           text check (country ~ '^[A-Z]{2}$'),
  tax_residency     text check (tax_residency ~ '^[A-Z]{2}$'),
  contact_pref      text not null default 'email' check (contact_pref in ('email', 'phone', 'text')),
  marketing_opt_in  boolean not null default false,
  application_note  text check (char_length(application_note) <= 2000),
  audience_note     text check (char_length(audience_note) <= 1000),
  categories        text[] not null default '{}',
  welcome_seen_at   timestamptz,
  profile_done_at   timestamptz,
  channel_done_at   timestamptz,
  education_done_at timestamptz,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  approved_by       uuid references auth.users (id) on delete set null,
  status_reason     text check (char_length(status_reason) <= 1000),
  termination_kind  text check (termination_kind in ('without_cause', 'material_misconduct', 'affiliate_resigned')),
  status_changed_at timestamptz,
  prospect_id       uuid,
  invited_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists affiliates_open_email on public.affiliates (email) where status not in ('rejected', 'terminated');
create index if not exists affiliates_status on public.affiliates (status);
drop trigger if exists affiliates_updated on public.affiliates;
create trigger affiliates_updated before update on public.affiliates for each row execute function public.set_updated_at();

create table if not exists public.affiliate_channels (
  id               uuid primary key default gen_random_uuid(),
  affiliate_id     uuid not null references public.affiliates (id) on delete cascade,
  platform         text not null check (platform in ('youtube', 'instagram', 'tiktok', 'facebook', 'podcast', 'blog', 'newsletter', 'other')),
  url              text check (url is null or (url ~ '^https://' and char_length(url) <= 500)),
  handle           text check (char_length(handle) <= 100),
  channel_id       text check (char_length(channel_id) <= 64),
  title            text check (char_length(title) <= 200),
  description      text check (char_length(description) <= 5000),
  thumbnail_url    text check (thumbnail_url is null or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 500)),
  -- Official imported metrics (YouTube Data API). The affiliate can't edit these; corrections go to review.
  subscriber_count bigint check (subscriber_count >= 0),
  subscribers_hidden boolean not null default false,
  view_count       bigint check (view_count >= 0),
  video_count      integer check (video_count >= 0),
  channel_country  text check (char_length(channel_country) <= 2),
  data_source      text not null default 'self_reported' check (data_source in ('youtube_api', 'self_reported', 'admin_corrected')),
  self_reported_audience bigint check (self_reported_audience >= 0),
  fetched_at       timestamptz,
  verify_code      text check (verify_code ~ '^B2B-[A-Z2-9]{6}$'),
  verified_at      timestamptz,
  verified_method  text check (verified_method in ('description_code', 'admin_review')),
  is_primary       boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists affiliate_channels_primary on public.affiliate_channels (affiliate_id) where is_primary;
create unique index if not exists affiliate_channels_youtube_id on public.affiliate_channels (channel_id) where platform = 'youtube' and channel_id is not null;
drop trigger if exists affiliate_channels_updated on public.affiliate_channels;
create trigger affiliate_channels_updated before update on public.affiliate_channels for each row execute function public.set_updated_at();

create table if not exists public.affiliate_channel_corrections (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.affiliate_channels (id) on delete cascade,
  affiliate_id  uuid not null references public.affiliates (id) on delete cascade,
  field         text not null check (field in ('subscriber_count', 'title', 'handle', 'url', 'description', 'channel_country', 'other')),
  current_value text check (char_length(current_value) <= 500),
  proposed_value text not null check (char_length(btrim(proposed_value)) between 1 and 500),
  note          text check (char_length(note) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by   uuid references auth.users (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text check (char_length(review_note) <= 1000),
  created_at    timestamptz not null default now()
);

create table if not exists public.affiliate_invites (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  personal_note text check (char_length(personal_note) <= 1000),
  email_status text not null default 'not_sent' check (email_status in ('not_sent', 'sent', 'failed')),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz
);

create table if not exists public.affiliate_lessons_done (
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  lesson       text not null check (lesson ~ '^[a-z0-9_]{2,40}$'),
  done_at      timestamptz not null default now(),
  primary key (affiliate_id, lesson)
);

create table if not exists public.affiliate_agreement_templates (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null unique check (version > 0),
  title        text not null check (char_length(title) between 1 and 200),
  body         text not null check (char_length(body) between 1 and 60000),
  legal_status text not null default 'draft_pending_counsel' check (legal_status in ('draft_pending_counsel', 'counsel_approved')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists affiliate_agreement_one_active on public.affiliate_agreement_templates ((true)) where active;

create table if not exists public.affiliate_agreement_acceptances (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete restrict,
  template_id  uuid not null references public.affiliate_agreement_templates (id) on delete restrict,
  body_sha256  text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  typed_name   text not null check (char_length(btrim(typed_name)) between 2 and 120),
  ip           text check (char_length(ip) <= 64),
  user_agent   text check (char_length(user_agent) <= 300),
  accepted_at  timestamptz not null default now(),
  unique (affiliate_id, template_id)
);
create or replace function public.affiliate_guard_immutable() returns trigger language plpgsql as $$
begin raise exception 'immutable_record' using errcode = '42501'; end $$;
drop trigger if exists affiliate_agreement_acceptances_immutable on public.affiliate_agreement_acceptances;
create trigger affiliate_agreement_acceptances_immutable before update or delete on public.affiliate_agreement_acceptances
  for each row execute function public.affiliate_guard_immutable();

-- ---------------------------------------------------------------------------------------------------
-- 3. Tax + payout destination (same rules as staff: sealed TIN, provider-hosted bank entry, last 4 only)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.affiliate_tax_profiles (
  affiliate_id      uuid primary key references public.affiliates (id) on delete cascade,
  form              text not null default 'w9' check (form in ('w9', 'w8_unsupported')),
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
  backup_withholding boolean not null default false,  -- only on an IRS notice or missing/invalid TIN; never estimated
  updated_at        timestamptz not null default now(),
  constraint affiliate_tax_w9 check (w9_status = 'not_started' or (tin_type is not null and tin_last4 is not null and w9_signed_at is not null))
);
create table if not exists public.affiliate_tin_secrets (
  affiliate_id   uuid primary key references public.affiliates (id) on delete cascade,
  tin_ciphertext text not null check (char_length(tin_ciphertext) between 16 and 1000),
  key_version    smallint not null default 1,
  updated_at     timestamptz not null default now()
);
create table if not exists public.affiliate_payout_destinations (
  id                uuid primary key default gen_random_uuid(),
  affiliate_id      uuid not null references public.affiliates (id) on delete cascade,
  provider          text not null check (provider in ('mock', 'stripe_global_payouts')),
  mode              text not null check (mode in ('test', 'live')),
  recipient_ref     text not null check (char_length(recipient_ref) between 1 and 200),
  payout_method_ref text check (char_length(payout_method_ref) <= 200),
  institution_name  text check (char_length(institution_name) <= 200),
  account_type      text not null default 'unknown' check (account_type in ('checking', 'savings', 'card', 'unknown')),
  last4             text check (last4 ~ '^[0-9]{4}$'),
  status            text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'disabled', 'replaced')),
  verified_at       timestamptz,
  eligible_from     timestamptz,
  is_current        boolean not null default true,
  created_at        timestamptz not null default now(),
  replaced_at       timestamptz
);
create unique index if not exists affiliate_payout_destinations_current on public.affiliate_payout_destinations (affiliate_id, mode) where is_current;

-- ---------------------------------------------------------------------------------------------------
-- 4. Attribution: clicks, referred customers, billing facts
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.affiliate_clicks (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  campaign     text check (campaign ~ '^[a-z0-9_-]{1,40}$'),
  source       text check (source ~ '^[a-z0-9_.-]{1,40}$'),
  landing_path text check (char_length(landing_path) <= 200),
  ip_hash      text check (ip_hash ~ '^[0-9a-f]{16,64}$'),
  ua_hash      text check (ua_hash ~ '^[0-9a-f]{16,64}$'),
  created_at   timestamptz not null default now()
);
create index if not exists affiliate_clicks_aff on public.affiliate_clicks (affiliate_id, created_at desc);
create index if not exists affiliate_clicks_ip on public.affiliate_clicks (ip_hash, created_at desc);

create table if not exists public.affiliate_referrals (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  affiliate_id          uuid not null references public.affiliates (id),
  code                  text not null,
  click_id              uuid references public.affiliate_clicks (id) on delete set null,
  campaign              text,
  source                text,
  landing_at            timestamptz,
  signup_at             timestamptz,
  attributed_at         timestamptz not null default now(),
  attribution_source    text not null default 'link' check (attribution_source in ('link', 'admin')),
  flags                 text[] not null default '{}',
  stripe_subscription_id text,
  sub_status            text,
  plan                  text,
  list_basis_cents      integer check (list_basis_cents is null or list_basis_cents >= 0),
  first_paid_at         timestamptz,
  first_paid_invoice    text,
  anniversary_date      date,                       -- first_paid_at (Central) = year 1; each year after on this date
  term_years            integer check (term_years between 1 and 10),
  eligibility_end_date  date,                       -- date of the last possible (year term_years) event
  cancel_requested_at   timestamptz,
  ended_at              timestamptz,
  ended_reason          text check (char_length(ended_reason) <= 300)
);
create index if not exists affiliate_referrals_aff on public.affiliate_referrals (affiliate_id);

create table if not exists public.affiliate_referral_history (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  from_affiliate uuid references public.affiliates (id),
  to_affiliate uuid references public.affiliates (id),
  action      text not null check (action in ('linked', 'assigned', 'reassigned', 'ended', 'dispute_resolved')),
  reason      text check (char_length(reason) <= 1000),
  actor       uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Paid invoices of referred customers (source of truth for amounts and coverage). Idempotent on invoice id.
create table if not exists public.affiliate_invoices (
  invoice_id        text primary key check (char_length(invoice_id) between 1 and 200),
  user_id           uuid not null references auth.users (id) on delete cascade,
  subscription_id   text,
  billing_reason    text check (char_length(billing_reason) <= 60),
  paid_at           timestamptz not null,
  period_start      date not null,
  period_end        date not null,
  period_months     numeric(7, 3) not null check (period_months > 0),
  gross_cents       integer not null check (gross_cents >= 0),          -- amount paid incl. tax
  pretax_cents      integer not null check (pretax_cents >= 0),         -- before tax
  list_divide_cents integer not null default 0 check (list_divide_cents >= 0),   -- list value per month (annual / 12)
  list_monthly_cents integer not null default 0 check (list_monthly_cents >= 0), -- list value per month (monthly list price)
  refunded_cents    integer not null default 0 check (refunded_cents >= 0),
  dispute_status    text check (dispute_status in ('open', 'won', 'lost')),
  detail            jsonb,
  created_at        timestamptz not null default now(),
  constraint affiliate_invoices_period check (period_end > period_start)
);
create index if not exists affiliate_invoices_user on public.affiliate_invoices (user_id, period_start);

-- ---------------------------------------------------------------------------------------------------
-- 5. Commission ledger (one line per customer per year; adjustments separate)
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.affiliate_commissions (
  id             uuid primary key default gen_random_uuid(),
  affiliate_id   uuid not null references public.affiliates (id),
  user_id        uuid not null references auth.users (id) on delete restrict,
  year_no        integer not null check (year_no between 1 and 10),
  anniversary_date date not null,
  invoice_id     text references public.affiliate_invoices (invoice_id) on delete restrict,
  amount_cents   integer not null check (amount_cents >= 0),
  basis          jsonb,
  status         text not null default 'pending' check (status in ('pending', 'payable', 'paid', 'held', 'ineligible', 'reversed', 'canceled')),
  hold_until     timestamptz,
  reason         text check (char_length(reason) <= 300),
  policy_version integer,
  payout_id      uuid references public.payouts (id) on delete set null,
  payable_at     timestamptz,
  paid_at        timestamptz,
  review_flag    text check (char_length(review_flag) <= 300),   -- refund/chargeback after payout: owner review
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, year_no)
);
create index if not exists affiliate_commissions_aff on public.affiliate_commissions (affiliate_id, status);
create index if not exists affiliate_commissions_due on public.affiliate_commissions (status, hold_until);
drop trigger if exists affiliate_commissions_updated on public.affiliate_commissions;
create trigger affiliate_commissions_updated before update on public.affiliate_commissions for each row execute function public.set_updated_at();

create table if not exists public.affiliate_adjustments (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliates (id),
  commission_id uuid references public.affiliate_commissions (id) on delete restrict,
  kind          text not null check (kind in ('recovery', 'correction')),
  amount_cents  integer not null check (amount_cents <> 0),
  status        text not null default 'pending_review' check (status in ('pending_review', 'approved', 'applied', 'void')),
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by    uuid references auth.users (id) on delete set null,
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  payout_id     uuid references public.payouts (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.affiliate_disputes (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid references public.affiliates (id) on delete set null,
  user_id      uuid references auth.users (id) on delete set null,
  commission_id uuid references public.affiliate_commissions (id) on delete set null,
  kind         text not null check (kind in ('attribution', 'commission', 'payout', 'other')),
  raised_by    text not null check (raised_by in ('affiliate', 'admin', 'sales')),
  customer_hint text check (char_length(customer_hint) <= 200),
  description  text not null check (char_length(btrim(description)) between 5 and 2000),
  status       text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution   text check (char_length(resolution) <= 2000),
  outcome      text check (outcome in ('kept', 'reassigned_affiliate', 'moved_to_sales', 'removed', 'commission_restored', 'commission_canceled', 'no_change')),
  resolved_by  uuid references auth.users (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------
-- 6. Recruitment CRM (separate from the sales lead CRM), email log, compliance
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.affiliate_prospects (
  id               uuid primary key default gen_random_uuid(),
  channel_name     text not null check (char_length(btrim(channel_name)) between 1 and 200),
  channel_url      text check (channel_url is null or (channel_url ~ '^https://' and char_length(channel_url) <= 500)),
  channel_id       text check (char_length(channel_id) <= 64),
  platform         text not null default 'youtube' check (platform in ('youtube', 'instagram', 'tiktok', 'facebook', 'podcast', 'blog', 'newsletter', 'other')),
  subscriber_count bigint check (subscriber_count >= 0),
  subscribers_refreshed_at timestamptz,
  categories       text[] not null default '{}',
  primary_audience text check (char_length(primary_audience) <= 300),
  contact_name     text check (char_length(contact_name) <= 200),
  email            text check (email is null or (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  email_source     text check (char_length(email_source) <= 500),   -- where a public business email was found (no scraping)
  status           text not null default 'researching' check (status in ('researching', 'qualified', 'contacted', 'follow_up', 'interested', 'invited', 'onboarding', 'active', 'declined', 'do_not_contact')),
  relevance_score  integer check (relevance_score between 0 and 100),
  next_action      text check (char_length(next_action) <= 300),
  next_action_at   date,
  notes            text check (char_length(notes) <= 5000),
  affiliate_id     uuid references public.affiliates (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists affiliate_prospects_channel on public.affiliate_prospects (channel_id) where channel_id is not null;
drop trigger if exists affiliate_prospects_updated on public.affiliate_prospects;
create trigger affiliate_prospects_updated before update on public.affiliate_prospects for each row execute function public.set_updated_at();

create table if not exists public.affiliate_outreach_events (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.affiliate_prospects (id) on delete cascade,
  affiliate_id uuid references public.affiliates (id) on delete cascade,
  kind        text not null check (kind in ('note', 'email_drafted', 'email_sent', 'email_failed', 'reply', 'call', 'invite_created', 'follow_up', 'status')),
  body        text check (char_length(body) <= 4000),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (prospect_id is not null or affiliate_id is not null)
);

create table if not exists public.affiliate_email_log (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (char_length(key) between 3 and 200),     -- idempotency key
  template     text not null check (template ~ '^[a-z_]{3,40}$'),
  to_email     text not null check (char_length(to_email) <= 320),
  affiliate_id uuid references public.affiliates (id) on delete set null,
  prospect_id  uuid references public.affiliate_prospects (id) on delete set null,
  status       text not null check (status in ('logged_off', 'sent', 'failed', 'suppressed')),
  provider_id  text check (char_length(provider_id) <= 200),
  error        text check (char_length(error) <= 300),
  created_at   timestamptz not null default now()
);

create table if not exists public.affiliate_compliance_cases (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  kind         text not null check (kind in ('undisclosed_relationship', 'false_earnings_claim', 'misleading_demo', 'fabricated_experience', 'spam', 'trademark', 'fraudulent_review', 'cookie_stuffing', 'self_referral', 'other')),
  evidence_url text check (evidence_url is null or (evidence_url ~ '^https://' and char_length(evidence_url) <= 500)),
  description  text not null check (char_length(btrim(description)) between 5 and 4000),
  reported_by  text check (char_length(reported_by) <= 200),
  status       text not null default 'open' check (status in ('open', 'warning_sent', 'resolved', 'escalated')),
  action_taken text check (char_length(action_taken) <= 2000),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- ---------------------------------------------------------------------------------------------------
-- 7. Payout ledger: affiliates become a second payee type (one ledger, same idempotency and limits)
-- ---------------------------------------------------------------------------------------------------
alter table public.payouts add column if not exists affiliate_id uuid references public.affiliates (id) on delete restrict;
alter table public.payouts alter column staff_id drop not null;
alter table public.payouts drop constraint if exists payouts_one_payee;
alter table public.payouts add constraint payouts_one_payee check (num_nonnulls(staff_id, affiliate_id) = 1);
create index if not exists payouts_affiliate on public.payouts (affiliate_id, created_at desc) where affiliate_id is not null;
alter table public.payouts add column if not exists affiliate_destination_id uuid references public.affiliate_payout_destinations (id) on delete restrict;
alter table public.payout_items drop constraint if exists payout_items_source_kind_check;
alter table public.payout_items add constraint payout_items_source_kind_check check (source_kind in ('sales_statement', 'affiliate_commission', 'affiliate_adjustment'));

-- ---------------------------------------------------------------------------------------------------
-- 8. RLS: service role only; people read their own data through security-definer functions
-- ---------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['affiliate_settings', 'affiliate_policy_versions', 'affiliates', 'affiliate_channels', 'affiliate_channel_corrections', 'affiliate_invites',
    'affiliate_lessons_done', 'affiliate_agreement_templates', 'affiliate_agreement_acceptances', 'affiliate_tax_profiles', 'affiliate_tin_secrets',
    'affiliate_payout_destinations', 'affiliate_clicks', 'affiliate_referrals', 'affiliate_referral_history', 'affiliate_invoices', 'affiliate_commissions',
    'affiliate_adjustments', 'affiliate_disputes', 'affiliate_prospects', 'affiliate_outreach_events', 'affiliate_email_log', 'affiliate_compliance_cases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. Helpers
-- ---------------------------------------------------------------------------------------------------
create or replace function public.affiliate_audit(p_actor uuid, p_action text, p_id text, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details) values (p_actor, p_action, 'affiliate', p_id, p_details)
$$;

create or replace function public.affiliate_require_admin(p_caller uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller is null or not public.is_admin(p_caller) then raise exception 'not_authorized' using errcode = '42501'; end if;
end $$;

create or replace function public.affiliate_new_code() returns text
language plpgsql volatile set search_path = public as $$
declare v text; alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    v := '';
    for i in 1..8 loop v := v || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.affiliates where code = v) and not exists (select 1 from public.sales_reps where code = v);
  end loop;
  return v;
end $$;

create or replace function public.affiliate_today(p_now timestamptz default now()) returns date
language sql stable as $$ select (p_now at time zone 'America/Chicago')::date $$;

-- Eligible monthly value of one invoice under the annual-plan rule (see header). Half-up rounding to the cent.
create or replace function public.affiliate_invoice_value(i public.affiliate_invoices, p_annual_basis text) returns integer
language sql immutable as $$
  -- Net pre-tax paid: a refund (stated against the gross, tax included) reduces the pre-tax amount proportionally.
  with n as (select case when i.gross_cents > 0 then i.pretax_cents::numeric * greatest(i.gross_cents - i.refunded_cents, 0) / i.gross_cents else 0 end as net)
  select case
    when i.dispute_status in ('open', 'lost') then 0
    when n.net <= 0 then 0
    when i.list_divide_cents <= 0 then round(n.net / i.period_months)::integer
    else round((case when p_annual_basis = 'monthly_list' and i.list_monthly_cents > 0 then i.list_monthly_cents else i.list_divide_cents end)::numeric
      * least(1::numeric, n.net / (i.list_divide_cents::numeric * i.period_months)))::integer
  end
  from n
$$;

-- A qualifying invoice: paid, a full billing period (not a proration), value > 0.
create or replace function public.affiliate_invoice_qualifies(i public.affiliate_invoices) returns boolean
language sql immutable as $$
  select coalesce(i.billing_reason, 'subscription_cycle') not in ('subscription_update', 'subscription_threshold') and i.pretax_cents > 0
$$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Seed agreement (DRAFT pending counsel; the full text lives in docs/affiliates/AFFILIATE_AGREEMENT_DRAFT.md and
--     this row is updated from it by the app owner after review; version 1 here is the review draft)
-- ---------------------------------------------------------------------------------------------------
insert into public.affiliate_agreement_templates (version, title, body)
select 1, 'Built2Bid Affiliate Program Agreement (Draft v1)', $agreement$DRAFT FOR ATTORNEY REVIEW. NOT FINAL. Built2Bid L.L.C. ("Built2Bid", "we") and you ("Affiliate", "you").

1. Eligibility and approval. You may join only after Built2Bid approves your application or invitation. We may approve or decline any applicant for any lawful reason, including audience relevance, content quality and professionalism. Subscriber or follower counts alone do not decide approval. You must be at least 18 and able to enter contracts. For now, commission payments are available only to approved affiliates who are U.S. persons with a U.S. bank account.

2. Independent relationship. You are an independent contractor. Nothing in this Agreement creates an employment, partnership, joint venture, franchise or agency relationship. You have no authority to make promises, sign agreements or accept payments for Built2Bid. You control your own content, schedule and methods, and you are responsible for your own expenses, taxes and insurance.

3. Qualified referral. A "Qualified Referral" is a new Built2Bid customer account that (a) is created through your unique referral link while the visit is within the attribution window shown in your dashboard (currently 90 days), (b) is not you, your business, a household member, or an account you control, (c) did not already have a Built2Bid account or paid subscription, and (d) is not attributed to a Built2Bid sales representative or another affiliate first.

4. Attribution ownership. Each customer has one referral owner: the verified referral source recorded when the customer created the account. Later clicks, coupons or links do not change ownership. Built2Bid may review and correct attribution for fraud, error or a documented dispute, with a written record. Decisions on disputed attribution are made by an authorized Built2Bid administrator and you may ask for a review.

5. Commission calculation. For each Qualified Referral, you may earn one Annual Commission for each Eligible Year. An Annual Commission equals one month of the customer's eligible paid subscription value at that time, calculated from the amount actually paid before tax, after discounts and refunds, for recurring subscription items (including additional paid seats). For annual plans, the monthly value is the annual eligible amount divided by 12 unless the published program policy states otherwise. Taxes, failed or unpaid invoices, refunded or charged-back amounts, one-time fees and other excluded items are never commissionable. Amounts are rounded to the nearest cent.

6. Ten-year maximum term. Year 1 begins on the date of the customer's first qualifying paid subscription payment. Each later Eligible Year falls on that date's anniversary. There are at most ten (10) Annual Commissions per Qualified Referral. The ten-year period does not restart because of upgrades, downgrades, billing-cycle changes, pauses, cancellation or reactivation.

7. Annual payout frequency. Commissions are earned and paid annually per customer, not monthly. No commission is paid in advance for future years.

8. Thirty-day holding period. Each Annual Commission is held for thirty (30) days after the qualifying payment, then re-checked for refunds, chargebacks, customer eligibility and your compliance with this Agreement before it becomes payable.

9. Cancellation, refunds and chargebacks. An Eligible Year requires that the customer's subscription is active and paid for the anniversary date. If the customer cancels, stops paying or is refunded, that year's commission is not earned, and eligibility for later years ends unless the customer is paying again on a later anniversary within the original ten-year period. A refund or chargeback during the holding period cancels that commission. [COUNSEL: decide whether Built2Bid may recover a commission already paid when the related payment is later refunded or charged back, and the notice required. Until counsel approves, Built2Bid does not deduct or recover paid commissions.]

10. Subscription pricing changes. Built2Bid sets its own prices and plans and may change them at any time. Each Annual Commission uses the customer's eligible value at that anniversary, which may be higher or lower than in earlier years.

11. Payout method and taxes. Payable commissions are paid by ACH through Built2Bid's payment provider to the bank account you connect on the provider's secure page. Built2Bid never asks for or stores your full bank account number. A minimum payable balance may apply; balances below it carry forward. You must provide a valid IRS Form W-9 before payment. Built2Bid will issue tax information returns (such as Form 1099) when required by law and may apply backup withholding only where the law requires it. You are responsible for your own taxes.

12. Fraud and prohibited conduct. You may not: refer yourself or accounts you control; use cookie stuffing, forced clicks, hidden or misleading links, or incentivized sign-ups not approved in writing; bid on Built2Bid trademarks in paid search; create fake accounts or reviews; or manipulate attribution. Commissions resulting from prohibited conduct are not earned.

13. Brand and trademarks. We grant you a limited, revocable, non-exclusive license to use the approved Built2Bid name, logos and materials from the Affiliate Resource Center only to promote Built2Bid under this Agreement. You may not imply you are Built2Bid or speak for it, register confusing domains or handles, or alter our marks.

14. FTC endorsement disclosures. You must clearly and conspicuously disclose your financial relationship with Built2Bid in each piece of content that promotes it, in the content itself (for example, said in the video and shown on screen), not only in a description or profile. You may only describe experiences you actually had and may not make claims Built2Bid cannot support.

15. YouTube and other platforms. You must follow the rules of each platform you use, including YouTube's paid promotion disclosure setting ("includes paid promotion") when applicable, and each platform's community guidelines and advertising policies.

16. Marketing and anti-spam. You must comply with CAN-SPAM, the TCPA, state privacy laws and similar laws. No unsolicited bulk email, texts or calls promoting Built2Bid. You may not buy or scrape contact lists to promote Built2Bid.

17. Confidentiality and data protection. Non-public information you receive (including dashboard data about referred customers) is confidential and may only be used to manage your participation. Built2Bid shows you privacy-safe customer identifiers only. You must not try to identify or contact referred customers about their Built2Bid account.

18. Termination. Either party may end this Agreement at any time with written notice. (a) Accrued commissions: Annual Commissions that became payable before termination are paid on the normal schedule. (b) Future conditional commissions: if Built2Bid terminates without cause or you resign, Annual Commissions for Qualified Referrals made before termination continue to be earned and paid on their normal schedule for the rest of the ten-year term while the customer remains eligible, unless this Agreement provides otherwise. [COUNSEL: confirm or revise post-termination treatment.] (c) Material misconduct: if Built2Bid terminates for fraud, prohibited conduct, a material breach not cured within a reasonable notice period, or illegal activity, commissions that are not yet paid are held for review and are forfeited to the extent they relate to the misconduct, and no future commissions are earned. Built2Bid will give written reasons.

19. Disputes and corrections. You may raise a question about attribution, a commission or a payout from your dashboard within 180 days. Built2Bid will review it and respond in writing. Errors in either direction will be corrected.

20. Program changes and amendments. Built2Bid may change the program prospectively with at least 30 days' written notice. Changes do not reduce commissions that already became payable, and do not reduce the commission terms that apply to Qualified Referrals made before the change unless you agree in writing or the change is required by law. [COUNSEL: confirm.] Continued participation after the notice period means you accept the change for new referrals.

21. Limitation of liability. Except for amounts owed under this Agreement, neither party is liable for indirect, incidental, special or consequential damages. Built2Bid's total liability is limited to commissions earned and unpaid. Nothing guarantees any level of earnings.

22. Governing law. This Agreement is governed by the laws of the State of Minnesota, without regard to conflict-of-laws rules. [COUNSEL: venue, arbitration, notice addresses.]

Acceptance: by typing your name and selecting "I agree", you sign this Agreement electronically. Built2Bid records the date, time, the version and a fingerprint of the exact text you accepted.$agreement$
where not exists (select 1 from public.affiliate_agreement_templates);

-- ---------------------------------------------------------------------------------------------------
-- 11. Public: clicks, applications, invitations
-- ---------------------------------------------------------------------------------------------------
-- A visit through /a/<CODE> (service role, from the redirect route). Returns the click id for an active affiliate,
-- or null (unknown / inactive code: no cookie is set).
create or replace function public.affiliate_log_click(p_code text, p_campaign text, p_source text, p_path text, p_ip_hash text, p_ua_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; v uuid;
begin
  select * into a from public.affiliates where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if not found then return null; end if;
  insert into public.affiliate_clicks (affiliate_id, campaign, source, landing_path, ip_hash, ua_hash)
  values (a.id, case when p_campaign ~ '^[a-z0-9_-]{1,40}$' then p_campaign end, case when p_source ~ '^[a-z0-9_.-]{1,40}$' then p_source end,
    left(p_path, 200), case when p_ip_hash ~ '^[0-9a-f]{16,64}$' then p_ip_hash end, case when p_ua_hash ~ '^[0-9a-f]{16,64}$' then p_ua_hash end)
  returning id into v;
  return v;
end $$;

-- Public application from /affiliates/apply (service role, after rate limiting + turnstile-free honeypot in the route).
create or replace function public.affiliate_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.affiliate_settings; v_email text := lower(btrim(coalesce(p ->> 'email', ''))); a public.affiliates; v_platform text;
begin
  select * into cfg from public.affiliate_settings where id;
  if not cfg.applications_open then raise exception 'applications_closed' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.affiliates where email = v_email and status not in ('rejected', 'terminated')) then
    return jsonb_build_object('status', 'exists');   -- no account enumeration detail beyond "we have it"
  end if;
  if char_length(btrim(coalesce(p ->> 'legal_name', ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  insert into public.affiliates (email, code, status, source, legal_name, display_name, business_name, country, application_note, audience_note, categories, marketing_opt_in)
  values (v_email, public.affiliate_new_code(), 'applied', 'application', left(btrim(p ->> 'legal_name'), 200), nullif(left(btrim(coalesce(p ->> 'display_name', '')), 120), ''),
    nullif(left(btrim(coalesce(p ->> 'business_name', '')), 200), ''), coalesce(nullif(upper(left(btrim(coalesce(p ->> 'country', '')), 2)), ''), 'US'),
    nullif(left(btrim(coalesce(p ->> 'note', '')), 2000), ''), nullif(left(btrim(coalesce(p ->> 'audience', '')), 1000), ''),
    coalesce((select array_agg(left(x, 40)) from jsonb_array_elements_text(coalesce(p -> 'categories', '[]'::jsonb)) x limit 20), '{}'),
    coalesce((p ->> 'marketing_opt_in')::boolean, false))
  returning * into a;
  v_platform := case when p ->> 'platform' in ('youtube', 'instagram', 'tiktok', 'facebook', 'podcast', 'blog', 'newsletter', 'other') then p ->> 'platform' else 'other' end;
  if nullif(btrim(coalesce(p ->> 'channel_url', '')), '') is not null then
    insert into public.affiliate_channels (affiliate_id, platform, url, title, self_reported_audience, data_source)
    values (a.id, v_platform, case when p ->> 'channel_url' ~ '^https://' then left(p ->> 'channel_url', 500) end,
      nullif(left(btrim(coalesce(p ->> 'channel_name', '')), 200), ''), case when (p ->> 'audience_size') ~ '^[0-9]{1,12}$' then (p ->> 'audience_size')::bigint end, 'self_reported');
  end if;
  perform public.affiliate_audit(null, 'affiliate.applied', a.id::text, jsonb_build_object('email', v_email));
  return jsonb_build_object('status', 'received', 'id', a.id);
end $$;

-- Owner: create (or reuse) an affiliate record for a person and issue an invite link. Only the token hash is stored.
create or replace function public.admin_affiliate_invite_create(p_caller uuid, p_email text, p_name text, p_prospect uuid, p_token_hash text, p_note text, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); a public.affiliates; i public.affiliate_invites;
begin
  perform public.affiliate_require_admin(p_caller);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalid' using errcode = '22023'; end if;
  select * into a from public.affiliates where email = v_email and status not in ('rejected', 'terminated');
  if not found then
    insert into public.affiliates (email, code, status, source, legal_name, prospect_id, invited_by)
    values (v_email, public.affiliate_new_code(), 'invited', 'invite', nullif(left(btrim(coalesce(p_name, '')), 200), ''), p_prospect, p_caller)
    returning * into a;
  end if;
  update public.affiliate_invites set revoked_at = now() where affiliate_id = a.id and accepted_at is null and revoked_at is null;
  insert into public.affiliate_invites (affiliate_id, token_hash, expires_at, personal_note, created_by)
  values (a.id, p_token_hash, now() + make_interval(days => greatest(1, least(coalesce(p_days, 14), 60))), nullif(left(btrim(coalesce(p_note, '')), 1000), ''), p_caller)
  returning * into i;
  if p_prospect is not null then
    update public.affiliate_prospects set status = 'invited', affiliate_id = a.id where id = p_prospect;
    insert into public.affiliate_outreach_events (prospect_id, affiliate_id, kind, body, created_by) values (p_prospect, a.id, 'invite_created', 'Invitation link created', p_caller);
  end if;
  perform public.affiliate_audit(p_caller, 'affiliate.invited', a.id::text, jsonb_build_object('email', v_email, 'expires_at', i.expires_at));
  return jsonb_build_object('affiliate_id', a.id, 'invite_id', i.id, 'email', a.email, 'name', coalesce(a.display_name, a.legal_name), 'expires_at', i.expires_at);
end $$;

create or replace function public.affiliate_invite_lookup(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', a.email, 'name', coalesce(a.display_name, a.legal_name), 'expires_at', i.expires_at, 'note', i.personal_note,
    'valid', i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and a.status in ('invited', 'onboarding'))
  from public.affiliate_invites i join public.affiliates a on a.id = i.affiliate_id where i.token_hash = p_token_hash
$$;

-- The signed-in, VERIFIED user accepts the invite (their email must match the invited email).
create or replace function public.affiliate_invite_accept(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.affiliate_invites; a public.affiliates; v_email text; v_verified timestamptz;
begin
  select lower(email), email_confirmed_at into v_email, v_verified from auth.users where id = auth.uid();
  if v_email is null or v_verified is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  select * into i from public.affiliate_invites where token_hash = p_token_hash for update;
  if not found or i.revoked_at is not null or i.expires_at <= now() then raise exception 'invite_invalid' using errcode = '22023'; end if;
  select * into a from public.affiliates where id = i.affiliate_id for update;
  if a.email <> v_email then raise exception 'wrong_email' using errcode = '42501'; end if;
  if a.user_id is not null and a.user_id <> auth.uid() then raise exception 'invite_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.affiliates x where x.user_id = auth.uid() and x.id <> a.id) then raise exception 'already_affiliate' using errcode = '22023'; end if;
  update public.affiliate_invites set accepted_at = coalesce(accepted_at, now()) where id = i.id;
  update public.affiliates set user_id = auth.uid(), status = case when status = 'invited' then 'onboarding' else status end, status_changed_at = now() where id = a.id;
  perform public.affiliate_audit(auth.uid(), 'affiliate.invite_accepted', a.id::text, null);
  return jsonb_build_object('affiliate_id', a.id);
end $$;

-- An approved applicant signs in with their application email: link the record (verified email only).
create or replace function public.affiliate_link_self() returns void
language plpgsql security definer set search_path = public as $$
declare v_email text; v_verified timestamptz;
begin
  select lower(email), email_confirmed_at into v_email, v_verified from auth.users where id = auth.uid();
  if v_email is null or v_verified is null then return; end if;
  if exists (select 1 from public.affiliates where user_id = auth.uid()) then return; end if;
  update public.affiliates set user_id = auth.uid(), status = case when status = 'invited' then 'onboarding' else status end, status_changed_at = now()
  where email = v_email and user_id is null and status in ('applied', 'onboarding', 'invited', 'pending_review', 'active')
    and (source = 'application' or exists (select 1 from public.affiliate_invites i where i.affiliate_id = affiliates.id and i.accepted_at is not null));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 12. Affiliate self-service (authenticated; own record only)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.affiliate_self() returns public.affiliates
language plpgsql stable security definer set search_path = public as $$
declare a public.affiliates;
begin
  select * into a from public.affiliates where user_id = auth.uid();
  if not found then raise exception 'not_affiliate' using errcode = '42501'; end if;
  if a.status in ('suspended', 'terminated', 'rejected') then raise exception 'affiliate_inactive' using errcode = '42501'; end if;
  return a;
end $$;

create or replace function public.affiliate_onboarding(a public.affiliates) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.affiliate_tax_profiles; d public.affiliate_payout_destinations; v_mode text; v_agree boolean; v_us boolean; v_lessons integer;
begin
  select * into t from public.affiliate_tax_profiles where affiliate_id = a.id;
  select case when mode = 'live' then 'live' else 'test' end into v_mode from public.payout_settings where id;
  select * into d from public.affiliate_payout_destinations where affiliate_id = a.id and mode = coalesce(v_mode, 'test') and is_current;
  v_agree := exists (select 1 from public.affiliate_agreement_acceptances x join public.affiliate_agreement_templates tp on tp.id = x.template_id where x.affiliate_id = a.id and tp.active);
  v_us := coalesce(a.country, 'US') = 'US' and coalesce(a.tax_residency, 'US') = 'US';
  select count(*) into v_lessons from public.affiliate_lessons_done where affiliate_id = a.id;
  return jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'welcome', 'label', 'Welcome', 'done', a.welcome_seen_at is not null),
      jsonb_build_object('key', 'profile', 'label', 'Your information', 'done', a.profile_done_at is not null),
      jsonb_build_object('key', 'channel', 'label', 'Your channel', 'done', a.channel_done_at is not null),
      jsonb_build_object('key', 'learn', 'label', 'Affiliate training', 'done', a.education_done_at is not null),
      jsonb_build_object('key', 'agreement', 'label', 'Affiliate agreement', 'done', v_agree),
      jsonb_build_object('key', 'payout', 'label', 'Tax form and payouts', 'done', (t.w9_status in ('submitted', 'verified') and d.id is not null) or not v_us),
      jsonb_build_object('key', 'finish', 'label', 'Finish', 'done', a.submitted_at is not null)),
    'lessons_done', v_lessons, 'us_payouts', v_us, 'w9_status', coalesce(t.w9_status, 'not_started'), 'tin_last4', t.tin_last4,
    'destination', case when d.id is null then null else jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'status', d.status, 'eligible_from', d.eligible_from, 'mode', d.mode) end,
    'agreement_accepted', v_agree);
end $$;

create or replace function public.affiliate_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates;
begin
  perform public.affiliate_link_self();
  select * into a from public.affiliates where user_id = auth.uid();
  if not found then return null; end if;
  if a.status in ('suspended', 'terminated', 'rejected') then return jsonb_build_object('status', a.status, 'reason', a.status_reason); end if;
  return (to_jsonb(a) - 'approved_by' - 'invited_by' - 'prospect_id') || jsonb_build_object(
    'onboarding', public.affiliate_onboarding(a),
    'channel', (select to_jsonb(c) from public.affiliate_channels c where c.affiliate_id = a.id and c.is_primary),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'field', x.field, 'proposed_value', x.proposed_value, 'status', x.status, 'review_note', x.review_note, 'created_at', x.created_at) order by x.created_at desc)
      from public.affiliate_channel_corrections x where x.affiliate_id = a.id), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(lesson) from public.affiliate_lessons_done where affiliate_id = a.id), '[]'::jsonb),
    'agreement', (select jsonb_build_object('id', t.id, 'version', t.version, 'title', t.title, 'body', t.body, 'legal_status', t.legal_status,
        'accepted_at', (select accepted_at from public.affiliate_agreement_acceptances x where x.affiliate_id = a.id and x.template_id = t.id))
      from public.affiliate_agreement_templates t where t.active),
    'policy', (select public.affiliate_policy_snapshot(s) from public.affiliate_settings s where s.id));
end $$;

create or replace function public.affiliate_my_step(p_step text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self();
begin
  if p_step = 'welcome' then
    update public.affiliates set welcome_seen_at = coalesce(welcome_seen_at, now()) where id = a.id;
  elsif p_step = 'profile' then
    if char_length(btrim(coalesce(p ->> 'legal_name', ''))) < 2 or char_length(btrim(coalesce(p ->> 'phone', ''))) < 7
       or char_length(btrim(coalesce(p ->> 'address_line1', ''))) < 3 or char_length(btrim(coalesce(p ->> 'city', ''))) < 2
       or coalesce(p ->> 'country', '') !~ '^[A-Za-z]{2}$' or coalesce(p ->> 'tax_residency', '') !~ '^[A-Za-z]{2}$' then
      raise exception 'required_missing' using errcode = '22023';
    end if;
    update public.affiliates set legal_name = left(btrim(p ->> 'legal_name'), 200), display_name = nullif(left(btrim(coalesce(p ->> 'display_name', '')), 120), ''),
      business_name = nullif(left(btrim(coalesce(p ->> 'business_name', '')), 200), ''), phone = left(btrim(p ->> 'phone'), 40),
      address_line1 = left(btrim(p ->> 'address_line1'), 200), address_line2 = nullif(left(btrim(coalesce(p ->> 'address_line2', '')), 200), ''),
      city = left(btrim(p ->> 'city'), 100), state = nullif(left(upper(btrim(coalesce(p ->> 'state', ''))), 60), ''), postal_code = nullif(left(btrim(coalesce(p ->> 'postal_code', '')), 20), ''),
      country = upper(p ->> 'country'), tax_residency = upper(p ->> 'tax_residency'),
      contact_pref = case when p ->> 'contact_pref' in ('email', 'phone', 'text') then p ->> 'contact_pref' else 'email' end,
      marketing_opt_in = coalesce((p ->> 'marketing_opt_in')::boolean, marketing_opt_in), profile_done_at = now()
    where id = a.id;
  elsif p_step = 'channel_done' then
    if not exists (select 1 from public.affiliate_channels where affiliate_id = a.id and is_primary) then raise exception 'channel_required' using errcode = '22023'; end if;
    update public.affiliates set channel_done_at = coalesce(channel_done_at, now()) where id = a.id;
  elsif p_step = 'learn_done' then
    if (select count(*) from public.affiliate_lessons_done where affiliate_id = a.id) < 10 then raise exception 'lessons_incomplete' using errcode = '22023'; end if;
    update public.affiliates set education_done_at = coalesce(education_done_at, now()) where id = a.id;
  elsif p_step = 'submit' then
    if a.profile_done_at is null or a.channel_done_at is null or a.education_done_at is null
       or not exists (select 1 from public.affiliate_agreement_acceptances x join public.affiliate_agreement_templates t on t.id = x.template_id where x.affiliate_id = a.id and t.active) then
      raise exception 'steps_incomplete' using errcode = '22023';
    end if;
    update public.affiliates set submitted_at = coalesce(submitted_at, now()),
      status = case when status in ('invited', 'onboarding', 'applied') then 'pending_review' else status end, status_changed_at = now() where id = a.id;
    perform public.affiliate_audit(auth.uid(), 'affiliate.submitted', a.id::text, null);
  else
    raise exception 'bad_step' using errcode = '22023';
  end if;
  select * into a from public.affiliates where id = a.id;
  return public.affiliate_onboarding(a);
end $$;

create or replace function public.affiliate_my_lesson(p_lesson text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self();
begin
  if p_lesson !~ '^[a-z0-9_]{2,40}$' then raise exception 'bad_lesson' using errcode = '22023'; end if;
  insert into public.affiliate_lessons_done (affiliate_id, lesson) values (a.id, p_lesson) on conflict do nothing;
end $$;

-- Self-reported channel (no API) or a non-YouTube profile. Official imported metrics are never written here.
create or replace function public.affiliate_my_channel_self(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self(); c public.affiliate_channels; v_platform text;
begin
  v_platform := case when p ->> 'platform' in ('youtube', 'instagram', 'tiktok', 'facebook', 'podcast', 'blog', 'newsletter', 'other') then p ->> 'platform' else 'other' end;
  if coalesce(p ->> 'url', '') !~ '^https://' then raise exception 'url_required' using errcode = '22023'; end if;
  select * into c from public.affiliate_channels where affiliate_id = a.id and is_primary for update;
  if c.id is not null and c.data_source = 'youtube_api' and v_platform = 'youtube' then
    raise exception 'use_correction' using errcode = '22023';   -- imported data: corrections go to review
  end if;
  if c.id is null then
    insert into public.affiliate_channels (affiliate_id, platform, url, handle, title, description, self_reported_audience, data_source)
    values (a.id, v_platform, left(p ->> 'url', 500), nullif(left(btrim(coalesce(p ->> 'handle', '')), 100), ''), nullif(left(btrim(coalesce(p ->> 'title', '')), 200), ''),
      nullif(left(btrim(coalesce(p ->> 'description', '')), 5000), ''), case when (p ->> 'audience') ~ '^[0-9]{1,12}$' then (p ->> 'audience')::bigint end, 'self_reported')
    returning * into c;
  else
    update public.affiliate_channels set platform = v_platform, url = left(p ->> 'url', 500), handle = nullif(left(btrim(coalesce(p ->> 'handle', '')), 100), ''),
      title = nullif(left(btrim(coalesce(p ->> 'title', '')), 200), ''), description = nullif(left(btrim(coalesce(p ->> 'description', '')), 5000), ''),
      self_reported_audience = case when (p ->> 'audience') ~ '^[0-9]{1,12}$' then (p ->> 'audience')::bigint end, data_source = 'self_reported',
      channel_id = null, subscriber_count = null, view_count = null, video_count = null, verified_at = null, verified_method = null
    where id = c.id returning * into c;
  end if;
  return to_jsonb(c);
end $$;

-- YouTube Data API import (service role; p_user = the verified session user). Overwrites official metrics only.
create or replace function public.affiliate_channel_import(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; c public.affiliate_channels; v_code text;
begin
  select * into a from public.affiliates where user_id = p_user and status not in ('suspended', 'terminated', 'rejected');
  if not found then raise exception 'not_affiliate' using errcode = '42501'; end if;
  if coalesce(p ->> 'channel_id', '') !~ '^UC[A-Za-z0-9_-]{22}$' then raise exception 'channel_id_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.affiliate_channels x where x.platform = 'youtube' and x.channel_id = p ->> 'channel_id' and x.affiliate_id <> a.id) then
    raise exception 'channel_claimed' using errcode = '22023';
  end if;
  select * into c from public.affiliate_channels where affiliate_id = a.id and is_primary for update;
  v_code := coalesce(c.verify_code, 'B2B-' || substr(public.affiliate_new_code(), 1, 6));
  if c.id is null then
    insert into public.affiliate_channels (affiliate_id, platform, data_source) values (a.id, 'youtube', 'youtube_api') returning * into c;
  end if;
  update public.affiliate_channels set platform = 'youtube', data_source = 'youtube_api', channel_id = p ->> 'channel_id',
    url = 'https://www.youtube.com/channel/' || (p ->> 'channel_id'), handle = nullif(left(coalesce(p ->> 'handle', ''), 100), ''),
    title = left(coalesce(p ->> 'title', ''), 200), description = left(coalesce(p ->> 'description', ''), 5000),
    thumbnail_url = case when p ->> 'thumbnail_url' ~ '^https://' then left(p ->> 'thumbnail_url', 500) end,
    subscriber_count = case when (p ->> 'subscriber_count') ~ '^[0-9]{1,15}$' then (p ->> 'subscriber_count')::bigint end,
    subscribers_hidden = coalesce((p ->> 'subscribers_hidden')::boolean, false),
    view_count = case when (p ->> 'view_count') ~ '^[0-9]{1,18}$' then (p ->> 'view_count')::bigint end,
    video_count = case when (p ->> 'video_count') ~ '^[0-9]{1,9}$' then (p ->> 'video_count')::integer end,
    channel_country = case when (p ->> 'country') ~ '^[A-Z]{2}$' then p ->> 'country' end,
    fetched_at = now(), verify_code = v_code,
    verified_at = case when c.channel_id is distinct from (p ->> 'channel_id') then null when position(v_code in coalesce(p ->> 'description', '')) > 0 then coalesce(c.verified_at, now()) else c.verified_at end,
    verified_method = case when c.channel_id is distinct from (p ->> 'channel_id') then null when position(v_code in coalesce(p ->> 'description', '')) > 0 then 'description_code' else c.verified_method end
  where id = c.id returning * into c;
  -- Ownership: verified when the code appears in the channel description on this or a later refresh.
  if c.verified_at is null and position(v_code in coalesce(c.description, '')) > 0 then
    update public.affiliate_channels set verified_at = now(), verified_method = 'description_code' where id = c.id returning * into c;
  end if;
  return to_jsonb(c);
end $$;

create or replace function public.affiliate_my_correction(p_field text, p_value text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self(); c public.affiliate_channels; x public.affiliate_channel_corrections;
begin
  select * into c from public.affiliate_channels where affiliate_id = a.id and is_primary;
  if not found then raise exception 'channel_required' using errcode = '22023'; end if;
  if (select count(*) from public.affiliate_channel_corrections where affiliate_id = a.id and status = 'pending') >= 5 then raise exception 'too_many_pending' using errcode = '22023'; end if;
  insert into public.affiliate_channel_corrections (channel_id, affiliate_id, field, current_value, proposed_value, note)
  values (c.id, a.id, p_field, left(case p_field when 'subscriber_count' then c.subscriber_count::text when 'title' then c.title when 'handle' then c.handle
      when 'url' then c.url when 'description' then left(c.description, 500) when 'channel_country' then c.channel_country else null end, 500),
    left(btrim(p_value), 500), nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  returning * into x;
  return to_jsonb(x);
end $$;

create or replace function public.affiliate_my_agreement_accept(p_template uuid, p_body_sha256 text, p_typed_name text, p_ip text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self(); t public.affiliate_agreement_templates;
begin
  select * into t from public.affiliate_agreement_templates where id = p_template and active;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if encode(sha256(convert_to(t.body, 'UTF8')), 'hex') <> p_body_sha256 then raise exception 'agreement_changed' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_typed_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  insert into public.affiliate_agreement_acceptances (affiliate_id, template_id, body_sha256, typed_name, ip, user_agent)
  values (a.id, t.id, p_body_sha256, btrim(p_typed_name), left(p_ip, 64), left(p_user_agent, 300)) on conflict (affiliate_id, template_id) do nothing;
  if found then perform public.affiliate_audit(auth.uid(), 'affiliate.agreement_accepted', a.id::text, jsonb_build_object('version', t.version)); end if;
  return public.affiliate_onboarding(a);
end $$;

-- W-9 (service role; the server seals the TIN first). U.S. persons only for this release.
create or replace function public.affiliate_w9_store(p_user uuid, p_legal_name text, p_business_name text, p_tax_class text, p_exempt_code text,
  p_tin_type text, p_tin_last4 text, p_tin_ciphertext text, p_signed_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates;
begin
  select * into a from public.affiliates where user_id = p_user and status not in ('suspended', 'terminated', 'rejected');
  if not found then raise exception 'not_affiliate' using errcode = '42501'; end if;
  if coalesce(a.country, 'US') <> 'US' or coalesce(a.tax_residency, 'US') <> 'US' then raise exception 'us_only' using errcode = '22023'; end if;
  insert into public.affiliate_tax_profiles (affiliate_id, form, w9_status, w9_legal_name, w9_business_name, w9_tax_class, w9_exempt_payee_code, tin_type, tin_last4, w9_signed_name, w9_signed_at)
  values (a.id, 'w9', 'submitted', left(p_legal_name, 200), nullif(left(p_business_name, 200), ''), p_tax_class, nullif(left(p_exempt_code, 4), ''), p_tin_type, p_tin_last4, left(p_signed_name, 120), now())
  on conflict (affiliate_id) do update set form = 'w9', w9_status = 'submitted', w9_legal_name = excluded.w9_legal_name, w9_business_name = excluded.w9_business_name,
    w9_tax_class = excluded.w9_tax_class, w9_exempt_payee_code = excluded.w9_exempt_payee_code, tin_type = excluded.tin_type, tin_last4 = excluded.tin_last4,
    w9_signed_name = excluded.w9_signed_name, w9_signed_at = now(), w9_verified_at = null, w9_verified_by = null, updated_at = now();
  insert into public.affiliate_tin_secrets (affiliate_id, tin_ciphertext) values (a.id, p_tin_ciphertext)
  on conflict (affiliate_id) do update set tin_ciphertext = excluded.tin_ciphertext, updated_at = now();
  perform public.affiliate_audit(p_user, 'affiliate.w9_submitted', a.id::text, jsonb_build_object('tin_type', p_tin_type, 'last4', p_tin_last4));
  return jsonb_build_object('w9_status', 'submitted');
end $$;

-- Provider-hosted bank onboarding result (service role). Same bank-change hold as staff.
create or replace function public.affiliate_destination_record(p_user uuid, p_provider text, p_mode text, p_recipient_ref text, p_method_ref text,
  p_institution text, p_account_type text, p_last4 text, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; prev public.affiliate_payout_destinations; d public.affiliate_payout_destinations; s public.payout_settings; v_change boolean;
begin
  select * into a from public.affiliates where user_id = p_user and status not in ('suspended', 'terminated', 'rejected');
  if not found then raise exception 'not_affiliate' using errcode = '42501'; end if;
  if coalesce(a.country, 'US') <> 'US' or coalesce(a.tax_residency, 'US') <> 'US' then raise exception 'us_only' using errcode = '22023'; end if;
  select * into s from public.payout_settings where id;
  select * into prev from public.affiliate_payout_destinations where affiliate_id = a.id and mode = p_mode and is_current for update;
  v_change := prev.id is not null and (prev.payout_method_ref is distinct from p_method_ref or prev.recipient_ref is distinct from p_recipient_ref);
  if prev.id is not null and not v_change then
    update public.affiliate_payout_destinations set institution_name = coalesce(p_institution, institution_name), account_type = coalesce(p_account_type, account_type),
      last4 = coalesce(p_last4, last4), status = p_status, verified_at = case when p_status = 'verified' then coalesce(verified_at, now()) else verified_at end
    where id = prev.id returning * into d;
    return jsonb_build_object('changed', false, 'email', a.email, 'name', coalesce(a.display_name, a.legal_name), 'last4', d.last4, 'institution', d.institution_name, 'eligible_from', d.eligible_from, 'id', d.id);
  end if;
  if prev.id is not null then update public.affiliate_payout_destinations set is_current = false, status = 'replaced', replaced_at = now() where id = prev.id; end if;
  insert into public.affiliate_payout_destinations (affiliate_id, provider, mode, recipient_ref, payout_method_ref, institution_name, account_type, last4, status, verified_at, eligible_from)
  values (a.id, p_provider, p_mode, p_recipient_ref, p_method_ref, p_institution, coalesce(p_account_type, 'unknown'), p_last4, p_status,
    case when p_status = 'verified' then now() end, case when v_change then now() + make_interval(hours => s.bank_change_hold_hours) else now() end)
  returning * into d;
  perform public.affiliate_audit(p_user, case when v_change then 'affiliate.bank_changed' else 'affiliate.bank_connected' end, a.id::text,
    jsonb_build_object('mode', p_mode, 'last4', p_last4, 'institution', p_institution, 'hold_until', d.eligible_from));
  return jsonb_build_object('changed', v_change, 'email', a.email, 'name', coalesce(a.display_name, a.legal_name), 'last4', d.last4, 'institution', d.institution_name, 'eligible_from', d.eligible_from, 'id', d.id);
end $$;

create or replace function public.affiliate_my_dispute(p_kind text, p_customer_hint text, p_description text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self(); x public.affiliate_disputes;
begin
  if (select count(*) from public.affiliate_disputes where affiliate_id = a.id and status = 'open') >= 10 then raise exception 'too_many_open' using errcode = '22023'; end if;
  insert into public.affiliate_disputes (affiliate_id, kind, raised_by, customer_hint, description)
  values (a.id, case when p_kind in ('attribution', 'commission', 'payout') then p_kind else 'other' end, 'affiliate', nullif(left(btrim(coalesce(p_customer_hint, '')), 200), ''), left(btrim(p_description), 2000))
  returning * into x;
  perform public.affiliate_audit(auth.uid(), 'affiliate.dispute_opened', a.id::text, jsonb_build_object('dispute', x.id, 'kind', x.kind));
  return jsonb_build_object('id', x.id);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 13. Attribution (service role, from the signed-in layout). One owner per customer across Sales and Affiliates.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.affiliate_record_attribution(p_user uuid, p_code text, p_visit_at timestamptz, p_click uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; cfg public.affiliate_settings; v_email text; v_created timestamptz; k public.affiliate_clicks; v_flags text[] := '{}'; v_ip_signups integer;
begin
  if p_user is null then return 'unknown_code'; end if;
  select * into a from public.affiliates where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if not found then return 'unknown_code'; end if;
  select * into cfg from public.affiliate_settings where id;
  -- Serialize per customer so Sales and Affiliate attribution can't both win a race.
  perform pg_advisory_xact_lock(hashtext('customer_attribution:' || p_user::text));
  if exists (select 1 from public.affiliate_referrals where user_id = p_user) then return 'already_attributed'; end if;
  if exists (select 1 from public.sales_attributions where user_id = p_user) then return 'owned_by_sales'; end if;
  select lower(email), created_at into v_email, v_created from auth.users where id = p_user;
  if not found then return 'unknown_code'; end if;
  -- Self-referral: the affiliate's own login or email, any affiliate, sales staff, or an internal/test account.
  if a.user_id = p_user or v_email = a.email or exists (select 1 from public.affiliates x where x.user_id = p_user) then return 'ineligible:self_referral'; end if;
  if exists (select 1 from public.sales_reps r where r.user_id = p_user and r.status <> 'removed') then return 'ineligible:sales_staff'; end if;
  if public.referral_excluded(p_user) is not null then return 'ineligible:' || public.referral_excluded(p_user); end if;
  if exists (select 1 from public.subscriptions s where s.user_id = p_user) then return 'existing_customer'; end if;
  if p_visit_at is null then return 'no_visit'; end if;
  -- Cookie-stuffing guard: the account must be created AFTER the click (5 minutes clock skew), within the window.
  if v_created < p_visit_at - interval '5 minutes' then return 'existing_account'; end if;
  if v_created > p_visit_at + make_interval(days => cfg.attribution_window_days) then return 'window_expired'; end if;
  if p_click is not null then select * into k from public.affiliate_clicks where id = p_click and affiliate_id = a.id; end if;
  if k.id is null then v_flags := array_append(v_flags, 'click_not_found'); end if;
  if k.ip_hash is not null then
    select count(*) into v_ip_signups from public.affiliate_referrals r join public.affiliate_clicks c on c.id = r.click_id
      where c.ip_hash = k.ip_hash and r.attributed_at > now() - interval '1 day';
    if v_ip_signups >= cfg.max_signups_per_ip_day then v_flags := array_append(v_flags, 'ip_velocity'); end if;
  end if;
  insert into public.affiliate_referrals (user_id, affiliate_id, code, click_id, campaign, source, landing_at, signup_at, flags)
  values (p_user, a.id, a.code, k.id, k.campaign, k.source, coalesce(k.created_at, p_visit_at), v_created, v_flags)
  on conflict (user_id) do nothing;
  if not found then return 'already_attributed'; end if;
  insert into public.affiliate_referral_history (user_id, to_affiliate, action, reason) values (p_user, a.id, 'linked', nullif(array_to_string(v_flags, ','), ''));
  return 'recorded';
end $$;

-- Sales attribution: unchanged except it now also yields to an affiliate who already owns the customer, under the
-- same per-customer lock (one owner per customer).
create or replace function public.sales_record_attribution(p_user uuid, p_code text, p_visit_at timestamptz default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  cfg public.sales_settings;
  v_email text; v_created timestamptz;
begin
  if p_user is null then return 'unknown_code'; end if;
  select * into rep from public.sales_reps where code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if not found then return 'unknown_code'; end if;
  perform pg_advisory_xact_lock(hashtext('customer_attribution:' || p_user::text));
  if exists (select 1 from public.sales_attributions where user_id = p_user) then return 'already_attributed'; end if;
  if exists (select 1 from public.affiliate_referrals where user_id = p_user and ended_at is null) then return 'owned_by_affiliate'; end if;
  select * into cfg from public.sales_settings where id;
  select lower(email), created_at into v_email, v_created from auth.users where id = p_user;
  if not found then return 'unknown_code'; end if;
  if rep.user_id = p_user or v_email = rep.email
     or exists (select 1 from public.sales_reps r where r.user_id = p_user and r.status <> 'removed') then
    return 'ineligible:sales_staff';
  end if;
  if public.referral_excluded(p_user) is not null then return 'ineligible:' || public.referral_excluded(p_user); end if;
  if exists (select 1 from public.subscriptions s where s.user_id = p_user) then return 'existing_customer'; end if;
  if v_created < coalesce(least(p_visit_at, now()), now()) - make_interval(days => cfg.attribution_window_days) then
    return 'existing_account';
  end if;
  insert into public.sales_attributions (user_id, rep_id, source, code) values (p_user, rep.id, 'link', rep.code)
  on conflict (user_id) do nothing;
  if not found then return 'already_attributed'; end if;
  insert into public.sales_attribution_history (user_id, to_rep, action) values (p_user, rep.id, 'linked');
  insert into public.sales_link_events (rep_id, kind, user_id) values (rep.id, 'signup', p_user) on conflict do nothing;
  return 'recorded';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 14. Billing hooks (service role: Stripe webhook). All idempotent; amounts from actual invoices.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.affiliate_sync_subscription(p_user uuid, p_subscription_id text, p_status text, p_plan text, p_list_basis_cents integer, p_canceled_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.affiliate_referrals;
begin
  select * into r from public.affiliate_referrals where user_id = p_user for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  update public.affiliate_referrals set stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id), sub_status = coalesce(p_status, sub_status),
    plan = coalesce(p_plan, plan), list_basis_cents = coalesce(nullif(p_list_basis_cents, 0), list_basis_cents),
    cancel_requested_at = case when p_canceled_at is null and p_status in ('active', 'trialing') then null else coalesce(cancel_requested_at, p_canceled_at) end
  where user_id = p_user;
  return jsonb_build_object('action', 'synced');
end $$;

-- Records one paid invoice of a referred customer, then evaluates the customer's annual events.
create or replace function public.affiliate_record_invoice(p_user uuid, p_invoice_id text, p_subscription_id text, p_billing_reason text, p_paid_at timestamptz,
  p_period_start timestamptz, p_period_end timestamptz, p_period_months numeric, p_gross_cents integer, p_pretax_cents integer,
  p_list_divide_cents integer, p_list_monthly_cents integer, p_detail jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.affiliate_referrals; i public.affiliate_invoices; cfg public.affiliate_settings;
begin
  select * into r from public.affiliate_referrals where user_id = p_user for update;
  if not found then return jsonb_build_object('action', 'none'); end if;
  if p_invoice_id is null or coalesce(p_gross_cents, 0) <= 0 or p_period_end is null or p_period_start is null or p_period_end <= p_period_start then
    return jsonb_build_object('action', 'ignored');
  end if;
  insert into public.affiliate_invoices (invoice_id, user_id, subscription_id, billing_reason, paid_at, period_start, period_end, period_months, gross_cents, pretax_cents,
    list_divide_cents, list_monthly_cents, detail)
  values (p_invoice_id, p_user, p_subscription_id, left(p_billing_reason, 60), coalesce(p_paid_at, now()), public.affiliate_today(p_period_start), public.affiliate_today(p_period_end),
    greatest(coalesce(p_period_months, 1), 0.001), p_gross_cents, greatest(least(coalesce(p_pretax_cents, p_gross_cents), p_gross_cents), 0),
    greatest(coalesce(p_list_divide_cents, 0), 0), greatest(coalesce(p_list_monthly_cents, 0), 0), p_detail)
  on conflict (invoice_id) do nothing;
  if not found then return jsonb_build_object('action', 'duplicate') || public.affiliate_evaluate(p_user, now()); end if;
  select * into i from public.affiliate_invoices where invoice_id = p_invoice_id;
  select * into cfg from public.affiliate_settings where id;
  -- First qualifying payment starts the (never-restarting) term.
  if r.first_paid_at is null and r.ended_at is null and public.affiliate_invoice_qualifies(i) and public.affiliate_invoice_value(i, cfg.annual_basis) > 0 then
    update public.affiliate_referrals set first_paid_at = i.paid_at, first_paid_invoice = i.invoice_id, anniversary_date = public.affiliate_today(i.paid_at),
      term_years = cfg.commission_years, eligibility_end_date = (public.affiliate_today(i.paid_at) + make_interval(years => cfg.commission_years - 1))::date
    where user_id = p_user;
  end if;
  return jsonb_build_object('action', 'recorded') || public.affiliate_evaluate(p_user, now());
end $$;

-- Creates the annual events that are due (idempotent; unique per customer-year). Year 1 from the first qualifying
-- invoice; year N when a qualifying invoice covers the anniversary date; after the grace days without one, ineligible.
create or replace function public.affiliate_evaluate(p_user uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.affiliate_referrals; cfg public.affiliate_settings; a public.affiliates; i public.affiliate_invoices; k integer; v_date date; v_today date;
  v_created integer := 0; v_missed integer := 0; v_amount integer; v_status text; v_reason text;
begin
  select * into r from public.affiliate_referrals where user_id = p_user;
  if not found or r.first_paid_at is null then return jsonb_build_object('created', 0); end if;
  select * into cfg from public.affiliate_settings where id;
  select * into a from public.affiliates where id = r.affiliate_id;
  v_today := public.affiliate_today(p_now);
  for k in 1..r.term_years loop
    v_date := (r.anniversary_date + make_interval(years => k - 1))::date;
    exit when v_date > v_today;
    -- A year already decided stays decided, except "no paid invoice on the anniversary": an invoice recorded late
    -- (webhook outage, backfill) that covers the anniversary turns it into a real commission below.
    continue when exists (select 1 from public.affiliate_commissions where user_id = p_user and year_no = k
      and not (status = 'ineligible' and reason = 'not_paid_on_anniversary'));
    -- A customer whose attribution ended (owner decision) earns nothing for later years.
    if r.ended_at is not null and v_date >= public.affiliate_today(r.ended_at) then
      insert into public.affiliate_commissions (affiliate_id, user_id, year_no, anniversary_date, amount_cents, status, reason, policy_version)
      values (r.affiliate_id, p_user, k, v_date, 0, 'ineligible', 'attribution_ended', public.affiliate_policy_current_version()) on conflict do nothing;
      v_missed := v_missed + 1; continue;
    end if;
    if k = 1 then
      select * into i from public.affiliate_invoices where invoice_id = r.first_paid_invoice;
    else
      select * into i from public.affiliate_invoices x where x.user_id = p_user and public.affiliate_invoice_qualifies(x)
        and x.period_start <= v_date and x.period_end > v_date and public.affiliate_invoice_value(x, cfg.annual_basis) > 0
      order by x.paid_at desc limit 1;
    end if;
    if i.invoice_id is null then
      if v_date + cfg.grace_days < v_today and not exists (select 1 from public.affiliate_commissions where user_id = p_user and year_no = k) then
        insert into public.affiliate_commissions (affiliate_id, user_id, year_no, anniversary_date, amount_cents, status, reason, policy_version)
        values (r.affiliate_id, p_user, k, v_date, 0, 'ineligible', 'not_paid_on_anniversary', public.affiliate_policy_current_version()) on conflict do nothing;
        if found then v_missed := v_missed + 1; end if;
      end if;
      continue;
    end if;
    v_amount := public.affiliate_invoice_value(i, cfg.annual_basis);
    v_status := 'pending'; v_reason := null;
    if a.status = 'terminated' and (a.termination_kind = 'material_misconduct' or cfg.termination_future = 'stop_all') and v_date >= public.affiliate_today(a.status_changed_at) then
      v_status := 'ineligible'; v_reason := 'affiliate_terminated';
    end if;
    insert into public.affiliate_commissions (affiliate_id, user_id, year_no, anniversary_date, invoice_id, amount_cents, basis, status, reason, hold_until, policy_version)
    values (r.affiliate_id, p_user, k, v_date, i.invoice_id, case when v_status = 'pending' then v_amount else 0 end,
      jsonb_build_object('invoice', i.invoice_id, 'pretax_cents', i.pretax_cents, 'refunded_cents', i.refunded_cents, 'period_months', i.period_months,
        'list_divide_cents', i.list_divide_cents, 'list_monthly_cents', i.list_monthly_cents, 'annual_basis', cfg.annual_basis, 'rule', 'round(L * min(1, P / (Ld * M)))'),
      v_status, v_reason, greatest(i.paid_at, v_date::timestamp at time zone 'America/Chicago') + make_interval(days => cfg.hold_days), public.affiliate_policy_current_version())
    on conflict (user_id, year_no) do update set invoice_id = excluded.invoice_id, amount_cents = excluded.amount_cents, basis = excluded.basis,
      status = excluded.status, reason = coalesce(excluded.reason, 'late_invoice'), hold_until = greatest(excluded.hold_until, now() + make_interval(days => cfg.hold_days))
    where affiliate_commissions.status = 'ineligible' and affiliate_commissions.reason = 'not_paid_on_anniversary';
    if found then v_created := v_created + 1; end if;
    i := null;
  end loop;
  return jsonb_build_object('created', v_created, 'ineligible', v_missed);
end $$;

-- Refunds (charge.refunded) and chargebacks (dispute events) on a referred customer's invoice.
create or replace function public.affiliate_invoice_refunded(p_invoice_id text, p_refunded_cents integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.affiliate_invoices; c public.affiliate_commissions;
begin
  update public.affiliate_invoices set refunded_cents = greatest(refunded_cents, least(coalesce(p_refunded_cents, 0), gross_cents)) where invoice_id = p_invoice_id returning * into i;
  if not found then return jsonb_build_object('action', 'none'); end if;
  for c in select * from public.affiliate_commissions where invoice_id = p_invoice_id and status in ('paid') for update loop
    update public.affiliate_commissions set review_flag = left('refund after payout: ' || i.refunded_cents || ' of ' || i.gross_cents || ' cents', 300) where id = c.id;
    perform public.affiliate_audit(null, 'affiliate.refund_after_payout', c.affiliate_id::text, jsonb_build_object('commission', c.id, 'invoice', p_invoice_id));
  end loop;
  return jsonb_build_object('action', 'recorded') || public.affiliate_mature(now(), (select user_id from public.affiliate_invoices where invoice_id = p_invoice_id));
end $$;

create or replace function public.affiliate_invoice_disputed(p_invoice_id text, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.affiliate_invoices;
begin
  if p_status not in ('open', 'won', 'lost') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.affiliate_invoices set dispute_status = p_status where invoice_id = p_invoice_id returning * into i;
  if not found then return jsonb_build_object('action', 'none'); end if;
  if p_status in ('open', 'lost') then
    update public.affiliate_commissions set review_flag = left('chargeback ' || p_status || ' after payout', 300) where invoice_id = p_invoice_id and status = 'paid';
  end if;
  return jsonb_build_object('action', 'recorded') || public.affiliate_mature(now(), i.user_id);
end $$;

-- After the hold: re-check and move to payable (or reverse). Also releases/holds for affiliate status changes.
-- p_user limits the sweep to one customer (webhook path); null = all (daily job).
create or replace function public.affiliate_mature(p_now timestamptz default now(), p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.affiliate_commissions; i public.affiliate_invoices; a public.affiliates; r public.affiliate_referrals; cfg public.affiliate_settings;
  v_amount integer; v_payable integer := 0; v_reversed integer := 0; v_held integer := 0;
begin
  select * into cfg from public.affiliate_settings where id;
  for c in select * from public.affiliate_commissions where status in ('pending', 'payable') and (p_user is null or user_id = p_user) order by created_at for update skip locked loop
    select * into i from public.affiliate_invoices where invoice_id = c.invoice_id;
    select * into a from public.affiliates where id = c.affiliate_id;
    select * into r from public.affiliate_referrals where user_id = c.user_id;
    v_amount := case when i.invoice_id is null then 0 else public.affiliate_invoice_value(i, (c.basis ->> 'annual_basis')) end;
    if c.status = 'pending' then
      if i.dispute_status = 'open' then continue; end if;                      -- wait for the dispute outcome
      if v_amount <= 0 then
        update public.affiliate_commissions set status = 'reversed', amount_cents = 0, reason = case when i.dispute_status = 'lost' then 'chargeback' else 'refunded' end where id = c.id;
        v_reversed := v_reversed + 1; continue;
      end if;
      if c.hold_until > p_now then
        if v_amount < c.amount_cents then update public.affiliate_commissions set amount_cents = v_amount, reason = 'partial_refund' where id = c.id; end if;
        continue;
      end if;
      if a.status = 'terminated' and a.termination_kind = 'material_misconduct' then
        update public.affiliate_commissions set status = 'held', reason = 'affiliate_terminated_misconduct_review' where id = c.id; v_held := v_held + 1; continue;
      end if;
      if a.status = 'suspended' then
        update public.affiliate_commissions set status = 'held', reason = 'affiliate_suspended' where id = c.id; v_held := v_held + 1; continue;
      end if;
      if 'self_referral_suspected' = any (r.flags) then
        update public.affiliate_commissions set status = 'held', reason = 'attribution_review' where id = c.id; v_held := v_held + 1; continue;
      end if;
      update public.affiliate_commissions set status = 'payable', payable_at = p_now, amount_cents = least(c.amount_cents, v_amount),
        reason = case when v_amount < c.amount_cents then 'partial_refund' else reason end where id = c.id;
      v_payable := v_payable + 1;
    elsif c.status = 'payable' and c.payout_id is null then
      -- Payable but not yet in a payout: a refund or chargeback now still stops it (nothing was paid).
      if v_amount <= 0 or i.dispute_status in ('open', 'lost') then
        update public.affiliate_commissions set status = 'reversed', amount_cents = 0, reason = case when i.dispute_status is not null then 'chargeback' else 'refunded' end where id = c.id;
        v_reversed := v_reversed + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('payable', v_payable, 'reversed', v_reversed, 'held', v_held);
end $$;

-- Daily job: evaluate every referred customer with a first payment, then mature.
create or replace function public.affiliate_daily(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_created integer := 0; v_missed integer := 0; e jsonb; m jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('affiliate_daily')) then return jsonb_build_object('skipped', 'locked'); end if;
  for r in select user_id from public.affiliate_referrals where first_paid_at is not null loop
    e := public.affiliate_evaluate(r.user_id, p_now);
    v_created := v_created + coalesce((e ->> 'created')::int, 0); v_missed := v_missed + coalesce((e ->> 'ineligible')::int, 0);
  end loop;
  m := public.affiliate_mature(p_now, null);
  return jsonb_build_object('created', v_created, 'ineligible', v_missed) || m;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 15. Payouts (reuses the V8.1 ledger). Planner groups payable lines per affiliate into one payout.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.affiliate_payout_blockers(p_affiliate uuid, p_mode text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare a public.affiliates; t public.affiliate_tax_profiles; d public.affiliate_payout_destinations; v text[] := '{}'; cfg public.affiliate_settings;
begin
  select * into cfg from public.affiliate_settings where id;
  select * into a from public.affiliates where id = p_affiliate;
  if not found then return array['no_affiliate']; end if;
  if not cfg.payouts_enabled then v := array_append(v, 'affiliate_payouts_off'); end if;
  if a.status = 'suspended' then v := array_append(v, 'suspended');
  elsif a.status = 'terminated' and a.termination_kind = 'material_misconduct' then v := array_append(v, 'terminated_review');
  elsif a.status not in ('active', 'terminated') then v := array_append(v, 'not_active'); end if;
  if coalesce(a.country, 'US') <> 'US' or coalesce(a.tax_residency, 'US') <> 'US' then v := array_append(v, 'unsupported_country'); end if;
  if not exists (select 1 from public.affiliate_agreement_acceptances x where x.affiliate_id = a.id) then v := array_append(v, 'agreement_missing'); end if;
  select * into t from public.affiliate_tax_profiles where affiliate_id = a.id;
  if coalesce(t.w9_status, 'not_started') not in ('submitted', 'verified') then v := array_append(v, 'w9_missing'); end if;
  select * into d from public.affiliate_payout_destinations where affiliate_id = a.id and mode = p_mode and is_current;
  if d.id is null then v := array_append(v, 'no_bank');
  elsif d.status <> 'verified' then v := array_append(v, 'bank_unverified');
  elsif d.eligible_from > now() then v := array_append(v, 'bank_change_hold'); end if;
  return v;
end $$;

create or replace function public.affiliate_payout_plan(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; cfg public.affiliate_settings; f public.payout_fee_policies; r record; p public.payouts; v_mode text; v_created integer := 0;
  v_blockers text[]; v_status text; v_fee integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('affiliate_payout_plan')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into s from public.payout_settings where id;
  select * into cfg from public.affiliate_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off'); end if;
  if not cfg.payouts_enabled then return jsonb_build_object('skipped', 'affiliate_payouts_off'); end if;
  v_mode := s.mode;
  select * into f from public.payout_fee_policies where id = s.fee_policy_id;
  for r in
    select c.affiliate_id, array_agg(c.id order by c.anniversary_date) as lines, sum(c.amount_cents)::integer as total
    from public.affiliate_commissions c
    where c.status = 'payable' and c.payout_id is null and c.amount_cents > 0
      and not exists (select 1 from public.payout_items i where i.mode = v_mode and i.source_kind = 'affiliate_commission' and i.source_id = c.id and i.active)
    group by c.affiliate_id
    having sum(c.amount_cents) >= cfg.min_payout_cents
  loop
    v_blockers := public.affiliate_payout_blockers(r.affiliate_id, v_mode);
    v_fee := public.payout_fee_cents(r.total, 'standard', f);
    v_status := case when cardinality(v_blockers) > 0 then 'held' when r.total > s.review_above_cents then 'needs_approval' else 'scheduled' end;
    insert into public.payouts (ref, affiliate_id, mode, provider, gross_cents, fee_cents, fee_bearer, fee_reason, fee_policy_version, net_cents, status, hold_reasons,
      scheduled_for, idempotency_key, funding_source)
    values ('B2B-AF-' || to_char(p_now at time zone 'America/Chicago', 'YYYYMM') || '-' || lpad(nextval('public.payout_ref_seq')::text, 6, '0') || case when v_mode = 'test' then '-T' else '' end,
      r.affiliate_id, v_mode, s.provider, r.total, v_fee, 'company', 'affiliate_program', f.version, r.total, v_status, v_blockers,
      ((p_now at time zone 'America/Chicago')::date + s.pay_delay_days), gen_random_uuid()::text, s.funding_label)
    returning * into p;
    insert into public.payout_items (payout_id, mode, source_kind, source_id, amount_cents, description)
    select p.id, v_mode, 'affiliate_commission', c.id, c.amount_cents, 'Year ' || c.year_no || ' commission (' || to_char(c.anniversary_date, 'Mon DD, YYYY') || ')'
    from public.affiliate_commissions c where c.id = any (r.lines);
    if v_mode = 'live' then update public.affiliate_commissions set payout_id = p.id where id = any (r.lines); end if;
    v_created := v_created + 1;
  end loop;
  -- Re-check held affiliate payouts.
  for p in select * from public.payouts where status = 'held' and mode = v_mode and affiliate_id is not null for update skip locked loop
    v_blockers := public.affiliate_payout_blockers(p.affiliate_id, v_mode);
    if cardinality(v_blockers) = 0 then
      update public.payouts set status = case when p.gross_cents > s.review_above_cents and p.approved_at is null then 'needs_approval' else 'scheduled' end, hold_reasons = '{}' where id = p.id;
    elsif v_blockers is distinct from p.hold_reasons then
      update public.payouts set hold_reasons = v_blockers where id = p.id;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'mode', v_mode);
end $$;

-- Claim due payouts (staff AND affiliate). Identical to 20270207001000 except the payee's blockers and destination
-- come from the affiliate tables for affiliate payouts.
create or replace function public.payout_claim_due(p_limit integer default 25, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_settings; p public.payouts; d_ref text; d_method text; d_id uuid; v_out jsonb := '[]'; v_today_cents bigint; v_blockers text[];
begin
  select * into s from public.payout_settings where id;
  if s.mode = 'off' then return jsonb_build_object('skipped', 'automation_off', 'payouts', '[]'::jsonb); end if;
  if s.paused then return jsonb_build_object('skipped', 'paused', 'payouts', '[]'::jsonb); end if;
  if s.mode = 'live' and (s.live_activated_at is null or s.provider = 'mock') then return jsonb_build_object('skipped', 'live_not_activated', 'payouts', '[]'::jsonb); end if;
  update public.payouts set status = 'scheduled', locked_at = null where status = 'submitting' and locked_at < p_now - interval '15 minutes' and mode = s.mode;
  select coalesce(sum(net_cents), 0) into v_today_cents from public.payouts
    where mode = s.mode and status in ('submitting', 'submitted', 'paid') and (submitted_at at time zone 'America/Chicago')::date = (p_now at time zone 'America/Chicago')::date;
  for p in select * from public.payouts where mode = s.mode and status = 'scheduled' and scheduled_for <= (p_now at time zone 'America/Chicago')::date
           and (next_attempt_at is null or next_attempt_at <= p_now) order by scheduled_for, created_at limit greatest(1, least(p_limit, 100)) for update skip locked loop
    v_blockers := case when p.affiliate_id is not null then public.affiliate_payout_blockers(p.affiliate_id, s.mode) else public.payout_blockers(p.staff_id, s.mode) end;
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
    if p.affiliate_id is not null then
      select id, recipient_ref, payout_method_ref into d_id, d_ref, d_method from public.affiliate_payout_destinations where affiliate_id = p.affiliate_id and mode = s.mode and is_current;
      update public.payouts set status = 'submitting', locked_at = p_now, attempts = attempts + 1, affiliate_destination_id = d_id, hold_reasons = '{}' where id = p.id;
    else
      select id, recipient_ref, payout_method_ref into d_id, d_ref, d_method from public.staff_payout_destinations where staff_id = p.staff_id and mode = s.mode and is_current;
      update public.payouts set status = 'submitting', locked_at = p_now, attempts = attempts + 1, destination_id = d_id, hold_reasons = '{}' where id = p.id;
    end if;
    v_today_cents := v_today_cents + p.net_cents;
    v_out := v_out || jsonb_build_object('id', p.id, 'ref', p.ref, 'net_cents', p.net_cents, 'idempotency_key', p.idempotency_key, 'provider', p.provider,
      'mode', p.mode, 'recipient_ref', d_ref, 'payout_method_ref', d_method, 'attempts', p.attempts + 1);
  end loop;
  return jsonb_build_object('mode', s.mode, 'provider', s.provider, 'payouts', v_out);
end $$;

-- Provider evidence: identical to 20270207001000 for staff payouts; affiliate payouts mark their commission lines paid
-- (live only) and release them on failure/return so they are paid again (never lost, never doubled).
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
      update public.affiliate_commissions c set status = 'paid', paid_at = p_occurred_at, payout_id = p.id
      from public.payout_items i where i.payout_id = p.id and i.source_kind = 'affiliate_commission' and i.active and i.source_id = c.id and c.status = 'payable';
    end if;
  elsif p_kind in ('failed', 'canceled') then
    update public.payouts set status = p_kind, failed_at = p_occurred_at, failure_code = left(p_failure_code, 80) where id = p.id;
    update public.payout_items set active = false where payout_id = p.id;
    update public.affiliate_commissions set payout_id = null where payout_id = p.id and status = 'payable';
    if p_failure_code in ('account_closed', 'invalid_account_number', 'no_account', 'recipient_rejected') then
      update public.staff_payout_destinations set status = 'failed' where id = p.destination_id;
      update public.affiliate_payout_destinations set status = 'failed' where id = p.affiliate_destination_id;
    end if;
  elsif p_kind = 'returned' then
    update public.payouts set status = 'returned', failed_at = p_occurred_at, failure_code = left(p_failure_code, 80) where id = p.id;
    update public.payout_items set active = false where payout_id = p.id;
    update public.staff_payout_destinations set status = 'failed' where id = p.destination_id;
    update public.affiliate_payout_destinations set status = 'failed' where id = p.affiliate_destination_id;
    if p.mode = 'live' then
      for st in select i.source_id from public.payout_items i where i.payout_id = p.id and i.source_kind = 'sales_statement' loop
        delete from public.sales_payouts where statement_id = st.source_id and reference like p.ref || ' / %';
        update public.sales_commissions set status = 'approved', paid_at = null, updated_at = now() where statement_id = st.source_id and status = 'paid';
        update public.sales_statements set status = 'approved', paid_at = null where id = st.source_id and status = 'paid';
      end loop;
      update public.affiliate_commissions set status = 'payable', paid_at = null, payout_id = null where payout_id = p.id and status = 'paid';
    end if;
  else
    update public.payouts set status = case when status = 'submitting' then 'submitted' else status end where id = p.id;
  end if;
  perform public.staff_audit(null, 'payout.' || p_kind, 'payout', p.id::text, jsonb_build_object('ref', p.ref, 'mode', p.mode, 'event', p_event_id, 'source', p_source));
  return jsonb_build_object('status', 'applied', 'payout_id', p.id, 'staff_id', p.staff_id, 'affiliate_id', p.affiliate_id, 'kind', p_kind, 'mode', p.mode);
end $$;

create or replace function public.payout_json(p public.payouts) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'idempotency_key' - 'locked_at' || jsonb_build_object(
    'staff_name', coalesce((select coalesce(m.preferred_name, m.display_name) from public.staff_members m where m.id = p.staff_id),
      (select 'Affiliate: ' || coalesce(a.display_name, a.legal_name, a.email) from public.affiliates a where a.id = p.affiliate_id)),
    'destination', coalesce((select jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'account_type', d.account_type) from public.staff_payout_destinations d where d.id = p.destination_id),
      (select jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'account_type', d.account_type) from public.affiliate_payout_destinations d where d.id = p.affiliate_destination_id)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('source_kind', i.source_kind, 'source_id', i.source_id, 'amount_cents', i.amount_cents, 'description', i.description, 'active', i.active)
      order by i.created_at) from public.payout_items i where i.payout_id = p.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------
-- 16. Affiliate dashboard data (authenticated; privacy-safe customer identifiers only)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.affiliate_my_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.affiliates := public.affiliate_self(); cfg public.affiliate_settings; v_mode text;
begin
  select * into cfg from public.affiliate_settings where id;
  select case when mode = 'live' then 'live' else 'test' end into v_mode from public.payout_settings where id;
  return jsonb_build_object(
    'affiliate', jsonb_build_object('id', a.id, 'code', a.code, 'status', a.status, 'name', coalesce(a.display_name, a.legal_name), 'email', a.email, 'phone', a.phone,
      'contact_pref', a.contact_pref, 'marketing_opt_in', a.marketing_opt_in, 'country', a.country),
    'policy', public.affiliate_policy_snapshot(cfg),
    'today', public.affiliate_today(now()),
    'channel', (select jsonb_build_object('platform', c.platform, 'title', c.title, 'url', c.url, 'thumbnail_url', c.thumbnail_url, 'subscriber_count', c.subscriber_count,
        'subscribers_hidden', c.subscribers_hidden, 'self_reported_audience', c.self_reported_audience, 'data_source', c.data_source, 'fetched_at', c.fetched_at, 'verified', c.verified_at is not null)
      from public.affiliate_channels c where c.affiliate_id = a.id and c.is_primary),
    'tax', (select jsonb_build_object('w9_status', t.w9_status, 'tin_last4', t.tin_last4) from public.affiliate_tax_profiles t where t.affiliate_id = a.id),
    'payout', jsonb_build_object('blockers', to_jsonb(public.affiliate_payout_blockers(a.id, v_mode)), 'enabled', cfg.payouts_enabled,
      'destination', (select jsonb_build_object('institution_name', d.institution_name, 'last4', d.last4, 'status', d.status, 'eligible_from', d.eligible_from)
        from public.affiliate_payout_destinations d where d.affiliate_id = a.id and d.mode = v_mode and d.is_current)),
    'clicks', jsonb_build_object('total', (select count(*) from public.affiliate_clicks where affiliate_id = a.id),
      'last_30', (select count(*) from public.affiliate_clicks where affiliate_id = a.id and created_at > now() - interval '30 days'),
      'by_campaign', coalesce((select jsonb_object_agg(coalesce(campaign, '(none)'), n) from (select campaign, count(*) n from public.affiliate_clicks where affiliate_id = a.id group by campaign) z), '{}'::jsonb)),
    'referrals', coalesce((select jsonb_agg(jsonb_build_object(
        'key', substr(md5(r.user_id::text || a.id::text), 1, 10),
        'label', 'Customer ' || upper(substr(md5(r.user_id::text || a.id::text), 1, 6)),
        'business_initial', upper(left(coalesce(nullif(bp.company_name, ''), 'C'), 1)),
        'referred_at', r.attributed_at, 'campaign', r.campaign, 'status', case when r.ended_at is not null then 'ended' when r.first_paid_at is null then 'free' else coalesce(r.sub_status, 'unknown') end,
        'plan', case when r.plan is null then null when r.plan ilike '%enterprise%' or r.plan ilike '%team%' then 'Team' when r.plan ilike '%annual%' then 'Annual' else 'Monthly' end,
        'first_paid_on', public.affiliate_today(r.first_paid_at), 'anniversary_date', r.anniversary_date, 'term_years', r.term_years, 'eligibility_end_date', r.eligibility_end_date,
        'cancel_requested', r.cancel_requested_at is not null,
        'expected_cents', (select public.affiliate_invoice_value(x, cfg.annual_basis) from public.affiliate_invoices x where x.user_id = r.user_id and public.affiliate_invoice_qualifies(x) order by x.paid_at desc limit 1),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'year_no', c.year_no, 'date', c.anniversary_date, 'amount_cents', c.amount_cents, 'status', c.status,
            'reason', c.reason, 'hold_until', c.hold_until, 'paid_at', c.paid_at, 'payable_at', c.payable_at) order by c.year_no)
          from public.affiliate_commissions c where c.user_id = r.user_id and c.affiliate_id = a.id), '[]'::jsonb)
      ) order by r.attributed_at desc)
      from public.affiliate_referrals r left join public.business_profiles bp on bp.user_id = r.user_id where r.affiliate_id = a.id), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('ref', p.ref, 'mode', p.mode, 'status', p.status, 'gross_cents', p.gross_cents, 'net_cents', p.net_cents,
        'scheduled_for', p.scheduled_for, 'settled_at', p.settled_at, 'failure_code', p.failure_code) order by p.created_at desc)
      from public.payouts p where p.affiliate_id = a.id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'amount_cents', x.amount_cents, 'status', x.status, 'reason', x.reason, 'created_at', x.created_at) order by x.created_at desc)
      from public.affiliate_adjustments x where x.affiliate_id = a.id and x.status <> 'void'), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'description', x.description, 'resolution', x.resolution, 'created_at', x.created_at) order by x.created_at desc)
      from public.affiliate_disputes x where x.affiliate_id = a.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 17. Owner (platform super-admin) functions (service role; re-check is_admin)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_affiliates_overview(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.affiliate_settings;
begin
  perform public.affiliate_require_admin(p_caller);
  select * into cfg from public.affiliate_settings where id;
  return jsonb_build_object(
    'settings', to_jsonb(cfg),
    'policy_versions', coalesce((select jsonb_agg(to_jsonb(v) order by v.version desc) from public.affiliate_policy_versions v), '[]'::jsonb),
    'agreement', (select jsonb_build_object('id', t.id, 'version', t.version, 'title', t.title, 'legal_status', t.legal_status, 'accepted', (select count(*) from public.affiliate_agreement_acceptances x where x.template_id = t.id))
      from public.affiliate_agreement_templates t where t.active),
    'affiliates', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'email', a.email, 'code', a.code, 'status', a.status, 'source', a.source,
        'name', coalesce(a.display_name, a.legal_name), 'legal_name', a.legal_name, 'country', a.country, 'created_at', a.created_at, 'submitted_at', a.submitted_at, 'approved_at', a.approved_at,
        'channel', (select jsonb_build_object('title', c.title, 'url', c.url, 'platform', c.platform, 'subscriber_count', c.subscriber_count, 'self_reported_audience', c.self_reported_audience,
            'data_source', c.data_source, 'verified', c.verified_at is not null, 'fetched_at', c.fetched_at) from public.affiliate_channels c where c.affiliate_id = a.id and c.is_primary),
        'onboarding', public.affiliate_onboarding(a),
        'clicks', (select count(*) from public.affiliate_clicks k where k.affiliate_id = a.id),
        'signups', (select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id),
        'paying', (select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id and r.first_paid_at is not null and r.ended_at is null and r.sub_status in ('active', 'past_due', 'trialing')),
        'earned_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.affiliate_id = a.id and c.status in ('payable', 'paid')),
        'pending_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.affiliate_id = a.id and c.status = 'pending'),
        'paid_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.affiliate_id = a.id and c.status = 'paid'),
        'agreement_version', (select max(t.version) from public.affiliate_agreement_acceptances x join public.affiliate_agreement_templates t on t.id = x.template_id where x.affiliate_id = a.id)
      ) order by a.created_at desc) from public.affiliates a), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'affiliate', coalesce(a.display_name, a.legal_name, a.email), 'field', x.field, 'current_value', x.current_value,
        'proposed_value', x.proposed_value, 'note', x.note, 'status', x.status, 'created_at', x.created_at) order by x.created_at desc)
      from public.affiliate_channel_corrections x join public.affiliates a on a.id = x.affiliate_id where x.status = 'pending'), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'affiliate', coalesce(a.display_name, a.legal_name, a.email), 'affiliate_id', x.affiliate_id, 'kind', x.kind,
        'raised_by', x.raised_by, 'customer_hint', x.customer_hint, 'description', x.description, 'status', x.status, 'resolution', x.resolution, 'outcome', x.outcome, 'created_at', x.created_at,
        'customer_email', (select email from auth.users u where u.id = x.user_id)) order by x.created_at desc)
      from public.affiliate_disputes x left join public.affiliates a on a.id = x.affiliate_id), '[]'::jsonb),
    'referrals', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'email', u.email, 'business', nullif(bp.company_name, ''), 'affiliate_id', r.affiliate_id,
        'affiliate', coalesce(a.display_name, a.legal_name, a.email), 'attributed_at', r.attributed_at, 'campaign', r.campaign, 'flags', r.flags, 'sub_status', r.sub_status, 'plan', r.plan,
        'first_paid_at', r.first_paid_at, 'anniversary_date', r.anniversary_date, 'eligibility_end_date', r.eligibility_end_date, 'ended_at', r.ended_at, 'ended_reason', r.ended_reason) order by r.attributed_at desc)
      from public.affiliate_referrals r join public.affiliates a on a.id = r.affiliate_id join auth.users u on u.id = r.user_id left join public.business_profiles bp on bp.user_id = r.user_id), '[]'::jsonb),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'affiliate', coalesce(a.display_name, a.legal_name, a.email), 'affiliate_id', c.affiliate_id, 'email', u.email,
        'year_no', c.year_no, 'anniversary_date', c.anniversary_date, 'amount_cents', c.amount_cents, 'status', c.status, 'reason', c.reason, 'hold_until', c.hold_until,
        'review_flag', c.review_flag, 'payout_id', c.payout_id, 'invoice_id', c.invoice_id, 'basis', c.basis, 'policy_version', c.policy_version) order by c.anniversary_date desc)
      from public.affiliate_commissions c join public.affiliates a on a.id = c.affiliate_id join auth.users u on u.id = c.user_id), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(public.payout_json(p) order by p.created_at desc) from public.payouts p where p.affiliate_id is not null), '[]'::jsonb),
    'compliance', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'affiliate', coalesce(a.display_name, a.legal_name, a.email), 'kind', x.kind, 'evidence_url', x.evidence_url,
        'description', x.description, 'status', x.status, 'action_taken', x.action_taken, 'created_at', x.created_at) order by x.created_at desc)
      from public.affiliate_compliance_cases x join public.affiliates a on a.id = x.affiliate_id), '[]'::jsonb));
end $$;

create or replace function public.admin_affiliate_decide(p_caller uuid, p_id uuid, p_decision text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates;
begin
  perform public.affiliate_require_admin(p_caller);
  select * into a from public.affiliates where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if p_decision = 'approve' then
    if a.status not in ('applied', 'pending_review', 'onboarding', 'invited') then raise exception 'bad_state' using errcode = '22023'; end if;
    -- An applicant is approved to START onboarding; a submitted onboarding is approved to go ACTIVE.
    update public.affiliates set status = case when a.submitted_at is not null then 'active' else 'onboarding' end,
      approved_at = case when a.submitted_at is not null then now() else approved_at end, approved_by = p_caller, status_reason = nullif(left(btrim(coalesce(p_reason, '')), 1000), ''), status_changed_at = now()
    where id = p_id returning * into a;
  elsif p_decision = 'reject' then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
    update public.affiliates set status = 'rejected', status_reason = left(btrim(p_reason), 1000), status_changed_at = now() where id = p_id returning * into a;
  else raise exception 'bad_decision' using errcode = '22023'; end if;
  perform public.affiliate_audit(p_caller, 'affiliate.' || p_decision, p_id::text, jsonb_build_object('status', a.status, 'reason', p_reason));
  return to_jsonb(a);
end $$;

create or replace function public.admin_affiliate_set_status(p_caller uuid, p_id uuid, p_status text, p_kind text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates;
begin
  perform public.affiliate_require_admin(p_caller);
  if p_status not in ('active', 'suspended', 'terminated') then raise exception 'bad_status' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_status = 'terminated' and p_kind not in ('without_cause', 'material_misconduct', 'affiliate_resigned') then raise exception 'kind_required' using errcode = '22023'; end if;
  select * into a from public.affiliates where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if a.status = 'terminated' then raise exception 'already_terminated' using errcode = '22023'; end if;
  if p_status = 'active' and a.status <> 'suspended' then raise exception 'bad_state' using errcode = '22023'; end if;
  update public.affiliates set status = p_status, termination_kind = case when p_status = 'terminated' then p_kind end, status_reason = left(btrim(p_reason), 1000), status_changed_at = now()
  where id = p_id returning * into a;
  -- Resume: held lines from a suspension go back to pending (re-checked at the next maturity run).
  if p_status = 'active' then update public.affiliate_commissions set status = 'pending', reason = null where affiliate_id = p_id and status = 'held' and reason = 'affiliate_suspended'; end if;
  -- Misconduct: unpaid payable lines are held for review (never silently forfeited).
  if p_status = 'terminated' and p_kind = 'material_misconduct' then
    update public.affiliate_commissions set status = 'held', reason = 'affiliate_terminated_misconduct_review' where affiliate_id = p_id and status in ('pending', 'payable') and payout_id is null;
  end if;
  perform public.affiliate_audit(p_caller, 'affiliate.status_' || p_status, p_id::text, jsonb_build_object('kind', p_kind, 'reason', p_reason));
  return to_jsonb(a);
end $$;

create or replace function public.admin_affiliate_correction_review(p_caller uuid, p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.affiliate_channel_corrections;
begin
  perform public.affiliate_require_admin(p_caller);
  select * into x from public.affiliate_channel_corrections where id = p_id and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  update public.affiliate_channel_corrections set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = p_caller, reviewed_at = now(),
    review_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '') where id = p_id;
  if p_approve then
    update public.affiliate_channels set
      subscriber_count = case when x.field = 'subscriber_count' and x.proposed_value ~ '^[0-9]{1,15}$' then x.proposed_value::bigint else subscriber_count end,
      title = case when x.field = 'title' then left(x.proposed_value, 200) else title end,
      handle = case when x.field = 'handle' then left(x.proposed_value, 100) else handle end,
      url = case when x.field = 'url' and x.proposed_value ~ '^https://' then left(x.proposed_value, 500) else url end,
      description = case when x.field = 'description' then x.proposed_value else description end,
      channel_country = case when x.field = 'channel_country' and upper(x.proposed_value) ~ '^[A-Z]{2}$' then upper(x.proposed_value) else channel_country end,
      data_source = case when x.field = 'subscriber_count' then 'admin_corrected' else data_source end
    where id = x.channel_id;
  end if;
  perform public.affiliate_audit(p_caller, 'affiliate.correction_' || case when p_approve then 'approved' else 'rejected' end, x.affiliate_id::text,
    jsonb_build_object('field', x.field, 'from', x.current_value, 'to', x.proposed_value));
end $$;

create or replace function public.admin_affiliate_channel_verify(p_caller uuid, p_affiliate uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.affiliate_require_admin(p_caller);
  update public.affiliate_channels set verified_at = now(), verified_method = 'admin_review' where affiliate_id = p_affiliate and is_primary;
  perform public.affiliate_audit(p_caller, 'affiliate.channel_verified', p_affiliate::text, null);
end $$;

-- Disputed attribution / commission: one decision with an audit trail. Reassignment never moves lines already created.
create or replace function public.admin_affiliate_dispute_resolve(p_caller uuid, p_id uuid, p_outcome text, p_resolution text, p_target_affiliate uuid default null, p_target_rep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x public.affiliate_disputes; r public.affiliate_referrals;
begin
  perform public.affiliate_require_admin(p_caller);
  if char_length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'resolution_required' using errcode = '22023'; end if;
  select * into x from public.affiliate_disputes where id = p_id and status = 'open' for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if x.user_id is not null then select * into r from public.affiliate_referrals where user_id = x.user_id for update; end if;
  if p_outcome = 'reassigned_affiliate' then
    if r.user_id is null or p_target_affiliate is null then raise exception 'target_required' using errcode = '22023'; end if;
    update public.affiliate_referrals set affiliate_id = p_target_affiliate, attribution_source = 'admin' where user_id = r.user_id;
    insert into public.affiliate_referral_history (user_id, from_affiliate, to_affiliate, action, reason, actor) values (r.user_id, r.affiliate_id, p_target_affiliate, 'dispute_resolved', p_resolution, p_caller);
  elsif p_outcome = 'moved_to_sales' then
    if r.user_id is null or p_target_rep is null then raise exception 'target_required' using errcode = '22023'; end if;
    update public.affiliate_referrals set ended_at = now(), ended_reason = 'moved_to_sales: ' || left(p_resolution, 200) where user_id = r.user_id;
    insert into public.affiliate_referral_history (user_id, from_affiliate, action, reason, actor) values (r.user_id, r.affiliate_id, 'dispute_resolved', p_resolution, p_caller);
    insert into public.sales_attributions (user_id, rep_id, source) values (r.user_id, p_target_rep, 'manual') on conflict (user_id) do nothing;
    insert into public.sales_attribution_history (user_id, to_rep, action, reason) values (r.user_id, p_target_rep, 'assigned', 'affiliate dispute: ' || left(p_resolution, 200));
    update public.affiliate_commissions set status = 'canceled', reason = 'attribution_moved' where user_id = r.user_id and status in ('pending', 'payable') and payout_id is null;
  elsif p_outcome = 'removed' then
    if r.user_id is null then raise exception 'target_required' using errcode = '22023'; end if;
    update public.affiliate_referrals set ended_at = now(), ended_reason = left(p_resolution, 300) where user_id = r.user_id;
    insert into public.affiliate_referral_history (user_id, from_affiliate, action, reason, actor) values (r.user_id, r.affiliate_id, 'ended', p_resolution, p_caller);
    update public.affiliate_commissions set status = 'canceled', reason = 'attribution_removed' where user_id = r.user_id and status in ('pending', 'payable') and payout_id is null;
  elsif p_outcome = 'commission_restored' then
    update public.affiliate_commissions set status = 'pending', reason = 'restored_after_review' where id = x.commission_id and status in ('held', 'ineligible', 'canceled');
  elsif p_outcome = 'commission_canceled' then
    update public.affiliate_commissions set status = 'canceled', reason = 'canceled_after_review' where id = x.commission_id and status in ('pending', 'payable', 'held') and payout_id is null;
  elsif p_outcome not in ('kept', 'no_change') then raise exception 'bad_outcome' using errcode = '22023'; end if;
  update public.affiliate_disputes set status = 'resolved', outcome = p_outcome, resolution = left(btrim(p_resolution), 2000), resolved_by = p_caller, resolved_at = now() where id = p_id;
  perform public.affiliate_audit(p_caller, 'affiliate.dispute_resolved', coalesce(x.affiliate_id::text, x.id::text), jsonb_build_object('dispute', p_id, 'outcome', p_outcome));
  return jsonb_build_object('outcome', p_outcome);
end $$;

-- Owner opens a dispute/review about a specific customer (e.g. a sales rep claims it).
create or replace function public.admin_affiliate_dispute_open(p_caller uuid, p_user uuid, p_kind text, p_description text, p_raised_by text default 'admin') returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.affiliate_require_admin(p_caller);
  insert into public.affiliate_disputes (affiliate_id, user_id, kind, raised_by, description)
  values ((select affiliate_id from public.affiliate_referrals where user_id = p_user), p_user, case when p_kind in ('attribution', 'commission', 'payout') then p_kind else 'other' end,
    case when p_raised_by in ('admin', 'sales') then p_raised_by else 'admin' end, left(btrim(p_description), 2000)) returning id into v;
  perform public.affiliate_audit(p_caller, 'affiliate.dispute_opened', v::text, jsonb_build_object('user', p_user));
  return v;
end $$;

-- Owner: find a customer account by email (for opening a review on a specific customer).
create or replace function public.admin_affiliate_user_by_email(p_caller uuid, p_email text) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.affiliate_require_admin(p_caller);
  return (select id from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1);
end $$;

create or replace function public.admin_affiliate_commission_set(p_caller uuid, p_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.affiliate_commissions;
begin
  perform public.affiliate_require_admin(p_caller);
  if p_status not in ('pending', 'canceled', 'held') then raise exception 'bad_status' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into c from public.affiliate_commissions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if c.status = 'paid' or c.payout_id is not null then raise exception 'locked_after_payout' using errcode = '22023'; end if;
  update public.affiliate_commissions set status = p_status, reason = left(btrim(p_reason), 300) where id = p_id;
  perform public.affiliate_audit(p_caller, 'affiliate.commission_set', c.affiliate_id::text, jsonb_build_object('commission', p_id, 'from', c.status, 'to', p_status, 'reason', p_reason));
end $$;

create or replace function public.admin_affiliate_settings_save(p_caller uuid, p jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.affiliate_settings;
begin
  perform public.affiliate_require_admin(p_caller);
  perform set_config('affiliate.policy_note', left(coalesce(btrim(p_note), ''), 500), true);
  update public.affiliate_settings set
    applications_open = coalesce((p ->> 'applications_open')::boolean, applications_open),
    commission_years = coalesce((p ->> 'commission_years')::int, commission_years),
    hold_days = coalesce((p ->> 'hold_days')::int, hold_days),
    grace_days = coalesce((p ->> 'grace_days')::int, grace_days),
    attribution_window_days = coalesce((p ->> 'attribution_window_days')::int, attribution_window_days),
    annual_basis = coalesce(p ->> 'annual_basis', annual_basis),
    annual_basis_approved_at = case when (p ->> 'approve_annual_basis')::boolean then now() when p ? 'annual_basis' and p ->> 'annual_basis' <> annual_basis then null else annual_basis_approved_at end,
    payouts_enabled = coalesce((p ->> 'payouts_enabled')::boolean, payouts_enabled),
    min_payout_cents = coalesce((p ->> 'min_payout_cents')::int, min_payout_cents),
    recruitment_emails = coalesce((p ->> 'recruitment_emails')::boolean, recruitment_emails),
    max_signups_per_ip_day = coalesce((p ->> 'max_signups_per_ip_day')::int, max_signups_per_ip_day),
    forecast_monthly_churn_bps = coalesce((p ->> 'forecast_monthly_churn_bps')::int, forecast_monthly_churn_bps),
    forecast_annual_upgrade_bps = coalesce((p ->> 'forecast_annual_upgrade_bps')::int, forecast_annual_upgrade_bps),
    policy_confirmed_at = case when (p ->> 'confirm')::boolean then now() else policy_confirmed_at end,
    updated_at = now(), updated_by = p_caller
  where id returning * into s;
  if s.payouts_enabled and s.policy_confirmed_at is null then raise exception 'confirm_policy_first' using errcode = '22023'; end if;
  perform public.affiliate_audit(p_caller, 'affiliate.settings_saved', 'settings', to_jsonb(s) - 'updated_by');
  return to_jsonb(s);
end $$;

create or replace function public.admin_affiliate_agreement_legal(p_caller uuid, p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.affiliate_require_admin(p_caller);
  if p_status not in ('draft_pending_counsel', 'counsel_approved') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.affiliate_agreement_templates set legal_status = p_status where id = p_id;
  perform public.affiliate_audit(p_caller, 'affiliate.agreement_legal_status', p_id::text, jsonb_build_object('status', p_status));
end $$;

-- Recruitment CRM
create or replace function public.admin_affiliate_prospect_save(p_caller uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x public.affiliate_prospects; v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
begin
  perform public.affiliate_require_admin(p_caller);
  if char_length(btrim(coalesce(p ->> 'channel_name', ''))) < 1 then raise exception 'name_required' using errcode = '22023'; end if;
  if v_email is not null and nullif(btrim(coalesce(p ->> 'email_source', '')), '') is null then raise exception 'email_source_required' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.affiliate_prospects (channel_name, created_by) values (left(btrim(p ->> 'channel_name'), 200), p_caller) returning * into x;
  else
    select * into x from public.affiliate_prospects where id = p_id for update;
    if not found then raise exception 'not_found' using errcode = '22023'; end if;
  end if;
  update public.affiliate_prospects set channel_name = left(btrim(p ->> 'channel_name'), 200),
    channel_url = case when p ->> 'channel_url' ~ '^https://' then left(p ->> 'channel_url', 500) end,
    channel_id = nullif(left(btrim(coalesce(p ->> 'channel_id', '')), 64), ''),
    platform = case when p ->> 'platform' in ('youtube', 'instagram', 'tiktok', 'facebook', 'podcast', 'blog', 'newsletter', 'other') then p ->> 'platform' else platform end,
    subscriber_count = case when (p ->> 'subscriber_count') ~ '^[0-9]{1,15}$' then (p ->> 'subscriber_count')::bigint else subscriber_count end,
    subscribers_refreshed_at = case when (p ->> 'subscriber_count') ~ '^[0-9]{1,15}$' and (p ->> 'subscriber_count')::bigint is distinct from subscriber_count then now() else subscribers_refreshed_at end,
    categories = coalesce((select array_agg(left(c, 40)) from jsonb_array_elements_text(coalesce(p -> 'categories', '[]'::jsonb)) c), categories),
    primary_audience = nullif(left(btrim(coalesce(p ->> 'primary_audience', '')), 300), ''),
    contact_name = nullif(left(btrim(coalesce(p ->> 'contact_name', '')), 200), ''),
    email = v_email, email_source = nullif(left(btrim(coalesce(p ->> 'email_source', '')), 500), ''),
    status = case when p ->> 'status' in ('researching', 'qualified', 'contacted', 'follow_up', 'interested', 'invited', 'onboarding', 'active', 'declined', 'do_not_contact') then p ->> 'status' else status end,
    relevance_score = case when (p ->> 'relevance_score') ~ '^[0-9]{1,3}$' and (p ->> 'relevance_score')::int <= 100 then (p ->> 'relevance_score')::int else relevance_score end,
    next_action = nullif(left(btrim(coalesce(p ->> 'next_action', '')), 300), ''),
    next_action_at = case when (p ->> 'next_action_at') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'next_action_at')::date end,
    notes = nullif(left(coalesce(p ->> 'notes', ''), 5000), '')
  where id = x.id returning * into x;
  if (p ->> 'status') is not null then
    insert into public.affiliate_outreach_events (prospect_id, kind, body, created_by) values (x.id, 'status', 'Status: ' || x.status, p_caller);
  end if;
  return to_jsonb(x);
end $$;

create or replace function public.admin_affiliate_prospect_event(p_caller uuid, p_prospect uuid, p_kind text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.affiliate_require_admin(p_caller);
  if p_kind not in ('note', 'email_drafted', 'email_sent', 'reply', 'call', 'follow_up') then raise exception 'bad_kind' using errcode = '22023'; end if;
  insert into public.affiliate_outreach_events (prospect_id, kind, body, created_by) values (p_prospect, p_kind, left(btrim(coalesce(p_body, '')), 4000), p_caller);
end $$;

create or replace function public.admin_affiliate_prospects(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.affiliate_require_admin(p_caller);
  return coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object(
      'suppressed', x.email is not null and exists (select 1 from public.creator_outreach_suppressions s where s.email = x.email),
      'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'body', e.body, 'created_at', e.created_at) order by e.created_at desc) from public.affiliate_outreach_events e where e.prospect_id = x.id), '[]'::jsonb))
    order by x.next_action_at nulls last, x.updated_at desc) from public.affiliate_prospects x), '[]'::jsonb);
end $$;

create or replace function public.admin_affiliate_compliance_save(p_caller uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x public.affiliate_compliance_cases;
begin
  perform public.affiliate_require_admin(p_caller);
  if p_id is null then
    insert into public.affiliate_compliance_cases (affiliate_id, kind, evidence_url, description, reported_by, created_by)
    values ((p ->> 'affiliate_id')::uuid, p ->> 'kind', case when p ->> 'evidence_url' ~ '^https://' then left(p ->> 'evidence_url', 500) end, left(btrim(p ->> 'description'), 4000),
      nullif(left(btrim(coalesce(p ->> 'reported_by', '')), 200), ''), p_caller) returning * into x;
  else
    update public.affiliate_compliance_cases set status = coalesce(p ->> 'status', status), action_taken = coalesce(nullif(left(btrim(coalesce(p ->> 'action_taken', '')), 2000), ''), action_taken),
      resolved_at = case when p ->> 'status' = 'resolved' then now() else resolved_at end where id = p_id returning * into x;
  end if;
  perform public.affiliate_audit(p_caller, 'affiliate.compliance_' || case when p_id is null then 'opened' else 'updated' end, x.affiliate_id::text, jsonb_build_object('case', x.id, 'kind', x.kind, 'status', x.status));
  return to_jsonb(x);
end $$;

-- Email log (service role): one row per idempotency key; returns false if the key was already used.
create or replace function public.affiliate_email_record(p_key text, p_template text, p_to text, p_affiliate uuid, p_prospect uuid, p_status text, p_provider_id text, p_error text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.affiliate_email_log (key, template, to_email, affiliate_id, prospect_id, status, provider_id, error)
  values (p_key, p_template, lower(p_to), p_affiliate, p_prospect, p_status, p_provider_id, left(p_error, 300)) on conflict (key) do nothing;
  return found;
end $$;

-- Owner reporting: program totals, liabilities, cohort forecast inputs, tax-year totals.
create or replace function public.admin_affiliate_reports(p_caller uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.affiliate_settings; th public.tax_reporting_thresholds;
begin
  perform public.affiliate_require_admin(p_caller);
  select * into cfg from public.affiliate_settings where id;
  select * into th from public.tax_reporting_thresholds where tax_year = p_year;
  return jsonb_build_object(
    'year', p_year, 'settings', to_jsonb(cfg),
    'affiliates_total', (select count(*) from public.affiliates where status = 'active'),
    'affiliates_producing', (select count(distinct affiliate_id) from public.affiliate_referrals where first_paid_at is not null),
    'referred', (select count(*) from public.affiliate_referrals),
    'referred_paid_ever', (select count(*) from public.affiliate_referrals where first_paid_at is not null),
    'referred_active', (select count(*) from public.affiliate_referrals where first_paid_at is not null and ended_at is null and sub_status in ('active', 'past_due', 'trialing') and cancel_requested_at is null),
    'referred_mrr_cents', (select coalesce(sum(v.value), 0) from (select distinct on (x.user_id) public.affiliate_invoice_value(x, cfg.annual_basis) as value
        from public.affiliate_invoices x join public.affiliate_referrals r on r.user_id = x.user_id
        where r.ended_at is null and r.sub_status in ('active', 'past_due', 'trialing') and r.cancel_requested_at is null and public.affiliate_invoice_qualifies(x)
        order by x.user_id, x.paid_at desc) v),
    'revenue_year_cents', (select coalesce(sum(greatest(pretax_cents - refunded_cents, 0)), 0) from public.affiliate_invoices where extract(year from paid_at at time zone 'America/Chicago') = p_year),
    'paid_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.status = 'paid'),
    'paid_year_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.status = 'paid' and extract(year from c.paid_at at time zone 'America/Chicago') = p_year),
    'payable_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.status = 'payable'),
    'pending_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.status = 'pending'),
    'held_cents', (select coalesce(sum(c.amount_cents), 0) from public.affiliate_commissions c where c.status = 'held'),
    'review_flags', (select count(*) from public.affiliate_commissions c where c.review_flag is not null),
    'payout_fees_cents', (select coalesce(sum(p.fee_cents), 0) from public.payouts p where p.affiliate_id is not null and p.status = 'paid' and p.mode = 'live'),
    -- Per active customer: current eligible monthly value and years left (for the cohort projection in the app).
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('value', v.value, 'years_left', v.years_left, 'anniversary_date', v.anniversary_date, 'affiliate_id', v.affiliate_id)) from (
        select distinct on (r.user_id) r.user_id, r.affiliate_id, r.anniversary_date, public.affiliate_invoice_value(x, cfg.annual_basis) as value,
          greatest(0, r.term_years - (select count(*) from public.affiliate_commissions c where c.user_id = r.user_id)) as years_left
        from public.affiliate_referrals r join public.affiliate_invoices x on x.user_id = r.user_id
        where r.first_paid_at is not null and r.ended_at is null and r.sub_status in ('active', 'past_due', 'trialing') and r.cancel_requested_at is null and public.affiliate_invoice_qualifies(x)
        order by r.user_id, x.paid_at desc) v), '[]'::jsonb),
    'cohorts', coalesce((select jsonb_agg(z order by z ->> 'cohort') from (select jsonb_build_object('cohort', to_char(r.first_paid_at at time zone 'America/Chicago', 'YYYY-MM'),
        'customers', count(*), 'still_active', count(*) filter (where r.ended_at is null and r.sub_status in ('active', 'past_due', 'trialing') and r.cancel_requested_at is null)) z
      from public.affiliate_referrals r where r.first_paid_at is not null group by to_char(r.first_paid_at at time zone 'America/Chicago', 'YYYY-MM')) q), '[]'::jsonb),
    'tax', jsonb_build_object('threshold', to_jsonb(th), 'affiliates', coalesce((select jsonb_agg(jsonb_build_object('affiliate_id', a.id, 'name', coalesce(t.w9_legal_name, a.legal_name, a.email),
        'tin_on_file', t.tin_last4 is not null, 'w9_status', coalesce(t.w9_status, 'not_started'), 'tax_class', t.w9_tax_class, 'backup_withholding', coalesce(t.backup_withholding, false),
        'paid_cents', (select coalesce(sum(p.gross_cents), 0) from public.payouts p where p.affiliate_id = a.id and p.mode = 'live' and p.status = 'paid' and p.tax_year = p_year),
        'likely_exempt', coalesce(t.w9_tax_class in ('c_corp', 's_corp', 'llc_c', 'llc_s'), false)))
      from public.affiliates a left join public.affiliate_tax_profiles t on t.affiliate_id = a.id where a.status in ('active', 'terminated', 'suspended')), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 18. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.affiliate_policy_current_version()', 'public.affiliate_settings_version()', 'public.affiliate_audit(uuid, text, text, jsonb)', 'public.affiliate_require_admin(uuid)',
    'public.affiliate_new_code()', 'public.affiliate_log_click(text, text, text, text, text, text)', 'public.affiliate_apply(jsonb)',
    'public.admin_affiliate_invite_create(uuid, text, text, uuid, text, text, integer)', 'public.affiliate_invite_lookup(text)', 'public.affiliate_onboarding(public.affiliates)',
    'public.affiliate_channel_import(uuid, jsonb)', 'public.affiliate_w9_store(uuid, text, text, text, text, text, text, text, text)',
    'public.affiliate_destination_record(uuid, text, text, text, text, text, text, text, text)', 'public.affiliate_record_attribution(uuid, text, timestamptz, uuid)',
    'public.sales_record_attribution(uuid, text, timestamptz)',
    'public.affiliate_sync_subscription(uuid, text, text, text, integer, timestamptz)',
    'public.affiliate_record_invoice(uuid, text, text, text, timestamptz, timestamptz, timestamptz, numeric, integer, integer, integer, integer, jsonb)',
    'public.affiliate_evaluate(uuid, timestamptz)', 'public.affiliate_invoice_refunded(text, integer)', 'public.affiliate_invoice_disputed(text, text)',
    'public.affiliate_mature(timestamptz, uuid)', 'public.affiliate_daily(timestamptz)', 'public.affiliate_payout_blockers(uuid, text)', 'public.affiliate_payout_plan(timestamptz)',
    'public.payout_claim_due(integer, timestamptz)', 'public.payout_apply_event(text, text, text, timestamptz, text, boolean, text)', 'public.payout_json(public.payouts)',
    'public.admin_affiliates_overview(uuid)', 'public.admin_affiliate_decide(uuid, uuid, text, text)', 'public.admin_affiliate_set_status(uuid, uuid, text, text, text)',
    'public.admin_affiliate_correction_review(uuid, uuid, boolean, text)', 'public.admin_affiliate_channel_verify(uuid, uuid)',
    'public.admin_affiliate_dispute_resolve(uuid, uuid, text, text, uuid, uuid)', 'public.admin_affiliate_dispute_open(uuid, uuid, text, text, text)',
    'public.admin_affiliate_commission_set(uuid, uuid, text, text)', 'public.admin_affiliate_user_by_email(uuid, text)', 'public.admin_affiliate_settings_save(uuid, jsonb, text)', 'public.admin_affiliate_agreement_legal(uuid, uuid, text)',
    'public.admin_affiliate_prospect_save(uuid, uuid, jsonb)', 'public.admin_affiliate_prospect_event(uuid, uuid, text, text)', 'public.admin_affiliate_prospects(uuid)',
    'public.admin_affiliate_compliance_save(uuid, uuid, jsonb)', 'public.affiliate_email_record(text, text, text, uuid, uuid, text, text, text)', 'public.admin_affiliate_reports(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.affiliate_invite_accept(text)', 'public.affiliate_link_self()', 'public.affiliate_self()', 'public.affiliate_me()',
    'public.affiliate_my_step(text, jsonb)', 'public.affiliate_my_lesson(text)', 'public.affiliate_my_channel_self(jsonb)', 'public.affiliate_my_correction(text, text, text)',
    'public.affiliate_my_agreement_accept(uuid, text, text, text, text)', 'public.affiliate_my_dispute(text, text, text)', 'public.affiliate_my_dashboard()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
