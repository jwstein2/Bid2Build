-- Complete HR records for employees and subcontractors (fills the gaps against Gusto / ADP / Paychex / Rippling
-- and the construction compliance tools), plus what the CSV import needs.
--
--   1. pm_employee_hr gains: employee ID, pay rate + unit + pay frequency, FLSA (overtime) status, workers' comp
--      class code, trade classification (prevailing wage / certified payroll), union local, date reported to the
--      state new-hire registry, the federal W-4 answers (2020+ form) and state withholding, and direct deposit
--      bank name / account type / routing number. pm_employee_hr_save and pm_employee_hr_get are redefined.
--   2. Bank account numbers are stored encrypted (by the server, AES-256-GCM) in pm_sensitive_ids with kind
--      'bank', exactly like SSNs and TINs. pm_sensitive_can: an employee's bank account is HR-only; a
--      subcontractor's is for people who manage subcontractor compliance. Every save/view/removal is logged.
--   3. pm_sub_documents gains COI endorsement checks (additional insured, waiver of subrogation, primary and
--      non-contributory) and an aggregate limit; new document types: workers' comp exemption, bond, safety program,
--      prequalification form. pm_sub_document_add and pm_sub_record are redefined.
--   4. pm_sub_profiles: payment terms, retainage %, backup withholding, EMR (safety rating), years in business,
--      diversity certifications, website, ACH bank name / account type / routing number, prequalified date.
--   5. pm_hr_overview: W-4 counts as on file when its answers are recorded; shows whether direct deposit is on file.
--
-- Nothing here is exported, sent to analytics or written to logs. Safe to run more than once.
-- Requires 20270105001000_hr_files.sql. Rollback: docs/hr-records/rollback_20270205001000.sql

-- 1. Employee HR file: pay, classification, withholding, direct deposit ------------------------------------------
alter table public.pm_employee_hr add column if not exists employee_number          text;
alter table public.pm_employee_hr add column if not exists pay_rate                 numeric(12, 2);
alter table public.pm_employee_hr add column if not exists pay_rate_unit            text;
alter table public.pm_employee_hr add column if not exists pay_frequency            text;
alter table public.pm_employee_hr add column if not exists flsa_status              text;
alter table public.pm_employee_hr add column if not exists wc_class_code            text;
alter table public.pm_employee_hr add column if not exists trade_classification     text;
alter table public.pm_employee_hr add column if not exists union_local              text;
alter table public.pm_employee_hr add column if not exists new_hire_reported_on     date;
alter table public.pm_employee_hr add column if not exists w4_filing_status         text;
alter table public.pm_employee_hr add column if not exists w4_multiple_jobs         boolean;
alter table public.pm_employee_hr add column if not exists w4_dependents_amount     numeric(10, 2);
alter table public.pm_employee_hr add column if not exists w4_other_income          numeric(12, 2);
alter table public.pm_employee_hr add column if not exists w4_deductions            numeric(12, 2);
alter table public.pm_employee_hr add column if not exists w4_extra_withholding     numeric(10, 2);
alter table public.pm_employee_hr add column if not exists w4_exempt                boolean;
alter table public.pm_employee_hr add column if not exists w4_signed_on             date;
alter table public.pm_employee_hr add column if not exists state_withholding_state  text;
alter table public.pm_employee_hr add column if not exists state_allowances         integer;
alter table public.pm_employee_hr add column if not exists state_extra_withholding  numeric(10, 2);
alter table public.pm_employee_hr add column if not exists state_exempt             boolean;
alter table public.pm_employee_hr add column if not exists dd_bank_name             text;
alter table public.pm_employee_hr add column if not exists dd_account_type          text;
alter table public.pm_employee_hr add column if not exists dd_routing               text;

