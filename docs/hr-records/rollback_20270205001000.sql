-- Rollback for 20270205001000_hr_records_complete.sql. WARNING: deletes the new HR fields (pay, W-4 answers, state
-- withholding, direct deposit details), encrypted bank account numbers, subcontractor business profiles, COI endorsement
-- checks and documents of the new types (workers' comp exemption, bond, safety program, prequalification).
-- Restores the 20270105001000 / 20261210001000 definitions. Safe to run more than once.
-- Run BEFORE docs/team-records/rollback_20270105001000.sql.
drop function if exists public.pm_sub_profile_save(uuid, jsonb);
drop table if exists public.pm_sub_profiles;
do $$ begin
  if to_regclass('public.pm_sub_documents') is not null then
    delete from public.pm_sub_documents where doc_type in ('wc_exemption', 'bond', 'safety_program', 'prequalification');
    alter table public.pm_sub_documents drop constraint if exists pm_sub_documents_doc_type_check;
    alter table public.pm_sub_documents add constraint pm_sub_documents_doc_type_check check (doc_type in ('w9', 'coi_general_liability', 'workers_comp',
      'auto_liability', 'umbrella', 'license', 'subcontract_agreement', 'master_agreement', 'lien_waiver', 'other'));
    alter table public.pm_sub_documents drop constraint if exists pm_sub_documents_aggregate_amount;
    alter table public.pm_sub_documents drop column if exists additional_insured, drop column if exists waiver_of_subrogation,
      drop column if exists primary_noncontributory, drop column if exists aggregate_amount;
  end if;
  if to_regclass('public.pm_sensitive_ids') is not null then
    delete from public.pm_sensitive_ids where kind = 'bank';
    delete from public.pm_sensitive_access_log where kind = 'bank';
    alter table public.pm_sensitive_ids drop constraint if exists pm_sensitive_ids_kind_check;
    alter table public.pm_sensitive_ids add constraint pm_sensitive_ids_kind_check check (kind in ('tin', 'ssn'));
    alter table public.pm_sensitive_access_log drop constraint if exists pm_sensitive_access_log_kind_check;
    alter table public.pm_sensitive_access_log add constraint pm_sensitive_access_log_kind_check check (kind in ('tin', 'ssn'));
  end if;
  if to_regclass('public.pm_employee_hr') is not null then
    alter table public.pm_employee_hr drop constraint if exists pm_employee_hr_v2_checks;
    alter table public.pm_employee_hr drop column if exists employee_number, drop column if exists pay_rate, drop column if exists pay_rate_unit,
      drop column if exists pay_frequency, drop column if exists flsa_status, drop column if exists wc_class_code, drop column if exists trade_classification,
      drop column if exists union_local, drop column if exists new_hire_reported_on, drop column if exists w4_filing_status, drop column if exists w4_multiple_jobs,
      drop column if exists w4_dependents_amount, drop column if exists w4_other_income, drop column if exists w4_deductions, drop column if exists w4_extra_withholding,
      drop column if exists w4_exempt, drop column if exists w4_signed_on, drop column if exists state_withholding_state, drop column if exists state_allowances,
      drop column if exists state_extra_withholding, drop column if exists state_exempt, drop column if exists dd_bank_name, drop column if exists dd_account_type,
      drop column if exists dd_routing;
  end if;
end $$;
drop function if exists public.aba_routing_ok(text);

-- Previous definitions (only when the tables they read still exist).
do $do$ begin
  if to_regclass('public.pm_employee_hr') is not null then
    execute $sql$create or replace function public.pm_sensitive_can(p_resource_id uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_kind
      when 'tin' then r.kind = 'subcontractor' and public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)
      when 'ssn' then r.kind = 'staff' and public.pm_hr_can(r.company_id, r.owner_id)
      else false end
      from public.pm_resources r where r.id = p_resource_id), false)
$$;

$sql$;
  end if;
end $do$;

