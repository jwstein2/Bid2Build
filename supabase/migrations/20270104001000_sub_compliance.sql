-- Built2Bid: subcontractor compliance (QuickBooks gap work, part 4).
--
--   1. pm_sensitive_ids: full tax ids (subcontractor TIN now, employee SSN in 20270105001000), encrypted by the
--      server (AES-256-GCM, PII_ENCRYPTION_KEY) before they reach the database. Only the service role can read
--      the table; the app shows the last 4 and reveals the full number only to people allowed to see it, after
--      pm_sensitive_log records who asked (pm_sensitive_access_log, append-only).
--   2. pm_sub_doc_requests: a secure link (token hash only) a contractor emails to a subcontractor so the sub fills
--      in their own W-9 and uploads insurance certificates / licenses. Submissions are applied by
--      pm_sub_request_submit (service role, called by the public /sub-docs/<token> page after it checks the token
--      and stores the files). Links expire after 14 days and work once.
--   3. pm_compliance_notices: one row per document and stage (30 days, 7 days, expired) so the daily job emails
--      the contractor about an expiring certificate once per stage.
--   4. fin_vendor_compliance(book): per vendor linked to a subcontractor, whether a W-9 and current insurance are
--      on file. Shown as a warning when recording a bill or paying a sub. It never blocks a payment.
--   5. pm_payer_profiles: the contractor's own legal name, EIN and address for 1099-NEC forms.
--
-- Safe to run more than once. Requires 20261210001000_team_records.sql. Rollback: docs/team-records/rollback_20270104001000.sql

-- 1. Encrypted tax ids + access log ------------------------------------------------------------------------
create table if not exists public.pm_sensitive_ids (
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  kind        text not null check (kind in ('tin', 'ssn')),
  sealed      text not null check (sealed ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' and char_length(sealed) <= 400),
  last4       text not null check (last4 ~ '^[0-9]{4}$'),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (resource_id, kind)
);
alter table public.pm_sensitive_ids enable row level security;
revoke all on public.pm_sensitive_ids from anon, authenticated;
grant select, insert, update, delete on public.pm_sensitive_ids to service_role;

create table if not exists public.pm_sensitive_access_log (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid references public.pm_resources (id) on delete set null,
  company_id  uuid references public.companies (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('tin', 'ssn')),
  action      text not null check (action in ('saved', 'revealed', 'exported', 'removed', 'submitted_by_sub')),
  actor       uuid references auth.users (id) on delete set null,
  note        text check (char_length(note) <= 300),
  at          timestamptz not null default now()
);
create index if not exists pm_sensitive_access_log_resource_idx on public.pm_sensitive_access_log (resource_id, at desc);
alter table public.pm_sensitive_access_log enable row level security;
revoke all on public.pm_sensitive_access_log from anon, authenticated;

-- Who may see or change a full tax id. TIN: subcontractor compliance managers. SSN: added by the HR migration.
create or replace function public.pm_sensitive_can(p_resource_id uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_kind
      when 'tin' then r.kind = 'subcontractor' and public.team_in_my_scope(r.company_id, r.owner_id) and public.sub_compliance_manageable(r.company_id, r.owner_id)
      else false end
      from public.pm_resources r where r.id = p_resource_id), false)
$$;
revoke execute on function public.pm_sensitive_can(uuid, text) from public, anon;
grant execute on function public.pm_sensitive_can(uuid, text) to authenticated;

drop policy if exists pm_sensitive_access_log_select on public.pm_sensitive_access_log;
create policy pm_sensitive_access_log_select on public.pm_sensitive_access_log for select to authenticated
  using (resource_id is not null and public.pm_sensitive_can(resource_id, kind));
grant select on public.pm_sensitive_access_log to authenticated;