alter table public.pm_employee_hr drop constraint if exists pm_employee_hr_v2_checks;
alter table public.pm_employee_hr add constraint pm_employee_hr_v2_checks check (
  (employee_number is null or char_length(employee_number) <= 40)
  and (pay_rate is null or pay_rate between 0 and 10000000)
  and (pay_rate_unit is null or pay_rate_unit in ('hour', 'year'))
  and (pay_frequency is null or pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly'))
  and (flsa_status is null or flsa_status in ('non_exempt', 'exempt'))
  and (wc_class_code is null or char_length(wc_class_code) <= 20)
  and (trade_classification is null or char_length(trade_classification) <= 100)
  and (union_local is null or char_length(union_local) <= 100)
  and (w4_filing_status is null or w4_filing_status in ('single', 'married_jointly', 'head_of_household'))
  and (w4_dependents_amount is null or w4_dependents_amount between 0 and 1000000)
  and (w4_other_income is null or w4_other_income between 0 and 100000000)
  and (w4_deductions is null or w4_deductions between 0 and 100000000)
  and (w4_extra_withholding is null or w4_extra_withholding between 0 and 1000000)
  and (state_withholding_state is null or state_withholding_state ~ '^[A-Z]{2}$')
  and (state_allowances is null or state_allowances between 0 and 99)
  and (state_extra_withholding is null or state_extra_withholding between 0 and 1000000)
  and (dd_bank_name is null or char_length(dd_bank_name) <= 100)
  and (dd_account_type is null or dd_account_type in ('checking', 'savings'))
  and (dd_routing is null or dd_routing ~ '^[0-9]{9}$')
);

-- 2. Encrypted bank account numbers ----------------------------------------------------------------------------
alter table public.pm_sensitive_ids drop constraint if exists pm_sensitive_ids_kind_check;
alter table public.pm_sensitive_ids add constraint pm_sensitive_ids_kind_check check (kind in ('tin', 'ssn', 'bank'));
alter table public.pm_sensitive_access_log drop constraint if exists pm_sensitive_access_log_kind_check;
alter table public.pm_sensitive_access_log add constraint pm_sensitive_access_log_kind_check check (kind in ('tin', 'ssn', 'bank'));

create or replace function public.pm_sensitive_can(p_resource_id uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_kind
      when 'tin' then r.kind = 'subcontractor' and public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)
      when 'ssn' then r.kind = 'staff' and public.pm_hr_can(r.company_id, r.owner_id)
      when 'bank' then case r.kind
        when 'staff' then public.pm_hr_can(r.company_id, r.owner_id)
        when 'subcontractor' then public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)
        else false end
      else false end
      from public.pm_resources r where r.id = p_resource_id), false)
$$;
revoke execute on function public.pm_sensitive_can(uuid, text) from public, anon;
grant execute on function public.pm_sensitive_can(uuid, text) to authenticated;