do $do$ begin
  if to_regclass('public.pm_employee_hr') is not null then
    execute $sql$create or replace function public.pm_employee_hr_save(p_resource_id uuid, p jsonb) returns void
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
    "i9ReverifyOn":"i9_reverify_on","ptoHoursPerYear":"pto_hours_per_year","sickHoursPerYear":"sick_hours_per_year","notes":"notes"}';
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
  insert into public.pm_employee_hr (resource_id, updated_by) values (r.id, auth.uid()) on conflict (resource_id) do nothing;
  select to_jsonb(h) into old from public.pm_employee_hr h where resource_id = r.id;
  nxt := old;
  for k in select jsonb_object_keys(p) loop
    nxt := jsonb_set(nxt, array[map ->> k], case when p -> k = 'null'::jsonb or p ->> k = '' then 'null'::jsonb
                                                when jsonb_typeof(p -> k) = 'string' then to_jsonb(btrim(p ->> k)) else p -> k end);
  end loop;
  if coalesce(nxt ->> 'employment_status', '') = '' then nxt := jsonb_set(nxt, '{employment_status}', '"active"'); end if;
  update public.pm_employee_hr h set
    legal_first_name = x.legal_first_name, legal_middle_name = x.legal_middle_name, legal_last_name = x.legal_last_name, preferred_name = x.preferred_name,
    date_of_birth = x.date_of_birth, personal_phone = x.personal_phone, personal_email = lower(x.personal_email), address_line1 = x.address_line1,
    address_line2 = x.address_line2, city = x.city, state = x.state, zip = x.zip, emergency1_name = x.emergency1_name, emergency1_relation = x.emergency1_relation,
    emergency1_phone = x.emergency1_phone, emergency1_alt_phone = x.emergency1_alt_phone, emergency2_name = x.emergency2_name,
    emergency2_relation = x.emergency2_relation, emergency2_phone = x.emergency2_phone, employment_type = x.employment_type,
    employment_status = x.employment_status, department = x.department, supervisor_id = x.supervisor_id, work_location = x.work_location,
    separation_date = x.separation_date, separation_reason = x.separation_reason, rehire_eligible = x.rehire_eligible,
    i9_completed_on = x.i9_completed_on, i9_reverify_on = x.i9_reverify_on, pto_hours_per_year = x.pto_hours_per_year,
    sick_hours_per_year = x.sick_hours_per_year, notes = x.notes, updated_by = auth.uid(), updated_at = now()
  from jsonb_populate_record(null::public.pm_employee_hr, nxt) x
  where h.resource_id = r.id;
  select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(nxt) n where key not in ('updated_by', 'updated_at', 'resource_id') and n.value is distinct from old -> key;
  if cardinality(changed) > 0 then
    insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (r.id, r.company_id, r.owner_id, auth.uid(), 'hr_file.updated', changed);
  end if;
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'invalid' using errcode = '22023';
  when check_violation then raise exception 'invalid' using errcode = '22023';
end $$;
revoke execute on function public.pm_employee_hr_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_employee_hr_save(uuid, jsonb) to authenticated;
$sql$;
  end if;
end $do$;