-- Check permission and record the access in one step, as the signed-in user, BEFORE the server touches the
-- encrypted value with the service role. Returns the last 4 on file (or null).
create or replace function public.pm_sensitive_log(p_resource_id uuid, p_kind text, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_last4 text;
begin
  if p_action not in ('saved', 'revealed', 'exported', 'removed') then raise exception 'bad_action' using errcode = '22023'; end if;
  if not public.pm_sensitive_can(p_resource_id, p_kind) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.pm_resources where id = p_resource_id;
  insert into public.pm_sensitive_access_log (resource_id, company_id, owner_id, kind, action, actor, note)
  values (r.id, r.company_id, r.owner_id, p_kind, p_action, auth.uid(), left(nullif(btrim(p_note), ''), 300));
  select last4 into v_last4 from public.pm_sensitive_ids where resource_id = r.id and kind = p_kind;
  return v_last4;
end $$;
revoke execute on function public.pm_sensitive_log(uuid, text, text, text) from public, anon;
grant execute on function public.pm_sensitive_log(uuid, text, text, text) to authenticated;

-- Whether a full id is on file (last 4 only), for the people allowed to see it.
create or replace function public.pm_sensitive_status(p_resource_id uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.pm_sensitive_ids;
begin
  if not public.pm_sensitive_can(p_resource_id, p_kind) then return null; end if;
  select * into s from public.pm_sensitive_ids where resource_id = p_resource_id and kind = p_kind;
  if not found then return jsonb_build_object('onFile', false); end if;
  return jsonb_build_object('onFile', true, 'last4', s.last4, 'updatedAt', s.updated_at);
end $$;
revoke execute on function public.pm_sensitive_status(uuid, text) from public, anon;
grant execute on function public.pm_sensitive_status(uuid, text) to authenticated;

-- 2. Self-serve request links --------------------------------------------------------------------------------
create table if not exists public.pm_sub_doc_requests (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.pm_resources (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete cascade,
  owner_id     uuid references auth.users (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  kinds        text[] not null check (cardinality(kinds) between 1 and 8 and kinds <@ array['w9', 'coi_general_liability', 'workers_comp', 'auto_liability', 'umbrella', 'license']::text[]),
  to_email     text check (char_length(to_email) <= 320),
  note         text check (char_length(note) <= 1000),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  opened_at    timestamptz,
  completed_at timestamptz,
  revoked_at   timestamptz,
  constraint pm_sub_doc_requests_scope check ((company_id is null) <> (owner_id is null))
);
create index if not exists pm_sub_doc_requests_resource_idx on public.pm_sub_doc_requests (resource_id, created_at desc);
alter table public.pm_sub_doc_requests enable row level security;
revoke all on public.pm_sub_doc_requests from anon, authenticated;
drop policy if exists pm_sub_doc_requests_select on public.pm_sub_doc_requests;
create policy pm_sub_doc_requests_select on public.pm_sub_doc_requests for select to authenticated
  using (public.team_in_my_scope(company_id, owner_id) and public.sub_compliance_manageable(company_id, owner_id));
grant select (id, resource_id, company_id, owner_id, kinds, to_email, note, created_by, created_at, expires_at, opened_at, completed_at, revoked_at)
  on public.pm_sub_doc_requests to authenticated;

alter table public.pm_sub_documents add column if not exists request_id uuid references public.pm_sub_doc_requests (id) on delete set null;
alter table public.pm_sub_tax_profiles add column if not exists signed_name text check (char_length(signed_name) <= 200);
alter table public.pm_sub_tax_profiles add column if not exists signed_at timestamptz;
alter table public.pm_sub_tax_profiles add column if not exists request_id uuid references public.pm_sub_doc_requests (id) on delete set null;

-- p {kinds: [...], toEmail?, note?, tokenHash} (the server makes the token and keeps only its hash here)
create or replace function public.pm_sub_request_create(p_resource_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_id uuid; v_kinds text[];
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'subcontractor' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.sub_compliance_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct k), '{}') into v_kinds from jsonb_array_elements_text(coalesce(p -> 'kinds', '[]'::jsonb)) k;
  if cardinality(v_kinds) = 0 then raise exception 'kinds_required' using errcode = '22023'; end if;
  if coalesce(p ->> 'tokenHash', '') !~ '^[0-9a-f]{64}$' then raise exception 'bad_token' using errcode = '22023'; end if;
  -- One open link per subcontractor: a new one replaces the old.
  update public.pm_sub_doc_requests set revoked_at = now() where resource_id = r.id and completed_at is null and revoked_at is null;
  insert into public.pm_sub_doc_requests (resource_id, company_id, owner_id, token_hash, kinds, to_email, note, created_by)
  values (r.id, r.company_id, r.owner_id, p ->> 'tokenHash', v_kinds, lower(nullif(btrim(p ->> 'toEmail'), '')), left(nullif(btrim(p ->> 'note'), ''), 1000), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.pm_sub_request_create(uuid, jsonb) from public, anon;
grant execute on function public.pm_sub_request_create(uuid, jsonb) to authenticated;

create or replace function public.pm_sub_request_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q public.pm_sub_doc_requests;
begin
  select * into q from public.pm_sub_doc_requests where id = p_id for update;
  if not found or not public.team_in_my_scope(q.company_id, q.owner_id) or not public.sub_compliance_manageable(q.company_id, q.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.pm_sub_doc_requests set revoked_at = coalesce(revoked_at, now()) where id = p_id and completed_at is null;
end $$;
revoke execute on function public.pm_sub_request_revoke(uuid) from public, anon;
grant execute on function public.pm_sub_request_revoke(uuid) to authenticated;

-- What the public page may show for a token (service role only): the contractor's name, the sub's name, what's asked.
create or replace function public.pm_sub_request_lookup(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.pm_sub_doc_requests; r public.pm_resources; v_company text;
begin
  select * into q from public.pm_sub_doc_requests where token_hash = p_token_hash;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if q.revoked_at is not null then return jsonb_build_object('state', 'revoked'); end if;
  if q.completed_at is not null then return jsonb_build_object('state', 'completed'); end if;
  if q.expires_at < now() then return jsonb_build_object('state', 'expired'); end if;
  update public.pm_sub_doc_requests set opened_at = coalesce(opened_at, now()) where id = q.id;
  select * into r from public.pm_resources where id = q.resource_id;
  if q.company_id is not null then select name into v_company from public.companies where id = q.company_id; end if;
  if v_company is null then
    select bp.company_name into v_company from public.business_profiles bp
     where bp.user_id = coalesce(q.owner_id, (select c.owner_user_id from public.companies c where c.id = q.company_id));
  end if;
  return jsonb_build_object('state', 'open', 'id', q.id, 'resourceId', r.id, 'subName', r.name, 'contractor', coalesce(v_company, 'Your contractor'),
    'kinds', to_jsonb(q.kinds), 'note', q.note, 'expiresAt', q.expires_at, 'folder', coalesce(q.company_id, q.owner_id)::text || '/' || r.id::text);
end $$;
revoke execute on function public.pm_sub_request_lookup(text) from public, anon, authenticated;
grant execute on function public.pm_sub_request_lookup(text) to service_role;

-- Apply a submission (service role only, after the server stored the files and encrypted the TIN).
-- p {w9?: {legalName, businessName?, taxClassification, tinType, tinLast4, address, signedName}, sealedTin?,
--    documents?: [{docType, issuer?, policyNumber?, coverageAmount?, effectiveOn?, expiresOn?, filePath, fileName}]}
create or replace function public.pm_sub_request_submit(p_token_hash text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.pm_sub_doc_requests; r public.pm_resources; w jsonb := p -> 'w9'; d jsonb; v_folder text; v_n integer := 0; v_last4 text;
begin
  select * into q from public.pm_sub_doc_requests where token_hash = p_token_hash for update;
  if not found or q.revoked_at is not null or q.completed_at is not null or q.expires_at < now() then raise exception 'link_closed' using errcode = 'P0001'; end if;
  select * into r from public.pm_resources where id = q.resource_id;
  v_folder := coalesce(q.company_id, q.owner_id)::text || '/' || r.id::text || '/';
  if w is not null and jsonb_typeof(w) = 'object' then
    if not ('w9' = any (q.kinds)) then raise exception 'not_requested' using errcode = '22023'; end if;
    v_last4 := regexp_replace(coalesce(w ->> 'tinLast4', ''), '[^0-9]', '', 'g');
    if v_last4 !~ '^[0-9]{4}$' or coalesce(w ->> 'tinType', '') not in ('ssn', 'ein') or nullif(btrim(w ->> 'legalName'), '') is null
       or nullif(btrim(w ->> 'signedName'), '') is null or coalesce(w ->> 'taxClassification', '') not in ('individual', 'c_corp', 's_corp', 'partnership', 'trust_estate', 'llc_c', 'llc_s', 'llc_p', 'other') then
      raise exception 'bad_w9' using errcode = '22023';
    end if;
    insert into public.pm_sub_tax_profiles (resource_id, legal_name, business_name, tax_classification, tin_type, tin_last4, address, w9_signed_on, signed_name, signed_at, request_id)
    values (r.id, left(btrim(w ->> 'legalName'), 200), left(nullif(btrim(w ->> 'businessName'), ''), 200), w ->> 'taxClassification', w ->> 'tinType', v_last4,
            left(nullif(btrim(w ->> 'address'), ''), 500), current_date, left(btrim(w ->> 'signedName'), 200), now(), q.id)
    on conflict (resource_id) do update set legal_name = excluded.legal_name, business_name = excluded.business_name, tax_classification = excluded.tax_classification,
      tin_type = excluded.tin_type, tin_last4 = excluded.tin_last4, address = excluded.address, w9_signed_on = excluded.w9_signed_on,
      signed_name = excluded.signed_name, signed_at = excluded.signed_at, request_id = excluded.request_id, updated_by = null, updated_at = now();
    if nullif(p ->> 'sealedTin', '') is not null then
      insert into public.pm_sensitive_ids (resource_id, kind, sealed, last4) values (r.id, 'tin', p ->> 'sealedTin', v_last4)
      on conflict (resource_id, kind) do update set sealed = excluded.sealed, last4 = excluded.last4, updated_by = null, updated_at = now();
      insert into public.pm_sensitive_access_log (resource_id, company_id, owner_id, kind, action, note) values (r.id, r.company_id, r.owner_id, 'tin', 'submitted_by_sub', 'Entered by the subcontractor on their W-9');
    end if;
    update public.pm_sub_documents set status = 'replaced' where resource_id = r.id and doc_type = 'w9' and status = 'on_file';
    insert into public.pm_sub_documents (resource_id, company_id, owner_id, doc_type, title, signed_on, note, request_id)
    values (r.id, r.company_id, r.owner_id, 'w9', 'W-9 (filled in online)', current_date, 'Signed online by ' || left(btrim(w ->> 'signedName'), 200), q.id);
    v_n := v_n + 1;
  end if;
  for d in select * from jsonb_array_elements(coalesce(p -> 'documents', '[]'::jsonb)) loop
    if not ((d ->> 'docType') = any (q.kinds)) or (d ->> 'docType') = 'w9' then raise exception 'not_requested' using errcode = '22023'; end if;
    if coalesce(d ->> 'filePath', '') not like v_folder || '%' then raise exception 'bad_path' using errcode = '22023'; end if;
    if public.pm_sub_doc_kind_insurance(d ->> 'docType') then
      update public.pm_sub_documents set status = 'replaced' where resource_id = r.id and doc_type = d ->> 'docType' and status = 'on_file';
    end if;
    insert into public.pm_sub_documents (resource_id, company_id, owner_id, doc_type, issuer, policy_number, coverage_amount, effective_on, expires_on,
      file_path, file_name, note, request_id)
    values (r.id, r.company_id, r.owner_id, d ->> 'docType', left(nullif(btrim(d ->> 'issuer'), ''), 200), left(nullif(btrim(d ->> 'policyNumber'), ''), 80),
            nullif(d ->> 'coverageAmount', '')::numeric, nullif(d ->> 'effectiveOn', '')::date, nullif(d ->> 'expiresOn', '')::date,
            d ->> 'filePath', left(nullif(d ->> 'fileName', ''), 200), 'Uploaded by the subcontractor', q.id);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'nothing_submitted' using errcode = '22023'; end if;
  update public.pm_sub_doc_requests set completed_at = now() where id = q.id;
  return jsonb_build_object('recorded', v_n, 'resourceId', r.id, 'companyId', q.company_id, 'ownerId', q.owner_id, 'createdBy', q.created_by);
end $$;
revoke execute on function public.pm_sub_request_submit(text, jsonb) from public, anon, authenticated;
grant execute on function public.pm_sub_request_submit(text, jsonb) to service_role;

-- 3. Expiry notices ------------------------------------------------------------------------------------------
create table if not exists public.pm_compliance_notices (
  doc_id  uuid not null references public.pm_sub_documents (id) on delete cascade,
  stage   text not null check (stage in ('30_days', '7_days', 'expired')),
  sent_at timestamptz not null default now(),
  primary key (doc_id, stage)
);
alter table public.pm_compliance_notices enable row level security;
revoke all on public.pm_compliance_notices from anon, authenticated;
grant select, insert on public.pm_compliance_notices to service_role;

-- Documents on file that crossed a notice stage and haven't had that notice yet (service role, daily job).
create or replace function public.pm_compliance_due(p_today date default current_date) returns table (
  doc_id uuid, stage text, company_id uuid, owner_id uuid, resource_id uuid, sub_name text, doc_type text, expires_on date)
language sql stable security definer set search_path = public as $$
  select d.id, s.stage, d.company_id, d.owner_id, d.resource_id, r.name, d.doc_type, d.expires_on
    from public.pm_sub_documents d
    join public.pm_resources r on r.id = d.resource_id and r.status = 'active'
    cross join lateral (select case when d.expires_on < p_today then 'expired'
                                    when d.expires_on <= p_today + 7 then '7_days'
                                    when d.expires_on <= p_today + 30 then '30_days' end as stage) s
   where d.status = 'on_file' and d.expires_on is not null and s.stage is not null
     and d.expires_on >= p_today - 30          -- don't dig up long-expired records
     and not exists (select 1 from public.pm_compliance_notices n where n.doc_id = d.id and n.stage = s.stage)
$$;
revoke execute on function public.pm_compliance_due(date) from public, anon, authenticated;
grant execute on function public.pm_compliance_due(date) to service_role;

-- 4. Vendor compliance (warning when recording a bill or paying a sub) -----------------------------------------
create or replace function public.fin_vendor_compliance(p_book_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fin_can_view_book(p_book_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'vendorId', v.id, 'resourceId', v.resource_id,
      'w9OnFile', coalesce(t.w9_signed_on is not null, false) or exists (select 1 from public.pm_sub_documents d where d.resource_id = v.resource_id and d.doc_type = 'w9' and d.status = 'on_file'),
      'insuranceOnFile', exists (select 1 from public.pm_sub_documents d where d.resource_id = v.resource_id and d.status = 'on_file' and public.pm_sub_doc_kind_insurance(d.doc_type)
                                   and (d.expires_on is null or d.expires_on >= current_date)),
      'expired', coalesce((select jsonb_agg(jsonb_build_object('docType', d.doc_type, 'expiresOn', d.expires_on) order by d.expires_on)
                             from public.pm_sub_documents d where d.resource_id = v.resource_id and d.status = 'on_file' and d.expires_on < current_date
                              and (public.pm_sub_doc_kind_insurance(d.doc_type) or d.doc_type = 'license')), '[]'::jsonb)))
      from public.fin_vendors v
      left join public.pm_sub_tax_profiles t on t.resource_id = v.resource_id
     where v.book_id = p_book_id and v.resource_id is not null and v.kind = 'subcontractor'), '[]'::jsonb);
end $$;
revoke execute on function public.fin_vendor_compliance(uuid) from public, anon;
grant execute on function public.fin_vendor_compliance(uuid) to authenticated;

-- 5. Payer details for 1099-NEC --------------------------------------------------------------------------------
create table if not exists public.pm_payer_profiles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid unique references public.companies (id) on delete cascade,
  owner_id   uuid unique references auth.users (id) on delete cascade,
  legal_name text not null check (char_length(btrim(legal_name)) between 1 and 200),
  ein        text check (ein ~ '^[0-9]{2}-[0-9]{7}$'),
  address    text check (char_length(address) <= 500),
  phone      text check (char_length(phone) <= 40),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint pm_payer_profiles_scope check ((company_id is null) <> (owner_id is null))
);
alter table public.pm_payer_profiles enable row level security;
revoke all on public.pm_payer_profiles from anon, authenticated;
drop policy if exists pm_payer_profiles_select on public.pm_payer_profiles;
create policy pm_payer_profiles_select on public.pm_payer_profiles for select to authenticated
  using (public.team_in_my_scope(company_id, owner_id) and public.sub_compliance_manageable(company_id, owner_id));
grant select on public.pm_payer_profiles to authenticated;

-- p {legalName, ein?, address?, phone?}
create or replace function public.pm_payer_profile_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
        v_ein text := nullif(regexp_replace(coalesce(p ->> 'ein', ''), '[^0-9]', '', 'g'), '');
begin
  if not public.sub_compliance_manageable(v_company, v_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_ein is not null and v_ein !~ '^[0-9]{9}$' then raise exception 'bad_ein' using errcode = '22023'; end if;
  if nullif(btrim(p ->> 'legalName'), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if v_company is not null then
    insert into public.pm_payer_profiles (company_id, legal_name, ein, address, phone, updated_by)
    values (v_company, left(btrim(p ->> 'legalName'), 200), case when v_ein is not null then substr(v_ein, 1, 2) || '-' || substr(v_ein, 3) end,
            left(nullif(btrim(p ->> 'address'), ''), 500), left(nullif(btrim(p ->> 'phone'), ''), 40), auth.uid())
    on conflict (company_id) do update set legal_name = excluded.legal_name, ein = excluded.ein, address = excluded.address, phone = excluded.phone,
      updated_by = auth.uid(), updated_at = now();
  else
    insert into public.pm_payer_profiles (owner_id, legal_name, ein, address, phone, updated_by)
    values (v_owner, left(btrim(p ->> 'legalName'), 200), case when v_ein is not null then substr(v_ein, 1, 2) || '-' || substr(v_ein, 3) end,
            left(nullif(btrim(p ->> 'address'), ''), 500), left(nullif(btrim(p ->> 'phone'), ''), 40), auth.uid())
    on conflict (owner_id) do update set legal_name = excluded.legal_name, ein = excluded.ein, address = excluded.address, phone = excluded.phone,
      updated_by = auth.uid(), updated_at = now();
  end if;
end $$;
revoke execute on function public.pm_payer_profile_save(jsonb) from public, anon;
grant execute on function public.pm_payer_profile_save(jsonb) to authenticated;
