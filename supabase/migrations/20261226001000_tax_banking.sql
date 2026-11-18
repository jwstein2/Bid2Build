-- V6.9 Tax intelligence + connected banking (read-only). Requires 20261124001000 .. 20261220001000.
--
-- PART A, TAX. Rates come from a licensed tax provider (Avalara AvaTax, TaxJar or Stripe Tax, none activated yet) or,
-- until one is approved, from the rate the company typed (labelled "your rate, not verified"). Nothing here is a
-- homemade national tax engine:
--   1. tax_authorities: the official agency for each of the 50 states + DC (names + homepages only; no invented feeds).
--   2. tax_change_events + tax_jurisdiction_rates: a versioned, append-only record of every rate or rule change the
--      provider reports, with its effective date and source. Only VERIFIED NUMERIC RATE changes whose sources agree
--      can activate automatically on their effective date. Taxability, sourcing and exemption changes always go to
--      review (status needs_review) and are never applied by software or AI.
--   3. tax_sync_runs: every provider sync, so the app can show the last verified update and warn when data is stale.
--   4. fin_tax_profiles, fin_tax_exemptions: per-book tax setup (service states, registrations, notification
--      preferences; email off by default) and customer exemption certificates.
--   5. tax_calculations: one row per calculation. A row is locked (immutable) when an invoice is issued or a proposal
--      version is finalized; a later correction is a NEW row that points at the one it supersedes.
--   6. fin_tax_alerts: in-app "Tax & Regulatory Updates", one per book per change (no duplicates on every login),
--      plus one quarterly digest per book per quarter.
--
-- PART B, BANKING (read-only, no money movement, no account/routing numbers):
--   7. fin_bank_connections: one per provider login (Plaid item). The provider access token lives in
--      fin_bank_connection_secrets, which no browser role can read or write (service role only), encrypted by the app.
--   8. fin_bank_accounts gains connection_id / provider_account_id / currency / subtype / is_primary; provider-fed
--      accounts use source 'provider_feed'. Feed transactions land in the SAME fin_bank_transactions table as
--      statement imports (append-only, fingerprint de-dupe), so Accountant Mode matching and reconciliation just work.
--   9. fin_bank_balances: append-only bank-REPORTED balance snapshots (current / available / as-of). Only people
--      with "reconcile" can read them; internal accounting balances are never written here.
--  10. fin_cash_events: planned cash events for the forecast (payroll, recurring bills, expected deposit dates),
--      always labelled scheduled or expected, never confirmed.
--
-- Access: tax setup needs manage_financial_config; tax alerts need view_company_financials; bank connect/disconnect
-- needs manage_financial_config; balances, feed lines and cash plan need reconcile. Writes need an active add-on.
-- Safe to run more than once. Rollback: docs/tax-banking/rollback_20261226001000.sql

-- 0. Capability map (mirror of src/lib/tax-banking/capabilities.ts; a unit test keeps them in sync) -------------
create or replace function public.tb_capability_key(p_cap text) returns text
language sql immutable set search_path = public as $$
  select case p_cap
    when 'tax.view_config' then 'view_company_financials'
    when 'tax.manage_settings' then 'manage_financial_config'
    when 'tax.review_alerts' then 'view_company_financials'
    when 'bank.view_balances' then 'reconcile'
    when 'bank.connect' then 'manage_financial_config'
    when 'bank.disconnect' then 'manage_financial_config'
    when 'bank.view_transactions' then 'reconcile'
    when 'bank.reconcile' then 'reconcile'
    when 'cash.view_forecast' then 'view_company_financials'
    when 'cash.manage_plan' then 'reconcile'
    when 'reports.view' then 'view_company_financials'
  end
$$;
create or replace function public.tb_can(p_book_id uuid, p_cap text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fin_has_permission(p_book_id, public.tb_capability_key(p_cap), p_write), false)
$$;
revoke execute on function public.tb_can(uuid, text, boolean) from public, anon;
grant execute on function public.tb_can(uuid, text, boolean) to authenticated;