-- p: camelCase keys of the HR file. Keys left out are kept; keys sent as "" or null are cleared.
create or replace function public.pm_employee_hr_save(p_resource_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.pm_resources := public.pm_hr_resource(p_resource_id);
  old jsonb; nxt jsonb; changed text[];
  map constant jsonb := '{"legalFirstName":"legal_first_name","legalMiddleName":"legal_middle_name","legalLastName":"legal_last_name","preferredName":"preferred_name",
    "dateOfBirth":"date_of_birth","personalPhone":"personal_phone","personalEmail":"personal_email","addressLine1":"address_line1","addressLine2":"address_line2",
    "city":"city","state":"state","zip":"zip","emergency1Name":"emergency1_name","emergency1Relation":"emergency1_relation","emergency1Phone":"emergency1_phone",
    "emergency1AltPhone":"emergency1_alt_phone","emergency2Name":"emergency2_name","emergency2Relation":"emergency2_relation","emergency2Phone":"emergency2_phone",
    "employmentType":"employment_type","employmentStatus":"employment_status","department":"department","supervisorId":"supervisor_id","workLocation":"work_location",
    "separationDate":"separation_date","separationReason":"separation_reason","rehireEligible":"rehire_eligible","i9CompletedOn":"i9_completed_on",
    "i9ReverifyOn":"i9_reverify_on","ptoHoursPerYear":"pto_hours_per_year","sickHoursPerYear":"sick_hours_per_year","notes":"notes",
    "employeeNumber":"employee_number","payRate":"pay_rate","payRateUnit":"pay_rate_unit","payFrequency":"pay_frequency","flsaStatus":"flsa_status",
    "wcClassCode":"wc_class_code","tradeClassification":"trade_classification","unionLocal":"union_local","newHireReportedOn":"new_hire_reported_on",
    "w4FilingStatus":"w4_filing_status","w4MultipleJobs":"w4_multiple_jobs","w4DependentsAmount":"w4_dependents_amount","w4OtherIncome":"w4_other_income",
    "w4Deductions":"w4_deductions","w4ExtraWithholding":"w4_extra_withholding","w4Exempt":"w4_exempt","w4SignedOn":"w4_signed_on",
    "stateWithholdingState":"state_withholding_state","stateAllowances":"state_allowances","stateExtraWithholding":"state_extra_withholding","stateExempt":"state_exempt",
    "ddBankName":"dd_bank_name","ddAccountType":"dd_account_type","ddRouting":"dd_routing"}';
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if not map ? k then raise exception 'unknown_field' using errcode = '22023', detail = k; end if;
  end loop;
  if p ? 'supervisorId' and nullif(p ->> 'supervisorId', '') is not null and not exists (
       select 1 from public.pm_resources s where s.id = (p ->> 'supervisorId')::uuid and s.kind = 'staff'
          and s.company_id is not distinct from r.company_id and s.owner_id is not distinct from r.owner_id and s.id <> r.id) then
    raise exception 'bad_supervisor' using errcode = '22023';
  end if;
  if nullif(p ->> 'personalEmail', '') is not null and (p ->> 'personalEmail') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email' using errcode = '22023'; end if;
  if nullif(p ->> 'ddRouting', '') is not null and not public.aba_routing_ok(p ->> 'ddRouting') then raise exception 'bad_routing' using errcode = '22023'; end if;
  insert into public.pm_employee_hr (resource_id, updated_by) values (r.id, auth.uid()) on conflict (resource_id) do nothing;
  select to_jsonb(h) into old from public.pm_employee_hr h where resource_id = r.id;
  nxt := old;
  for k in select jsonb_object_keys(p) loop
    nxt := jsonb_set(nxt, array[map ->> k], case when p -> k = 'null'::jsonb or p ->> k = '' then 'null'::jsonb
                                                when jsonb_typeof(p -> k) = 'string' then to_jsonb(btrim(p ->> k)) else p -> k end);
  end loop;
  if coalesce(nxt ->> 'employment_status', '') = '' then nxt := jsonb_set(nxt, '{employment_status}', '"active"'); end if;
  if nxt ->> 'state_withholding_state' is not null then nxt := jsonb_set(nxt, '{state_withholding_state}', to_jsonb(upper(nxt ->> 'state_withholding_state'))); end if;
  update public.pm_employee_hr h set
    legal_first_name = x.legal_first_name, legal_middle_name = x.legal_middle_name, legal_last_name = x.legal_last_name, preferred_name = x.preferred_name,
    date_of_birth = x.date_of_birth, personal_phone = x.personal_phone, personal_email = lower(x.personal_email), address_line1 = x.address_line1,
    address_line2 = x.address_line2, city = x.city, state = x.state, zip = x.zip, emergency1_name = x.emergency1_name, emergency1_relation = x.emergency1_relation,
    emergency1_phone = x.emergency1_phone, emergency1_alt_phone = x.emergency1_alt_phone, emergency2_name = x.emergency2_name,
    emergency2_relation = x.emergency2_relation, emergency2_phone = x.emergency2_phone, employment_type = x.employment_type,
    employment_status = x.employment_status, department = x.department, supervisor_id = x.supervisor_id, work_location = x.work_location,
    separation_date = x.separation_date, separation_reason = x.separation_reason, rehire_eligible = x.rehire_eligible,
    i9_completed_on = x.i9_completed_on, i9_reverify_on = x.i9_reverify_on, pto_hours_per_year = x.pto_hours_per_year,
    sick_hours_per_year = x.sick_hours_per_year, notes = x.notes,
    employee_number = x.employee_number, pay_rate = x.pay_rate, pay_rate_unit = x.pay_rate_unit, pay_frequency = x.pay_frequency, flsa_status = x.flsa_status,
    wc_class_code = x.wc_class_code, trade_classification = x.trade_classification, union_local = x.union_local, new_hire_reported_on = x.new_hire_reported_on,
    w4_filing_status = x.w4_filing_status, w4_multiple_jobs = x.w4_multiple_jobs, w4_dependents_amount = x.w4_dependents_amount, w4_other_income = x.w4_other_income,
    w4_deductions = x.w4_deductions, w4_extra_withholding = x.w4_extra_withholding, w4_exempt = x.w4_exempt, w4_signed_on = x.w4_signed_on,
    state_withholding_state = x.state_withholding_state, state_allowances = x.state_allowances, state_extra_withholding = x.state_extra_withholding,
    state_exempt = x.state_exempt, dd_bank_name = x.dd_bank_name, dd_account_type = x.dd_account_type, dd_routing = x.dd_routing,
    updated_by = auth.uid(), updated_at = now()
  from jsonb_populate_record(null::public.pm_employee_hr, nxt) x
  where h.resource_id = r.id;
  select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(nxt) n where key not in ('updated_by', 'updated_at', 'resource_id') and n.value is distinct from old -> key;
  if cardinality(changed) > 0 then
    insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (r.id, r.company_id, r.owner_id, auth.uid(), 'hr_file.updated', changed);
  end if;
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'invalid' using errcode = '22023';
  when check_violation then raise exception 'invalid' using errcode = '22023';
