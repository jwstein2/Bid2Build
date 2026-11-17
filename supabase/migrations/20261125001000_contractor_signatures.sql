-- V5.3 Proposal signature management: contractor-side signatures and countersigning.
--
-- Extends the existing e-signature system (20261115001000_e_signatures.sql). The customer side is
-- unchanged: signing_requests / signatures stay exactly as they are, and so does every downstream
-- reader of public.signatures (pipeline, project reviews, Financial Command Center).
--
-- * Additive only. New tables + functions, no existing table, column, function, policy or row is
--   changed. Nothing here inserts, updates or backfills any existing signed contract.
-- * contractor_signing_policies: one per company (Enterprise) or per solo account. Who signs for the
--   contractor, whether automatic application is allowed, whether reps may sign.
-- * contractor_signer_credentials: a PERSON's adopted signature (drawn / typed / uploaded), versioned,
--   with the adoption statement, optional standing authorization for automatic application, and the
--   identity check that was done. Evidence is write-once; revoking only flips status columns.
-- * contractor_signing_authorizations: the company owner (or someone the owner trusted with
--   change_proposal_policy) authorizes a member to sign on behalf of the company. No self-grants.
-- * contractor_signing_requirements: what the policy required for one customer signing link, frozen
--   when the link was created. Links created before this migration have no row = "historical".
-- * contractor_signatures: the contractor-side signature actually applied to ONE frozen version:
--   who, under what authority, which credential version, which policy revision, auto vs interactive,
--   what triggered it, and when. Write-once. Never backdated: applied_at is always now().
-- * contractor_executed_documents: processing state of the fully executed PDF (both signatures).
-- * contractor_signing_events: append-only audit trail.
-- * Reads follow the estimate (RLS) for document records; a signer's own credential is readable only by
--   that signer. Every write goes through the service-role functions below, called from server routes
--   after authenticating the caller (same pattern as the customer e-signature functions).
-- * Applying a contractor signature never creates a customer signature, never moves the pipeline,
--   never creates invoices or charges anything.

-- ---------------------------------------------------------------------------
-- 0. Shared guard
-- ---------------------------------------------------------------------------
-- True when an UPDATE only clears columns to NULL from inside another trigger: that is a foreign key
-- ON DELETE SET NULL (an account or policy being deleted), which must not be blocked.
create or replace function public.contractor_only_fk_nulling(p_new jsonb, p_old jsonb) returns boolean
language sql volatile as $$
  select pg_trigger_depth() >= 2 and coalesce(bool_and(n.value = 'null'::jsonb), true)
  from jsonb_each(p_new) n join jsonb_each(p_old) o using (key) where n.value is distinct from o.value
$$;

create or replace function public.contractor_guard_write_once() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Deletes are allowed only through a cascade (account / bid deletion), never directly.
  if tg_op = 'DELETE' and pg_trigger_depth() >= 2 then return old; end if;
  if tg_op = 'UPDATE' and public.contractor_only_fk_nulling(to_jsonb(new), to_jsonb(old)) then return new; end if;
  raise exception 'record_immutable' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Company / account signing policy
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_signing_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references public.companies (id) on delete cascade,
  owner_user_id uuid unique references auth.users (id) on delete cascade,
  -- A finalized, accepted proposal is "fully executed" only after a contractor-side signature.
  required boolean not null default true,
  -- company_signer = Mode A, sales_rep = Mode B, manual = Mode C (a person countersigns each contract).
  mode text not null default 'manual' check (mode in ('company_signer', 'sales_rep', 'manual')),
  default_signer_id uuid references auth.users (id) on delete set null,
  -- Off = every contract needs fresh, interactive approval by the signer.
  auto_apply_allowed boolean not null default false,
  auto_apply_timing text not null default 'before_send' check (auto_apply_timing in ('before_send', 'after_customer')),
  rep_signatures_allowed boolean not null default false,
  revision integer not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_signing_policies_tenant check ((company_id is null) <> (owner_user_id is null))
);

-- Every saved revision, so a signature can always point at the exact policy that applied.
create table if not exists public.contractor_signing_policy_history (
  id bigint generated always as identity primary key,
  policy_id uuid not null references public.contractor_signing_policies (id) on delete cascade,
  revision integer not null,
  settings jsonb not null,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (policy_id, revision)
);
drop trigger if exists contractor_signing_policy_history_write_once on public.contractor_signing_policy_history;
create trigger contractor_signing_policy_history_write_once before update or delete on public.contractor_signing_policy_history
  for each row execute function public.contractor_guard_write_once();

-- ---------------------------------------------------------------------------
-- 2. A person's adopted signature (credential), versioned
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_signer_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null,
  legal_name text not null check (char_length(legal_name) between 2 and 200),
  title text check (char_length(title) <= 120),
  method text not null check (method in ('drawn', 'typed', 'uploaded')),
  signature_text text check (char_length(signature_text) between 2 and 200),
  -- PNG data URL, re-encoded on the server (metadata stripped), bounded.
  signature_image text check (char_length(signature_image) <= 400000),
  image_sha256 text check (image_sha256 ~ '^[0-9a-f]{64}$'),
  adoption_version text not null check (char_length(adoption_version) <= 60),
  adoption_text text not null check (char_length(adoption_text) <= 2000),
  -- Standing authorization for automatic application (null text = not authorized).
  auto_apply_authorized boolean not null default false,
  auto_apply_text text check (char_length(auto_apply_text) <= 2000),
  -- What identity check was done before storing (e.g. {"method":"recent_sign_in","authenticatedAt":...}).
  verification jsonb not null check (jsonb_typeof(verification) = 'object'),
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  -- The only mutable columns.
  status text not null default 'active' check (status in ('active', 'superseded', 'revoked')),
  status_changed_at timestamptz,
  auto_apply_revoked_at timestamptz,
  unique (user_id, version),
  constraint contractor_signer_credentials_payload check (
    (method = 'typed' and signature_text is not null) or (method in ('drawn', 'uploaded') and signature_image is not null and image_sha256 is not null)
  ),
  constraint contractor_signer_credentials_auto check (auto_apply_authorized = (auto_apply_text is not null))
);
create unique index if not exists contractor_signer_credentials_one_active on public.contractor_signer_credentials (user_id) where status = 'active';