-- 1. State tax authority registry ------------------------------------------------------------------------------
create table if not exists public.tax_authorities (
  state             text primary key check (state ~ '^[A-Z]{2}$'),
  state_name        text not null,
  authority         text not null,
  website           text not null check (website ~ '^https://'),
  tax_system        text not null check (tax_system in ('sales_use', 'gross_receipts', 'transaction_privilege', 'local_only', 'none')),
  sst_member        boolean not null default false,
  note              text,
  info_url          text check (info_url ~ '^https://'),     -- set only after a person confirms the page on the agency's site
  rate_url          text check (rate_url ~ '^https://'),
  machine_feed      text not null default 'none_known' check (machine_feed in ('none_known', 'provider_only', 'official_feed')),
  update_frequency  text,                                   -- e.g. 'quarterly' once confirmed; null = unknown
  source_status     text not null default 'needs_verification' check (source_status in ('needs_verification', 'reachable', 'unreachable', 'review')),
  last_verified_at  timestamptz,
  last_checked_at   timestamptz,
  next_check_at     timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.tax_authorities enable row level security;
drop policy if exists tax_authorities_read on public.tax_authorities;
create policy tax_authorities_read on public.tax_authorities for select to anon, authenticated using (true);
revoke insert, update, delete on public.tax_authorities from anon, authenticated;
grant select on public.tax_authorities to anon, authenticated;

-- Agency names and homepages (src/lib/tax-banking/authorities.ts). Re-running refreshes names, never verification state.
insert into public.tax_authorities (state, state_name, authority, website, tax_system, sst_member, note) values
  ('AL', 'Alabama', 'Alabama Department of Revenue', 'https://www.revenue.alabama.gov/', 'sales_use', false, 'Many cities and counties administer their own sales taxes.'),
  ('AK', 'Alaska', 'Alaska Department of Revenue', 'https://tax.alaska.gov/', 'local_only', false, 'No statewide sales tax. Some boroughs and cities levy local sales taxes.'),
  ('AZ', 'Arizona', 'Arizona Department of Revenue', 'https://azdor.gov/', 'transaction_privilege', false, 'Transaction privilege tax with separate contracting classifications. Review contract treatment.'),
  ('AR', 'Arkansas', 'Arkansas Department of Finance and Administration', 'https://www.dfa.arkansas.gov/', 'sales_use', true, null),
  ('CA', 'California', 'California Department of Tax and Fee Administration', 'https://www.cdtfa.ca.gov/', 'sales_use', false, 'District taxes vary within cities and counties.'),
  ('CO', 'Colorado', 'Colorado Department of Revenue', 'https://tax.colorado.gov/', 'sales_use', false, 'Home-rule cities may collect their own sales and use taxes.'),
  ('CT', 'Connecticut', 'Connecticut Department of Revenue Services', 'https://portal.ct.gov/drs', 'sales_use', false, null),
  ('DE', 'Delaware', 'Delaware Division of Revenue', 'https://revenue.delaware.gov/', 'none', false, 'No sales tax. Delaware levies a gross receipts tax on businesses.'),
  ('DC', 'District of Columbia', 'DC Office of Tax and Revenue', 'https://otr.cfo.dc.gov/', 'sales_use', false, null),
  ('FL', 'Florida', 'Florida Department of Revenue', 'https://floridarevenue.com/', 'sales_use', false, null),
  ('GA', 'Georgia', 'Georgia Department of Revenue', 'https://dor.georgia.gov/', 'sales_use', true, null),
  ('HI', 'Hawaii', 'Hawaii Department of Taxation', 'https://tax.hawaii.gov/', 'gross_receipts', false, 'General excise tax on the business, not a retail sales tax.'),
  ('ID', 'Idaho', 'Idaho State Tax Commission', 'https://tax.idaho.gov/', 'sales_use', false, null),
  ('IL', 'Illinois', 'Illinois Department of Revenue', 'https://tax.illinois.gov/', 'sales_use', false, null),
  ('IN', 'Indiana', 'Indiana Department of Revenue', 'https://www.in.gov/dor/', 'sales_use', true, null),
  ('IA', 'Iowa', 'Iowa Department of Revenue', 'https://revenue.iowa.gov/', 'sales_use', true, null),
  ('KS', 'Kansas', 'Kansas Department of Revenue', 'https://www.ksrevenue.gov/', 'sales_use', true, null),
  ('KY', 'Kentucky', 'Kentucky Department of Revenue', 'https://revenue.ky.gov/', 'sales_use', true, null),
  ('LA', 'Louisiana', 'Louisiana Department of Revenue', 'https://revenue.louisiana.gov/', 'sales_use', false, 'Parish (local) sales taxes are administered locally.'),
  ('ME', 'Maine', 'Maine Revenue Services', 'https://www.maine.gov/revenue/', 'sales_use', false, null),
  ('MD', 'Maryland', 'Comptroller of Maryland', 'https://www.marylandtaxes.gov/', 'sales_use', false, null),
  ('MA', 'Massachusetts', 'Massachusetts Department of Revenue', 'https://www.mass.gov/orgs/massachusetts-department-of-revenue', 'sales_use', false, null),
  ('MI', 'Michigan', 'Michigan Department of Treasury', 'https://www.michigan.gov/treasury', 'sales_use', true, null),
  ('MN', 'Minnesota', 'Minnesota Department of Revenue', 'https://www.revenue.state.mn.us/', 'sales_use', true, null),
  ('MS', 'Mississippi', 'Mississippi Department of Revenue', 'https://www.dor.ms.gov/', 'sales_use', false, 'Contractor''s tax applies to some construction contracts. Review contract treatment.'),
  ('MO', 'Missouri', 'Missouri Department of Revenue', 'https://dor.mo.gov/', 'sales_use', false, null),
  ('MT', 'Montana', 'Montana Department of Revenue', 'https://mtrevenue.gov/', 'none', false, 'No general sales tax. Some resort areas levy local resort taxes.'),
  ('NE', 'Nebraska', 'Nebraska Department of Revenue', 'https://revenue.nebraska.gov/', 'sales_use', true, 'Contractor options for materials. Review contract treatment.'),
  ('NV', 'Nevada', 'Nevada Department of Taxation', 'https://tax.nv.gov/', 'sales_use', true, null),
  ('NH', 'New Hampshire', 'New Hampshire Department of Revenue Administration', 'https://www.revenue.nh.gov/', 'none', false, 'No general sales tax.'),
  ('NJ', 'New Jersey', 'New Jersey Division of Taxation', 'https://www.nj.gov/treasury/taxation/', 'sales_use', true, null),
  ('NM', 'New Mexico', 'New Mexico Taxation and Revenue Department', 'https://www.tax.newmexico.gov/', 'gross_receipts', false, 'Gross receipts tax generally applies to construction services.'),
  ('NY', 'New York', 'New York State Department of Taxation and Finance', 'https://www.tax.ny.gov/', 'sales_use', false, 'Capital improvements and repairs are treated differently. Review contract treatment.'),
  ('NC', 'North Carolina', 'North Carolina Department of Revenue', 'https://www.ncdor.gov/', 'sales_use', true, 'Real property contracts and repair/maintenance are treated differently.'),
  ('ND', 'North Dakota', 'North Dakota Office of State Tax Commissioner', 'https://www.tax.nd.gov/', 'sales_use', true, null),
  ('OH', 'Ohio', 'Ohio Department of Taxation', 'https://tax.ohio.gov/', 'sales_use', true, null),
  ('OK', 'Oklahoma', 'Oklahoma Tax Commission', 'https://oklahoma.gov/tax.html', 'sales_use', true, null),
  ('OR', 'Oregon', 'Oregon Department of Revenue', 'https://www.oregon.gov/dor/', 'none', false, 'No general sales tax.'),
  ('PA', 'Pennsylvania', 'Pennsylvania Department of Revenue', 'https://www.revenue.pa.gov/', 'sales_use', false, null),
  ('RI', 'Rhode Island', 'Rhode Island Division of Taxation', 'https://tax.ri.gov/', 'sales_use', true, null),
  ('SC', 'South Carolina', 'South Carolina Department of Revenue', 'https://dor.sc.gov/', 'sales_use', false, null),
  ('SD', 'South Dakota', 'South Dakota Department of Revenue', 'https://dor.sd.gov/', 'sales_use', true, 'Contractor''s excise tax applies to some construction. Review contract treatment.'),
  ('TN', 'Tennessee', 'Tennessee Department of Revenue', 'https://www.tn.gov/revenue.html', 'sales_use', true, null),
  ('TX', 'Texas', 'Texas Comptroller of Public Accounts', 'https://comptroller.texas.gov/', 'sales_use', false, 'New construction and residential repair are treated differently from nonresidential repair. Review contract treatment.'),
  ('UT', 'Utah', 'Utah State Tax Commission', 'https://tax.utah.gov/', 'sales_use', true, null),
  ('VT', 'Vermont', 'Vermont Department of Taxes', 'https://tax.vermont.gov/', 'sales_use', true, null),
  ('VA', 'Virginia', 'Virginia Department of Taxation', 'https://www.tax.virginia.gov/', 'sales_use', false, null),
  ('WA', 'Washington', 'Washington State Department of Revenue', 'https://dor.wa.gov/', 'sales_use', true, 'Retail sales tax generally applies to construction services, with destination-based local rates.'),
  ('WV', 'West Virginia', 'West Virginia State Tax Department', 'https://tax.wv.gov/', 'sales_use', true, null),
  ('WI', 'Wisconsin', 'Wisconsin Department of Revenue', 'https://www.revenue.wi.gov/', 'sales_use', true, null),
  ('WY', 'Wyoming', 'Wyoming Department of Revenue', 'https://revenue.wyo.gov/', 'sales_use', true, null)

on conflict (state) do update set state_name = excluded.state_name, authority = excluded.authority, website = excluded.website,
  tax_system = excluded.tax_system, sst_member = excluded.sst_member, note = excluded.note, updated_at = now();

-- 2. Sync runs (freshness) --------------------------------------------------------------------------------------
create table if not exists public.tax_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('none', 'mock', 'avalara', 'taxjar', 'stripe_tax', 'official')),
  kind          text not null default 'rates' check (kind in ('rates', 'authorities', 'digest')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'ok', 'failed', 'skipped')),
  error         text check (char_length(error) <= 500),
  changes_found integer not null default 0,
  changes_applied integer not null default 0,
  changes_review integer not null default 0,
  api_calls     integer not null default 0
);
create index if not exists tax_sync_runs_recent on public.tax_sync_runs (kind, started_at desc);
alter table public.tax_sync_runs enable row level security;
revoke all on public.tax_sync_runs from anon, authenticated;

-- 3. Change events + versioned rates ----------------------------------------------------------------------------
create table if not exists public.tax_change_events (
  id                 uuid primary key default gen_random_uuid(),
  state              text not null references public.tax_authorities (state),
  jurisdiction_code  text not null check (char_length(jurisdiction_code) between 1 and 80),
  jurisdiction_name  text not null check (char_length(jurisdiction_name) between 1 and 200),
  level              text not null default 'state' check (level in ('state', 'county', 'city', 'special', 'other')),
  kind               text not null check (kind in ('rate', 'taxability', 'sourcing', 'exemption', 'other')),
  summary            text not null check (char_length(summary) between 1 and 500),
  old_rate           numeric(8, 5) check (old_rate between 0 and 100),
  new_rate           numeric(8, 5) check (new_rate between 0 and 100),
  effective_date     date not null,
  source             text not null check (source in ('provider', 'official', 'fixture')),
  provider           text,
  provider_ref       text check (char_length(provider_ref) <= 200),
  source_url         text check (source_url ~ '^https://'),
  verified           boolean not null default false,
  sources_agree      boolean,                 -- false = two sources disagree: never auto-applied
  automatable        boolean generated always as (kind = 'rate' and verified and new_rate is not null and coalesce(sources_agree, true)) stored,
  status             text not null check (status in ('scheduled', 'active', 'needs_review', 'rejected')),
  review_note        text check (char_length(review_note) <= 1000),
  detected_at        timestamptz not null default now(),
  activated_at       timestamptz,
  fanned_out_at      timestamptz,
  sync_run_id        uuid references public.tax_sync_runs (id) on delete set null,
  constraint tax_change_events_rate check (kind <> 'rate' or new_rate is not null),
  -- Only an automatable change may ever be scheduled or active; everything else waits for a person.
  constraint tax_change_events_auto check (status not in ('scheduled', 'active') or (kind = 'rate' and verified and new_rate is not null and coalesce(sources_agree, true)))
);
create unique index if not exists tax_change_events_dedupe on public.tax_change_events (state, jurisdiction_code, kind, effective_date, coalesce(new_rate, -1), md5(summary));
create index if not exists tax_change_events_state on public.tax_change_events (state, effective_date desc);
alter table public.tax_change_events enable row level security;
drop policy if exists tax_change_events_read on public.tax_change_events;
create policy tax_change_events_read on public.tax_change_events for select to authenticated using (true);   -- public rate facts, no customer data
revoke insert, update, delete on public.tax_change_events from anon, authenticated;
grant select on public.tax_change_events to authenticated;