end $$;
revoke execute on function public.pm_employee_hr_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_employee_hr_save(uuid, jsonb) to authenticated;

-- ABA routing number checksum (3-7-1 weights). Used for employee direct deposit and subcontractor ACH.
create or replace function public.aba_routing_ok(p text) returns boolean
language sql immutable set search_path = public as $$
  select p ~ '^[0-9]{9}$' and (
    3 * (substr(p, 1, 1)::int + substr(p, 4, 1)::int + substr(p, 7, 1)::int)
  + 7 * (substr(p, 2, 1)::int + substr(p, 5, 1)::int + substr(p, 8, 1)::int)
  +     (substr(p, 3, 1)::int + substr(p, 6, 1)::int + substr(p, 9, 1)::int)) % 10 = 0
$$;

-- The HR file, now with direct deposit status (last 4 only) and bank-account access in the history.
create or replace function public.pm_employee_hr_get(p_resource_id uuid, p_year integer default extract(year from current_date)::integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources := public.pm_hr_resource(p_resource_id); h public.pm_employee_hr; s public.pm_sensitive_ids; b public.pm_sensitive_ids;
begin
  select * into h from public.pm_employee_hr where resource_id = r.id;
  select * into s from public.pm_sensitive_ids where resource_id = r.id and kind = 'ssn';
  select * into b from public.pm_sensitive_ids where resource_id = r.id and kind = 'bank';
  return jsonb_build_object(
    'resourceId', r.id, 'name', r.name, 'email', r.email, 'phone', r.phone, 'status', r.status,
    'profile', (select jsonb_build_object('title', p.title, 'payType', p.pay_type, 'hireDate', p.hire_date) from public.pm_employee_profiles p where p.resource_id = r.id),
    'hr', case when h.resource_id is null then null else to_jsonb(h) - 'updated_by' end,
    'ssn', jsonb_build_object('onFile', s.resource_id is not null, 'last4', s.last4, 'updatedAt', s.updated_at),
    'bank', jsonb_build_object('onFile', b.resource_id is not null, 'last4', b.last4, 'updatedAt', b.updated_at),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'docType', d.doc_type, 'title', d.title, 'signedOn', d.signed_on, 'expiresOn', d.expires_on,
        'note', d.note, 'fileName', d.file_name, 'hasFile', d.file_path is not null, 'recordedAt', d.recorded_at) order by d.recorded_at desc)
      from public.pm_employee_documents d where d.resource_id = r.id and d.status = 'on_file'), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'issuer', c.issuer, 'number', c.number, 'issuedOn', c.issued_on,
        'expiresOn', c.expires_on, 'documentId', c.document_id, 'note', c.note) order by c.expires_on nulls last, c.name)
      from public.pm_employee_certifications c where c.resource_id = r.id), '[]'::jsonb),
    'timeOff', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'startDate', e.start_date, 'endDate', e.end_date, 'hours', e.hours,
        'status', e.status, 'note', e.note) order by e.start_date desc)
      from public.pm_pto_entries e where e.resource_id = r.id and e.start_date >= make_date(p_year - 1, 1, 1)), '[]'::jsonb),
    'balances', jsonb_build_object('year', p_year,
      'ptoAllowance', h.pto_hours_per_year, 'sickAllowance', h.sick_hours_per_year,
      'ptoUsed', coalesce((select sum(e.hours) from public.pm_pto_entries e where e.resource_id = r.id and e.kind = 'pto' and e.status = 'approved' and extract(year from e.start_date) = p_year), 0),
      'sickUsed', coalesce((select sum(e.hours) from public.pm_pto_entries e where e.resource_id = r.id and e.kind = 'sick' and e.status = 'approved' and extract(year from e.start_date) = p_year), 0)),
    'supervisors', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name) from public.pm_resources x
      where x.kind = 'staff' and x.status = 'active' and x.id <> r.id and x.company_id is not distinct from r.company_id and x.owner_id is not distinct from r.owner_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'fields', a.fields, 'at', a.at,
        'by', coalesce((select m.display_name from public.company_members m where m.user_id = a.actor and m.company_id is not distinct from r.company_id limit 1), 'Owner')) order by a.at desc)
      from (select * from public.pm_hr_audit a where a.resource_id = r.id order by a.at desc limit 25) a), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('action', l.kind || '.' || l.action, 'fields', '{}'::text[], 'at', l.at,
        'by', coalesce((select m.display_name from public.company_members m where m.user_id = l.actor and m.company_id is not distinct from r.company_id limit 1), 'Owner')) order by l.at desc)
      from (select * from public.pm_sensitive_access_log l where l.resource_id = r.id and l.kind in ('ssn', 'bank') order by l.at desc limit 25) l), '[]'::jsonb));
