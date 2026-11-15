-- E-signatures: homeowners accept a frozen proposal version through a secret signing link.
--
-- * Additive only: two new tables, functions, and one delete guard on estimates. No existing column,
--   function, policy or row is changed. Estimate lifecycle (draft/finalized/archived) and the Enterprise
--   pipeline_stage are left alone: signing status lives in its own tables.
-- * A signing request points at ONE immutable estimate_versions row (created by finalize_bid under the
--   existing one-credit-per-bid rule) plus the SHA-256 of the exact PDF the customer reviews.
-- * The link token is never stored: only its SHA-256. Requests expire and can be revoked.
-- * signatures is the acceptance record. Evidence columns can never be updated or deleted (trigger);
--   only the signed-PDF processing columns change after acceptance. unique(request_id) makes acceptance
--   idempotent and blocks a second signature on the same link.
-- * Reads: anyone who can read the estimate under the existing estimates RLS (owner, plus Enterprise
--   members with bid visibility). No insert/update/delete for end users: all writes go through the
--   service-role functions below, called from server routes.
-- * Sending stays OFF until NEXT_PUBLIC_ESIGNATURES=on (see docs/esign/README.md).

-- ---------------------------------------------------------------------------
-- 1. Signing requests
-- ---------------------------------------------------------------------------
create table if not exists public.signing_requests (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the customer-facing PDF of this version, and the version's content hash.
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'signed', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (revoke_reason in ('contractor', 'superseded')),
  signed_at timestamptz,
  constraint signing_requests_expiry_valid check (expires_at > created_at)
);
create index if not exists signing_requests_estimate_idx on public.signing_requests (estimate_id, created_at desc);
create index if not exists signing_requests_user_idx on public.signing_requests (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Signatures (acceptance records)
-- ---------------------------------------------------------------------------
create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.signing_requests (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  signer_name text not null check (char_length(signer_name) between 2 and 200),
  signer_email text not null check (char_length(signer_email) between 3 and 320),
  method text not null check (method in ('typed', 'drawn')),
  -- Typed: the name exactly as applied. Drawn: a PNG data URL (bounded).
  signature_text text check (char_length(signature_text) <= 200),
  signature_image text check (char_length(signature_image) <= 400000),
  consent_version text not null check (char_length(consent_version) <= 40),
  consent_text text not null check (char_length(consent_text) <= 4000),
  acceptance_text text not null check (char_length(acceptance_text) <= 2000),
  consented_at timestamptz not null,
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- The exact amount and identifiers of the version that was accepted (copied for fast listing).
  total numeric(14, 2) not null,
  version_number integer not null,
  proposal_number text not null default '' check (char_length(proposal_number) <= 50),
  project_title text not null default '' check (char_length(project_title) <= 300),
  customer_name text not null default '' check (char_length(customer_name) <= 200),
  -- Only possession of the link is checked today. Never described as identity verification.
  verification text not null default 'link_possession' check (verification in ('link_possession', 'email_code')),
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 500),
  signed_at timestamptz not null default now(),
  -- Signed document processing (the only mutable columns).
  pdf_status text not null default 'pending' check (pdf_status in ('pending', 'ready', 'failed')),
  pdf_path text,
  pdf_hash text check (pdf_hash ~ '^[0-9a-f]{64}$'),
  pdf_error text check (char_length(pdf_error) <= 500),
  pdf_attempts integer not null default 0,
  pdf_updated_at timestamptz,
  constraint signatures_payload check (
    (method = 'typed' and signature_text is not null) or (method = 'drawn' and signature_image is not null)
  )
);
create index if not exists signatures_user_signed_idx on public.signatures (user_id, signed_at desc);
create index if not exists signatures_company_signed_idx on public.signatures (company_id, signed_at desc) where company_id is not null;
create index if not exists signatures_estimate_idx on public.signatures (estimate_id, signed_at desc);

-- Evidence is write-once. Only pdf_* processing columns may change; rows are never deleted directly
-- (they go only when the whole account is deleted, which cascades from auth.users).
create or replace function public.guard_signature_record() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() < 2 then raise exception 'signature_immutable' using errcode = 'P0001'; end if;
    return old;
  end if;
  if (to_jsonb(new) - array['pdf_status', 'pdf_path', 'pdf_hash', 'pdf_error', 'pdf_attempts', 'pdf_updated_at', 'company_id'])
     is distinct from (to_jsonb(old) - array['pdf_status', 'pdf_path', 'pdf_hash', 'pdf_error', 'pdf_attempts', 'pdf_updated_at', 'company_id']) then
    raise exception 'signature_immutable' using errcode = 'P0001';
  end if;
  -- A finished signed document is never replaced.
  if old.pdf_status = 'ready' and (new.pdf_path is distinct from old.pdf_path or new.pdf_hash is distinct from old.pdf_hash) then
    raise exception 'signature_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists signatures_guard on public.signatures;