do $do$ begin
  if to_regclass('public.pm_employee_hr') is not null then
    execute $sql$create or replace function public.pm_employee_hr_get(p_resource_id uuid, p_year integer default extract(year from current_date)::integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources := public.pm_hr_resource(p_resource_id); h public.pm_employee_hr; s public.pm_sensitive_ids;
begin
  select * into h from public.pm_employee_hr where resource_id = r.id;
  select * into s from public.pm_sensitive_ids where resource_id = r.id and kind = 'ssn';
  return jsonb_build_object(
    'resourceId', r.id, 'name', r.name, 'email', r.email, 'phone', r.phone, 'status', r.status,
    'profile', (select jsonb_build_object('title', p.title, 'payType', p.pay_type, 'hireDate', p.hire_date) from public.pm_employee_profiles p where p.resource_id = r.id),
    'hr', case when h.resource_id is null then null else to_jsonb(h) - 'updated_by' end,
    'ssn', jsonb_build_object('onFile', s.resource_id is not null, 'last4', s.last4, 'updatedAt', s.updated_at),
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
      || coalesce((select jsonb_agg(jsonb_build_object('action', 'ssn.' || l.action, 'fields', '{}'::text[], 'at', l.at,
        'by', coalesce((select m.display_name from public.company_members m where m.user_id = l.actor and m.company_id is not distinct from r.company_id limit 1), 'Owner')) order by l.at desc)
      from (select * from public.pm_sensitive_access_log l where l.resource_id = r.id and l.kind = 'ssn' order by l.at desc limit 25) l), '[]'::jsonb));
end $$;
revoke execute on function public.pm_employee_hr_get(uuid, integer) from public, anon;
grant execute on function public.pm_employee_hr_get(uuid, integer) to authenticated;
$sql$;
  end if;
end $do$;

do $do$ begin
  if to_regclass('public.pm_employee_hr') is not null then
    execute $sql$create or replace function public.pm_hr_overview() returns jsonb
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
        'w4OnFile', exists (select 1 from public.pm_employee_documents d where d.resource_id = r.id and d.doc_type = 'w4' and d.status = 'on_file'),
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
$sql$;
  end if;
end $do$;

do $do$ begin
  if to_regclass('public.pm_sub_documents') is not null then
    execute $sql$create or replace function public.pm_sub_record(p_resource_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; t public.pm_sub_tax_profiles;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.sub_compliance_manageable(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.pm_sub_tax_profiles where resource_id = r.id;
  return jsonb_build_object(
    'resourceId', r.id, 'name', r.name, 'folder', coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text,
    'tax', case when t.resource_id is null then null else jsonb_build_object('legalName', t.legal_name, 'businessName', t.business_name,
      'taxClassification', t.tax_classification, 'tinType', t.tin_type, 'tinLast4', t.tin_last4, 'address', t.address,
      'w9SignedOn', t.w9_signed_on, 'track1099', t.track_1099, 'tracks1099', public.pm_sub_tracks_1099(t), 'updatedAt', t.updated_at) end,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'docType', d.doc_type, 'title', d.title, 'issuer', d.issuer,
        'policyNumber', d.policy_number, 'coverageAmount', d.coverage_amount, 'effectiveOn', d.effective_on, 'expiresOn', d.expires_on,
        'signedOn', d.signed_on, 'fileName', d.file_name, 'hasFile', d.file_path is not null, 'note', d.note, 'status', d.status,
        'recordedAt', d.recorded_at) order by d.status, d.doc_type, d.expires_on nulls last, d.recorded_at desc)
      from public.pm_sub_documents d where d.resource_id = r.id and d.status <> 'removed'), '[]'::jsonb));
end $$;
revoke execute on function public.pm_sub_record(uuid) from public, anon;
grant execute on function public.pm_sub_record(uuid) to authenticated;
$sql$;
  end if;
end $do$;

do $do$ begin
  if to_regclass('public.pm_sub_documents') is not null then
    execute $sql$create or replace function public.pm_sub_document_add(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_type text := p ->> 'docType'; v_id uuid; v_path text := nullif(p ->> 'filePath', '');
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.sub_compliance_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_type is null or v_type not in ('w9', 'coi_general_liability', 'workers_comp', 'auto_liability', 'umbrella', 'license',
                                      'subcontract_agreement', 'master_agreement', 'lien_waiver', 'other') then
    raise exception 'bad_type' using errcode = '22023';
  end if;
  -- Files must sit under this subcontractor's own folder.
  if v_path is not null and v_path not like coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text || '/%' then raise exception 'bad_path' using errcode = '22023'; end if;
  if v_type = 'w9' or public.pm_sub_doc_kind_insurance(v_type) then
    update public.pm_sub_documents set status = 'replaced' where resource_id = r.id and doc_type = v_type and status = 'on_file';
  end if;
  insert into public.pm_sub_documents (resource_id, company_id, owner_id, doc_type, title, issuer, policy_number, coverage_amount,
    effective_on, expires_on, signed_on, file_path, file_name, note, recorded_by)
  values (r.id, r.company_id, r.owner_id, v_type, left(nullif(btrim(p ->> 'title'), ''), 200), left(nullif(btrim(p ->> 'issuer'), ''), 200),
          left(nullif(btrim(p ->> 'policyNumber'), ''), 80), nullif(p ->> 'coverageAmount', '')::numeric,
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
$sql$;
  end if;
end $do$;