end $$;
revoke execute on function public.pm_employee_hr_get(uuid, integer) from public, anon;
grant execute on function public.pm_employee_hr_get(uuid, integer) to authenticated;

-- 3. Subcontractor documents: endorsements, aggregate limit, more types -----------------------------------------
alter table public.pm_sub_documents add column if not exists additional_insured      boolean;
alter table public.pm_sub_documents add column if not exists waiver_of_subrogation   boolean;
alter table public.pm_sub_documents add column if not exists primary_noncontributory boolean;
alter table public.pm_sub_documents add column if not exists aggregate_amount        numeric(14, 2);
alter table public.pm_sub_documents drop constraint if exists pm_sub_documents_aggregate_amount;
alter table public.pm_sub_documents add constraint pm_sub_documents_aggregate_amount check (aggregate_amount is null or aggregate_amount >= 0);
alter table public.pm_sub_documents drop constraint if exists pm_sub_documents_doc_type_check;
alter table public.pm_sub_documents add constraint pm_sub_documents_doc_type_check check (doc_type in ('w9', 'coi_general_liability', 'workers_comp', 'auto_liability',
  'umbrella', 'license', 'subcontract_agreement', 'master_agreement', 'lien_waiver', 'other', 'wc_exemption', 'bond', 'safety_program', 'prequalification'));