create or replace function public.tax_change_events_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  -- The facts never change; only status, activation, fan-out and the review note move forward.
  -- (automatable is a generated column: it is not computed yet in a BEFORE trigger, so it's left out of the comparison)
  if (to_jsonb(new) - 'status' - 'activated_at' - 'fanned_out_at' - 'review_note' - 'automatable') is distinct from (to_jsonb(old) - 'status' - 'activated_at' - 'fanned_out_at' - 'review_note' - 'automatable')
     or old.status in ('active', 'rejected') and new.status is distinct from old.status then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists tax_change_events_guard on public.tax_change_events;
create trigger tax_change_events_guard before update or delete on public.tax_change_events for each row execute function public.tax_change_events_guard();

create table if not exists public.tax_jurisdiction_rates (
  id                 uuid primary key default gen_random_uuid(),
  state              text not null references public.tax_authorities (state),
  jurisdiction_code  text not null,
  jurisdiction_name  text not null,
  level              text not null check (level in ('state', 'county', 'city', 'special', 'other')),
  rate               numeric(8, 5) not null check (rate between 0 and 100),
  effective_from     date not null,
  source             text not null check (source in ('provider', 'official', 'fixture')),
  provider           text,
  source_url         text,
  change_event_id    uuid references public.tax_change_events (id) on delete restrict,
  recorded_at        timestamptz not null default now(),
  unique (state, jurisdiction_code, effective_from, source)
);
create index if not exists tax_jurisdiction_rates_lookup on public.tax_jurisdiction_rates (state, jurisdiction_code, effective_from desc);
drop trigger if exists tax_jurisdiction_rates_immutable on public.tax_jurisdiction_rates;
create trigger tax_jurisdiction_rates_immutable before update or delete on public.tax_jurisdiction_rates for each row execute function public.fin_guard_immutable();
alter table public.tax_jurisdiction_rates enable row level security;
drop policy if exists tax_jurisdiction_rates_read on public.tax_jurisdiction_rates;
create policy tax_jurisdiction_rates_read on public.tax_jurisdiction_rates for select to authenticated using (true);
revoke insert, update, delete on public.tax_jurisdiction_rates from anon, authenticated;
grant select on public.tax_jurisdiction_rates to authenticated;

-- The rate in force for a jurisdiction on a date (history is preserved: older versions stay queryable).
create or replace function public.tax_rate_on(p_state text, p_code text, p_date date) returns numeric
language sql stable set search_path = public as $$
  select rate from public.tax_jurisdiction_rates where state = p_state and jurisdiction_code = p_code and effective_from <= p_date
   order by effective_from desc, recorded_at desc limit 1
$$;

-- 4. Per-book tax profile + exemptions --------------------------------------------------------------------------
create table if not exists public.fin_tax_profiles (
  book_id              uuid primary key references public.fin_books (id) on delete restrict,
  primary_state        text references public.tax_authorities (state),
  address              jsonb,                                  -- {line1, city, state, zip}
  service_states       text[] not null default '{}',
  registrations        jsonb not null default '[]'::jsonb,     -- [{state, registered, note}] (never full permit numbers)
  business_type        text check (business_type in ('general_contractor', 'subcontractor', 'specialty_trade', 'remodeler', 'service', 'other')),
  work_mix             text check (work_mix in ('residential', 'commercial', 'both')),
  default_contract     text check (default_contract in ('lump_sum', 'time_and_materials', 'cost_plus', 'mixed')),
  provider             text not null default 'none' check (provider in ('none', 'mock', 'avalara', 'taxjar', 'stripe_tax')),
  auto_apply_rates     boolean not null default true,          -- verified numeric rate updates only, on their effective date
  notify_immediate     boolean not null default true,
  notify_quarterly     boolean not null default true,
  notify_email         boolean not null default false,         -- in-app only unless the company turns this on
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  constraint fin_tax_profiles_states check (service_states <@ array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']::text[])
);

create table if not exists public.fin_tax_exemptions (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  customer_id     uuid not null references public.customers (id) on delete restrict,
  state           text not null references public.tax_authorities (state),
  reason          text not null check (reason in ('resale', 'government', 'nonprofit', 'religious', 'agricultural', 'manufacturing', 'direct_pay', 'other')),
  certificate_ref text check (char_length(certificate_ref) <= 40),     -- last digits / label only
  document_id     uuid,                                              -- fin_documents row holding the certificate, when uploaded
  expires_on      date,
  status          text not null default 'active' check (status in ('active', 'revoked')),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists fin_tax_exemptions_customer on public.fin_tax_exemptions (book_id, customer_id);

-- 5. Calculations (snapshots) -----------------------------------------------------------------------------------
create table if not exists public.tax_calculations (
  id                uuid primary key default gen_random_uuid(),
  subject_type      text not null check (subject_type in ('estimate', 'proposal_version', 'invoice')),
  subject_id        uuid not null,
  estimate_id       uuid references public.estimates (id) on delete cascade,   -- estimate + proposal subjects
  book_id           uuid references public.fin_books (id) on delete restrict,   -- invoice subjects
  status            text not null check (status in ('calculated', 'needs_review', 'failed')),
  transaction_date  date not null,
  address           jsonb,
  taxable_amount    numeric(14, 2) not null default 0,
  nontaxable_amount numeric(14, 2) not null default 0,
  tax_amount        numeric(14, 2) not null default 0,
  combined_rate     numeric(8, 5),
  jurisdictions     jsonb not null default '[]'::jsonb,   -- [{name, level, rate, taxType, taxable, tax}]
  lines             jsonb not null default '[]'::jsonb,   -- [{ref, classification, amount, taxable, tax}]
  exemptions        jsonb not null default '[]'::jsonb,
  review_reasons    text[] not null default '{}',
  source            text not null check (source in ('provider', 'company_rate', 'mock', 'contract')),
  provider          text,
  provider_ref      text check (char_length(provider_ref) <= 200),
  data_as_of        timestamptz,
  locked            boolean not null default false,
  supersedes        uuid references public.tax_calculations (id) on delete restrict,
  correction_reason text check (char_length(correction_reason) <= 500),
  created_by        uuid references auth.users (id) on delete set null,
  calculated_at     timestamptz not null default now(),
  constraint tax_calculations_scope check ((subject_type = 'invoice') = (book_id is not null) and (subject_type = 'invoice') = (estimate_id is null)),
  constraint tax_calculations_correction check ((supersedes is null) = (correction_reason is null))
);
create index if not exists tax_calculations_subject on public.tax_calculations (subject_type, subject_id, calculated_at desc);
create unique index if not exists tax_calculations_one_correction on public.tax_calculations (supersedes) where supersedes is not null;

create or replace function public.tax_calculations_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- A locked snapshot (issued invoice / finalized proposal) never changes or disappears. Unlocked draft rows may be
  -- cleaned up by the estimate cascade only.
  if tg_op = 'DELETE' and old.estimate_id is not null and not exists (select 1 from public.estimates e where e.id = old.estimate_id) then
    return old;   -- the estimate itself was deleted (account deletion cascade)
  end if;
  if old.locked then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'locked') is distinct from (to_jsonb(old) - 'locked') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists tax_calculations_guard on public.tax_calculations;
create trigger tax_calculations_guard before update or delete on public.tax_calculations for each row execute function public.tax_calculations_guard();

-- 6. Alerts -----------------------------------------------------------------------------------------------------
create table if not exists public.fin_tax_alerts (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.fin_books (id) on delete restrict,
  change_event_id  uuid references public.tax_change_events (id) on delete restrict,
  kind             text not null check (kind in ('rate_change', 'rule_change', 'calc_review', 'stale_data', 'digest')),
  digest_quarter   date,
  title            text not null check (char_length(title) <= 200),
  state            text references public.tax_authorities (state),
  locality         text,
  effective_date   date,
  source_url       text,
  impact           text check (char_length(impact) <= 1000),
  auto_updated     boolean not null default false,
  review_needed    boolean not null default false,
  status           text not null default 'new' check (status in ('new', 'reviewed', 'dismissed')),
  acted_by         uuid references auth.users (id) on delete set null,
  acted_at         timestamptz,
  created_at       timestamptz not null default now(),
  constraint fin_tax_alerts_digest check ((kind = 'digest') = (digest_quarter is not null))
);
create unique index if not exists fin_tax_alerts_once on public.fin_tax_alerts (book_id, change_event_id) where change_event_id is not null;
create unique index if not exists fin_tax_alerts_digest_once on public.fin_tax_alerts (book_id, digest_quarter) where digest_quarter is not null;
create index if not exists fin_tax_alerts_book on public.fin_tax_alerts (book_id, status, created_at desc);

-- 7. Bank connections -------------------------------------------------------------------------------------------
create table if not exists public.fin_bank_connections (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid not null references public.fin_books (id) on delete restrict,
  provider            text not null check (provider in ('mock', 'plaid', 'stripe_fc', 'teller')),
  provider_item_ref   text not null check (char_length(provider_item_ref) between 1 and 200),   -- item id, not a secret
  institution_name    text not null check (char_length(institution_name) between 1 and 200),
  institution_ref     text check (char_length(institution_ref) <= 100),
  status              text not null default 'active' check (status in ('active', 'needs_reauth', 'revoked', 'institution_down', 'error', 'disconnected')),
  error_code          text check (char_length(error_code) <= 80),
  error_message       text check (char_length(error_message) <= 300),
  history_partial     boolean not null default false,
  last_sync_at        timestamptz,
  last_success_at     timestamptz,
  next_sync_at        timestamptz,
  manual_refreshes_today integer not null default 0,
  manual_refresh_day  date,
  sandbox             boolean not null default false,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  disconnected_by     uuid references auth.users (id) on delete set null,
  disconnected_at     timestamptz,
  constraint fin_bank_connections_disc check ((status = 'disconnected') = (disconnected_at is not null)),
  unique (provider, provider_item_ref)
);
create index if not exists fin_bank_connections_book on public.fin_bank_connections (book_id);

-- Tokens: service role only. No policy, no grant: a signed-in browser can never read this table.
create table if not exists public.fin_bank_connection_secrets (
  connection_id     uuid primary key references public.fin_bank_connections (id) on delete cascade,
  token_ciphertext  text not null check (char_length(token_ciphertext) between 16 and 4000),
  key_version       smallint not null default 1,
  updated_at        timestamptz not null default now()
);
alter table public.fin_bank_connection_secrets enable row level security;
revoke all on public.fin_bank_connection_secrets from public, anon, authenticated;

alter table public.fin_bank_accounts add column if not exists connection_id uuid references public.fin_bank_connections (id) on delete restrict;
alter table public.fin_bank_accounts add column if not exists provider_account_ref text check (char_length(provider_account_ref) <= 200);
alter table public.fin_bank_accounts add column if not exists currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$');
alter table public.fin_bank_accounts add column if not exists subtype text check (char_length(subtype) <= 40);
alter table public.fin_bank_accounts add column if not exists institution_name text check (char_length(institution_name) <= 200);
alter table public.fin_bank_accounts add column if not exists is_primary boolean not null default false;
alter table public.fin_bank_accounts drop constraint if exists fin_bank_accounts_source_check;
alter table public.fin_bank_accounts add constraint fin_bank_accounts_source_check check (source in ('statement_import', 'provider_feed'));
alter table public.fin_bank_accounts drop constraint if exists fin_bank_accounts_feed;
alter table public.fin_bank_accounts add constraint fin_bank_accounts_feed check ((source = 'provider_feed') = (connection_id is not null and provider_account_ref is not null));
create unique index if not exists fin_bank_accounts_feed_once on public.fin_bank_accounts (connection_id, provider_account_ref) where connection_id is not null;
create unique index if not exists fin_bank_accounts_one_primary on public.fin_bank_accounts (book_id) where is_primary and status = 'active';

-- 8. Bank-reported balances -------------------------------------------------------------------------------------
create table if not exists public.fin_bank_balances (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.fin_books (id) on delete restrict,
  account_id        uuid not null references public.fin_bank_accounts (id) on delete restrict,
  current_balance   numeric(14, 2),
  available_balance numeric(14, 2),
  currency          text not null default 'USD',
  as_of             timestamptz not null,
  source            text not null check (source in ('mock', 'plaid', 'stripe_fc', 'teller')),
  recorded_at       timestamptz not null default now(),
  constraint fin_bank_balances_some check (current_balance is not null or available_balance is not null)
);
create index if not exists fin_bank_balances_latest on public.fin_bank_balances (account_id, as_of desc);
drop trigger if exists fin_bank_balances_immutable on public.fin_bank_balances;
create trigger fin_bank_balances_immutable before update or delete on public.fin_bank_balances for each row execute function public.fin_guard_immutable();

-- 9. Cash plan ---------------------------------------------------------------------------------------------------
create table if not exists public.fin_cash_events (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  kind          text not null check (kind in ('payroll', 'recurring_expense', 'expected_deposit', 'supplier_payment', 'sub_payment', 'transfer', 'other_inflow', 'other_outflow')),
  label         text not null check (char_length(btrim(label)) between 1 and 200),
  amount        numeric(14, 2) not null check (amount > 0),
  direction     text not null check (direction in ('in', 'out')),
  expected_on   date not null,
  recurrence    text not null default 'none' check (recurrence in ('none', 'weekly', 'biweekly', 'monthly')),
  recur_until   date,
  certainty     text not null default 'scheduled' check (certainty in ('scheduled', 'expected')),
  account_id    uuid references public.fin_bank_accounts (id) on delete restrict,
  to_account_id uuid references public.fin_bank_accounts (id) on delete restrict,
  invoice_id    uuid references public.fin_invoices (id) on delete restrict,
  settlement    text check (settlement in ('initiated', 'processing', 'estimated_available', 'settled', 'failed', 'returned')),
  note          text check (char_length(note) <= 500),
  status        text not null default 'active' check (status in ('active', 'cancelled', 'done')),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint fin_cash_events_transfer check ((kind = 'transfer') = (to_account_id is not null) and (kind <> 'transfer' or account_id is not null)),
  constraint fin_cash_events_dir check (kind not in ('payroll', 'recurring_expense', 'supplier_payment', 'sub_payment', 'other_outflow') or direction = 'out'),
  constraint fin_cash_events_dir_in check (kind not in ('expected_deposit', 'other_inflow') or direction = 'in')
);
create index if not exists fin_cash_events_book on public.fin_cash_events (book_id, status, expected_on);

-- 10. RLS ---------------------------------------------------------------------------------------------------------
alter table public.fin_tax_profiles enable row level security;
alter table public.fin_tax_exemptions enable row level security;
alter table public.tax_calculations enable row level security;
alter table public.fin_tax_alerts enable row level security;
alter table public.fin_bank_connections enable row level security;
alter table public.fin_bank_balances enable row level security;
alter table public.fin_cash_events enable row level security;

drop policy if exists fin_tax_profiles_select on public.fin_tax_profiles;
create policy fin_tax_profiles_select on public.fin_tax_profiles for select to authenticated using (public.tb_can(book_id, 'tax.view_config'));
drop policy if exists fin_tax_exemptions_select on public.fin_tax_exemptions;
create policy fin_tax_exemptions_select on public.fin_tax_exemptions for select to authenticated
  using (public.tb_can(book_id, 'tax.view_config') or public.fin_has_permission(book_id, 'view_project_financials'));
drop policy if exists fin_tax_alerts_select on public.fin_tax_alerts;
create policy fin_tax_alerts_select on public.fin_tax_alerts for select to authenticated using (public.tb_can(book_id, 'tax.review_alerts'));
drop policy if exists fin_bank_connections_select on public.fin_bank_connections;
create policy fin_bank_connections_select on public.fin_bank_connections for select to authenticated using (public.tb_can(book_id, 'bank.view_balances'));
drop policy if exists fin_bank_balances_select on public.fin_bank_balances;
create policy fin_bank_balances_select on public.fin_bank_balances for select to authenticated using (public.tb_can(book_id, 'bank.view_balances'));
drop policy if exists fin_cash_events_select on public.fin_cash_events;
create policy fin_cash_events_select on public.fin_cash_events for select to authenticated using (public.tb_can(book_id, 'cash.view_forecast'));
drop policy if exists tax_calculations_select on public.tax_calculations;
create policy tax_calculations_select on public.tax_calculations for select to authenticated using (
  case when book_id is not null then public.fin_has_permission(book_id, 'view_project_financials')
       else exists (select 1 from public.estimates e where e.id = tax_calculations.estimate_id) end);
do $$ declare t text; begin
  foreach t in array array['fin_tax_profiles', 'fin_tax_exemptions', 'tax_calculations', 'fin_tax_alerts', 'fin_bank_connections', 'fin_bank_balances', 'fin_cash_events'] loop
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 11. Tax functions ----------------------------------------------------------------------------------------------
create or replace function public.fin_tax_profile_save(p_book_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_states text[] := coalesce(array(select upper(x) from jsonb_array_elements_text(coalesce(p -> 'serviceStates', '[]'::jsonb)) x), '{}');
        v_primary text := upper(nullif(p ->> 'primaryState', ''));
begin
  perform public.fin_require(p_book_id, public.tb_capability_key('tax.manage_settings'), true);
  if v_primary is not null and not (v_primary = any (v_states)) then v_states := v_states || v_primary; end if;
  if nullif(p ->> 'provider', '') is not null and p ->> 'provider' not in ('none', 'mock') then
    -- Paid providers are switched on by the platform owner after approval, never from a customer form.
    raise exception 'provider_not_approved' using errcode = '22023';
  end if;
  insert into public.fin_tax_profiles as t (book_id, primary_state, address, service_states, registrations, business_type, work_mix, default_contract,
                                            auto_apply_rates, notify_immediate, notify_quarterly, notify_email, updated_by, updated_at)
  values (p_book_id, v_primary, p -> 'address', v_states, coalesce(p -> 'registrations', '[]'::jsonb), nullif(p ->> 'businessType', ''), nullif(p ->> 'workMix', ''),
          nullif(p ->> 'defaultContract', ''), coalesce((p ->> 'autoApplyRates')::boolean, true), coalesce((p ->> 'notifyImmediate')::boolean, true),
          coalesce((p ->> 'notifyQuarterly')::boolean, true), coalesce((p ->> 'notifyEmail')::boolean, false), auth.uid(), now())
  on conflict (book_id) do update set primary_state = excluded.primary_state, address = excluded.address, service_states = excluded.service_states,
    registrations = excluded.registrations, business_type = excluded.business_type, work_mix = excluded.work_mix, default_contract = excluded.default_contract,
    auto_apply_rates = excluded.auto_apply_rates, notify_immediate = excluded.notify_immediate, notify_quarterly = excluded.notify_quarterly,
    notify_email = excluded.notify_email, updated_by = excluded.updated_by, updated_at = now();
  perform public.fin_audit(p_book_id, 'tax.profile_saved', 'tax_profile', p_book_id, jsonb_build_object('states', v_states, 'primary', v_primary, 'email', coalesce((p ->> 'notifyEmail')::boolean, false)));
end $$;

create or replace function public.fin_tax_exemption_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_cust uuid := nullif(p ->> 'customerId', '')::uuid;
begin
  perform public.fin_require(p_book_id, public.tb_capability_key('tax.manage_settings'), true);
  if v_id is null then
    if not exists (select 1 from public.customers c join public.fin_books b on b.id = p_book_id
                    where c.id = v_cust and (c.company_id = b.company_id or (b.company_id is null and c.user_id = b.owner_user_id))) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    insert into public.fin_tax_exemptions (book_id, customer_id, state, reason, certificate_ref, document_id, expires_on, created_by)
    values (p_book_id, v_cust, upper(p ->> 'state'), p ->> 'reason', nullif(left(p ->> 'certificateRef', 40), ''), nullif(p ->> 'documentId', '')::uuid,
            nullif(p ->> 'expiresOn', '')::date, auth.uid()) returning id into v_id;
    perform public.fin_audit(p_book_id, 'tax.exemption_added', 'tax_exemption', v_id, jsonb_build_object('state', p ->> 'state', 'reason', p ->> 'reason'));
  else
    update public.fin_tax_exemptions set status = 'revoked' where id = v_id and book_id = p_book_id and (p ->> 'status') = 'revoked';
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_audit(p_book_id, 'tax.exemption_revoked', 'tax_exemption', v_id, null);
  end if;
  return v_id;
end $$;

-- Record a calculation. Estimate/proposal subjects: the caller must own the estimate (same rule as estimates_own_all).
-- Invoice subjects: create_invoices. p_lock = true makes it an immutable snapshot. A correction of a locked snapshot
-- passes supersedes + correctionReason and creates a new row; the original stays.
create or replace function public.tax_calc_record(p jsonb, p_lock boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_type text := p ->> 'subjectType'; v_subject uuid := (p ->> 'subjectId')::uuid; v_est uuid; v_book uuid; v_id uuid;
        v_sup uuid := nullif(p ->> 'supersedes', '')::uuid; s public.tax_calculations;
begin
  if v_type in ('estimate', 'proposal_version') then
    v_est := case when v_type = 'estimate' then v_subject else (select estimate_id from public.estimate_versions where id = v_subject) end;
    if not exists (select 1 from public.estimates e where e.id = v_est and e.user_id = auth.uid() and (e.company_id is null or e.company_id = public.my_company_id())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif v_type = 'invoice' then
    select book_id into v_book from public.fin_invoices where id = v_subject;
    if v_book is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_require(v_book, 'create_invoices', true);
  else
    raise exception 'bad_subject' using errcode = '22023';
  end if;
  if v_sup is not null then
    select * into s from public.tax_calculations where id = v_sup;
    if not found or s.subject_type <> v_type or s.subject_id <> v_subject then raise exception 'not_found' using errcode = 'P0002'; end if;
    if nullif(btrim(p ->> 'correctionReason'), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  end if;
  if (p ->> 'taxAmount')::numeric <> round((p ->> 'taxAmount')::numeric, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  insert into public.tax_calculations (subject_type, subject_id, estimate_id, book_id, status, transaction_date, address, taxable_amount, nontaxable_amount,
    tax_amount, combined_rate, jurisdictions, lines, exemptions, review_reasons, source, provider, provider_ref, data_as_of, locked, supersedes, correction_reason, created_by)
  values (v_type, v_subject, v_est, v_book, coalesce(p ->> 'status', 'calculated'), coalesce(nullif(p ->> 'transactionDate', '')::date, current_date), p -> 'address',
    coalesce((p ->> 'taxableAmount')::numeric, 0), coalesce((p ->> 'nontaxableAmount')::numeric, 0), coalesce((p ->> 'taxAmount')::numeric, 0),
    nullif(p ->> 'combinedRate', '')::numeric, coalesce(p -> 'jurisdictions', '[]'), coalesce(p -> 'lines', '[]'), coalesce(p -> 'exemptions', '[]'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'reviewReasons', '[]'::jsonb))), '{}'), p ->> 'source', nullif(p ->> 'provider', ''),
    nullif(left(p ->> 'providerRef', 200), ''), nullif(p ->> 'dataAsOf', '')::timestamptz, p_lock, v_sup, nullif(left(btrim(p ->> 'correctionReason'), 500), ''), auth.uid())
  returning id into v_id;
  if v_book is not null then
    perform public.fin_audit(v_book, case when v_sup is null then 'tax.calculated' else 'tax.corrected' end, 'invoice', v_subject,
      jsonb_build_object('calc', v_id, 'tax', p ->> 'taxAmount', 'source', p ->> 'source', 'locked', p_lock, 'supersedes', v_sup, 'reasons', p -> 'reviewReasons'));
  end if;
  return v_id;
end $$;

create or replace function public.fin_tax_alert_act(p_alert_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_tax_alerts;
begin
  select * into a from public.fin_tax_alerts where id = p_alert_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.tb_can(a.book_id, 'tax.review_alerts') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('reviewed', 'dismissed') then raise exception 'bad_state' using errcode = '22023'; end if;
  update public.fin_tax_alerts set status = p_status, acted_by = auth.uid(), acted_at = now() where id = a.id;
  perform public.fin_audit(a.book_id, 'tax.alert_' || p_status, 'tax_alert', a.id, jsonb_build_object('title', a.title));
end $$;

-- Platform side (service role only): record a provider-reported change. Never activates anything that isn't a
-- verified numeric rate whose sources agree; a duplicate report returns the existing event.
create or replace function public.tax_change_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_auto boolean; e public.tax_change_events;
        v_kind text := p ->> 'kind'; v_verified boolean := coalesce((p ->> 'verified')::boolean, false);
        v_agree boolean := (p ->> 'sourcesAgree')::boolean; v_new numeric := nullif(p ->> 'newRate', '')::numeric; v_eff date := (p ->> 'effectiveDate')::date;
begin
  v_auto := v_kind = 'rate' and v_verified and v_new is not null and coalesce(v_agree, true);
  v_status := case when not v_auto then 'needs_review' when v_eff <= current_date then 'active' else 'scheduled' end;
  insert into public.tax_change_events (state, jurisdiction_code, jurisdiction_name, level, kind, summary, old_rate, new_rate, effective_date, source, provider,
                                        provider_ref, source_url, verified, sources_agree, status, activated_at, sync_run_id)
  values (upper(p ->> 'state'), p ->> 'jurisdictionCode', p ->> 'jurisdictionName', coalesce(p ->> 'level', 'state'), v_kind, left(p ->> 'summary', 500),
          nullif(p ->> 'oldRate', '')::numeric, v_new, v_eff, p ->> 'source', nullif(p ->> 'provider', ''), nullif(p ->> 'providerRef', ''), nullif(p ->> 'sourceUrl', ''),
          v_verified, v_agree, v_status, case when v_status = 'active' then now() end, nullif(p ->> 'syncRunId', '')::uuid)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    select * into e from public.tax_change_events where state = upper(p ->> 'state') and jurisdiction_code = p ->> 'jurisdictionCode' and kind = v_kind
       and effective_date = v_eff and coalesce(new_rate, -1) = coalesce(v_new, -1) and md5(summary) = md5(left(p ->> 'summary', 500));
    return jsonb_build_object('id', e.id, 'status', e.status, 'duplicate', true);
  end if;
  if v_auto then
    insert into public.tax_jurisdiction_rates (state, jurisdiction_code, jurisdiction_name, level, rate, effective_from, source, provider, source_url, change_event_id)
    values (upper(p ->> 'state'), p ->> 'jurisdictionCode', p ->> 'jurisdictionName', coalesce(p ->> 'level', 'state'), v_new, v_eff, p ->> 'source',
            nullif(p ->> 'provider', ''), nullif(p ->> 'sourceUrl', ''), v_id)
    on conflict do nothing;
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status, 'duplicate', false);
end $$;

-- Scheduled verified rate changes whose effective date has arrived become active (rates were versioned at record time,
-- so calculations pick them up by date; this flips the status that the UI and alerts show).
create or replace function public.tax_activate_due(p_today date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.tax_change_events set status = 'active', activated_at = now() where status = 'scheduled' and effective_date <= p_today;
  get diagnostics n = row_count;
  return n;
end $$;

-- One alert per affected book per change (books whose tax profile serves the state). Re-running adds nothing.
create or replace function public.tax_fanout_alerts(p_change_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.tax_change_events; n integer;
begin
  select * into e from public.tax_change_events where id = p_change_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.fin_tax_alerts (book_id, change_event_id, kind, title, state, locality, effective_date, source_url, impact, auto_updated, review_needed)
  select t.book_id, e.id, case when e.kind = 'rate' then 'rate_change' else 'rule_change' end,
         left(case when e.kind = 'rate' then 'Sales tax rates affecting your ' || a.state_name || ' service area have changed'
                   else 'A ' || a.state_name || ' tax rule change may affect your work' end, 200),
         e.state, case when e.level <> 'state' then e.jurisdiction_name end, e.effective_date, coalesce(e.source_url, a.website),
         left(e.summary || case when e.kind = 'rate' and e.old_rate is not null and position(rtrim(rtrim(e.new_rate::text, '0'), '.') || '%' in e.summary) = 0 then ' (' || rtrim(rtrim(e.old_rate::text, '0'), '.') || '% to ' || rtrim(rtrim(e.new_rate::text, '0'), '.') || '%)' else '' end, 1000),
         e.automatable and t.auto_apply_rates, not (e.automatable and t.auto_apply_rates)
    from public.fin_tax_profiles t join public.tax_authorities a on a.state = e.state
    join public.fin_books b on b.id = t.book_id and b.sandbox_of is null
   where (e.state = any (t.service_states) or e.state = t.primary_state) and t.notify_immediate
  on conflict do nothing;
  get diagnostics n = row_count;
  update public.tax_change_events set fanned_out_at = coalesce(fanned_out_at, now()) where id = e.id;
  return n;
end $$;

-- Quarterly summary: one digest per book per quarter, listing the changes in its states during that quarter.
create or replace function public.tax_quarterly_digest(p_quarter date) returns integer
language plpgsql security definer set search_path = public as $$
declare q date := date_trunc('quarter', p_quarter)::date; n integer;
begin
  insert into public.fin_tax_alerts (book_id, kind, digest_quarter, title, impact, review_needed)
  select t.book_id, 'digest', q, 'Quarterly tax update summary: Q' || extract(quarter from q) || ' ' || extract(year from q),
         left(count(e.id) || ' change(s) in your states (' || string_agg(distinct e.state, ', ') || '). '
              || count(e.id) filter (where e.status = 'needs_review') || ' need review.', 1000),
         bool_or(e.status = 'needs_review')
    from public.fin_tax_profiles t join public.fin_books b on b.id = t.book_id and b.sandbox_of is null
    join public.tax_change_events e on (e.state = any (t.service_states) or e.state = t.primary_state)
         and e.detected_at >= q and e.detected_at < (q + interval '3 months')
   where t.notify_quarterly
   group by t.book_id
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Freshness for the UI (no customer data): last good sync, last attempt, and whether anything failed since.
create or replace function public.tax_freshness() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lastSuccessAt', (select max(finished_at) from public.tax_sync_runs where kind = 'rates' and status = 'ok'),
    'lastAttemptAt', (select max(started_at) from public.tax_sync_runs where kind = 'rates'),
    'lastStatus', (select status from public.tax_sync_runs where kind = 'rates' order by started_at desc limit 1),
    'provider', (select provider from public.tax_sync_runs where kind = 'rates' order by started_at desc limit 1),
    'authoritiesReachable', (select count(*) from public.tax_authorities where source_status = 'reachable'),
    'authoritiesTotal', (select count(*) from public.tax_authorities))
$$;
revoke execute on function public.tax_freshness() from public, anon;
grant execute on function public.tax_freshness() to authenticated;

-- 12. Bank functions ---------------------------------------------------------------------------------------------
-- Create a connection + its accounts after the provider's secure flow (the server exchanged the public token and
-- will store the encrypted access token itself with the service role). p: {provider, itemRef, institutionName,
-- institutionRef, sandbox, accounts: [{ref, name, mask, kind, subtype, currency}]}.
create or replace function public.fin_bank_connection_create(p_book_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_conn uuid; x jsonb; v_ids jsonb := '[]'::jsonb; v_acct uuid; v_sandbox boolean := public.fin_is_sandbox(p_book_id);
begin
  perform public.fin_require(p_book_id, public.tb_capability_key('bank.connect'), true);
  if p ->> 'provider' = 'mock' and not (v_sandbox or coalesce((p ->> 'sandbox')::boolean, false)) then
    raise exception 'mock_outside_sandbox' using errcode = '22023';
  end if;
  insert into public.fin_bank_connections (book_id, provider, provider_item_ref, institution_name, institution_ref, sandbox, created_by, next_sync_at)
  values (p_book_id, p ->> 'provider', p ->> 'itemRef', left(p ->> 'institutionName', 200), nullif(p ->> 'institutionRef', ''),
          v_sandbox or coalesce((p ->> 'sandbox')::boolean, false), auth.uid(), now())
  returning id into v_conn;
  for x in select * from jsonb_array_elements(coalesce(p -> 'accounts', '[]'::jsonb)) loop
    if nullif(x ->> 'mask', '') is not null and (x ->> 'mask') !~ '^[0-9]{4}$' then raise exception 'bad_last4' using errcode = '22023'; end if;
    insert into public.fin_bank_accounts (book_id, name, kind, last4, opening_balance, opening_date, source, connection_id, provider_account_ref, currency,
                                          subtype, institution_name, created_by)
    values (p_book_id, left(coalesce(nullif(btrim(x ->> 'name'), ''), 'Account'), 120),
            case when x ->> 'kind' in ('checking', 'savings', 'credit_card') then x ->> 'kind' else 'other' end, nullif(x ->> 'mask', ''), 0, current_date,
            'provider_feed', v_conn, x ->> 'ref', coalesce(nullif(x ->> 'currency', ''), 'USD'), nullif(left(x ->> 'subtype', 40), ''), left(p ->> 'institutionName', 200), auth.uid())
    returning id into v_acct;
    v_ids := v_ids || jsonb_build_object('ref', x ->> 'ref', 'accountId', v_acct);
  end loop;
  -- First connected checking account becomes primary when the book has none.
  update public.fin_bank_accounts set is_primary = true
   where id = (select id from public.fin_bank_accounts where connection_id = v_conn and kind = 'checking' order by created_at limit 1)
     and not exists (select 1 from public.fin_bank_accounts where book_id = p_book_id and is_primary and status = 'active');
  perform public.fin_audit(p_book_id, 'bank.connected', 'bank_connection', v_conn, jsonb_build_object('provider', p ->> 'provider', 'institution', p ->> 'institutionName',
    'accounts', jsonb_array_length(v_ids)));
  return jsonb_build_object('connectionId', v_conn, 'accounts', v_ids);
end $$;

create or replace function public.fin_bank_set_primary(p_account_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.fin_bank_accounts;
begin
  select * into a from public.fin_bank_accounts where id = p_account_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(a.book_id, public.tb_capability_key('bank.connect'), true);
  if a.status <> 'active' then raise exception 'account_archived' using errcode = '22023'; end if;
  update public.fin_bank_accounts set is_primary = false where book_id = a.book_id and is_primary and id <> a.id;
  update public.fin_bank_accounts set is_primary = true where id = a.id;
  perform public.fin_audit(a.book_id, 'bank.primary_set', 'bank_account', a.id, jsonb_build_object('name', a.name));
end $$;

-- Disconnect: the token is destroyed, the connection stays as history, imported bank lines and balances are kept
-- (they are bank-source records), accounts stop syncing and drop out of the forecast.
create or replace function public.fin_bank_connection_disconnect(p_connection_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.fin_bank_connections;
begin
  select * into c from public.fin_bank_connections where id = p_connection_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(c.book_id, public.tb_capability_key('bank.disconnect'), true);
  if c.status = 'disconnected' then return; end if;
  delete from public.fin_bank_connection_secrets where connection_id = c.id;
  update public.fin_bank_connections set status = 'disconnected', disconnected_by = auth.uid(), disconnected_at = now(), next_sync_at = null where id = c.id;
  update public.fin_bank_accounts set is_primary = false where connection_id = c.id;
  perform public.fin_audit(c.book_id, 'bank.disconnected', 'bank_connection', c.id, jsonb_build_object('institution', c.institution_name, 'reason', p_reason));
end $$;

-- Manual refresh gate: reconcile permission, active connection, at most 5 per connection per day (provider rate limits).
create or replace function public.fin_bank_refresh_allowed(p_connection_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.fin_bank_connections;
begin
  select * into c from public.fin_bank_connections where id = p_connection_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.fin_require(c.book_id, public.tb_capability_key('bank.view_balances'), true);
  if c.status = 'disconnected' then raise exception 'disconnected' using errcode = '22023'; end if;
  if c.manual_refresh_day = current_date and c.manual_refreshes_today >= 5 then raise exception 'rate_limited' using errcode = '22023'; end if;
  update public.fin_bank_connections set manual_refresh_day = current_date,
    manual_refreshes_today = case when manual_refresh_day = current_date then manual_refreshes_today + 1 else 1 end where id = c.id;
  return jsonb_build_object('connectionId', c.id, 'provider', c.provider, 'bookId', c.book_id, 'sandbox', c.sandbox);
end $$;

-- Provider sync result (service role only: the server calls it after reading the provider). p: {status, errorCode,
-- errorMessage, historyPartial, balances: [{ref, current, available, currency, asOf}], transactions: [{ref, date,
-- description, amount (+ in / - out), txnRef, checkNumber}]}. Pending transactions are never sent here.
create or replace function public.fin_bank_feed_ingest(p_connection_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.fin_bank_connections; a public.fin_bank_accounts; v_status text := coalesce(p ->> 'status', 'active'); v_rows jsonb; v_import uuid;
        v_n integer; v_ins integer := 0; v_total integer := 0; v_bal integer := 0; b jsonb; v_sum numeric; v_min date; v_cur numeric;
begin
  select * into c from public.fin_bank_connections where id = p_connection_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status = 'disconnected' then raise exception 'disconnected' using errcode = '22023'; end if;
  if v_status not in ('active', 'needs_reauth', 'revoked', 'institution_down', 'error') then raise exception 'bad_state' using errcode = '22023'; end if;
  update public.fin_bank_connections set status = v_status, error_code = nullif(left(p ->> 'errorCode', 80), ''), error_message = nullif(left(p ->> 'errorMessage', 300), ''),
    history_partial = coalesce((p ->> 'historyPartial')::boolean, history_partial), last_sync_at = now(),
    last_success_at = case when v_status = 'active' then now() else last_success_at end, next_sync_at = now() + interval '1 day'
   where id = c.id;
  if v_status <> 'active' then
    perform public.fin_audit(c.book_id, 'bank.sync_failed', 'bank_connection', c.id, jsonb_build_object('status', v_status, 'code', p ->> 'errorCode'));
    return jsonb_build_object('status', v_status, 'inserted', 0, 'balances', 0);
  end if;
  for a in select * from public.fin_bank_accounts where connection_id = c.id and status = 'active' loop
    v_rows := coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p -> 'transactions', '[]'::jsonb)) x where x ->> 'ref' = a.provider_account_ref), '[]'::jsonb);
    v_n := jsonb_array_length(v_rows);
    b := (select x from jsonb_array_elements(coalesce(p -> 'balances', '[]'::jsonb)) x where x ->> 'ref' = a.provider_account_ref limit 1);
    v_cur := nullif(b ->> 'current', '')::numeric;
    if v_n > 0 then
      create temp table if not exists fin_bank_feed_rows (d date, descr text, amt numeric, chk text, ref text, fp text) on commit drop;
      truncate fin_bank_feed_rows;
      insert into fin_bank_feed_rows
      select (x ->> 'date')::date, left(coalesce(nullif(btrim(x ->> 'description'), ''), 'Bank transaction'), 300), (x ->> 'amount')::numeric,
             nullif(left(x ->> 'checkNumber', 20), ''), left(x ->> 'txnRef', 80), md5('feed|' || coalesce(x ->> 'txnRef', md5(x::text)))
        from jsonb_array_elements(v_rows) x
       where nullif(x ->> 'date', '') is not null and (x ->> 'amount')::numeric <> 0 and (x ->> 'amount')::numeric = round((x ->> 'amount')::numeric, 2);
      -- First sync for this account: derive the opening balance so reconciliation (opening + lines) equals what the bank reports.
      if v_cur is not null and not exists (select 1 from public.fin_bank_transactions t where t.account_id = a.id) then
        select coalesce(sum(amt), 0), min(d) into v_sum, v_min from fin_bank_feed_rows;
        update public.fin_bank_accounts set opening_balance = v_cur - v_sum, opening_date = coalesce(v_min, current_date) where id = a.id;
      end if;
      select count(*) into v_ins from fin_bank_feed_rows r where not exists (select 1 from public.fin_bank_transactions t where t.account_id = a.id and t.fingerprint = r.fp);
      if v_ins > 0 then
        insert into public.fin_bank_imports (book_id, account_id, file_name, file_hash, statement_start, statement_end, row_count, inserted_count, skipped_count, total_in, total_out, balanced)
        select a.book_id, a.id, left(c.institution_name || ' feed ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), 200), md5(c.id::text || now()::text || a.id::text),
               min(d), max(d), count(*), v_ins, count(*) - v_ins, coalesce(sum(greatest(amt, 0)), 0), coalesce(sum(greatest(-amt, 0)), 0), null
          from fin_bank_feed_rows
        returning id into v_import;
        insert into public.fin_bank_transactions (book_id, account_id, import_id, posted_on, description, amount, check_number, bank_ref, fingerprint)
        select a.book_id, a.id, v_import, d, descr, amt, chk, ref, fp from fin_bank_feed_rows on conflict (account_id, fingerprint) do nothing;
      end if;
      v_total := v_total + v_ins;
    elsif v_cur is not null and not exists (select 1 from public.fin_bank_transactions t where t.account_id = a.id) then
      update public.fin_bank_accounts set opening_balance = v_cur, opening_date = current_date where id = a.id;
    end if;
    if b is not null and (nullif(b ->> 'current', '') is not null or nullif(b ->> 'available', '') is not null) then
      insert into public.fin_bank_balances (book_id, account_id, current_balance, available_balance, currency, as_of, source)
      values (a.book_id, a.id, v_cur, nullif(b ->> 'available', '')::numeric, coalesce(nullif(b ->> 'currency', ''), a.currency),
              coalesce(nullif(b ->> 'asOf', '')::timestamptz, now()), c.provider);
      v_bal := v_bal + 1;
    end if;
  end loop;
  perform public.fin_audit(c.book_id, 'bank.synced', 'bank_connection', c.id, jsonb_build_object('inserted', v_total, 'balances', v_bal));
  return jsonb_build_object('status', 'active', 'inserted', v_total, 'balances', v_bal);
end $$;

create or replace function public.fin_cash_event_save(p_book_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_kind text := p ->> 'kind'; v_amt numeric := (p ->> 'amount')::numeric;
begin
  perform public.fin_require(p_book_id, public.tb_capability_key('cash.manage_plan'), true);
  if v_id is not null then
    update public.fin_cash_events set status = coalesce(nullif(p ->> 'status', ''), status), settlement = coalesce(nullif(p ->> 'settlement', ''), settlement),
      expected_on = coalesce(nullif(p ->> 'expectedOn', '')::date, expected_on)
     where id = v_id and book_id = p_book_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    perform public.fin_audit(p_book_id, 'cash.event_updated', 'cash_event', v_id, p - 'note');
    return v_id;
  end if;
  if v_amt is null or v_amt <= 0 or v_amt <> round(v_amt, 2) then raise exception 'bad_amount' using errcode = '22023'; end if;
  if nullif(p ->> 'accountId', '') is not null and not exists (select 1 from public.fin_bank_accounts where id = (p ->> 'accountId')::uuid and book_id = p_book_id) then
    raise exception 'not_found' using errcode = 'P0002'; end if;
  if nullif(p ->> 'toAccountId', '') is not null and not exists (select 1 from public.fin_bank_accounts where id = (p ->> 'toAccountId')::uuid and book_id = p_book_id) then
    raise exception 'not_found' using errcode = 'P0002'; end if;
  if nullif(p ->> 'invoiceId', '') is not null and not exists (select 1 from public.fin_invoices where id = (p ->> 'invoiceId')::uuid and book_id = p_book_id) then
    raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.fin_cash_events (book_id, kind, label, amount, direction, expected_on, recurrence, recur_until, certainty, account_id, to_account_id, invoice_id, settlement, note, created_by)
  values (p_book_id, v_kind, left(btrim(p ->> 'label'), 200), v_amt,
          case when v_kind in ('expected_deposit', 'other_inflow') then 'in' when v_kind = 'transfer' then 'out' else 'out' end,
          (p ->> 'expectedOn')::date, coalesce(nullif(p ->> 'recurrence', ''), 'none'), nullif(p ->> 'recurUntil', '')::date,
          case when v_kind = 'expected_deposit' then 'expected' else coalesce(nullif(p ->> 'certainty', ''), 'scheduled') end,
          nullif(p ->> 'accountId', '')::uuid, nullif(p ->> 'toAccountId', '')::uuid, nullif(p ->> 'invoiceId', '')::uuid, nullif(p ->> 'settlement', ''),
          nullif(left(p ->> 'note', 500), ''), auth.uid())
  returning id into v_id;
  perform public.fin_audit(p_book_id, 'cash.event_added', 'cash_event', v_id, jsonb_build_object('kind', v_kind, 'amount', v_amt::text, 'on', p ->> 'expectedOn'));
  return v_id;
end $$;

-- 13. Owner monitoring (aggregates only; never one customer's balances or transactions) -------------------------
create or replace function public.admin_tax_banking_health() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tax', public.tax_freshness() || jsonb_build_object(
      'syncFailures7d', (select count(*) from public.tax_sync_runs where status = 'failed' and started_at > now() - interval '7 days'),
      'apiCalls30d', (select coalesce(sum(api_calls), 0) from public.tax_sync_runs where started_at > now() - interval '30 days'),
      'changesNeedingReview', (select count(*) from public.tax_change_events where status = 'needs_review'),
      'changesScheduled', (select count(*) from public.tax_change_events where status = 'scheduled'),
      'statesWithProfiles', (select count(distinct s) from public.fin_tax_profiles, unnest(service_states) s),
      'booksWithProfiles', (select count(*) from public.fin_tax_profiles),
      'failedCalcs30d', (select count(*) from public.tax_calculations where status = 'failed' and calculated_at > now() - interval '30 days'),
      'reviewCalcs30d', (select count(*) from public.tax_calculations where status = 'needs_review' and calculated_at > now() - interval '30 days')),
    'bank', jsonb_build_object(
      'connectionsByStatus', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.fin_bank_connections where not sandbox group by status) s), '{}'::jsonb),
      'connectionsByProvider', coalesce((select jsonb_object_agg(provider, n) from (select provider, count(*) n from public.fin_bank_connections where not sandbox and status <> 'disconnected' group by provider) s), '{}'::jsonb),
      'linkedAccounts', (select count(*) from public.fin_bank_accounts a join public.fin_bank_connections c on c.id = a.connection_id where not c.sandbox and c.status <> 'disconnected' and a.status = 'active'),
      'staleConnections', (select count(*) from public.fin_bank_connections where not sandbox and status = 'active' and coalesce(last_success_at, created_at) < now() - interval '2 days'),
      'syncErrors7d', (select count(*) from public.fin_audit_log where action = 'bank.sync_failed' and created_at > now() - interval '7 days')))
$$;

revoke execute on function public.fin_tax_profile_save(uuid, jsonb), public.fin_tax_exemption_save(uuid, jsonb), public.tax_calc_record(jsonb, boolean),
  public.fin_tax_alert_act(uuid, text), public.fin_bank_connection_create(uuid, jsonb), public.fin_bank_set_primary(uuid),
  public.fin_bank_connection_disconnect(uuid, text), public.fin_bank_refresh_allowed(uuid), public.fin_cash_event_save(uuid, jsonb) from public, anon;
grant execute on function public.fin_tax_profile_save(uuid, jsonb), public.fin_tax_exemption_save(uuid, jsonb), public.tax_calc_record(jsonb, boolean),
  public.fin_tax_alert_act(uuid, text), public.fin_bank_connection_create(uuid, jsonb), public.fin_bank_set_primary(uuid),
  public.fin_bank_connection_disconnect(uuid, text), public.fin_bank_refresh_allowed(uuid), public.fin_cash_event_save(uuid, jsonb) to authenticated;
revoke execute on function public.tax_change_record(jsonb), public.tax_activate_due(date), public.tax_fanout_alerts(uuid), public.tax_quarterly_digest(date),
  public.fin_bank_feed_ingest(uuid, jsonb), public.admin_tax_banking_health() from public, anon, authenticated;
grant execute on function public.tax_change_record(jsonb), public.tax_activate_due(date), public.tax_fanout_alerts(uuid), public.tax_quarterly_digest(date),
  public.fin_bank_feed_ingest(uuid, jsonb), public.admin_tax_banking_health() to service_role;

-- Books with provider connections or tax snapshots hold records (retention + purge rules).
create or replace function public.fin_book_has_records(p_book_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t text; v boolean;
begin
  foreach t in array array['fin_jobs', 'fin_invoices', 'fin_payments', 'fin_credit_memos', 'fin_refunds', 'fin_vendor_bills',
                           'fin_expenses', 'fin_commitments', 'fin_documents', 'fin_vendors', 'fin_bank_transactions', 'fin_bank_connections', 'fin_bank_balances'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I where book_id = $1)', t) into v using p_book_id;
      if v then return true; end if;
    end if;
  end loop;
  return false;
end $$;
revoke execute on function public.fin_book_has_records(uuid) from public, anon, authenticated;
