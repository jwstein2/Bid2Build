-- =====================================================================================================
-- Payout taxes, withholding and tax-season documents (V8.4)
--
-- Built2Bid's OWN payees only (staff on the contractor path, sales reps, affiliates). Never a contractor
-- customer's workers. Builds on V8.1 staff payouts (20270207001000), the Affiliate Hub (20270211001000) and
-- commission reconciliation (20270223001000).
--
-- What this adds:
--   1. payout_tax_settings: payer details for 1099s, backup withholding switch (OFF) + rate (UNVERIFIED),
--      filing method and Form 945 deposit schedule.
--   2. payout_state_tax_rules: one row per state + DC. Every row starts UNVERIFIED. Nothing here is treated as
--      law until the owner (with a CPA) marks the state verified with a source note.
--   3. Backup withholding on payouts: federal + state, computed by a trigger from the payee's IRS-notice flag,
--      only when the owner turned withholding on. A flagged payee is HELD (never paid in full) while it's off.
--   4. Live payouts need the payee's tax state known and that state's rules verified (state-by-state gate).
--   5. Owner records: state filings (contractor reports, state 1099s) and withholding deposits (EFTPS etc.).
--   6. admin_tax_season(): one JSON for the Tax season tab and every CSV / PDF download.
--
-- Safe to re-run. Changes no money settings: payout mode, provider and live activation are untouched.
-- Rollback: docs/payout-taxes/rollback_20270304001000.sql
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.payout_tax_settings (
  id                          boolean primary key default true check (id),
  payer_legal_name            text not null default 'Built2Bid L.L.C.' check (char_length(payer_legal_name) between 1 and 200),
  payer_ein                   text check (payer_ein ~ '^[0-9]{2}-[0-9]{7}$'),
  payer_address               text check (char_length(payer_address) <= 300),
  payer_phone                 text check (char_length(payer_phone) <= 40),
  payer_state_ids             jsonb not null default '{}'::jsonb,       -- {"MN": "1234567"}: state withholding / payer ids
  backup_withholding_enabled  boolean not null default false,
  backup_withholding_bps      integer not null default 2400 check (backup_withholding_bps between 0 and 5000),
  backup_rate_verified        boolean not null default false,
  backup_rate_source          text not null default 'IRS Publication 1281 / Form 945 instructions: backup withholding rate 24% (IRC 3406). Confirm with your CPA before turning withholding on.'
                                check (char_length(backup_rate_source) between 1 and 500),
  filing_method               text not null default 'not_chosen' check (filing_method in ('not_chosen', 'accountant', 'filing_service', 'irs_iris')),
  deposit_schedule            text not null default 'not_set' check (deposit_schedule in ('not_set', 'monthly', 'semiweekly')),
  cpa_name                    text check (char_length(cpa_name) <= 200),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users (id) on delete set null
);
insert into public.payout_tax_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- 2. State rules (all unverified). Only a few widely published facts are pre-filled, and they are still
--    unverified: no-income-tax states, and California's contractor reporting + 7% backup withholding.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.payout_state_tax_rules (
  state                          text primary key check (state ~ '^[A-Z]{2}$'),
  name                           text not null check (char_length(name) between 2 and 40),
  has_income_tax                 boolean,                                  -- null = not checked
  state_1099_filing              text not null default 'unknown' check (state_1099_filing in ('unknown', 'cfsf', 'direct', 'direct_if_withholding', 'none_expected')),
  state_1099_threshold_cents     integer check (state_1099_threshold_cents between 0 and 100000000),
  state_backup_withholding_bps   integer check (state_backup_withholding_bps between 0 and 2000),
  nonresident_withholding_note   text check (char_length(nonresident_withholding_note) <= 500),
  contractor_reporting           text not null default 'unknown' check (contractor_reporting in ('unknown', 'required', 'not_required')),
  contractor_report_threshold_cents integer check (contractor_report_threshold_cents between 0 and 100000000),
  contractor_report_days         integer check (contractor_report_days between 1 and 120),
  agency_url                     text check (agency_url ~ '^https://' and char_length(agency_url) <= 300),
  notes                          text check (char_length(notes) <= 1000),
  verified                       boolean not null default false,
  verified_at                    timestamptz,
  verified_by                    uuid references auth.users (id) on delete set null,
  source_note                    text check (char_length(source_note) <= 500),
  updated_at                     timestamptz not null default now(),
  constraint state_rule_verified check (not verified or (verified_at is not null and char_length(coalesce(source_note, '')) >= 5))
);