create or replace function public.pm_sub_document_add(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_type text := p ->> 'docType'; v_id uuid; v_path text := nullif(p ->> 'filePath', '');
  v_bool constant text[] := array['additionalInsured', 'waiverOfSubrogation', 'primaryNoncontributory'];
  k text;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.sub_compliance_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_type is null or v_type not in ('w9', 'coi_general_liability', 'workers_comp', 'auto_liability', 'umbrella', 'license',
                                      'subcontract_agreement', 'master_agreement', 'lien_waiver', 'other', 'wc_exemption', 'bond', 'safety_program', 'prequalification') then
    raise exception 'bad_type' using errcode = '22023';
  end if;
  foreach k in array v_bool loop
    if p ? k and jsonb_typeof(p -> k) not in ('boolean', 'null') then raise exception 'invalid' using errcode = '22023'; end if;
  end loop;
  -- Files must sit under this subcontractor's own folder.
  if v_path is not null and v_path not like coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text || '/%' then raise exception 'bad_path' using errcode = '22023'; end if;
  if v_type in ('w9', 'wc_exemption', 'bond') or public.pm_sub_doc_kind_insurance(v_type) then
    update public.pm_sub_documents set status = 'replaced' where resource_id = r.id and doc_type = v_type and status = 'on_file';
  end if;
  insert into public.pm_sub_documents (resource_id, company_id, owner_id, doc_type, title, issuer, policy_number, coverage_amount, aggregate_amount,
    additional_insured, waiver_of_subrogation, primary_noncontributory, effective_on, expires_on, signed_on, file_path, file_name, note, recorded_by)
  values (r.id, r.company_id, r.owner_id, v_type, left(nullif(btrim(p ->> 'title'), ''), 200), left(nullif(btrim(p ->> 'issuer'), ''), 200),
          left(nullif(btrim(p ->> 'policyNumber'), ''), 80), nullif(p ->> 'coverageAmount', '')::numeric, nullif(p ->> 'aggregateAmount', '')::numeric,
          (p ->> 'additionalInsured')::boolean, (p ->> 'waiverOfSubrogation')::boolean, (p ->> 'primaryNoncontributory')::boolean,
          nullif(p ->> 'effectiveOn', '')::date, nullif(p ->> 'expiresOn', '')::date, nullif(p ->> 'signedOn', '')::date,
          v_path, left(nullif(p ->> 'fileName', ''), 200), left(nullif(btrim(p ->> 'note'), ''), 1000), auth.uid())
  returning id into v_id;
  if v_type = 'w9' and nullif(p ->> 'signedOn', '') is not null then
    insert into public.pm_sub_tax_profiles (resource_id, w9_signed_on, updated_by) values (r.id, (p ->> 'signedOn')::date, auth.uid())
    on conflict (resource_id) do update set w9_signed_on = excluded.w9_signed_on, updated_by = auth.uid(), updated_at = now();
  end if;
  return v_id;
end $$;
revoke execute on function public.pm_sub_document_add(uuid, jsonb) from public, anon;
grant execute on function public.pm_sub_document_add(uuid, jsonb) to authenticated;

-- 4. Subcontractor business profile -----------------------------------------------------------------------------
create table if not exists public.pm_sub_profiles (
  resource_id        uuid primary key references public.pm_resources (id) on delete cascade,
  payment_terms      text check (payment_terms is null or char_length(payment_terms) <= 60),
  retainage_pct      numeric(5, 2) check (retainage_pct is null or retainage_pct between 0 and 50),
  backup_withholding boolean not null default false,
  emr                numeric(4, 2) check (emr is null or emr between 0 and 5),
  years_in_business  integer check (years_in_business is null or years_in_business between 0 and 300),
  diversity_certs    text[] not null default '{}' check (diversity_certs <@ array['mbe', 'wbe', 'dbe', 'sbe', 'vosb', 'sdvosb', 'hubzone', '8a']::text[]),
  website            text check (website is null or char_length(website) <= 300),
  ach_bank_name      text check (ach_bank_name is null or char_length(ach_bank_name) <= 100),
  ach_account_type   text check (ach_account_type is null or ach_account_type in ('checking', 'savings')),
  ach_routing        text check (ach_routing is null or ach_routing ~ '^[0-9]{9}$'),
  prequalified_on    date,
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);
alter table public.pm_sub_profiles enable row level security;
revoke all on public.pm_sub_profiles from anon, authenticated;
drop policy if exists pm_sub_profiles_select on public.pm_sub_profiles;
create policy pm_sub_profiles_select on public.pm_sub_profiles for select to authenticated
  using (exists (select 1 from public.pm_resources r where r.id = resource_id and public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)));
grant select on public.pm_sub_profiles to authenticated;

