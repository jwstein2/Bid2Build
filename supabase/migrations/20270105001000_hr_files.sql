-- HR files for employees (staff in Team & Subcontractors).
--
--   1. pm_hr_managers + pm_hr_can(): who may open HR files. The solo account owner, the company owner, and the
--      people the owner names as HR managers. Nobody else, whatever their role (not even "manage team").
--   2. pm_employee_hr: legal name, date of birth, home address, personal phone/email, two emergency contacts,
--      employment type and status, separation details, I-9 dates, PTO allowances, HR notes.
--   3. Social Security number: stored encrypted (AES-256-GCM, by the server) in pm_sensitive_ids with kind 'ssn'.
--      pm_sensitive_can() is redefined so SSNs are HR-only. Every save/view/removal is logged first.
--   4. pm_employee_documents (private hr-records bucket): application, résumé, offer letter, W-4, I-9, direct
--      deposit form, handbook acknowledgment, reviews, write-ups, separation paperwork, licenses, other.
--   5. pm_employee_certifications: licenses/certifications with expiry (OSHA 10/30, CDL, first aid, trade licenses).
--   6. pm_pto_entries: time off requested/approved, and the year's balance from the allowance on the HR file.
--   7. pm_hr_audit: every HR change, with the field names that changed (never the values).
--
-- No SSN, date of birth or HR field ever appears in exports, the activity feed, analytics or logs.
-- Safe to run more than once. Requires 20270104001000_sub_compliance.sql. Rollback: docs/team-records/rollback_20270105001000.sql