create trigger signatures_guard before update or delete on public.signatures
  for each row execute function public.guard_signature_record();

-- A signed bid can be archived but not deleted on its own (the account-deletion cascade still works).
create or replace function public.guard_signed_estimate_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() < 2 and exists (select 1 from public.signatures s where s.estimate_id = old.id) then
    raise exception 'estimate_signed' using errcode = 'P0001', hint = 'archive_instead';
  end if;
  return old;
end $$;
drop trigger if exists estimates_guard_signed_delete on public.estimates;
create trigger estimates_guard_signed_delete before delete on public.estimates
  for each row execute function public.guard_signed_estimate_delete();

-- Versions that were signed are never deleted directly either.
create or replace function public.guard_signed_version_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() < 2 and exists (select 1 from public.signatures s where s.version_id = old.id) then
    raise exception 'version_signed' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists estimate_versions_guard_signed_delete on public.estimate_versions;
create trigger estimate_versions_guard_signed_delete before delete on public.estimate_versions
  for each row execute function public.guard_signed_version_delete();

-- ---------------------------------------------------------------------------
-- 3. RLS: read follows the estimate; writes are server-only
-- ---------------------------------------------------------------------------
alter table public.signing_requests enable row level security;
alter table public.signatures enable row level security;
revoke all on public.signing_requests, public.signatures from anon, authenticated;
grant select on public.signing_requests, public.signatures to authenticated;
grant all on public.signing_requests, public.signatures to service_role;

-- The estimates subquery is itself RLS-filtered (own bids, plus company bids the member may view).
drop policy if exists signing_requests_visible_select on public.signing_requests;
create policy signing_requests_visible_select on public.signing_requests for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = signing_requests.estimate_id));
drop policy if exists signatures_visible_select on public.signatures;
create policy signatures_visible_select on public.signatures for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = signatures.estimate_id));

-- token_hash is a secret-derived value: hide it from signed-in readers too.
revoke select on public.signing_requests from authenticated;
grant select (id, estimate_id, version_id, user_id, company_id, status, expires_at, created_at, revoked_at,
  revoke_reason, signed_at, document_hash, content_hash) on public.signing_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Server functions (service role only)
-- ---------------------------------------------------------------------------
-- Create a request for a version the caller owns. Earlier pending requests for the same bid are
-- revoked as superseded, so only the newest link can be signed.
create or replace function public.create_signing_request(
  p_user_id uuid, p_estimate_id uuid, p_version_id uuid, p_token_hash text, p_document_hash text, p_expires_at timestamptz
) returns public.signing_requests
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates;
  v public.estimate_versions;
  r public.signing_requests;
begin
  select * into e from public.estimates where id = p_estimate_id and user_id = p_user_id for update;
  if not found then raise exception 'estimate_not_found' using errcode = 'P0002'; end if;
  if e.status = 'archived' then raise exception 'estimate_archived' using errcode = 'P0001'; end if;
  select * into v from public.estimate_versions where id = p_version_id and estimate_id = p_estimate_id;
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.signatures s where s.version_id = p_version_id) then
    raise exception 'version_already_signed' using errcode = 'P0001';
  end if;
  if p_expires_at <= now() + interval '1 hour' or p_expires_at > now() + interval '91 days' then
    raise exception 'invalid_expiry' using errcode = 'P0001';
  end if;

  update public.signing_requests set status = 'revoked', revoked_at = now(), revoked_by = p_user_id, revoke_reason = 'superseded'
    where estimate_id = p_estimate_id and status = 'pending';

  insert into public.signing_requests (estimate_id, version_id, user_id, company_id, token_hash, document_hash, content_hash, expires_at)
    values (p_estimate_id, p_version_id, p_user_id, e.company_id, p_token_hash, p_document_hash, v.content_hash, p_expires_at)
    returning * into r;
  return r;
end $$;

