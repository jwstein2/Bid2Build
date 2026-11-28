-- Rollback for 20270304001000_payout_tax_compliance.sql (V8.4 payout taxes).
-- Run only if no live payout has withholding on it: withheld amounts would lose their record.
-- Check first:  select count(*) from public.payouts where withholding_cents > 0 or state_withholding_cents > 0;

begin;
drop trigger if exists payouts_withholding on public.payouts;
drop function if exists public.payouts_apply_withholding();
alter table public.payouts drop constraint if exists payouts_net;
alter table public.payouts add constraint payouts_net check (net_cents = greatest(gross_cents + adjustments_cents - case when fee_bearer = 'recipient' then fee_cents else 0 end, 0)) not valid;
alter table public.payouts drop column if exists withholding_cents, drop column if exists state_withholding_cents, drop column if exists tax_state, drop column if exists withholding_reason;
drop index if exists public.payouts_tax_year;

-- Blockers back to their 20270207001000 / 20270211001000 definitions (without the tax checks).
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

drop function if exists public.admin_tax_preflight(uuid);
drop function if exists public.admin_tax_season(uuid, integer);
drop function if exists public.admin_withholding_deposit_record(uuid, jsonb);
drop function if exists public.admin_state_filing_record(uuid, jsonb);
drop function if exists public.admin_payee_tax_status_save(uuid, text, uuid, jsonb);
drop function if exists public.admin_state_tax_rule_save(uuid, text, jsonb);
drop function if exists public.admin_payout_tax_settings_save(uuid, jsonb);
drop function if exists public.payout_tax_refresh(uuid, uuid);
drop function if exists public.payee_tax_blockers(uuid, uuid, text);
drop function if exists public.payee_tax_facts(uuid, uuid);
drop function if exists public.us_state_code(text);
drop table if exists public.payout_withholding_deposits;
drop table if exists public.payee_state_filings;
drop table if exists public.payout_state_tax_rules;
drop table if exists public.payout_tax_settings;
alter table public.staff_tax_profiles drop column if exists backup_withholding_reason, drop column if exists backup_withholding_since, drop column if exists tin_match_status, drop column if exists tin_matched_on;
alter table public.affiliate_tax_profiles drop column if exists backup_withholding_reason, drop column if exists backup_withholding_since, drop column if exists tin_match_status, drop column if exists tin_matched_on;
commit;