-- 1. Who may open HR files -------------------------------------------------------------------------------------
create table if not exists public.pm_hr_managers (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  added_by   uuid references auth.users (id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (company_id, user_id)
);
alter table public.pm_hr_managers enable row level security;
revoke all on public.pm_hr_managers from anon, authenticated;
drop policy if exists pm_hr_managers_select on public.pm_hr_managers;
create policy pm_hr_managers_select on public.pm_hr_managers for select to authenticated
  using (public.team_is_company_owner(company_id) or user_id = auth.uid());
grant select on public.pm_hr_managers to authenticated;

create or replace function public.pm_hr_can(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null and public.team_in_my_scope(p_company, p_owner) and case
    when p_company is null then p_owner = auth.uid()
    else public.team_is_company_owner(p_company)
      or exists (select 1 from public.pm_hr_managers h join public.company_members m on m.company_id = h.company_id and m.user_id = h.user_id and m.status = 'active'
                  where h.company_id = p_company and h.user_id = auth.uid())
  end, false)
$$;
revoke execute on function public.pm_hr_can(uuid, uuid) from public, anon;
grant execute on function public.pm_hr_can(uuid, uuid) to authenticated;

-- The owner names (or removes) HR managers. Only active members of the company.
create or replace function public.pm_hr_manager_set(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.team_is_company_owner(v_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_on then
    if not exists (select 1 from public.company_members where company_id = v_company and user_id = p_user and status = 'active') then
      raise exception 'not_member' using errcode = '22023';
    end if;
    insert into public.pm_hr_managers (company_id, user_id, added_by) values (v_company, p_user, auth.uid()) on conflict do nothing;
  else
    delete from public.pm_hr_managers where company_id = v_company and user_id = p_user;
  end if;
  insert into public.pm_hr_audit (company_id, actor, action, fields) values (v_company, auth.uid(), case when p_on then 'hr_manager_added' else 'hr_manager_removed' end, array[p_user::text]);
end $$;

-- 7 (needed above). Audit trail: who changed what (field names only) -------------------------------------------
create table if not exists public.pm_hr_audit (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid references public.pm_resources (id) on delete set null,
  company_id  uuid references public.companies (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete cascade,
  actor       uuid references auth.users (id) on delete set null,
  action      text not null check (char_length(action) <= 60),
  fields      text[] not null default '{}',
  at          timestamptz not null default now()
);
create index if not exists pm_hr_audit_resource_idx on public.pm_hr_audit (resource_id, at desc);
alter table public.pm_hr_audit enable row level security;
revoke all on public.pm_hr_audit from anon, authenticated;
drop policy if exists pm_hr_audit_select on public.pm_hr_audit;
create policy pm_hr_audit_select on public.pm_hr_audit for select to authenticated using (public.pm_hr_can(company_id, owner_id));
grant select on public.pm_hr_audit to authenticated;

revoke execute on function public.pm_hr_manager_set(uuid, boolean) from public, anon;
grant execute on function public.pm_hr_manager_set(uuid, boolean) to authenticated;

-- 3. SSNs: HR only (TINs unchanged) --------------------------------------------------------------------------
create or replace function public.pm_sensitive_can(p_resource_id uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_kind
      when 'tin' then r.kind = 'subcontractor' and public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)
      when 'ssn' then r.kind = 'staff' and public.pm_hr_can(r.company_id, r.owner_id)
      else false end
      from public.pm_resources r where r.id = p_resource_id), false)
$$;

-- 2. The HR file ------------------------------------------------------------------------------------------------
create table if not exists public.pm_employee_hr (
  resource_id          uuid primary key references public.pm_resources (id) on delete cascade,
  legal_first_name     text check (char_length(legal_first_name) <= 100),
  legal_middle_name    text check (char_length(legal_middle_name) <= 100),
  legal_last_name      text check (char_length(legal_last_name) <= 100),
  preferred_name       text check (char_length(preferred_name) <= 100),
  date_of_birth        date check (date_of_birth is null or date_of_birth between date '1900-01-01' and current_date),
  personal_phone       text check (char_length(personal_phone) <= 40),
  personal_email       text check (char_length(personal_email) <= 320),
  address_line1        text check (char_length(address_line1) <= 200),
  address_line2        text check (char_length(address_line2) <= 200),
  city                 text check (char_length(city) <= 100),
  state                text check (char_length(state) <= 40),
  zip                  text check (char_length(zip) <= 20),
  emergency1_name      text check (char_length(emergency1_name) <= 200),
  emergency1_relation  text check (char_length(emergency1_relation) <= 60),
  emergency1_phone     text check (char_length(emergency1_phone) <= 40),
  emergency1_alt_phone text check (char_length(emergency1_alt_phone) <= 40),
  emergency2_name      text check (char_length(emergency2_name) <= 200),
  emergency2_relation  text check (char_length(emergency2_relation) <= 60),
  emergency2_phone     text check (char_length(emergency2_phone) <= 40),
  employment_type      text check (employment_type in ('full_time', 'part_time', 'seasonal', 'temporary', 'intern')),
  employment_status    text not null default 'active' check (employment_status in ('applicant', 'active', 'on_leave', 'separated')),
  department           text check (char_length(department) <= 100),
  supervisor_id        uuid references public.pm_resources (id) on delete set null,
  work_location        text check (char_length(work_location) <= 200),
  separation_date      date,
  separation_reason    text check (separation_reason in ('resigned', 'laid_off', 'terminated', 'retired', 'contract_ended', 'other')),
  rehire_eligible      boolean,
  i9_completed_on      date,
  i9_reverify_on       date,
  pto_hours_per_year   numeric(6, 2) check (pto_hours_per_year is null or pto_hours_per_year between 0 and 2000),
  sick_hours_per_year  numeric(6, 2) check (sick_hours_per_year is null or sick_hours_per_year between 0 and 2000),
  notes                text check (char_length(notes) <= 5000),
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);
alter table public.pm_employee_hr enable row level security;
revoke all on public.pm_employee_hr from anon, authenticated;
drop policy if exists pm_employee_hr_select on public.pm_employee_hr;
create policy pm_employee_hr_select on public.pm_employee_hr for select to authenticated
  using (exists (select 1 from public.pm_resources r where r.id = resource_id and public.pm_hr_can(r.company_id, r.owner_id)));
grant select on public.pm_employee_hr to authenticated;

create or replace function public.pm_hr_resource(p_resource_id uuid) returns public.pm_resources
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'staff' then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.pm_hr_can(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return r;
end $$;
revoke execute on function public.pm_hr_resource(uuid) from public, anon, authenticated;

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

-- 4. HR documents --------------------------------------------------------------------------------------------------
create table if not exists public.pm_employee_documents (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  company_id  uuid references public.companies (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete cascade,
  doc_type    text not null check (doc_type in ('application', 'resume', 'offer_letter', 'w4', 'state_w4', 'i9', 'direct_deposit', 'handbook_ack',
                                                'background_check', 'drug_test', 'review', 'warning', 'separation', 'license', 'certification', 'medical', 'other')),
  title       text check (char_length(title) <= 200),
  signed_on   date,
  expires_on  date,
  note        text check (char_length(note) <= 1000),
  file_path   text check (char_length(file_path) <= 500),
  file_name   text check (char_length(file_name) <= 200),
  status      text not null default 'on_file' check (status in ('on_file', 'removed')),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index if not exists pm_employee_documents_resource_idx on public.pm_employee_documents (resource_id, recorded_at desc);
alter table public.pm_employee_documents enable row level security;
revoke all on public.pm_employee_documents from anon, authenticated;
drop policy if exists pm_employee_documents_select on public.pm_employee_documents;
create policy pm_employee_documents_select on public.pm_employee_documents for select to authenticated using (public.pm_hr_can(company_id, owner_id));
grant select (id, resource_id, company_id, owner_id, doc_type, title, signed_on, expires_on, note, file_name, status, recorded_by, recorded_at)
  on public.pm_employee_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-records', 'hr-records', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- p {docType, title?, signedOn?, expiresOn?, note?, filePath?, fileName?}. The server uploads the file first to
-- hr-records/<company or owner>/<resource>/..., then records it here.
create or replace function public.pm_employee_document_add(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_hr_resource(p_resource_id); v_id uuid; v_path text := nullif(p ->> 'filePath', '');
begin
  if v_path is not null and v_path not like coalesce(r.company_id, r.owner_id)::text || '/' || r.id::text || '/%' then raise exception 'bad_path' using errcode = '22023'; end if;
  insert into public.pm_employee_documents (resource_id, company_id, owner_id, doc_type, title, signed_on, expires_on, note, file_path, file_name, recorded_by)
  values (r.id, r.company_id, r.owner_id, p ->> 'docType', left(nullif(btrim(p ->> 'title'), ''), 200), nullif(p ->> 'signedOn', '')::date,
          nullif(p ->> 'expiresOn', '')::date, left(nullif(btrim(p ->> 'note'), ''), 1000), v_path, left(nullif(btrim(p ->> 'fileName'), ''), 200), auth.uid())
  returning id into v_id;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (r.id, r.company_id, r.owner_id, auth.uid(), 'document.added', array[p ->> 'docType']);
  return v_id;
exception when check_violation then raise exception 'bad_type' using errcode = '22023';
end $$;

-- File path for a short-lived link (the server checks this as the signed-in user, then signs with the service role).
create or replace function public.pm_employee_document_file(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.pm_employee_documents;
begin
  select * into d from public.pm_employee_documents where id = p_id and status = 'on_file';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.pm_hr_resource(d.resource_id);
  if d.file_path is null then raise exception 'no_file' using errcode = 'P0002'; end if;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (d.resource_id, d.company_id, d.owner_id, auth.uid(), 'document.opened', array[d.doc_type]);
  return jsonb_build_object('path', d.file_path, 'fileName', d.file_name);
end $$;

create or replace function public.pm_employee_document_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.pm_employee_documents;
begin
  select * into d from public.pm_employee_documents where id = p_id and status = 'on_file';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.pm_hr_resource(d.resource_id);
  update public.pm_employee_documents set status = 'removed' where id = p_id;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (d.resource_id, d.company_id, d.owner_id, auth.uid(), 'document.removed', array[d.doc_type]);
end $$;
revoke execute on function public.pm_employee_document_add(uuid, jsonb), public.pm_employee_document_file(uuid), public.pm_employee_document_remove(uuid) from public, anon;
grant execute on function public.pm_employee_document_add(uuid, jsonb), public.pm_employee_document_file(uuid), public.pm_employee_document_remove(uuid) to authenticated;

-- 5. Certifications ----------------------------------------------------------------------------------------------
create table if not exists public.pm_employee_certifications (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  company_id  uuid references public.companies (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  issuer      text check (char_length(issuer) <= 200),
  number      text check (char_length(number) <= 80),
  issued_on   date,
  expires_on  date,
  document_id uuid references public.pm_employee_documents (id) on delete set null,
  note        text check (char_length(note) <= 500),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists pm_employee_certifications_resource_idx on public.pm_employee_certifications (resource_id);
alter table public.pm_employee_certifications enable row level security;
revoke all on public.pm_employee_certifications from anon, authenticated;
drop policy if exists pm_employee_certifications_select on public.pm_employee_certifications;
create policy pm_employee_certifications_select on public.pm_employee_certifications for select to authenticated using (public.pm_hr_can(company_id, owner_id));
grant select on public.pm_employee_certifications to authenticated;

-- p {id?, name, issuer?, number?, issuedOn?, expiresOn?, documentId?, note?}; returns the id.
create or replace function public.pm_employee_cert_save(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_hr_resource(p_resource_id); v_id uuid := nullif(p ->> 'id', '')::uuid; v_doc uuid := nullif(p ->> 'documentId', '')::uuid;
begin
  if v_doc is not null and not exists (select 1 from public.pm_employee_documents where id = v_doc and resource_id = r.id) then raise exception 'bad_document' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.pm_employee_certifications (resource_id, company_id, owner_id, name, issuer, number, issued_on, expires_on, document_id, note, created_by)
    values (r.id, r.company_id, r.owner_id, btrim(p ->> 'name'), nullif(btrim(p ->> 'issuer'), ''), nullif(btrim(p ->> 'number'), ''), nullif(p ->> 'issuedOn', '')::date,
            nullif(p ->> 'expiresOn', '')::date, v_doc, nullif(btrim(p ->> 'note'), ''), auth.uid())
    returning id into v_id;
  else
    update public.pm_employee_certifications set name = btrim(p ->> 'name'), issuer = nullif(btrim(p ->> 'issuer'), ''), number = nullif(btrim(p ->> 'number'), ''),
      issued_on = nullif(p ->> 'issuedOn', '')::date, expires_on = nullif(p ->> 'expiresOn', '')::date, document_id = v_doc, note = nullif(btrim(p ->> 'note'), '')
     where id = v_id and resource_id = r.id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (r.id, r.company_id, r.owner_id, auth.uid(), 'certification.saved', array[btrim(p ->> 'name')]);
  return v_id;
exception when check_violation or not_null_violation then raise exception 'invalid' using errcode = '22023';
end $$;

create or replace function public.pm_employee_cert_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pm_employee_certifications;
begin
  select * into c from public.pm_employee_certifications where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.pm_hr_resource(c.resource_id);
  delete from public.pm_employee_certifications where id = p_id;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (c.resource_id, c.company_id, c.owner_id, auth.uid(), 'certification.removed', array[c.name]);
end $$;
revoke execute on function public.pm_employee_cert_save(uuid, jsonb), public.pm_employee_cert_remove(uuid) from public, anon;
grant execute on function public.pm_employee_cert_save(uuid, jsonb), public.pm_employee_cert_remove(uuid) to authenticated;

-- 6. Time off ------------------------------------------------------------------------------------------------------
create table if not exists public.pm_pto_entries (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  company_id  uuid references public.companies (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('pto', 'sick', 'unpaid', 'holiday', 'bereavement', 'jury', 'other')),
  start_date  date not null,
  end_date    date not null,
  hours       numeric(6, 2) not null check (hours > 0 and hours <= 2000),
  status      text not null default 'approved' check (status in ('requested', 'approved', 'denied', 'canceled')),
  note        text check (char_length(note) <= 500),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz,
  check (end_date >= start_date and end_date - start_date <= 366)
);
create index if not exists pm_pto_entries_resource_idx on public.pm_pto_entries (resource_id, start_date desc);
alter table public.pm_pto_entries enable row level security;
revoke all on public.pm_pto_entries from anon, authenticated;
drop policy if exists pm_pto_entries_select on public.pm_pto_entries;
create policy pm_pto_entries_select on public.pm_pto_entries for select to authenticated using (public.pm_hr_can(company_id, owner_id));
grant select on public.pm_pto_entries to authenticated;

-- p {kind, startDate, endDate, hours, status?, note?}
create or replace function public.pm_pto_save(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_hr_resource(p_resource_id); v_id uuid; v_status text := coalesce(nullif(p ->> 'status', ''), 'approved');
begin
  insert into public.pm_pto_entries (resource_id, company_id, owner_id, kind, start_date, end_date, hours, status, note, created_by, decided_by, decided_at)
  values (r.id, r.company_id, r.owner_id, p ->> 'kind', (p ->> 'startDate')::date, coalesce(nullif(p ->> 'endDate', ''), p ->> 'startDate')::date, (p ->> 'hours')::numeric,
          v_status, left(nullif(btrim(p ->> 'note'), ''), 500), auth.uid(), case when v_status <> 'requested' then auth.uid() end, case when v_status <> 'requested' then now() end)
  returning id into v_id;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (r.id, r.company_id, r.owner_id, auth.uid(), 'time_off.added', array[p ->> 'kind']);
  return v_id;
exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then raise exception 'invalid' using errcode = '22023';
end $$;

create or replace function public.pm_pto_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.pm_pto_entries;
begin
  if p_status not in ('approved', 'denied', 'canceled') then raise exception 'invalid' using errcode = '22023'; end if;
  select * into e from public.pm_pto_entries where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.pm_hr_resource(e.resource_id);
  update public.pm_pto_entries set status = p_status, decided_by = auth.uid(), decided_at = now() where id = p_id;
  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields) values (e.resource_id, e.company_id, e.owner_id, auth.uid(), 'time_off.' || p_status, array[e.kind]);
end $$;
revoke execute on function public.pm_pto_save(uuid, jsonb), public.pm_pto_set_status(uuid, text) from public, anon;
grant execute on function public.pm_pto_save(uuid, jsonb), public.pm_pto_set_status(uuid, text) to authenticated;

-- One employee's HR file for the page: everything except the SSN (only whether it's on file and its last 4).
create or replace function public.pm_employee_hr_get(p_resource_id uuid, p_year integer default extract(year from current_date)::integer) returns jsonb
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

-- Everyone's HR file at a glance (HR only): what's missing and what expires soon. No personal details.
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