insert into public.payout_state_tax_rules (state, name) values
  ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),('CA','California'),('CO','Colorado'),('CT','Connecticut'),
  ('DE','Delaware'),('DC','District of Columbia'),('FL','Florida'),('GA','Georgia'),('HI','Hawaii'),('ID','Idaho'),('IL','Illinois'),
  ('IN','Indiana'),('IA','Iowa'),('KS','Kansas'),('KY','Kentucky'),('LA','Louisiana'),('ME','Maine'),('MD','Maryland'),
  ('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),('MS','Mississippi'),('MO','Missouri'),('MT','Montana'),('NE','Nebraska'),
  ('NV','Nevada'),('NH','New Hampshire'),('NJ','New Jersey'),('NM','New Mexico'),('NY','New York'),('NC','North Carolina'),('ND','North Dakota'),
  ('OH','Ohio'),('OK','Oklahoma'),('OR','Oregon'),('PA','Pennsylvania'),('RI','Rhode Island'),('SC','South Carolina'),('SD','South Dakota'),
  ('TN','Tennessee'),('TX','Texas'),('UT','Utah'),('VT','Vermont'),('VA','Virginia'),('WA','Washington'),('WV','West Virginia'),
  ('WI','Wisconsin'),('WY','Wyoming')
on conflict (state) do nothing;

-- Pre-fill (unverified) only where nothing was entered yet.
update public.payout_state_tax_rules set has_income_tax = false, state_1099_filing = 'none_expected',
  notes = 'No broad personal income tax on wages or contractor pay, so no state 1099 filing is expected. Unverified: confirm with your CPA.'
where state in ('AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY') and has_income_tax is null and not verified;
update public.payout_state_tax_rules set has_income_tax = true, contractor_reporting = 'required', contractor_report_threshold_cents = 60000, contractor_report_days = 20,
  state_backup_withholding_bps = 700, agency_url = 'https://edd.ca.gov',
  nonresident_withholding_note = 'Nonresident payees performing services in California may be subject to 7% nonresident withholding (Form 592) above a yearly threshold. Ask your CPA.',
  notes = 'Independent contractor reporting (EDD Form DE 542) when you pay or contract to pay $600 or more, within 20 days. California backup withholding of 7% applies when federal backup withholding applies. Unverified: confirm with your CPA.'
where state = 'CA' and has_income_tax is null and not verified;
update public.payout_state_tax_rules set has_income_tax = true,
  notes = 'Built2Bid''s reps work in Minnesota: verify this state first (state 1099 filing, contractor reporting, withholding).'
where state = 'MN' and has_income_tax is null and not verified;

-- Free-text state ("mn", "Minnesota") -> 'MN', or null.
create or replace function public.us_state_code(p text) returns text
language sql stable security definer set search_path = public as $$
  select r.state from public.payout_state_tax_rules r
  where r.state = upper(btrim(coalesce(p, ''))) or lower(r.name) = lower(btrim(coalesce(p, '')))
  limit 1
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Payee tax status (both payee types): reason for backup withholding + IRS TIN Matching result.
-- ---------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['staff_tax_profiles', 'affiliate_tax_profiles'] loop
    execute format('alter table public.%I add column if not exists backup_withholding_reason text check (backup_withholding_reason in (''irs_b_notice'', ''irs_cp2100'', ''irs_notified'', ''other''))', t);
    execute format('alter table public.%I add column if not exists backup_withholding_since date', t);
    execute format('alter table public.%I add column if not exists tin_match_status text not null default ''not_checked'' check (tin_match_status in (''not_checked'', ''matched'', ''mismatch''))', t);
    execute format('alter table public.%I add column if not exists tin_matched_on date', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Withholding on payouts
-- ---------------------------------------------------------------------------------------------------
alter table public.payouts add column if not exists withholding_cents integer not null default 0 check (withholding_cents >= 0);
alter table public.payouts add column if not exists state_withholding_cents integer not null default 0 check (state_withholding_cents >= 0);
alter table public.payouts add column if not exists tax_state text check (tax_state ~ '^[A-Z]{2}$');
alter table public.payouts add column if not exists withholding_reason text check (char_length(withholding_reason) <= 60);
alter table public.payouts drop constraint if exists payouts_net;
alter table public.payouts add constraint payouts_net check (net_cents = greatest(gross_cents + adjustments_cents
  - case when fee_bearer = 'recipient' then fee_cents else 0 end - withholding_cents - state_withholding_cents, 0));
create index if not exists payouts_tax_year on public.payouts (tax_year) where mode = 'live' and status = 'paid';

/** The payee's tax state and IRS-notice flag (staff or affiliate). */
create or replace function public.payee_tax_facts(p_staff uuid, p_affiliate uuid, out tax_state text, out flagged boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  flagged := false;
  if p_staff is not null then
    select public.us_state_code(coalesce(m.work_state, m.state)), coalesce(t.backup_withholding, false) into tax_state, flagged
    from public.staff_members m left join public.staff_tax_profiles t on t.staff_id = m.id where m.id = p_staff;
  elsif p_affiliate is not null then
    select public.us_state_code(a.state), coalesce(t.backup_withholding, false) into tax_state, flagged
    from public.affiliates a left join public.affiliate_tax_profiles t on t.affiliate_id = a.id where a.id = p_affiliate;
  end if;
  flagged := coalesce(flagged, false);
end $$;

/**
 * Tax blockers added to both payee blocker lists:
 *  - backup_withholding_setup: the payee has an IRS notice but withholding is off (never pay them in full).
 *  - tax_state_missing / state_tax_rule_unverified: LIVE only. The payee's state must be known and verified.
 */
create or replace function public.payee_tax_blockers(p_staff uuid, p_affiliate uuid, p_mode text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare f record; ts public.payout_tax_settings; r public.payout_state_tax_rules; v text[] := '{}';
begin
  select * into f from public.payee_tax_facts(p_staff, p_affiliate);
  select * into ts from public.payout_tax_settings where id;
  if f.flagged and not coalesce(ts.backup_withholding_enabled, false) then v := array_append(v, 'backup_withholding_setup'); end if;
  if p_mode = 'live' then
    if f.tax_state is null then v := array_append(v, 'tax_state_missing');
    else
      select * into r from public.payout_state_tax_rules where state = f.tax_state;
      if not coalesce(r.verified, false) then v := array_append(v, 'state_tax_rule_unverified'); end if;
    end if;
  end if;
  return v;
end $$;

/**
 * Backup withholding, computed on every write before a payout is submitted. Federal at the settings rate and
 * the state rate when that state is verified and has one, both only for payees with an IRS-notice flag and only
 * while the owner has withholding on. Net = gross + adjustments - recipient fee - withholding.
 */
create or replace function public.payouts_apply_withholding() returns trigger
language plpgsql security definer set search_path = public as $$
declare ts public.payout_tax_settings; f record; r public.payout_state_tax_rules; v_base integer; v_fed integer := 0; v_st integer := 0; v_fee integer;
begin
  if tg_op = 'UPDATE' and (new.provider_ref is not null or new.status not in ('scheduled', 'held', 'needs_approval')) then
    return new;   -- frozen once claimed for sending: the amount sent is the amount recorded
  end if;
  select * into ts from public.payout_tax_settings where id;
  select * into f from public.payee_tax_facts(new.staff_id, new.affiliate_id);
  new.tax_state := f.tax_state;
  v_base := greatest(new.gross_cents + new.adjustments_cents, 0);
  if f.flagged and coalesce(ts.backup_withholding_enabled, false) then
    v_fed := round(v_base * ts.backup_withholding_bps / 10000.0)::integer;
    select * into r from public.payout_state_tax_rules where state = f.tax_state;
    if coalesce(r.verified, false) and r.state_backup_withholding_bps is not null then
      v_st := round(v_base * r.state_backup_withholding_bps / 10000.0)::integer;
    end if;
  end if;
  v_fee := case when new.fee_bearer = 'recipient' then new.fee_cents else 0 end;
  v_fed := least(v_fed, v_base);
  v_st := least(v_st, v_base - v_fed);
  new.withholding_cents := v_fed;
  new.state_withholding_cents := v_st;
  new.withholding_reason := case when v_fed + v_st > 0 then 'backup_withholding' end;
  new.net_cents := greatest(v_base - v_fee - v_fed - v_st, 0);
  return new;
end $$;
drop trigger if exists payouts_withholding on public.payouts;
create trigger payouts_withholding before insert or update on public.payouts for each row execute function public.payouts_apply_withholding();

-- Re-run the trigger on payouts that haven't been sent (after a flag, rate or state rule changes).
create or replace function public.payout_tax_refresh(p_staff uuid default null, p_affiliate uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.payouts set updated_at = now()
  where status in ('scheduled', 'held', 'needs_approval') and provider_ref is null
    and (p_staff is null or staff_id = p_staff) and (p_affiliate is null or affiliate_id = p_affiliate);
  get diagnostics n = row_count;
  return n;
end $$;

-- Blocker lists: latest definitions (20270207001000 / 20270211001000) + the tax blockers.
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
  return v || public.payee_tax_blockers(p_staff, null, p_mode);
end $$;

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
  return v || public.payee_tax_blockers(null, p_affiliate, p_mode);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Owner records: state filings and withholding deposits
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.payee_state_filings (
  id            uuid primary key default gen_random_uuid(),
  payee_kind    text not null check (payee_kind in ('staff', 'affiliate')),
  payee_id      uuid not null,
  state         text not null check (state ~ '^[A-Z]{2}$'),
  kind          text not null check (kind in ('contractor_report', 'state_1099', 'other')),
  tax_year      integer not null check (tax_year between 2020 and 2100),
  filed_on      date not null,
  confirmation  text check (char_length(confirmation) <= 200),
  note          text check (char_length(note) <= 500),
  recorded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists payee_state_filings_year on public.payee_state_filings (tax_year, state);

create table if not exists public.payout_withholding_deposits (
  id            uuid primary key default gen_random_uuid(),
  tax_year      integer not null check (tax_year between 2020 and 2100),
  jurisdiction  text not null check (jurisdiction = 'federal' or jurisdiction ~ '^[A-Z]{2}$'),
  period_month  date not null check (period_month = date_trunc('month', period_month)::date),
  amount_cents  integer not null check (amount_cents > 0),
  deposited_on  date not null,
  confirmation  text check (char_length(confirmation) <= 200),        -- e.g. EFTPS acknowledgement number
  note          text check (char_length(note) <= 500),
  recorded_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists payout_withholding_deposits_year on public.payout_withholding_deposits (tax_year, jurisdiction);

do $$ declare t text; begin
  foreach t in array array['payout_tax_settings', 'payout_state_tax_rules', 'payee_state_filings', 'payout_withholding_deposits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Owner functions (every one re-checks the caller)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_payout_tax_settings_save(p_caller uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payout_tax_settings; v_enable boolean; v_verified boolean;
begin
  perform public.staff_require_owner(p_caller);
  select * into s from public.payout_tax_settings where id for update;
  v_verified := coalesce((p ->> 'backup_rate_verified')::boolean, s.backup_rate_verified);
  v_enable := coalesce((p ->> 'backup_withholding_enabled')::boolean, s.backup_withholding_enabled);
  if v_enable and not v_verified then raise exception 'rate_not_verified' using errcode = '22023'; end if;
  update public.payout_tax_settings set
    payer_legal_name = coalesce(nullif(btrim(p ->> 'payer_legal_name'), ''), payer_legal_name),
    payer_ein = case when p ? 'payer_ein' then nullif(btrim(p ->> 'payer_ein'), '') else payer_ein end,
    payer_address = case when p ? 'payer_address' then nullif(btrim(p ->> 'payer_address'), '') else payer_address end,
    payer_phone = case when p ? 'payer_phone' then nullif(btrim(p ->> 'payer_phone'), '') else payer_phone end,
    payer_state_ids = case when jsonb_typeof(p -> 'payer_state_ids') = 'object' then p -> 'payer_state_ids' else payer_state_ids end,
    backup_withholding_bps = coalesce((p ->> 'backup_withholding_bps')::integer, backup_withholding_bps),
    backup_rate_verified = v_verified,
    backup_rate_source = coalesce(nullif(btrim(p ->> 'backup_rate_source'), ''), backup_rate_source),
    backup_withholding_enabled = v_enable,
    filing_method = coalesce(nullif(p ->> 'filing_method', ''), filing_method),
    deposit_schedule = coalesce(nullif(p ->> 'deposit_schedule', ''), deposit_schedule),
    cpa_name = case when p ? 'cpa_name' then nullif(btrim(p ->> 'cpa_name'), '') else cpa_name end,
    updated_at = now(), updated_by = p_caller
  where id returning * into s;
  perform public.payout_tax_refresh();
  perform public.staff_audit(p_caller, 'payout_tax.settings_saved', 'payout_tax_settings', 'singleton',
    jsonb_build_object('backup_withholding_enabled', s.backup_withholding_enabled, 'bps', s.backup_withholding_bps, 'rate_verified', s.backup_rate_verified,
      'filing_method', s.filing_method, 'deposit_schedule', s.deposit_schedule));
  return to_jsonb(s);
end $$;

create or replace function public.admin_state_tax_rule_save(p_caller uuid, p_state text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.payout_state_tax_rules; v_verified boolean;
begin
  perform public.staff_require_owner(p_caller);
  select * into r from public.payout_state_tax_rules where state = upper(p_state) for update;
  if not found then raise exception 'unknown_state' using errcode = '22023'; end if;
  v_verified := coalesce((p ->> 'verified')::boolean, r.verified);
  update public.payout_state_tax_rules set
    has_income_tax = case when p ? 'has_income_tax' then (p ->> 'has_income_tax')::boolean else has_income_tax end,
    state_1099_filing = coalesce(nullif(p ->> 'state_1099_filing', ''), state_1099_filing),
    state_1099_threshold_cents = case when p ? 'state_1099_threshold_cents' then (p ->> 'state_1099_threshold_cents')::integer else state_1099_threshold_cents end,
    state_backup_withholding_bps = case when p ? 'state_backup_withholding_bps' then (p ->> 'state_backup_withholding_bps')::integer else state_backup_withholding_bps end,
    nonresident_withholding_note = case when p ? 'nonresident_withholding_note' then nullif(btrim(p ->> 'nonresident_withholding_note'), '') else nonresident_withholding_note end,
    contractor_reporting = coalesce(nullif(p ->> 'contractor_reporting', ''), contractor_reporting),
    contractor_report_threshold_cents = case when p ? 'contractor_report_threshold_cents' then (p ->> 'contractor_report_threshold_cents')::integer else contractor_report_threshold_cents end,
    contractor_report_days = case when p ? 'contractor_report_days' then (p ->> 'contractor_report_days')::integer else contractor_report_days end,
    agency_url = case when p ? 'agency_url' then nullif(btrim(p ->> 'agency_url'), '') else agency_url end,
    notes = case when p ? 'notes' then nullif(btrim(p ->> 'notes'), '') else notes end,
    source_note = case when p ? 'source_note' then nullif(btrim(p ->> 'source_note'), '') else source_note end,
    verified = v_verified,
    verified_at = case when v_verified then coalesce(case when r.verified then r.verified_at end, now()) end,
    verified_by = case when v_verified then coalesce(case when r.verified then r.verified_by end, p_caller) end,
    updated_at = now()
  where state = r.state returning * into r;
  perform public.payout_tax_refresh();
  perform public.staff_audit(p_caller, case when v_verified then 'payout_tax.state_verified' else 'payout_tax.state_saved' end, 'state_tax_rule', r.state, to_jsonb(r) - 'updated_at');
  return to_jsonb(r);
end $$;

create or replace function public.admin_payee_tax_status_save(p_caller uuid, p_kind text, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_flag boolean; v_reason text; v_since date; v_match text; v_matched date;
begin
  perform public.staff_require_owner(p_caller);
  v_flag := (p ->> 'backup_withholding')::boolean;
  v_reason := nullif(p ->> 'backup_withholding_reason', '');
  v_since := nullif(p ->> 'backup_withholding_since', '')::date;
  v_match := nullif(p ->> 'tin_match_status', '');
  v_matched := nullif(p ->> 'tin_matched_on', '')::date;
  if v_flag and v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_kind = 'staff' then
    insert into public.staff_tax_profiles (staff_id) values (p_id) on conflict (staff_id) do nothing;
    update public.staff_tax_profiles set
      backup_withholding = coalesce(v_flag, backup_withholding),
      backup_withholding_reason = case when v_flag is null then backup_withholding_reason when v_flag then v_reason end,
      backup_withholding_since = case when v_flag is null then backup_withholding_since when v_flag then coalesce(v_since, current_date) end,
      tin_match_status = coalesce(v_match, tin_match_status),
      tin_matched_on = case when v_match is null then tin_matched_on else coalesce(v_matched, current_date) end
    where staff_id = p_id;
    perform public.payout_tax_refresh(p_id, null);
  elsif p_kind = 'affiliate' then
    if not exists (select 1 from public.affiliates where id = p_id) then raise exception 'not_found' using errcode = '22023'; end if;
    insert into public.affiliate_tax_profiles (affiliate_id) values (p_id) on conflict (affiliate_id) do nothing;
    update public.affiliate_tax_profiles set
      backup_withholding = coalesce(v_flag, backup_withholding),
      backup_withholding_reason = case when v_flag is null then backup_withholding_reason when v_flag then v_reason end,
      backup_withholding_since = case when v_flag is null then backup_withholding_since when v_flag then coalesce(v_since, current_date) end,
      tin_match_status = coalesce(v_match, tin_match_status),
      tin_matched_on = case when v_match is null then tin_matched_on else coalesce(v_matched, current_date) end
    where affiliate_id = p_id;
    perform public.payout_tax_refresh(null, p_id);
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  perform public.staff_audit(p_caller, 'payout_tax.payee_status_saved', p_kind, p_id::text, p);
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.admin_state_filing_record(p_caller uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.staff_require_owner(p_caller);
  insert into public.payee_state_filings (payee_kind, payee_id, state, kind, tax_year, filed_on, confirmation, note, recorded_by)
  values (p ->> 'payee_kind', (p ->> 'payee_id')::uuid, upper(p ->> 'state'), p ->> 'kind', (p ->> 'tax_year')::integer, (p ->> 'filed_on')::date,
    nullif(btrim(p ->> 'confirmation'), ''), nullif(btrim(p ->> 'note'), ''), p_caller)
  returning id into v_id;
  perform public.staff_audit(p_caller, 'payout_tax.state_filing_recorded', 'payee_state_filing', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_withholding_deposit_record(p_caller uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_month date := date_trunc('month', (p ->> 'period_month')::date)::date;
begin
  perform public.staff_require_owner(p_caller);
  insert into public.payout_withholding_deposits (tax_year, jurisdiction, period_month, amount_cents, deposited_on, confirmation, note, recorded_by)
  values (extract(year from v_month)::integer, case when upper(p ->> 'jurisdiction') = 'FEDERAL' then 'federal' else upper(p ->> 'jurisdiction') end, v_month,
    (p ->> 'amount_cents')::integer, (p ->> 'deposited_on')::date, nullif(btrim(p ->> 'confirmation'), ''), nullif(btrim(p ->> 'note'), ''), p_caller)
  returning id into v_id;
  perform public.staff_audit(p_caller, 'payout_tax.deposit_recorded', 'payout_withholding_deposit', v_id::text, p);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Tax season report (Tax season tab + every CSV / PDF). LIVE paid payouts only; amounts by tax_year
--    (the year the payout settled, Central time). Full TINs are never in here (last 4 only).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_tax_season(p_caller uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare th public.tax_reporting_thresholds; ts public.payout_tax_settings; v_payees jsonb; v_threshold integer;
begin
  perform public.staff_require_cap(p_caller, 'tax.view');
  select * into th from public.tax_reporting_thresholds where tax_year = p_year;
  select * into ts from public.payout_tax_settings where id;
  v_threshold := th.threshold_cents;

  with paid as (
    select p.staff_id, p.affiliate_id, sum(p.gross_cents + p.adjustments_cents)::bigint gross, sum(p.withholding_cents)::bigint fed, sum(p.state_withholding_cents)::bigint st,
      sum(p.net_cents)::bigint net, coalesce(sum(p.fee_cents) filter (where p.fee_bearer = 'recipient'), 0)::bigint fees, count(*) n,
      (array_agg(p.tax_state order by p.settled_at desc) filter (where p.tax_state is not null))[1] paid_state
    from public.payouts p where p.mode = 'live' and p.status = 'paid' and p.tax_year = p_year
    group by p.staff_id, p.affiliate_id
  ), people as (
    select 'staff'::text kind, m.id, coalesce(t.w9_legal_name, nullif(btrim(concat_ws(' ', m.legal_first_name, m.legal_last_name)), ''), m.display_name) name,
      t.w9_business_name business_name, m.email, t.tin_type, t.tin_last4, t.w9_status, t.w9_tax_class tax_class, t.w9_exempt_payee_code exempt_code,
      coalesce(t.backup_withholding, false) backup, t.backup_withholding_reason backup_reason, coalesce(t.tin_match_status, 'not_checked') tin_match,
      m.address_line1, m.address_line2, m.city, m.state addr_state, m.postal_code,
      coalesce(pd.paid_state, public.us_state_code(coalesce(m.work_state, m.state))) tax_state, m.classification label,
      coalesce(pd.gross, 0) gross, coalesce(pd.fed, 0) fed, coalesce(pd.st, 0) st, coalesce(pd.net, 0) net, coalesce(pd.fees, 0) fees, coalesce(pd.n, 0) n
    from public.staff_members m
    left join public.staff_tax_profiles t on t.staff_id = m.id
    left join paid pd on pd.staff_id = m.id
    where m.classification in ('contractor_1099', 'vendor') or pd.staff_id is not null
    union all
    select 'affiliate', a.id, coalesce(t.w9_legal_name, a.legal_name, a.display_name, a.email), t.w9_business_name, a.email, t.tin_type, t.tin_last4, t.w9_status, t.w9_tax_class, t.w9_exempt_payee_code,
      coalesce(t.backup_withholding, false), t.backup_withholding_reason, coalesce(t.tin_match_status, 'not_checked'),
      a.address_line1, a.address_line2, a.city, a.state, a.postal_code,
      coalesce(pd.paid_state, public.us_state_code(a.state)), 'affiliate',
      coalesce(pd.gross, 0), coalesce(pd.fed, 0), coalesce(pd.st, 0), coalesce(pd.net, 0), coalesce(pd.fees, 0), coalesce(pd.n, 0)
    from public.affiliates a
    left join public.affiliate_tax_profiles t on t.affiliate_id = a.id
    left join paid pd on pd.affiliate_id = a.id
    where a.status = 'active' or pd.affiliate_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', x.kind, 'id', x.id, 'name', x.name, 'business_name', x.business_name, 'email', x.email, 'label', x.label,
      'tin_type', x.tin_type, 'tin_last4', x.tin_last4, 'w9_status', coalesce(x.w9_status, 'not_started'), 'tax_class', x.tax_class, 'exempt_code', x.exempt_code,
      'backup_withholding', x.backup, 'backup_reason', x.backup_reason, 'tin_match', x.tin_match,
      'address', nullif(concat_ws(', ', x.address_line1, x.address_line2, x.city, nullif(btrim(concat_ws(' ', x.addr_state, x.postal_code)), '')), ''),
      'address_line1', x.address_line1, 'address_line2', x.address_line2, 'city', x.city, 'addr_state', x.addr_state, 'postal_code', x.postal_code,
      'tax_state', x.tax_state, 'gross_cents', x.gross, 'federal_withheld_cents', x.fed, 'state_withheld_cents', x.st, 'net_cents', x.net, 'recipient_fees_cents', x.fees, 'payouts', x.n,
      -- Corporations are generally exempt from 1099-NEC reporting (attorney fees aside): flagged, not decided.
      'likely_exempt', coalesce(x.tax_class in ('c_corp', 's_corp', 'llc_c', 'llc_s'), false),
      -- Any withholding means a 1099 regardless of the threshold.
      'needs_1099', (x.fed + x.st > 0) or (v_threshold is not null and x.gross >= v_threshold and not coalesce(x.tax_class in ('c_corp', 's_corp', 'llc_c', 'llc_s'), false)),
      'missing', to_jsonb(array_remove(array[
        case when x.tin_last4 is null then 'tin' end,
        case when coalesce(x.w9_status, 'not_started') = 'not_started' then 'w9' end,
        case when x.address_line1 is null or x.city is null or x.postal_code is null then 'address' end,
        case when x.tax_state is null then 'state' end], null))
    ) order by x.name), '[]'::jsonb) into v_payees
  from people x;

  return jsonb_build_object(
    'year', p_year,
    'generated_at', now(),
    'threshold', to_jsonb(th),
    'settings', to_jsonb(ts) - 'updated_by',
    'payees', v_payees,
    'states', coalesce((select jsonb_agg(jsonb_build_object('state', r.state, 'name', r.name, 'verified', r.verified, 'verified_at', r.verified_at, 'source_note', r.source_note,
        'has_income_tax', r.has_income_tax, 'state_1099_filing', r.state_1099_filing, 'state_1099_threshold_cents', r.state_1099_threshold_cents,
        'state_backup_withholding_bps', r.state_backup_withholding_bps, 'nonresident_withholding_note', r.nonresident_withholding_note,
        'contractor_reporting', r.contractor_reporting, 'contractor_report_threshold_cents', r.contractor_report_threshold_cents, 'contractor_report_days', r.contractor_report_days,
        'agency_url', r.agency_url, 'notes', r.notes,
        'payees', (select count(*) from jsonb_array_elements(v_payees) e where e ->> 'tax_state' = r.state),
        'needs_1099', (select count(*) from jsonb_array_elements(v_payees) e where e ->> 'tax_state' = r.state and (e ->> 'needs_1099')::boolean),
        'gross_cents', (select coalesce(sum((e ->> 'gross_cents')::bigint), 0) from jsonb_array_elements(v_payees) e where e ->> 'tax_state' = r.state),
        'state_withheld_cents', (select coalesce(sum((e ->> 'state_withheld_cents')::bigint), 0) from jsonb_array_elements(v_payees) e where e ->> 'tax_state' = r.state),
        'payer_state_id', ts.payer_state_ids ->> r.state,
        'filings', (select count(*) from public.payee_state_filings f where f.state = r.state and f.tax_year = p_year)
      ) order by r.state) from public.payout_state_tax_rules r), '[]'::jsonb),
    'contractor_reports', coalesce((select jsonb_agg(z order by z ->> 'due_on' nulls last) from (
        select jsonb_build_object('payee_kind', e ->> 'kind', 'payee_id', e ->> 'id', 'name', e ->> 'name', 'state', r.state, 'rule_verified', r.verified,
          'threshold_cents', r.contractor_report_threshold_cents, 'crossed_on', c.crossed_on,
          'due_on', case when c.crossed_on is not null and r.contractor_report_days is not null then c.crossed_on + r.contractor_report_days end,
          'filed_on', (select max(f.filed_on) from public.payee_state_filings f where f.payee_id = (e ->> 'id')::uuid and f.state = r.state and f.kind = 'contractor_report'),
          'agency_url', r.agency_url) z
        from jsonb_array_elements(v_payees) e
        join public.payout_state_tax_rules r on r.state = e ->> 'tax_state' and r.contractor_reporting = 'required'
        left join lateral (
          select min(q.d) crossed_on from (
            select (p.settled_at at time zone 'America/Chicago')::date d,
              sum(p.gross_cents + p.adjustments_cents) over (order by p.settled_at rows unbounded preceding) cum
            from public.payouts p where p.mode = 'live' and p.status = 'paid' and p.tax_year = p_year
              and ((e ->> 'kind' = 'staff' and p.staff_id = (e ->> 'id')::uuid) or (e ->> 'kind' = 'affiliate' and p.affiliate_id = (e ->> 'id')::uuid))) q
          where q.cum >= coalesce(r.contractor_report_threshold_cents, 0)) c on true) y), '[]'::jsonb),
    'withholding_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', mth, 'federal_cents', fed, 'state', st_by) order by mth) from (
        select m.mth, sum(m.fed)::bigint fed, coalesce(jsonb_object_agg(m.tax_state, m.st) filter (where m.st > 0 and m.tax_state is not null), '{}'::jsonb) st_by
        from (select to_char(date_trunc('month', p.settled_at at time zone 'America/Chicago'), 'YYYY-MM-01') mth, p.tax_state,
                sum(p.withholding_cents)::bigint fed, sum(p.state_withholding_cents)::bigint st
              from public.payouts p where p.mode = 'live' and p.status = 'paid' and p.tax_year = p_year and (p.withholding_cents > 0 or p.state_withholding_cents > 0)
              group by 1, 2) m
        group by m.mth) w), '[]'::jsonb),
    'withholding_payouts', coalesce((select jsonb_agg(jsonb_build_object('ref', p.ref, 'settled_at', p.settled_at, 'payee', public.payout_json(p) ->> 'staff_name',
        'tax_state', p.tax_state, 'gross_cents', p.gross_cents + p.adjustments_cents, 'federal_cents', p.withholding_cents, 'state_cents', p.state_withholding_cents, 'net_cents', p.net_cents) order by p.settled_at)
        from public.payouts p where p.mode = 'live' and p.status = 'paid' and p.tax_year = p_year and (p.withholding_cents > 0 or p.state_withholding_cents > 0)), '[]'::jsonb),
    'deposits', coalesce((select jsonb_agg(to_jsonb(d) - 'recorded_by' order by d.period_month, d.jurisdiction) from public.payout_withholding_deposits d where d.tax_year = p_year), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('ref', p.ref, 'payee', public.payout_json(p) ->> 'staff_name', 'payee_kind', case when p.affiliate_id is not null then 'affiliate' else 'staff' end,
        'status', p.status, 'settled_at', p.settled_at, 'tax_state', p.tax_state, 'gross_cents', p.gross_cents, 'adjustments_cents', p.adjustments_cents, 'fee_cents', p.fee_cents, 'fee_bearer', p.fee_bearer,
        'federal_cents', p.withholding_cents, 'state_cents', p.state_withholding_cents, 'net_cents', p.net_cents, 'provider', p.provider, 'provider_ref', p.provider_ref,
        'items', (select count(*) from public.payout_items i where i.payout_id = p.id)) order by p.settled_at)
        from public.payouts p where p.mode = 'live' and p.status in ('paid', 'returned') and p.tax_year = p_year), '[]'::jsonb),
    'employees_w2', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name, 'status', m.status, 'work_state', m.work_state)) from public.staff_members m where m.classification = 'employee_w2'), '[]'::jsonb),
    'filings', coalesce((select jsonb_agg(to_jsonb(f) - 'recorded_by' order by f.filed_on) from public.payee_state_filings f where f.tax_year = p_year), '[]'::jsonb)
  );
end $$;

-- Live preflight on the owner's Settings: what still blocks LIVE payouts on tax grounds.
create or replace function public.admin_tax_preflight(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ts public.payout_tax_settings;
begin
  perform public.staff_require_cap(p_caller, 'tax.view');
  select * into ts from public.payout_tax_settings where id;
  return jsonb_build_object(
    'payer_ein', ts.payer_ein is not null, 'payer_address', ts.payer_address is not null, 'filing_method', ts.filing_method, 'deposit_schedule', ts.deposit_schedule,
    'backup_withholding_enabled', ts.backup_withholding_enabled, 'backup_rate_verified', ts.backup_rate_verified,
    'flagged_payees', (select count(*) from public.staff_tax_profiles where backup_withholding) + (select count(*) from public.affiliate_tax_profiles where backup_withholding),
    'payee_states', coalesce((select jsonb_agg(distinct jsonb_build_object('state', x.st, 'verified', coalesce(r.verified, false))) from (
        select public.us_state_code(coalesce(m.work_state, m.state)) st from public.staff_members m where m.classification in ('contractor_1099', 'vendor') and m.status = 'active'
        union select public.us_state_code(a.state) from public.affiliates a where a.status = 'active') x
      left join public.payout_state_tax_rules r on r.state = x.st), '[]'::jsonb),
    'verified_states', (select count(*) from public.payout_state_tax_rules where verified));
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'public.us_state_code(text)', 'public.payee_tax_facts(uuid, uuid)', 'public.payee_tax_blockers(uuid, uuid, text)', 'public.payouts_apply_withholding()',
    'public.payout_tax_refresh(uuid, uuid)', 'public.payout_blockers(uuid, text)', 'public.affiliate_payout_blockers(uuid, text)',
    'public.admin_payout_tax_settings_save(uuid, jsonb)', 'public.admin_state_tax_rule_save(uuid, text, jsonb)', 'public.admin_payee_tax_status_save(uuid, text, uuid, jsonb)',
    'public.admin_state_filing_record(uuid, jsonb)', 'public.admin_withholding_deposit_record(uuid, jsonb)', 'public.admin_tax_season(uuid, integer)', 'public.admin_tax_preflight(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