-- p: camelCase keys. Keys left out are kept; "" or null clears.
create or replace function public.pm_sub_profile_save(p_resource_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; k text;
  allowed constant text[] := array['paymentTerms', 'retainagePct', 'backupWithholding', 'emr', 'yearsInBusiness', 'diversityCerts', 'website',
                                   'achBankName', 'achAccountType', 'achRouting', 'prequalifiedOn'];
  v_certs text[];
  has constant jsonb := coalesce(p, '{}'::jsonb);
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.sub_compliance_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any (allowed) then raise exception 'unknown_field' using errcode = '22023', detail = k; end if;
  end loop;
  if nullif(p ->> 'achRouting', '') is not null and not public.aba_routing_ok(p ->> 'achRouting') then raise exception 'bad_routing' using errcode = '22023'; end if;
  if p ? 'diversityCerts' then
    if jsonb_typeof(p -> 'diversityCerts') not in ('array', 'null') then raise exception 'invalid' using errcode = '22023'; end if;
    select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}') into v_certs from jsonb_array_elements_text(coalesce(p -> 'diversityCerts', '[]'::jsonb)) x;
  end if;
  insert into public.pm_sub_profiles (resource_id, updated_by) values (r.id, auth.uid()) on conflict (resource_id) do nothing;
  update public.pm_sub_profiles s set
    payment_terms      = case when has ? 'paymentTerms' then left(nullif(btrim(p ->> 'paymentTerms'), ''), 60) else s.payment_terms end,
    retainage_pct      = case when has ? 'retainagePct' then nullif(p ->> 'retainagePct', '')::numeric else s.retainage_pct end,
    backup_withholding = case when has ? 'backupWithholding' then coalesce((nullif(p ->> 'backupWithholding', ''))::boolean, false) else s.backup_withholding end,
    emr                = case when has ? 'emr' then nullif(p ->> 'emr', '')::numeric else s.emr end,
    years_in_business  = case when has ? 'yearsInBusiness' then nullif(p ->> 'yearsInBusiness', '')::int else s.years_in_business end,
    diversity_certs    = case when has ? 'diversityCerts' then v_certs else s.diversity_certs end,
    website            = case when has ? 'website' then left(nullif(btrim(p ->> 'website'), ''), 300) else s.website end,
    ach_bank_name      = case when has ? 'achBankName' then left(nullif(btrim(p ->> 'achBankName'), ''), 100) else s.ach_bank_name end,
    ach_account_type   = case when has ? 'achAccountType' then nullif(p ->> 'achAccountType', '') else s.ach_account_type end,
    ach_routing        = case when has ? 'achRouting' then nullif(btrim(p ->> 'achRouting'), '') else s.ach_routing end,
    prequalified_on    = case when has ? 'prequalifiedOn' then nullif(p ->> 'prequalifiedOn', '')::date else s.prequalified_on end,
    updated_by = auth.uid(), updated_at = now()
  where s.resource_id = r.id;
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'invalid' using errcode = '22023';
  when check_violation then raise exception 'invalid' using errcode = '22023';
end $$;
revoke execute on function public.pm_sub_profile_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_sub_profile_save(uuid, jsonb) to authenticated;

-- Full record for one subcontractor, now with the business profile, ACH status (last 4 only) and endorsements.
create or replace function public.pm_sub_record(p_resource_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; t public.pm_sub_tax_profiles; s public.pm_sub_profiles; b public.pm_sensitive_ids;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.sub_compliance_manageable(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.pm_sub_tax_profiles where resource_id = r.id;
  select * into s from public.pm_sub_profiles where resource_id = r.id;
  select * into b from public.pm_sensitive_ids where resource_id = r.id and kind = 'bank';
  return jsonb_build_object(
    'resourceId', r.id, 'name', r.name, 'folder', coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text,
    'tax', case when t.resource_id is null then null else jsonb_build_object('legalName', t.legal_name, 'businessName', t.business_name,
      'taxClassification', t.tax_classification, 'tinType', t.tin_type, 'tinLast4', t.tin_last4, 'address', t.address,
      'w9SignedOn', t.w9_signed_on, 'track1099', t.track_1099, 'tracks1099', public.pm_sub_tracks_1099(t), 'updatedAt', t.updated_at) end,
    'profile', case when s.resource_id is null then null else jsonb_build_object('paymentTerms', s.payment_terms, 'retainagePct', s.retainage_pct,
      'backupWithholding', s.backup_withholding, 'emr', s.emr, 'yearsInBusiness', s.years_in_business, 'diversityCerts', to_jsonb(s.diversity_certs),
      'website', s.website, 'achBankName', s.ach_bank_name, 'achAccountType', s.ach_account_type, 'achRouting', s.ach_routing,
      'prequalifiedOn', s.prequalified_on, 'updatedAt', s.updated_at) end,
    'bank', jsonb_build_object('onFile', b.resource_id is not null, 'last4', b.last4, 'updatedAt', b.updated_at),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'docType', d.doc_type, 'title', d.title, 'issuer', d.issuer,
        'policyNumber', d.policy_number, 'coverageAmount', d.coverage_amount, 'aggregateAmount', d.aggregate_amount,
        'additionalInsured', d.additional_insured, 'waiverOfSubrogation', d.waiver_of_subrogation, 'primaryNoncontributory', d.primary_noncontributory,
        'effectiveOn', d.effective_on, 'expiresOn', d.expires_on,
        'signedOn', d.signed_on, 'fileName', d.file_name, 'hasFile', d.file_path is not null, 'note', d.note, 'status', d.status,
        'recordedAt', d.recorded_at) order by d.status, d.doc_type, d.expires_on nulls last, d.recorded_at desc)
      from public.pm_sub_documents d where d.resource_id = r.id and d.status <> 'removed'), '[]'::jsonb));