create or replace function public.revoke_signing_request(p_user_id uuid, p_request_id uuid) returns public.signing_requests
language plpgsql security definer set search_path = public as $$
declare r public.signing_requests;
begin
  update public.signing_requests set status = 'revoked', revoked_at = now(), revoked_by = p_user_id, revoke_reason = 'contractor'
    where id = p_request_id and user_id = p_user_id and status = 'pending'
    returning * into r;
  if not found then
    select * into r from public.signing_requests where id = p_request_id and user_id = p_user_id;
    if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  end if;
  return r;
end $$;

-- Accept a request. Locks the request row, so concurrent submissions serialize; the loser gets
-- 'already_signed' (same signer replaying gets the existing record back: idempotent).
create or replace function public.accept_signing_request(
  p_token_hash text, p_signer_name text, p_signer_email text, p_method text, p_signature_text text,
  p_signature_image text, p_consent_version text, p_consent_text text, p_acceptance_text text,
  p_consented_at timestamptz, p_ip text, p_user_agent text
) returns table (signature_id uuid, created boolean, request_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r public.signing_requests;
  v public.estimate_versions;
  s public.signatures;
begin
  select * into r from public.signing_requests where token_hash = p_token_hash for update;
  if not found then raise exception 'link_invalid' using errcode = 'P0002'; end if;
  if r.status = 'signed' then
    select * into s from public.signatures where request_id = r.id;
    if lower(s.signer_email) = lower(trim(p_signer_email)) and s.signer_name = trim(p_signer_name) then
      return query select s.id, false, r.id; return;
    end if;
    raise exception 'already_signed' using errcode = 'P0001';
  end if;
  if r.status = 'revoked' then raise exception 'link_revoked' using errcode = 'P0001'; end if;
  if r.expires_at <= now() then raise exception 'link_expired' using errcode = 'P0001'; end if;
  if exists (select 1 from public.estimates e where e.id = r.estimate_id and e.status = 'archived') then
    raise exception 'link_revoked' using errcode = 'P0001';
  end if;
  select * into v from public.estimate_versions where id = r.version_id;

  insert into public.signatures (request_id, estimate_id, version_id, user_id, company_id, signer_name, signer_email, method,
    signature_text, signature_image, consent_version, consent_text, acceptance_text, consented_at, document_hash, content_hash,
    total, version_number, proposal_number, project_title, customer_name, ip_address, user_agent)
  values (r.id, r.estimate_id, r.version_id, r.user_id, r.company_id, trim(p_signer_name), lower(trim(p_signer_email)), p_method,
    case when p_method = 'typed' then trim(p_signature_text) end, case when p_method = 'drawn' then p_signature_image end,
    p_consent_version, p_consent_text, p_acceptance_text, least(p_consented_at, now()), r.document_hash, r.content_hash,
    v.total, v.version_number, coalesce(v.proposal->'meta'->>'number', ''), left(coalesce(v.proposal->'meta'->>'title', ''), 300),
    left(coalesce(v.proposal->'customer'->>'name', ''), 200), left(p_ip, 64), left(p_user_agent, 500))
  returning * into s;

  update public.signing_requests set status = 'signed', signed_at = s.signed_at where id = r.id;
  return query select s.id, true, r.id;
end $$;

-- Signed-PDF processing state (the only post-acceptance write).
create or replace function public.record_signed_pdf(p_signature_id uuid, p_ok boolean, p_path text, p_hash text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.signatures set
    pdf_status = case when p_ok then 'ready' else 'failed' end,
    pdf_path = case when p_ok then p_path else pdf_path end,
    pdf_hash = case when p_ok then p_hash else pdf_hash end,
    pdf_error = case when p_ok then null else left(p_error, 500) end,
    pdf_attempts = pdf_attempts + 1,
    pdf_updated_at = now()
  where id = p_signature_id and pdf_status <> 'ready';
end $$;

revoke all on function public.create_signing_request(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_signing_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_signing_request(text, text, text, text, text, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.record_signed_pdf(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.guard_signature_record(), public.guard_signed_estimate_delete(), public.guard_signed_version_delete() from public, anon, authenticated;
grant execute on function public.create_signing_request(uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.revoke_signing_request(uuid, uuid) to service_role;
grant execute on function public.accept_signing_request(text, text, text, text, text, text, text, text, text, timestamptz, text, text) to service_role;
grant execute on function public.record_signed_pdf(uuid, boolean, text, text, text) to service_role;