create or replace function public.contractor_guard_credential() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() < 2 then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if public.contractor_only_fk_nulling(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if (to_jsonb(new) - array['status', 'status_changed_at', 'auto_apply_revoked_at'])
     is distinct from (to_jsonb(old) - array['status', 'status_changed_at', 'auto_apply_revoked_at']) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  -- Revocation is final: a revoked or superseded credential never becomes active again, and a revoked
  -- automatic-application authorization is never restored (a new credential needs fresh consent).
  if old.status <> 'active' and new.status is distinct from old.status then raise exception 'record_immutable' using errcode = 'P0001'; end if;
  if old.auto_apply_revoked_at is not null and new.auto_apply_revoked_at is distinct from old.auto_apply_revoked_at then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists contractor_signer_credentials_guard on public.contractor_signer_credentials;
create trigger contractor_signer_credentials_guard before update or delete on public.contractor_signer_credentials
  for each row execute function public.contractor_guard_credential();

-- ---------------------------------------------------------------------------
-- 3. Company signing authorizations (owner-controlled)
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_signing_authorizations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- own_bids = the rep signs only bids assigned to them; company_bids = any company bid.
  scope text not null check (scope in ('own_bids', 'company_bids')),
  auto_apply_allowed boolean not null default false,
  title text check (char_length(title) <= 120),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists contractor_signing_authorizations_one_active on public.contractor_signing_authorizations (company_id, user_id) where status = 'active';

create or replace function public.contractor_guard_authorization() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() < 2 then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if public.contractor_only_fk_nulling(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if old.status <> 'active'
     or (to_jsonb(new) - array['status', 'revoked_by', 'revoked_at']) is distinct from (to_jsonb(old) - array['status', 'revoked_by', 'revoked_at']) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists contractor_signing_authorizations_guard on public.contractor_signing_authorizations;
create trigger contractor_signing_authorizations_guard before update or delete on public.contractor_signing_authorizations
  for each row execute function public.contractor_guard_authorization();

-- ---------------------------------------------------------------------------
-- 4. What the policy required for one customer signing link (frozen at link creation)
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_signing_requirements (
  request_id uuid primary key references public.signing_requests (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  required boolean not null,
  mode text not null check (mode in ('company_signer', 'sales_rep', 'manual')),
  sequence text not null check (sequence in ('contractor_first', 'customer_first')),
  policy_id uuid references public.contractor_signing_policies (id) on delete set null,
  policy_revision integer,
  policy_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists contractor_signing_requirements_estimate_idx on public.contractor_signing_requirements (estimate_id);
drop trigger if exists contractor_signing_requirements_write_once on public.contractor_signing_requirements;
create trigger contractor_signing_requirements_write_once before update or delete on public.contractor_signing_requirements
  for each row execute function public.contractor_guard_write_once();

-- ---------------------------------------------------------------------------
-- 5. Contractor signatures actually applied
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_signatures (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  -- One contractor-side signature per frozen version.
  version_id uuid not null unique references public.estimate_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  -- Set when the customer had already signed this version (customer-first / countersignature).
  customer_signature_id uuid references public.signatures (id) on delete set null,
  signer_id uuid references auth.users (id) on delete set null,
  signer_name text not null check (char_length(signer_name) between 2 and 200),
  signer_title text check (char_length(signer_title) <= 120),
  company_name text not null default '' check (char_length(company_name) <= 200),
  authority text not null check (authority in ('business_owner', 'company_owner', 'company_authorization')),
  authorization_id uuid references public.contractor_signing_authorizations (id) on delete set null,
  credential_id uuid references public.contractor_signer_credentials (id) on delete set null,
  credential_version integer not null,
  -- A copy of the applied signature, so later updates or revocation never change an executed document.
  signature_method text not null check (signature_method in ('drawn', 'typed', 'uploaded')),
  signature_text text check (char_length(signature_text) <= 200),
  signature_image text check (char_length(signature_image) <= 400000),
  image_sha256 text check (image_sha256 ~ '^[0-9a-f]{64}$'),
  application text not null check (application in ('auto_policy', 'interactive')),
  trigger text not null check (trigger in ('signing_link_created', 'customer_signed', 'countersign_action', 'sign_before_send', 'corrective_countersign')),
  -- Whose action caused it (auto: the user who created the link, or null when the customer's signature did).
  triggered_by uuid references auth.users (id) on delete set null,
  sequence text not null check (sequence in ('contractor_first', 'customer_first')),
  -- A countersignature added to a proposal signed before contractor signatures existed (never backdated).
  corrective boolean not null default false,
  policy_id uuid references public.contractor_signing_policies (id) on delete set null,
  policy_revision integer,
  policy_snapshot jsonb not null,
  -- Interactive: the statement the signer affirmed. Auto: the standing authorization it relied on.
  statement_text text not null check (char_length(statement_text) <= 2000),
  authorization_given_at timestamptz,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Only recorded for a person actually signing in a browser at that moment.
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 500),
  session_authenticated_at timestamptz,
  applied_at timestamptz not null default now(),
  constraint contractor_signatures_payload check (
    (signature_method = 'typed' and signature_text is not null) or (signature_method in ('drawn', 'uploaded') and signature_image is not null)
  ),
  constraint contractor_signatures_auto_evidence check (
    application = 'interactive' or (ip_address is null and user_agent is null and session_authenticated_at is null and authorization_given_at is not null)
  ),
  constraint contractor_signatures_trigger check (
    (application = 'auto_policy' and trigger in ('signing_link_created', 'customer_signed'))
    or (application = 'interactive' and trigger in ('countersign_action', 'sign_before_send', 'corrective_countersign'))
  )
);
create index if not exists contractor_signatures_estimate_idx on public.contractor_signatures (estimate_id, applied_at desc);
create index if not exists contractor_signatures_company_idx on public.contractor_signatures (company_id, applied_at desc) where company_id is not null;
drop trigger if exists contractor_signatures_write_once on public.contractor_signatures;
create trigger contractor_signatures_write_once before update or delete on public.contractor_signatures
  for each row execute function public.contractor_guard_write_once();

-- A countersigned version is never deleted directly either (mirrors guard_signed_version_delete).
create or replace function public.contractor_guard_signed_version_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() < 2 and exists (select 1 from public.contractor_signatures c where c.version_id = old.id) then
    raise exception 'version_signed' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists estimate_versions_guard_countersigned_delete on public.estimate_versions;
create trigger estimate_versions_guard_countersigned_delete before delete on public.estimate_versions
  for each row execute function public.contractor_guard_signed_version_delete();

-- ---------------------------------------------------------------------------
-- 6. Fully executed document (both signatures) processing state
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_executed_documents (
  signature_id uuid primary key references public.signatures (id) on delete cascade,
  contractor_signature_id uuid not null unique references public.contractor_signatures (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  -- The later of the two real signing times. Never a made-up time.
  executed_at timestamptz not null,
  pdf_status text not null default 'pending' check (pdf_status in ('pending', 'ready', 'failed')),
  pdf_path text,
  pdf_hash text check (pdf_hash ~ '^[0-9a-f]{64}$'),
  pdf_error text check (char_length(pdf_error) <= 500),
  pdf_attempts integer not null default 0,
  pdf_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create or replace function public.contractor_guard_executed_document() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() < 2 then raise exception 'record_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if public.contractor_only_fk_nulling(to_jsonb(new), to_jsonb(old)) then return new; end if;
  if (to_jsonb(new) - array['pdf_status', 'pdf_path', 'pdf_hash', 'pdf_error', 'pdf_attempts', 'pdf_updated_at'])
     is distinct from (to_jsonb(old) - array['pdf_status', 'pdf_path', 'pdf_hash', 'pdf_error', 'pdf_attempts', 'pdf_updated_at']) then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  if old.pdf_status = 'ready' and (new.pdf_path is distinct from old.pdf_path or new.pdf_hash is distinct from old.pdf_hash or new.pdf_status <> 'ready') then
    raise exception 'record_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists contractor_executed_documents_guard on public.contractor_executed_documents;
create trigger contractor_executed_documents_guard before update or delete on public.contractor_executed_documents
  for each row execute function public.contractor_guard_executed_document();

-- ---------------------------------------------------------------------------
-- 7. Audit trail (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_signing_events (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete cascade,
  tenant_user_id uuid references auth.users (id) on delete cascade,
  estimate_id uuid references public.estimates (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event text not null check (event in (
    'policy_saved', 'credential_adopted', 'credential_revoked', 'auto_apply_revoked',
    'authorization_granted', 'authorization_revoked', 'requirement_recorded',
    'contractor_signed_auto', 'contractor_signed_interactive', 'countersign_requested', 'fully_executed', 'auto_apply_skipped'
  )),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists contractor_signing_events_estimate_idx on public.contractor_signing_events (estimate_id, created_at) where estimate_id is not null;
create index if not exists contractor_signing_events_company_idx on public.contractor_signing_events (company_id, created_at desc) where company_id is not null;
create index if not exists contractor_signing_events_tenant_idx on public.contractor_signing_events (tenant_user_id, created_at desc) where tenant_user_id is not null;
drop trigger if exists contractor_signing_events_write_once on public.contractor_signing_events;
create trigger contractor_signing_events_write_once before update or delete on public.contractor_signing_events
  for each row execute function public.contractor_guard_write_once();

-- ---------------------------------------------------------------------------
-- 8. Authority helpers
-- ---------------------------------------------------------------------------
-- Company owner (owner_user_id and still an active member), or a member the owner trusted with
-- change_proposal_policy (an owner-only permission to grant).
create or replace function public.contractor_can_manage_signing(p_actor uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_actor is not null and p_company is not null and exists (
    select 1 from public.company_members m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = p_actor and m.status = 'active'
      and (c.owner_user_id = p_actor or 'change_proposal_policy' = any (public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked)))
  )
$$;

-- The same check for the signed-in caller (used by RLS policies).
create or replace function public.contractor_i_manage_signing(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.contractor_can_manage_signing((select auth.uid()), p_company) $$;

-- May p_signer sign this bid for the contractor? Returns the basis of that authority.
create or replace function public.contractor_signer_authority(p_signer uuid, p_estimate_id uuid)
returns table (ok boolean, authority text, authorization_id uuid, auto_allowed boolean, title text, reason text)
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; c public.companies; a public.contractor_signing_authorizations; v_member boolean;
begin
  select * into e from public.estimates where id = p_estimate_id;
  if not found or p_signer is null then return query select false, null::text, null::uuid, false, null::text, 'estimate_not_found'; return; end if;
  if e.company_id is null then
    if p_signer = e.user_id then return query select true, 'business_owner', null::uuid, true, null::text, null::text;
    else return query select false, null::text, null::uuid, false, null::text, 'signer_not_authorized'; end if;
    return;
  end if;
  select * into c from public.companies where id = e.company_id;
  v_member := exists (select 1 from public.company_members m where m.company_id = e.company_id and m.user_id = p_signer and m.status = 'active');
  if not v_member then return query select false, null::text, null::uuid, false, null::text, 'signer_not_authorized'; return; end if;
  if c.owner_user_id = p_signer then return query select true, 'company_owner', null::uuid, true, null::text, null::text; return; end if;
  select * into a from public.contractor_signing_authorizations
    where company_id = e.company_id and user_id = p_signer and status = 'active';
  if not found then return query select false, null::text, null::uuid, false, null::text, 'signer_not_authorized'; return; end if;
  if a.scope = 'own_bids' and e.user_id <> p_signer then
    return query select false, null::text, null::uuid, false, null::text, 'signer_scope_own_bids'; return;
  end if;
  return query select true, 'company_authorization', a.id, a.auto_apply_allowed, a.title, null::text;
end $$;

-- The policy for a bid's tenant as JSON (defaults when none was saved: required, manual countersign).
create or replace function public.contractor_policy_for(p_company uuid, p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('id', p.id, 'revision', p.revision, 'configured', true, 'required', p.required, 'mode', p.mode,
       'defaultSignerId', p.default_signer_id, 'autoApplyAllowed', p.auto_apply_allowed, 'autoApplyTiming', p.auto_apply_timing,
       'repSignaturesAllowed', p.rep_signatures_allowed, 'updatedAt', p.updated_at)
     from public.contractor_signing_policies p
     where (p_company is not null and p.company_id = p_company) or (p_company is null and p.owner_user_id = p_owner)),
    jsonb_build_object('id', null, 'revision', null, 'configured', false, 'required', true, 'mode', 'manual',
      'defaultSignerId', null, 'autoApplyAllowed', false, 'autoApplyTiming', 'before_send', 'repSignaturesAllowed', false, 'updatedAt', null))
$$;

-- Who should sign this bid for the contractor, and may it happen automatically?
-- Mode B falls back to the company signer when the rep isn't authorized or has no signature on file.
create or replace function public.contractor_resolve_signer(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e public.estimates; p jsonb; c public.companies;
  v_rep_ok boolean := false; v_signer uuid; v_cred public.contractor_signer_credentials; v_auth record; v_missing text; v_auto boolean := false; v_via text;
begin
  select * into e from public.estimates where id = p_estimate_id;
  if not found then return null; end if;
  p := public.contractor_policy_for(e.company_id, e.user_id);
  if not (p ->> 'required')::boolean then
    return jsonb_build_object('required', false, 'policy', p);
  end if;
  if e.company_id is not null then select * into c from public.companies where id = e.company_id; end if;

  -- Mode B: the assigned sales rep (the bid's owner), when allowed, authorized and on file.
  if p ->> 'mode' = 'sales_rep' and (p ->> 'repSignaturesAllowed')::boolean then
    select * into v_auth from public.contractor_signer_authority(e.user_id, e.id);
    if v_auth.ok and exists (select 1 from public.contractor_signer_credentials k where k.user_id = e.user_id and k.status = 'active') then
      v_rep_ok := true; v_signer := e.user_id; v_via := 'sales_rep';
    end if;
  end if;
  if not v_rep_ok then
    -- Mode A / fallback / Mode C designated signer: the configured default, else the business owner.
    v_signer := coalesce(nullif(p ->> 'defaultSignerId', '')::uuid, case when e.company_id is null then e.user_id else c.owner_user_id end);
    v_via := case when p ->> 'mode' = 'sales_rep' then 'company_signer_fallback' else 'company_signer' end;
    select * into v_auth from public.contractor_signer_authority(v_signer, e.id);
  end if;

  select * into v_cred from public.contractor_signer_credentials where user_id = v_signer and status = 'active';
  if not coalesce(v_auth.ok, false) then v_missing := 'signer_not_authorized';
  elsif v_cred.id is null then v_missing := 'no_signature_on_file';
  end if;

  v_auto := coalesce(v_missing is null and p ->> 'mode' <> 'manual' and (p ->> 'autoApplyAllowed')::boolean
    and v_auth.auto_allowed and v_cred.auto_apply_authorized and v_cred.auto_apply_revoked_at is null, false);

  return jsonb_build_object(
    'required', true, 'policy', p, 'signerId', v_signer, 'via', v_via,
    'authority', v_auth.authority, 'authorizationId', v_auth.authorization_id,
    'credentialId', v_cred.id, 'credentialVersion', v_cred.version,
    'signerName', v_cred.legal_name, 'signerTitle', coalesce(nullif(v_auth.title, ''), v_cred.title),
    'autoEligible', v_auto, 'autoTiming', p ->> 'autoApplyTiming',
    'missing', v_missing
  );
end $$;

create or replace function public.contractor_log(p_company uuid, p_tenant uuid, p_estimate uuid, p_actor uuid, p_event text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.contractor_signing_events (company_id, tenant_user_id, estimate_id, actor_id, event, details)
  values (p_company, case when p_company is null then p_tenant end, p_estimate, p_actor, p_event, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 9. Policy management
-- ---------------------------------------------------------------------------
-- p_company null = the actor's own solo account. Only an owner / trusted administrator manages a company.
create or replace function public.contractor_save_policy(p_actor uuid, p_company uuid, p_settings jsonb)
returns public.contractor_signing_policies
language plpgsql security definer set search_path = public as $$
declare
  r public.contractor_signing_policies;
  v_mode text := coalesce(p_settings ->> 'mode', 'manual');
  v_signer uuid := nullif(p_settings ->> 'defaultSignerId', '')::uuid;
  v_ok boolean;
begin
  if p_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_mode not in ('company_signer', 'sales_rep', 'manual') then raise exception 'invalid_policy' using errcode = '22023'; end if;
  if coalesce(p_settings ->> 'autoApplyTiming', 'before_send') not in ('before_send', 'after_customer') then raise exception 'invalid_policy' using errcode = '22023'; end if;
  if p_company is not null then
    if not public.contractor_can_manage_signing(p_actor, p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
    -- The default signer must be someone who can sign for this company: the owner or an authorized member.
    if v_signer is not null then
      select (exists (select 1 from public.companies c where c.id = p_company and c.owner_user_id = v_signer)
              or exists (select 1 from public.contractor_signing_authorizations a where a.company_id = p_company and a.user_id = v_signer and a.status = 'active' and a.scope = 'company_bids'))
         and exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = v_signer and m.status = 'active')
        into v_ok;
      if not v_ok then raise exception 'signer_not_authorized' using errcode = '22023'; end if;
    end if;
  else
    if exists (select 1 from public.company_members m where m.user_id = p_actor and m.status = 'active') then
      raise exception 'use_company_policy' using errcode = '22023';
    end if;
    if v_signer is not null and v_signer <> p_actor then raise exception 'signer_not_authorized' using errcode = '22023'; end if;
  end if;

  -- One policy per tenant; serialize concurrent saves.
  perform pg_advisory_xact_lock(hashtextextended('contractor_policy:' || coalesce(p_company, p_actor)::text, 0));
  update public.contractor_signing_policies set
    required = coalesce((p_settings ->> 'required')::boolean, true), mode = v_mode, default_signer_id = v_signer,
    auto_apply_allowed = coalesce((p_settings ->> 'autoApplyAllowed')::boolean, false),
    auto_apply_timing = coalesce(p_settings ->> 'autoApplyTiming', 'before_send'),
    rep_signatures_allowed = coalesce((p_settings ->> 'repSignaturesAllowed')::boolean, false),
    revision = revision + 1, updated_by = p_actor, updated_at = now()
  where (p_company is not null and company_id = p_company) or (p_company is null and owner_user_id = p_actor)
  returning * into r;
  if r.id is null then
    insert into public.contractor_signing_policies (company_id, owner_user_id, required, mode, default_signer_id, auto_apply_allowed, auto_apply_timing, rep_signatures_allowed, updated_by)
    values (p_company, case when p_company is null then p_actor end,
      coalesce((p_settings ->> 'required')::boolean, true), v_mode, v_signer,
      coalesce((p_settings ->> 'autoApplyAllowed')::boolean, false), coalesce(p_settings ->> 'autoApplyTiming', 'before_send'),
      coalesce((p_settings ->> 'repSignaturesAllowed')::boolean, false), p_actor)
    returning * into r;
  end if;
  insert into public.contractor_signing_policy_history (policy_id, revision, settings, actor_id)
    values (r.id, r.revision, public.contractor_policy_for(r.company_id, r.owner_user_id), p_actor);
  perform public.contractor_log(r.company_id, r.owner_user_id, null, p_actor, 'policy_saved', jsonb_build_object('revision', r.revision, 'mode', r.mode, 'required', r.required, 'autoApplyAllowed', r.auto_apply_allowed, 'repSignaturesAllowed', r.rep_signatures_allowed, 'defaultSignerId', r.default_signer_id));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Credentials (a person's own signature)
-- ---------------------------------------------------------------------------
create or replace function public.contractor_adopt_credential(
  p_user uuid, p_legal_name text, p_title text, p_method text, p_signature_text text, p_signature_image text, p_image_sha256 text,
  p_adoption_version text, p_adoption_text text, p_auto_apply_text text, p_verification jsonb, p_ip text, p_user_agent text
) returns public.contractor_signer_credentials
language plpgsql security definer set search_path = public as $$
declare r public.contractor_signer_credentials; v_next integer; v_company uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contractor_credential:' || p_user::text, 0));
  select coalesce(max(version), 0) + 1 into v_next from public.contractor_signer_credentials where user_id = p_user;
  update public.contractor_signer_credentials set status = 'superseded', status_changed_at = now() where user_id = p_user and status = 'active';
  insert into public.contractor_signer_credentials (user_id, version, legal_name, title, method, signature_text, signature_image, image_sha256,
    adoption_version, adoption_text, auto_apply_authorized, auto_apply_text, verification, ip_address, user_agent)
  values (p_user, v_next, btrim(p_legal_name), nullif(btrim(coalesce(p_title, '')), ''), p_method,
    case when p_method = 'typed' then btrim(p_signature_text) end, case when p_method <> 'typed' then p_signature_image end,
    case when p_method <> 'typed' then p_image_sha256 end,
    p_adoption_version, p_adoption_text, p_auto_apply_text is not null, p_auto_apply_text, p_verification, left(p_ip, 64), left(p_user_agent, 500))
  returning * into r;
  select m.company_id into v_company from public.company_members m where m.user_id = p_user and m.status = 'active';
  perform public.contractor_log(v_company, p_user, null, p_user, 'credential_adopted', jsonb_build_object('credentialId', r.id, 'version', r.version, 'method', r.method, 'autoApplyAuthorized', r.auto_apply_authorized, 'verification', p_verification));
  return r;
end $$;

-- p_scope 'auto_apply' stops future automatic use only; 'all' revokes the signature entirely.
create or replace function public.contractor_revoke_credential(p_user uuid, p_scope text) returns public.contractor_signer_credentials
language plpgsql security definer set search_path = public as $$
declare r public.contractor_signer_credentials; v_company uuid;
begin
  if p_scope not in ('auto_apply', 'all') then raise exception 'invalid_scope' using errcode = '22023'; end if;
  select * into r from public.contractor_signer_credentials where user_id = p_user and status = 'active' for update;
  if not found then raise exception 'no_signature_on_file' using errcode = 'P0002'; end if;
  if p_scope = 'all' then
    update public.contractor_signer_credentials set status = 'revoked', status_changed_at = now(),
      auto_apply_revoked_at = case when auto_apply_authorized then coalesce(auto_apply_revoked_at, now()) end
      where id = r.id returning * into r;
  elsif r.auto_apply_authorized and r.auto_apply_revoked_at is null then
    update public.contractor_signer_credentials set auto_apply_revoked_at = now() where id = r.id returning * into r;
  end if;
  select m.company_id into v_company from public.company_members m where m.user_id = p_user and m.status = 'active';
  perform public.contractor_log(v_company, p_user, null, p_user, case when p_scope = 'all' then 'credential_revoked' else 'auto_apply_revoked' end, jsonb_build_object('credentialId', r.id, 'version', r.version));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Company authorizations
-- ---------------------------------------------------------------------------
create or replace function public.contractor_grant_authorization(p_actor uuid, p_company uuid, p_user uuid, p_scope text, p_auto boolean, p_title text)
returns public.contractor_signing_authorizations
language plpgsql security definer set search_path = public as $$
declare r public.contractor_signing_authorizations;
begin
  if not public.contractor_can_manage_signing(p_actor, p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Nobody grants signing authority to themselves (the owner already holds it).
  if p_actor = p_user then raise exception 'self_grant' using errcode = '42501'; end if;
  if p_scope not in ('own_bids', 'company_bids') then raise exception 'invalid_scope' using errcode = '22023'; end if;
  if not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = p_user and m.status = 'active' and m.role <> 'viewer') then
    raise exception 'not_a_member' using errcode = '22023';
  end if;
  if exists (select 1 from public.companies c where c.id = p_company and c.owner_user_id = p_user) then raise exception 'owner_already_authorized' using errcode = '22023'; end if;
  update public.contractor_signing_authorizations set status = 'revoked', revoked_by = p_actor, revoked_at = now()
    where company_id = p_company and user_id = p_user and status = 'active';
  insert into public.contractor_signing_authorizations (company_id, user_id, scope, auto_apply_allowed, title, granted_by)
    values (p_company, p_user, p_scope, coalesce(p_auto, false), nullif(btrim(coalesce(p_title, '')), ''), p_actor)
    returning * into r;
  perform public.contractor_log(p_company, null, null, p_actor, 'authorization_granted', jsonb_build_object('authorizationId', r.id, 'userId', p_user, 'scope', p_scope, 'autoApplyAllowed', r.auto_apply_allowed, 'title', r.title));
  return r;
end $$;

create or replace function public.contractor_revoke_authorization(p_actor uuid, p_company uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.contractor_can_manage_signing(p_actor, p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.contractor_signing_authorizations set status = 'revoked', revoked_by = p_actor, revoked_at = now()
    where company_id = p_company and user_id = p_user and status = 'active' returning id into v_id;
  if v_id is not null then
    perform public.contractor_log(p_company, null, null, p_actor, 'authorization_revoked', jsonb_build_object('authorizationId', v_id, 'userId', p_user));
  end if;
end $$;

-- Roster for Company Profile -> Proposal Signing: members, their authority and whether a signature is
-- on file. Never returns signature images.
create or replace function public.contractor_company_signers(p_actor uuid, p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.contractor_can_manage_signing(p_actor, p_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', m.user_id, 'name', coalesce(nullif(m.display_name, ''), m.email, 'Member'), 'email', m.email, 'role', m.role,
      'isOwner', c.owner_user_id = m.user_id,
      'authorization', (select jsonb_build_object('id', a.id, 'scope', a.scope, 'autoApplyAllowed', a.auto_apply_allowed, 'title', a.title, 'grantedAt', a.granted_at)
                          from public.contractor_signing_authorizations a where a.company_id = p_company and a.user_id = m.user_id and a.status = 'active'),
      'credential', (select jsonb_build_object('version', k.version, 'method', k.method, 'legalName', k.legal_name, 'title', k.title,
                          'autoApplyAuthorized', k.auto_apply_authorized and k.auto_apply_revoked_at is null, 'adoptedAt', k.created_at)
                       from public.contractor_signer_credentials k where k.user_id = m.user_id and k.status = 'active')
    ) order by (c.owner_user_id = m.user_id) desc, m.role, m.display_name)
    from public.company_members m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.status = 'active'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 12. Requirements, application, execution
-- ---------------------------------------------------------------------------
-- Freeze what the policy requires for a new customer signing link (called right after create_signing_request).
create or replace function public.contractor_record_requirement(p_request_id uuid, p_actor uuid) returns public.contractor_signing_requirements
language plpgsql security definer set search_path = public as $$
declare r public.signing_requests; e public.estimates; p jsonb; out public.contractor_signing_requirements;
begin
  select * into r from public.signing_requests where id = p_request_id;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  select * into out from public.contractor_signing_requirements where request_id = p_request_id;
  if found then return out; end if;
  select * into e from public.estimates where id = r.estimate_id;
  p := public.contractor_policy_for(e.company_id, e.user_id);
  insert into public.contractor_signing_requirements (request_id, estimate_id, version_id, required, mode, sequence, policy_id, policy_revision, policy_snapshot)
  values (r.id, r.estimate_id, r.version_id, (p ->> 'required')::boolean, p ->> 'mode',
    case when exists (select 1 from public.contractor_signatures c where c.version_id = r.version_id) then 'contractor_first' else 'customer_first' end,
    nullif(p ->> 'id', '')::uuid, nullif(p ->> 'revision', '')::integer, p)
  returning * into out;
  perform public.contractor_log(e.company_id, e.user_id, e.id, p_actor, 'requirement_recorded', jsonb_build_object('requestId', r.id, 'required', out.required, 'mode', out.mode, 'sequence', out.sequence, 'policyRevision', out.policy_revision));
  return out;
end $$;

-- Apply a contractor-side signature to one frozen version.
--   p_application 'interactive': p_signer is the signed-in person doing it now (p_actor must equal p_signer).
--   p_application 'auto_policy': only when contractor_resolve_signer says this signer may be applied automatically.
-- Never changes the customer signature, the version, the pipeline or any money record.
create or replace function public.contractor_apply_signature(
  p_estimate_id uuid, p_version_id uuid, p_signer uuid, p_actor uuid, p_application text, p_trigger text,
  p_statement text, p_ip text, p_user_agent text, p_session_authenticated_at timestamptz
) returns public.contractor_signatures
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates; v public.estimate_versions; k public.contractor_signer_credentials; a record; res jsonb; p jsonb;
  cs public.signatures; req public.contractor_signing_requirements; out public.contractor_signatures;
  v_corrective boolean := false; v_trigger text := p_trigger; v_company_name text;
begin
  if p_application not in ('interactive', 'auto_policy') then raise exception 'invalid_application' using errcode = '22023'; end if;
  select * into e from public.estimates where id = p_estimate_id for update;
  if not found then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  select * into v from public.estimate_versions where id = p_version_id and estimate_id = p_estimate_id;
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;


  -- The customer's signature on this exact version, if they signed first.
  select * into cs from public.signatures where version_id = p_version_id order by signed_at desc limit 1;
  if cs.id is not null then
    select * into req from public.contractor_signing_requirements where request_id = cs.request_id;
    -- Signed before contractor signatures existed: a separately recorded corrective countersignature.
    v_corrective := req.request_id is null;
  end if;

  select * into a from public.contractor_signer_authority(p_signer, p_estimate_id);
  if not coalesce(a.ok, false) then raise exception 'signer_not_authorized' using errcode = '42501', detail = coalesce(a.reason, ''); end if;
  -- Checked after authority, so an outsider learns nothing about another company's documents.
  select * into out from public.contractor_signatures where version_id = p_version_id;
  if found then
    if out.signer_id = p_signer then return out; end if;
    raise exception 'already_countersigned' using errcode = 'P0001';
  end if;
  if e.status = 'archived' then raise exception 'estimate_archived' using errcode = 'P0001'; end if;
  select * into k from public.contractor_signer_credentials where user_id = p_signer and status = 'active';
  if not found then raise exception 'no_signature_on_file' using errcode = 'P0001'; end if;

  if p_application = 'interactive' then
    -- Nobody applies another person's signature.
    if p_actor is distinct from p_signer then raise exception 'signer_mismatch' using errcode = '42501'; end if;
    if coalesce(btrim(p_statement), '') = '' then raise exception 'statement_required' using errcode = '22023'; end if;
    if v_corrective then v_trigger := 'corrective_countersign';
    elsif v_trigger not in ('countersign_action', 'sign_before_send') then v_trigger := 'countersign_action'; end if;
  else
    if v_corrective then raise exception 'auto_not_permitted' using errcode = '42501', detail = 'historical'; end if;
    res := public.contractor_resolve_signer(p_estimate_id);
    if not coalesce((res ->> 'autoEligible')::boolean, false) or (res ->> 'signerId')::uuid is distinct from p_signer then
      raise exception 'auto_not_permitted' using errcode = '42501';
    end if;
    if v_trigger not in ('signing_link_created', 'customer_signed') then raise exception 'invalid_trigger' using errcode = '22023'; end if;
  end if;

  p := public.contractor_policy_for(e.company_id, e.user_id);
  v_company_name := left(coalesce(v.proposal -> 'brand' ->> 'companyName', ''), 200);
  insert into public.contractor_signatures (estimate_id, version_id, user_id, company_id, customer_signature_id, signer_id, signer_name, signer_title, company_name,
    authority, authorization_id, credential_id, credential_version, signature_method, signature_text, signature_image, image_sha256,
    application, trigger, triggered_by, sequence, corrective, policy_id, policy_revision, policy_snapshot, statement_text, authorization_given_at,
    content_hash, ip_address, user_agent, session_authenticated_at)
  values (e.id, v.id, e.user_id, e.company_id, cs.id, p_signer, k.legal_name, coalesce(nullif(a.title, ''), k.title), v_company_name,
    a.authority, a.authorization_id, k.id, k.version, k.method, k.signature_text, k.signature_image, k.image_sha256,
    p_application, v_trigger, p_actor, case when cs.id is null then 'contractor_first' else 'customer_first' end, v_corrective,
    nullif(p ->> 'id', '')::uuid, nullif(p ->> 'revision', '')::integer, p,
    case when p_application = 'interactive' then left(btrim(p_statement), 2000) else left(k.auto_apply_text, 2000) end,
    case when p_application = 'auto_policy' then k.created_at end,
    v.content_hash,
    case when p_application = 'interactive' then left(p_ip, 64) end,
    case when p_application = 'interactive' then left(p_user_agent, 500) end,
    case when p_application = 'interactive' then p_session_authenticated_at end)
  returning * into out;

  perform public.contractor_log(e.company_id, e.user_id, e.id, p_actor,
    case when p_application = 'interactive' then 'contractor_signed_interactive' else 'contractor_signed_auto' end,
    jsonb_build_object('contractorSignatureId', out.id, 'versionId', v.id, 'signerId', p_signer, 'credentialVersion', k.version, 'authority', a.authority,
      'trigger', v_trigger, 'sequence', out.sequence, 'corrective', v_corrective, 'policyRevision', out.policy_revision));
  if cs.id is not null then
    perform public.contractor_open_executed(cs.id);
  end if;
  return out;
end $$;

-- Create the executed-document record once both signatures exist on the same version (idempotent).
create or replace function public.contractor_open_executed(p_signature_id uuid) returns public.contractor_executed_documents
language plpgsql security definer set search_path = public as $$
declare s public.signatures; c public.contractor_signatures; out public.contractor_executed_documents;
begin
  select * into out from public.contractor_executed_documents where signature_id = p_signature_id;
  if found then return out; end if;
  select * into s from public.signatures where id = p_signature_id;
  if not found then raise exception 'signature_not_found' using errcode = 'P0002'; end if;
  select * into c from public.contractor_signatures where version_id = s.version_id;
  if not found then return null; end if;
  insert into public.contractor_executed_documents (signature_id, contractor_signature_id, estimate_id, version_id, user_id, company_id, executed_at)
    values (s.id, c.id, s.estimate_id, s.version_id, s.user_id, s.company_id, greatest(s.signed_at, c.applied_at))
    on conflict (signature_id) do nothing
    returning * into out;
  if out.signature_id is null then select * into out from public.contractor_executed_documents where signature_id = p_signature_id;
  else
    perform public.contractor_log(s.company_id, s.user_id, s.estimate_id, null, 'fully_executed',
      jsonb_build_object('signatureId', s.id, 'contractorSignatureId', c.id, 'executedAt', out.executed_at, 'sequence', c.sequence));
  end if;
  return out;
end $$;

-- After the customer signs (called by the accept route). Contractor-first: opens the executed record.
-- Customer-first with automatic application after acceptance: applies it. Otherwise records that a
-- countersignature is needed (the app shows it to the authorized signers). Returns the resulting state.
create or replace function public.contractor_after_customer_signed(p_signature_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.signatures; req public.contractor_signing_requirements; res jsonb; c public.contractor_signatures;
begin
  select * into s from public.signatures where id = p_signature_id;
  if not found then raise exception 'signature_not_found' using errcode = 'P0002'; end if;
  select * into req from public.contractor_signing_requirements where request_id = s.request_id;
  if not found then return jsonb_build_object('state', 'historical'); end if;
  select * into c from public.contractor_signatures where version_id = s.version_id;
  if found then perform public.contractor_open_executed(s.id); return jsonb_build_object('state', 'fully_executed', 'contractorSignatureId', c.id); end if;
  if not req.required then return jsonb_build_object('state', 'not_required'); end if;
  res := public.contractor_resolve_signer(s.estimate_id);
  if coalesce((res ->> 'autoEligible')::boolean, false) and res ->> 'autoTiming' = 'after_customer' then
    c := public.contractor_apply_signature(s.estimate_id, s.version_id, (res ->> 'signerId')::uuid, null, 'auto_policy', 'customer_signed', null, null, null, null);
    return jsonb_build_object('state', 'fully_executed', 'contractorSignatureId', c.id);
  end if;
  perform public.contractor_log(s.company_id, s.user_id, s.estimate_id, null, 'countersign_requested',
    jsonb_build_object('signatureId', s.id, 'signerId', res ->> 'signerId', 'missing', res ->> 'missing', 'mode', req.mode));
  return jsonb_build_object('state', 'awaiting_contractor', 'signerId', res ->> 'signerId', 'missing', res ->> 'missing');
end $$;

create or replace function public.contractor_record_executed_pdf(p_signature_id uuid, p_ok boolean, p_path text, p_hash text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.contractor_executed_documents set
    pdf_status = case when p_ok then 'ready' else 'failed' end,
    pdf_path = case when p_ok then p_path else pdf_path end,
    pdf_hash = case when p_ok then p_hash else pdf_hash end,
    pdf_error = case when p_ok then null else left(p_error, 500) end,
    pdf_attempts = pdf_attempts + 1,
    pdf_updated_at = now()
  where signature_id = p_signature_id and pdf_status <> 'ready';
end $$;

-- Bids waiting for a contractor signature that this person may countersign (dashboard notification).
create or replace function public.contractor_awaiting_for(p_actor uuid) returns table (signature_id uuid, estimate_id uuid, version_id uuid, signed_at timestamptz, customer_name text, project_title text, total numeric, version_number integer)
language sql stable security definer set search_path = public as $$
  select s.id, s.estimate_id, s.version_id, s.signed_at, s.customer_name, s.project_title, s.total, s.version_number
  from public.signatures s
  join public.contractor_signing_requirements q on q.request_id = s.request_id and q.required
  join public.estimates e on e.id = s.estimate_id and e.status <> 'archived'
  where not exists (select 1 from public.contractor_signatures c where c.version_id = s.version_id)
    and (s.user_id = p_actor or (s.company_id is not null and exists (select 1 from public.company_members m where m.company_id = s.company_id and m.user_id = p_actor and m.status = 'active')))
    and (select x.ok from public.contractor_signer_authority(p_actor, s.estimate_id) x)
  order by s.signed_at desc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- 13. RLS: reads only; all writes through the functions above (service role)
-- ---------------------------------------------------------------------------
alter table public.contractor_signing_policies enable row level security;
alter table public.contractor_signing_policy_history enable row level security;
alter table public.contractor_signer_credentials enable row level security;
alter table public.contractor_signing_authorizations enable row level security;
alter table public.contractor_signing_requirements enable row level security;
alter table public.contractor_signatures enable row level security;
alter table public.contractor_executed_documents enable row level security;
alter table public.contractor_signing_events enable row level security;

revoke all on public.contractor_signing_policies, public.contractor_signing_policy_history, public.contractor_signer_credentials,
  public.contractor_signing_authorizations, public.contractor_signing_requirements, public.contractor_signatures,
  public.contractor_executed_documents, public.contractor_signing_events from anon, authenticated;
grant select on public.contractor_signing_policies, public.contractor_signing_policy_history, public.contractor_signer_credentials,
  public.contractor_signing_authorizations, public.contractor_signing_requirements, public.contractor_signatures,
  public.contractor_executed_documents, public.contractor_signing_events to authenticated;
grant all on public.contractor_signing_policies, public.contractor_signing_policy_history, public.contractor_signer_credentials,
  public.contractor_signing_authorizations, public.contractor_signing_requirements, public.contractor_signatures,
  public.contractor_executed_documents, public.contractor_signing_events to service_role;

drop policy if exists contractor_signing_policies_select on public.contractor_signing_policies;
create policy contractor_signing_policies_select on public.contractor_signing_policies for select to authenticated
  using (owner_user_id = (select auth.uid()) or (company_id is not null and public.is_active_company_member(company_id)));
drop policy if exists contractor_signing_policy_history_select on public.contractor_signing_policy_history;
create policy contractor_signing_policy_history_select on public.contractor_signing_policy_history for select to authenticated
  using (exists (select 1 from public.contractor_signing_policies p where p.id = policy_id));
-- A signature image is personal: only its owner reads their own credential rows.
drop policy if exists contractor_signer_credentials_own on public.contractor_signer_credentials;
create policy contractor_signer_credentials_own on public.contractor_signer_credentials for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists contractor_signing_authorizations_select on public.contractor_signing_authorizations;
create policy contractor_signing_authorizations_select on public.contractor_signing_authorizations for select to authenticated
  using (user_id = (select auth.uid()) or public.is_active_company_member(company_id));
-- Document records follow the estimate (owner, plus Enterprise members whose permissions let them view it).
drop policy if exists contractor_signing_requirements_select on public.contractor_signing_requirements;
create policy contractor_signing_requirements_select on public.contractor_signing_requirements for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_id));
drop policy if exists contractor_signatures_select on public.contractor_signatures;
create policy contractor_signatures_select on public.contractor_signatures for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_id));
drop policy if exists contractor_executed_documents_select on public.contractor_executed_documents;
create policy contractor_executed_documents_select on public.contractor_executed_documents for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_id));
drop policy if exists contractor_signing_events_select on public.contractor_signing_events;
create policy contractor_signing_events_select on public.contractor_signing_events for select to authenticated
  using ((estimate_id is not null and exists (select 1 from public.estimates e where e.id = estimate_id))
    or (estimate_id is null and (tenant_user_id = (select auth.uid()) or actor_id = (select auth.uid()) or (company_id is not null and public.contractor_i_manage_signing(company_id)))));

-- ---------------------------------------------------------------------------
-- 14. Function privileges: service role only (server routes authenticate the caller first)
-- ---------------------------------------------------------------------------
revoke all on function public.contractor_only_fk_nulling(jsonb, jsonb), public.contractor_guard_write_once(), public.contractor_guard_credential(), public.contractor_guard_authorization(),
  public.contractor_guard_executed_document(), public.contractor_guard_signed_version_delete() from public, anon, authenticated;
revoke all on function public.contractor_signer_authority(uuid, uuid), public.contractor_policy_for(uuid, uuid), public.contractor_resolve_signer(uuid),
  public.contractor_log(uuid, uuid, uuid, uuid, text, jsonb), public.contractor_save_policy(uuid, uuid, jsonb),
  public.contractor_adopt_credential(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, text),
  public.contractor_revoke_credential(uuid, text), public.contractor_grant_authorization(uuid, uuid, uuid, text, boolean, text),
  public.contractor_revoke_authorization(uuid, uuid, uuid), public.contractor_company_signers(uuid, uuid),
  public.contractor_record_requirement(uuid, uuid), public.contractor_apply_signature(uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz),
  public.contractor_open_executed(uuid), public.contractor_after_customer_signed(uuid), public.contractor_record_executed_pdf(uuid, boolean, text, text, text),
  public.contractor_awaiting_for(uuid) from public, anon, authenticated;
grant execute on function public.contractor_signer_authority(uuid, uuid), public.contractor_policy_for(uuid, uuid), public.contractor_resolve_signer(uuid),
  public.contractor_log(uuid, uuid, uuid, uuid, text, jsonb), public.contractor_save_policy(uuid, uuid, jsonb),
  public.contractor_adopt_credential(uuid, text, text, text, text, text, text, text, text, text, jsonb, text, text),
  public.contractor_revoke_credential(uuid, text), public.contractor_grant_authorization(uuid, uuid, uuid, text, boolean, text),
  public.contractor_revoke_authorization(uuid, uuid, uuid), public.contractor_company_signers(uuid, uuid),
  public.contractor_record_requirement(uuid, uuid), public.contractor_apply_signature(uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz),
  public.contractor_open_executed(uuid), public.contractor_after_customer_signed(uuid), public.contractor_record_executed_pdf(uuid, boolean, text, text, text),
  public.contractor_awaiting_for(uuid) to service_role;
revoke all on function public.contractor_can_manage_signing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.contractor_can_manage_signing(uuid, uuid) to service_role;
-- RLS policies call this one as the signed-in user (it only ever answers for auth.uid()).
revoke all on function public.contractor_i_manage_signing(uuid) from public, anon;
grant execute on function public.contractor_i_manage_signing(uuid) to authenticated, service_role;