end $$;
revoke execute on function public.pm_sub_record(uuid) from public, anon;
grant execute on function public.pm_sub_record(uuid) to authenticated;

-- 5. HR overview: W-4 answers count as on file; direct deposit on file ------------------------------------------
create or replace function public.pm_hr_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
begin
  if not public.pm_hr_can(v_company, v_owner) then return jsonb_build_object('canManage', false, 'isOwner', false, 'people', '[]'::jsonb, 'managers', '[]'::jsonb); end if;
  return jsonb_build_object('canManage', true,
    'isOwner', v_company is null or public.team_is_company_owner(v_company),
    'managers', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', coalesce(m.display_name, 'Member'), 'hr', h.user_id is not null) order by m.display_name)
       from public.company_members m left join public.pm_hr_managers h on h.company_id = m.company_id and h.user_id = m.user_id
      where v_company is not null and m.company_id = v_company and m.status = 'active' and m.user_id <> (select c.owner_user_id from public.companies c where c.id = v_company)), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('resourceId', r.id, 'name', r.name, 'resourceStatus', r.status,
        'employmentStatus', coalesce(h.employment_status, 'active'), 'hrStarted', h.resource_id is not null,
        'ssnOnFile', exists (select 1 from public.pm_sensitive_ids s where s.resource_id = r.id and s.kind = 'ssn'),
        'emergencyOnFile', coalesce(h.emergency1_phone, p.emergency_phone) is not null,
        'i9OnFile', h.i9_completed_on is not null or exists (select 1 from public.pm_employee_documents d where d.resource_id = r.id and d.doc_type = 'i9' and d.status = 'on_file'),
        'w4OnFile', h.w4_filing_status is not null or coalesce(h.w4_exempt, false)
                    or exists (select 1 from public.pm_employee_documents d where d.resource_id = r.id and d.doc_type = 'w4' and d.status = 'on_file'),
        'bankOnFile', exists (select 1 from public.pm_sensitive_ids s where s.resource_id = r.id and s.kind = 'bank')
                    or exists (select 1 from public.pm_employee_documents d where d.resource_id = r.id and d.doc_type = 'direct_deposit' and d.status = 'on_file'),
        'nextExpiry', least((select min(c.expires_on) from public.pm_employee_certifications c where c.resource_id = r.id and c.expires_on >= current_date),
                            case when h.i9_reverify_on >= current_date then h.i9_reverify_on end),
        'expired', (select count(*) from public.pm_employee_certifications c where c.resource_id = r.id and c.expires_on < current_date)) order by r.name)
      from public.pm_resources r
      left join public.pm_employee_hr h on h.resource_id = r.id
      left join public.pm_employee_profiles p on p.resource_id = r.id
     where r.kind = 'staff' and r.company_id is not distinct from v_company and r.owner_id is not distinct from v_owner), '[]'::jsonb));
end $$;
revoke execute on function public.pm_hr_overview() from public, anon;
grant execute on function public.pm_hr_overview() to authenticated;
