-- Project Operations V4.3 (part 2 of 4): document history, change orders, trade scopes, scope sharing
-- and subcontractor quotes.
--
--   * estimate_versions content becomes write-once (only the owner id may move, on account deletion),
--     so a sent / signed proposal can never be rewritten. project_proposal_history() lists every
--     version with when it was sent and signed and which one was approved.
--   * change_orders are separate, project-linked documents with their own number, scope lines, price
--     adjustment, status and versions. Sending freezes a version (write-once). Approval is either a
--     customer e-signature on that frozen version, or a manual approval the contractor records with a
--     note (never inferred). Only approved / signed change orders count in the approved contract value.
--   * project_scope_sections: the internal work scope per estimate section / trade (instructions,
--     installation notes, internal notes, assigned staff or subcontractor) with a revision per save.
--     Editing it never touches the estimate or the signed proposal.
--   * scope_shares: a frozen, explicitly chosen set of fields (and photos) for one subcontractor, read
--     through a secret link. Updating the share adds a version; the link shows the latest one.
--   * subcontractor_quotes start on an ESTIMATE LINE ITEM (and appear in the project scope through the
--     item's section). Each amount is a write-once revision recorded as an unapproved value. Only
--     "Update internal project cost" writes a cost adjustment (write-once); nothing changes a
--     customer price or contract. The original estimated cost is frozen on the quote.
--
-- Safe to run more than once. Requires 20261119001000_project_operations.sql.
-- Rollback: docs/project-operations/rollback_20261119002000.sql

-- 1. Proposal versions are write-once ---------------------------------------------------------------
create or replace function public.guard_estimate_version_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'user_id') is distinct from (to_jsonb(old) - 'user_id') then
    raise exception 'version_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists estimate_versions_immutable on public.estimate_versions;
create trigger estimate_versions_immutable before update on public.estimate_versions for each row execute function public.guard_estimate_version_update();

-- 2. Change orders --------------------------------------------------------------------------------
create table if not exists public.change_orders (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,       -- bid owner
  company_id uuid references public.companies (id) on delete cascade,
  number integer not null check (number >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 4000),
  -- [{kind: add|remove|modify, description, amount}] customer-facing scope and price lines.
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 100),
  amount numeric(14, 2) not null default 0,                                  -- signed price adjustment
  schedule_days integer check (schedule_days between -365 and 365),
  customer_notes text check (char_length(customer_notes) <= 4000),
  internal_notes text check (char_length(internal_notes) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'signed', 'declined', 'void')),
  version integer not null default 0 check (version >= 0),                   -- last sent version (0 = never sent)
  approval_method text check (approval_method in ('manual', 'signature')),
  approval_note text check (char_length(approval_note) <= 1000),
  approved_version integer,
  source_quote_revision_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estimate_id, number),
  constraint change_orders_approved check (status not in ('approved', 'signed') or (approval_method is not null and approved_version is not null and decided_at is not null)),
  constraint change_orders_manual_note check (approval_method is distinct from 'manual' or approval_note is not null)
);
create index if not exists change_orders_estimate_idx on public.change_orders (estimate_id, number);
drop trigger if exists change_orders_updated on public.change_orders;
create trigger change_orders_updated before update on public.change_orders for each row execute function public.set_updated_at();

create table if not exists public.change_order_versions (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references public.change_orders (id) on delete cascade,
  version integer not null check (version >= 1),
  content jsonb not null,                    -- exactly what the customer saw (no internal notes)
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (change_order_id, version)
);
create table if not exists public.change_order_signing (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references public.change_orders (id) on delete cascade,
  version_id uuid not null references public.change_order_versions (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'signed', 'revoked')),
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists change_order_signing_co_idx on public.change_order_signing (change_order_id, created_at desc);
create table if not exists public.change_order_signatures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.change_order_signing (id) on delete cascade,
  change_order_id uuid not null references public.change_orders (id) on delete cascade,
  version_id uuid not null references public.change_order_versions (id) on delete cascade,
  signer_name text not null check (char_length(signer_name) between 2 and 200),
  signer_email text not null check (char_length(signer_email) between 3 and 320),
  signature_text text not null check (char_length(signature_text) between 2 and 200),
  consent_version text not null check (char_length(consent_version) <= 40),
  consent_text text not null check (char_length(consent_text) <= 4000),
  acceptance_text text not null check (char_length(acceptance_text) <= 2000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  amount numeric(14, 2) not null,
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 500),
  signed_at timestamptz not null default now()
);

-- Frozen versions and signatures are write-once (deletes only through the whole-bid cascade).
create or replace function public.guard_write_once() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() >= 2 then return old; end if;
  raise exception 'record_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists change_order_versions_write_once on public.change_order_versions;
create trigger change_order_versions_write_once before update or delete on public.change_order_versions for each row execute function public.guard_write_once();
drop trigger if exists change_order_signatures_write_once on public.change_order_signatures;
create trigger change_order_signatures_write_once before update or delete on public.change_order_signatures for each row execute function public.guard_write_once();

alter table public.change_orders enable row level security;
alter table public.change_order_versions enable row level security;
alter table public.change_order_signing enable row level security;
alter table public.change_order_signatures enable row level security;
drop policy if exists change_orders_select on public.change_orders;
create policy change_orders_select on public.change_orders for select to authenticated using (public.estimate_readable(estimate_id));
drop policy if exists change_order_versions_select on public.change_order_versions;
create policy change_order_versions_select on public.change_order_versions for select to authenticated
  using (exists (select 1 from public.change_orders c where c.id = change_order_id));
drop policy if exists change_order_signatures_select on public.change_order_signatures;
create policy change_order_signatures_select on public.change_order_signatures for select to authenticated
  using (exists (select 1 from public.change_orders c where c.id = change_order_id));
revoke all on public.change_orders, public.change_order_versions, public.change_order_signing, public.change_order_signatures from anon, authenticated;
grant select on public.change_order_versions, public.change_order_signatures to authenticated;
-- Internal notes are company-only: readers get every column except internal_notes (the history RPC
-- returns them to people who can create change orders).
grant select (id, estimate_id, user_id, company_id, number, title, description, lines, amount, schedule_days, customer_notes, status, version,
  approval_method, approval_note, approved_version, source_quote_revision_id, created_by, sent_at, sent_by, decided_at, decided_by, created_at, updated_at)
  on public.change_orders to authenticated;
-- change_order_signing (token hashes) is server-only.

-- Customer-facing content of a change order (what is frozen when it is sent).
create or replace function public.change_order_content(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', c.number, 'title', c.title, 'description', c.description, 'lines', c.lines,
    'amount', c.amount, 'scheduleDays', c.schedule_days, 'customerNotes', c.customer_notes,
    'project', jsonb_build_object('title', e.title, 'number', e.estimate_number, 'customerName', e.customer_name, 'projectAddress', e.project_address))
  from public.change_orders c join public.estimates e on e.id = c.estimate_id where c.id = p_id
$$;
revoke execute on function public.change_order_content(uuid) from public, anon, authenticated;

-- Create or edit a DRAFT. Lines are validated and the amount is their sum.
create or replace function public.change_order_save(p_estimate_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid; c public.change_orders; e public.estimates; v_lines jsonb := '[]'::jsonb; l jsonb; v_amount numeric := 0; v_amt numeric;
begin
  if auth.uid() is null or not public.estimate_permission(p_estimate_id, 'create_change_orders') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public.estimate_is_accepted(p_estimate_id) then raise exception 'not_accepted' using errcode = '22023'; end if;
  select * into e from public.estimates where id = p_estimate_id;
  for l in select x from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) x loop
    if coalesce(l ->> 'kind', '') not in ('add', 'remove', 'modify') or nullif(btrim(coalesce(l ->> 'description', '')), '') is null then
      raise exception 'bad_line' using errcode = '22023';
    end if;
    v_amt := round(coalesce(nullif(l ->> 'amount', '')::numeric, 0), 2);
    if abs(v_amt) > 100000000 then raise exception 'bad_line' using errcode = '22023'; end if;
    v_amount := v_amount + v_amt;
    v_lines := v_lines || jsonb_build_object('kind', l ->> 'kind', 'description', left(btrim(l ->> 'description'), 1000), 'amount', v_amt);
  end loop;
  if jsonb_array_length(v_lines) > 100 then raise exception 'bad_line' using errcode = '22023'; end if;
  if v_id is null then
    perform 1 from public.estimates where id = p_estimate_id for update;
    insert into public.change_orders (estimate_id, user_id, company_id, number, title, description, lines, amount, schedule_days, customer_notes, internal_notes, created_by, source_quote_revision_id)
    values (p_estimate_id, e.user_id, e.company_id, coalesce((select max(number) from public.change_orders where estimate_id = p_estimate_id), 0) + 1,
            left(coalesce(nullif(btrim(p ->> 'title'), ''), 'Change order'), 200), left(nullif(btrim(p ->> 'description'), ''), 4000), v_lines, v_amount,
            nullif(p ->> 'scheduleDays', '')::int, left(nullif(btrim(p ->> 'customerNotes'), ''), 4000), left(nullif(btrim(p ->> 'internalNotes'), ''), 4000),
            auth.uid(), nullif(p ->> 'sourceQuoteRevisionId', '')::uuid)
    returning id into v_id;
  else
    select * into c from public.change_orders where id = v_id and estimate_id = p_estimate_id for update;
    if not found then raise exception 'not_found' using errcode = '42501'; end if;
    if c.status <> 'draft' then raise exception 'not_draft' using errcode = '22023'; end if;
    update public.change_orders set title = left(coalesce(nullif(btrim(p ->> 'title'), ''), title), 200), description = left(nullif(btrim(p ->> 'description'), ''), 4000),
      lines = v_lines, amount = v_amount, schedule_days = nullif(p ->> 'scheduleDays', '')::int,
      customer_notes = left(nullif(btrim(p ->> 'customerNotes'), ''), 4000), internal_notes = left(nullif(btrim(p ->> 'internalNotes'), ''), 4000)
    where id = v_id;
  end if;
  if e.company_id is not null then perform public.company_audit(e.company_id, 'change_order.saved', 'change_order', v_id::text, jsonb_build_object('estimate_id', p_estimate_id)); end if;
  return v_id;
end $$;
revoke execute on function public.change_order_save(uuid, jsonb) from public, anon;
grant execute on function public.change_order_save(uuid, jsonb) to authenticated;

-- Send = freeze the next version (the app delivers it: signing link or the user's own email).
create or replace function public.change_order_send(p_id uuid, p_content_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.change_orders; v_ver integer; v_vid uuid; v_content jsonb;
begin
  select * into c from public.change_orders where id = p_id for update;
  if not found or auth.uid() is null or not public.estimate_permission(c.estimate_id, 'send_change_orders') then raise exception 'forbidden' using errcode = '42501'; end if;
  if c.status = 'sent' then
    select id into v_vid from public.change_order_versions where change_order_id = p_id and version = c.version;
    return jsonb_build_object('versionId', v_vid, 'version', c.version, 'unchanged', true);
  end if;
  if c.status <> 'draft' then raise exception 'not_draft' using errcode = '22023'; end if;
  if jsonb_array_length(c.lines) = 0 then raise exception 'no_lines' using errcode = '22023'; end if;
  v_ver := c.version + 1;
  v_content := public.change_order_content(p_id) || jsonb_build_object('version', v_ver);
  -- The fingerprint is computed here from the exact frozen content (p_content_hash is accepted for
  -- compatibility and ignored), so the hash always matches what the customer sees and signs.
  insert into public.change_order_versions (change_order_id, version, content, content_hash, created_by)
  values (p_id, v_ver, v_content, encode(sha256(convert_to(v_content::text, 'UTF8')), 'hex'), auth.uid()) returning id into v_vid;
  update public.change_orders set status = 'sent', version = v_ver, sent_at = now(), sent_by = auth.uid() where id = p_id;
  if c.company_id is not null then perform public.company_audit(c.company_id, 'change_order.sent', 'change_order', p_id::text, jsonb_build_object('version', v_ver)); end if;
  return jsonb_build_object('versionId', v_vid, 'version', v_ver, 'content', v_content);
end $$;
revoke execute on function public.change_order_send(uuid, text) from public, anon;
grant execute on function public.change_order_send(uuid, text) to authenticated;

-- Contractor actions after sending: record a manual customer approval (note required), mark declined,
-- void, or reopen as a draft for revision (open signing links are revoked).
create or replace function public.change_order_decide(p_id uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.change_orders; v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  select * into c from public.change_orders where id = p_id for update;
  if not found or auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action = 'revise' then
    if not public.estimate_permission(c.estimate_id, 'create_change_orders') then raise exception 'forbidden' using errcode = '42501'; end if;
    if c.status not in ('sent', 'declined') then raise exception 'bad_state' using errcode = '22023'; end if;
    update public.change_order_signing set status = 'revoked', revoked_at = now() where change_order_id = p_id and status = 'pending';
    update public.change_orders set status = 'draft', decided_at = null, decided_by = null where id = p_id;
  elsif p_action = 'approve' then
    if not public.estimate_permission(c.estimate_id, 'send_change_orders') then raise exception 'forbidden' using errcode = '42501'; end if;
    if c.status <> 'sent' then raise exception 'bad_state' using errcode = '22023'; end if;
    if v_note is null then raise exception 'note_required' using errcode = '22023'; end if;
    update public.change_order_signing set status = 'revoked', revoked_at = now() where change_order_id = p_id and status = 'pending';
    update public.change_orders set status = 'approved', approval_method = 'manual', approval_note = v_note, approved_version = c.version,
      decided_at = now(), decided_by = auth.uid() where id = p_id;
  elsif p_action in ('decline', 'void') then
    if not public.estimate_permission(c.estimate_id, 'send_change_orders') then raise exception 'forbidden' using errcode = '42501'; end if;
    if c.status in ('approved', 'signed') or (p_action = 'decline' and c.status <> 'sent') then raise exception 'bad_state' using errcode = '22023'; end if;
    update public.change_order_signing set status = 'revoked', revoked_at = now() where change_order_id = p_id and status = 'pending';
    update public.change_orders set status = case p_action when 'decline' then 'declined' else 'void' end, approval_note = coalesce(v_note, approval_note),
      decided_at = now(), decided_by = auth.uid() where id = p_id;
  else
    raise exception 'bad_action' using errcode = '22023';
  end if;
  if c.company_id is not null then perform public.company_audit(c.company_id, 'change_order.' || p_action, 'change_order', p_id::text, jsonb_build_object('note', v_note)); end if;
  return (select status from public.change_orders where id = p_id);
end $$;
revoke execute on function public.change_order_decide(uuid, text, text) from public, anon;
grant execute on function public.change_order_decide(uuid, text, text) to authenticated;

-- Signing (service role: called from server routes after the caller's permission was checked).
create or replace function public.change_order_create_signing(p_change_order_id uuid, p_actor uuid, p_token_hash text, p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.change_orders; v_vid uuid; v_id uuid;
begin
  select * into c from public.change_orders where id = p_change_order_id for update;
  if not found or c.status <> 'sent' then raise exception 'bad_state' using errcode = '22023'; end if;
  select id into v_vid from public.change_order_versions where change_order_id = c.id and version = c.version;
  update public.change_order_signing set status = 'revoked', revoked_at = now() where change_order_id = c.id and status = 'pending';
  insert into public.change_order_signing (change_order_id, version_id, token_hash, expires_at, created_by)
  values (c.id, v_vid, p_token_hash, p_expires_at, p_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.change_order_accept_signing(p_token_hash text, p_signer_name text, p_signer_email text, p_signature_text text,
  p_consent_version text, p_consent_text text, p_acceptance_text text, p_ip text, p_user_agent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.change_order_signing; c public.change_orders; v public.change_order_versions; v_sig uuid;
begin
  select * into r from public.change_order_signing where token_hash = p_token_hash for update;
  if not found or r.status <> 'pending' or r.expires_at <= now() then raise exception 'link_invalid' using errcode = 'P0001'; end if;
  select * into c from public.change_orders where id = r.change_order_id for update;
  select * into v from public.change_order_versions where id = r.version_id;
  if c.status <> 'sent' or c.version <> v.version then raise exception 'link_invalid' using errcode = 'P0001'; end if;
  insert into public.change_order_signatures (request_id, change_order_id, version_id, signer_name, signer_email, signature_text, consent_version, consent_text,
    acceptance_text, content_hash, amount, ip_address, user_agent)
  values (r.id, c.id, v.id, left(btrim(p_signer_name), 200), left(btrim(p_signer_email), 320), left(btrim(p_signature_text), 200), p_consent_version, p_consent_text,
    p_acceptance_text, v.content_hash, (v.content ->> 'amount')::numeric, left(p_ip, 64), left(p_user_agent, 500))
  returning id into v_sig;
  update public.change_order_signing set status = 'signed' where id = r.id;
  update public.change_orders set status = 'signed', approval_method = 'signature', approved_version = v.version, decided_at = now() where id = c.id;
  if c.company_id is not null then
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (c.company_id, null, 'change_order.signed', 'change_order', c.id::text, jsonb_build_object('version', v.version));
  end if;
  return v_sig;
end $$;
revoke all on function public.change_order_create_signing(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.change_order_accept_signing(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.change_order_create_signing(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.change_order_accept_signing(text, text, text, text, text, text, text, text, text) to service_role;

-- 3. Proposal history and contract value -------------------------------------------------------------
-- One call for the Documents tab: every finalized version (sent / signed / superseded), the approval,
-- and every change order. Totals are customer-facing prices only (never cost or margin).
create or replace function public.project_proposal_history(p_estimate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.estimates; v_approved uuid; v_source text; v_original numeric;
begin
  if auth.uid() is null or not public.estimate_readable(p_estimate_id) then raise exception 'not_found' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate_id;
  -- Approved version: the latest SIGNED version, else (manual Won) the latest version finalized by the won date.
  select s.version_id into v_approved from public.signatures s where s.estimate_id = e.id order by s.signed_at desc limit 1;
  if v_approved is not null then v_source := 'signature';
  elsif e.pipeline_stage in ('won', 'scheduled', 'in_progress', 'completed') then
    select v.id into v_approved from public.estimate_versions v where v.estimate_id = e.id and v.created_at <= coalesce(e.won_at, now()) + interval '1 minute'
     order by v.version_number desc limit 1;
    if v_approved is null then select v.id into v_approved from public.estimate_versions v where v.estimate_id = e.id order by v.version_number desc limit 1; end if;
    v_source := case when v_approved is not null then 'manual' end;
  end if;
  select total into v_original from public.estimate_versions where id = v_approved;
  return jsonb_build_object(
    'estimate', jsonb_build_object('id', e.id, 'title', e.title, 'number', e.estimate_number, 'stage', e.pipeline_stage, 'updatedAt', e.updated_at,
      'ownerId', e.user_id, 'wonAt', e.won_at, 'companyId', e.company_id),
    'approval', case when v_approved is null then null else jsonb_build_object('versionId', v_approved, 'source', v_source, 'total', v_original) end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'number', v.version_number, 'createdAt', v.created_at, 'total', v.total, 'contentHash', v.content_hash, 'authorId', v.user_id,
        'hasPdf', exists (select 1 from public.generated_documents d where d.version_id = v.id),
        'sentAt', (select min(r.created_at) from public.signing_requests r where r.version_id = v.id),
        'signatures', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'signedAt', s.signed_at, 'signerName', s.signer_name, 'pdfStatus', s.pdf_status) order by s.signed_at)
                                from public.signatures s where s.version_id = v.id), '[]'::jsonb),
        'openLink', exists (select 1 from public.signing_requests r where r.version_id = v.id and r.status = 'pending' and r.expires_at > now()),
        'approved', v.id = v_approved
      ) order by v.version_number desc) from public.estimate_versions v where v.estimate_id = e.id), '[]'::jsonb),
    'changeOrders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'number', c.number, 'title', c.title, 'amount', c.amount, 'status', c.status, 'version', c.version, 'approvedVersion', c.approved_version,
        'approvalMethod', c.approval_method, 'approvalNote', c.approval_note, 'sentAt', c.sent_at, 'decidedAt', c.decided_at, 'createdAt', c.created_at,
        'updatedAt', c.updated_at, 'createdBy', c.created_by, 'description', c.description, 'lines', c.lines, 'scheduleDays', c.schedule_days,
        'customerNotes', c.customer_notes,
        'internalNotes', case when public.estimate_permission(e.id, 'create_change_orders') then c.internal_notes end,
        'signatures', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'signedAt', g.signed_at, 'signerName', g.signer_name, 'version', cv.version) order by g.signed_at)
                                from public.change_order_signatures g join public.change_order_versions cv on cv.id = g.version_id where g.change_order_id = c.id), '[]'::jsonb),
        'openLink', exists (select 1 from public.change_order_signing r where r.change_order_id = c.id and r.status = 'pending' and r.expires_at > now())
      ) order by c.number) from public.change_orders c where c.estimate_id = e.id), '[]'::jsonb),
    'permissions', jsonb_build_object('create', public.estimate_permission(e.id, 'create_change_orders'), 'send', public.estimate_permission(e.id, 'send_change_orders'),
      'accepted', public.estimate_is_accepted(e.id))
  );
end $$;
revoke execute on function public.project_proposal_history(uuid) from public, anon;
grant execute on function public.project_proposal_history(uuid) to authenticated;

-- 4. Trade scope workspace ---------------------------------------------------------------------------
create or replace function public.can_manage_project_scope(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.pm_estimate_access(e.id) and (
      e.company_id is null
      or public.has_company_permission(e.company_id, 'edit_all_schedules')
      or (public.has_company_permission(e.company_id, 'edit_assigned_schedules') and e.user_id = auth.uid()))
    from public.estimates e where e.id = p_estimate_id), false)
$$;
revoke execute on function public.can_manage_project_scope(uuid) from public, anon;
grant execute on function public.can_manage_project_scope(uuid) to authenticated;

create or replace function public.project_scope_readable(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.estimate_readable(e.id) and (e.company_id is null or public.has_company_permission(e.company_id, 'view_schedules'))
                   from public.estimates e where e.id = p_estimate_id), false)
$$;
revoke execute on function public.project_scope_readable(uuid) from public, anon;
grant execute on function public.project_scope_readable(uuid) to authenticated;

create table if not exists public.project_scope_sections (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  source_group_id uuid not null,
  source_version_id uuid references public.estimate_versions (id) on delete set null,
  trade text check (char_length(trade) <= 60),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  sort_order integer not null default 0,
  -- Reference copy of the approved scope for this section (customer-facing; never edited here).
  approved_scope text check (char_length(approved_scope) <= 8000),
  work_description text check (char_length(work_description) <= 8000),        -- subcontractor-facing
  technical_instructions text check (char_length(technical_instructions) <= 8000), -- subcontractor-facing
  installation_notes text check (char_length(installation_notes) <= 8000),      -- subcontractor-facing
  internal_notes text check (char_length(internal_notes) <= 8000),              -- company only
  customer_info text check (char_length(customer_info) <= 4000),                -- may be shown to the customer
  resource_id uuid references public.pm_resources (id) on delete set null,
  revision integer not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estimate_id, source_group_id)
);
create index if not exists project_scope_sections_estimate_idx on public.project_scope_sections (estimate_id, sort_order);
create table if not exists public.project_scope_revisions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.project_scope_sections (id) on delete cascade,
  revision integer not null,
  content jsonb not null,
  summary text check (char_length(summary) <= 300),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (section_id, revision)
);
drop trigger if exists project_scope_revisions_write_once on public.project_scope_revisions;
create trigger project_scope_revisions_write_once before update or delete on public.project_scope_revisions for each row execute function public.guard_write_once();

alter table public.project_scope_sections enable row level security;
alter table public.project_scope_revisions enable row level security;
drop policy if exists project_scope_sections_select on public.project_scope_sections;
create policy project_scope_sections_select on public.project_scope_sections for select to authenticated using (public.project_scope_readable(estimate_id));
drop policy if exists project_scope_revisions_select on public.project_scope_revisions;
create policy project_scope_revisions_select on public.project_scope_revisions for select to authenticated
  using (exists (select 1 from public.project_scope_sections s where s.id = section_id));
revoke all on public.project_scope_sections, public.project_scope_revisions from anon, authenticated;
grant select on public.project_scope_sections, public.project_scope_revisions to authenticated;

create or replace function public.scope_section_content(s public.project_scope_sections) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', s.title, 'trade', s.trade, 'workDescription', s.work_description, 'technicalInstructions', s.technical_instructions,
    'installationNotes', s.installation_notes, 'internalNotes', s.internal_notes, 'customerInfo', s.customer_info, 'resourceId', s.resource_id)
$$;

-- Build the workspace from the approved scope (sections chosen by the server from the approved
-- version's frozen snapshot). Existing sections are kept: running it again only adds missing ones.
-- p_sections: [{sourceGroupId, trade, title, sortOrder, approvedScope}]
create or replace function public.project_scope_init(p_estimate_id uuid, p_version_id uuid, p_sections jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.estimates; x jsonb; v_n integer := 0; v_id uuid;
begin
  if auth.uid() is null or not public.can_manage_project_scope(p_estimate_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate_id;
  if p_version_id is not null and not exists (select 1 from public.estimate_versions v where v.id = p_version_id and v.estimate_id = p_estimate_id) then
    raise exception 'bad_version' using errcode = '22023';
  end if;
  for x in select y from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) y loop
    -- Each section must come from this estimate (current sections or the approved version's snapshot).
    if not exists (select 1 from public.estimate_groups g where g.id = (x ->> 'sourceGroupId')::uuid and g.estimate_id = p_estimate_id)
       and not exists (select 1 from public.estimate_versions v, jsonb_array_elements(v.snapshot #> '{estimate,groups}') g
                       where v.id = p_version_id and g ->> 'id' = x ->> 'sourceGroupId') then
      raise exception 'unknown_source' using errcode = '22023';
    end if;
    insert into public.project_scope_sections (estimate_id, user_id, company_id, source_group_id, source_version_id, trade, title, sort_order, approved_scope, work_description, updated_by)
    values (p_estimate_id, e.user_id, e.company_id, (x ->> 'sourceGroupId')::uuid, p_version_id, left(nullif(x ->> 'trade', ''), 60),
            left(coalesce(nullif(btrim(x ->> 'title'), ''), 'Section'), 200), coalesce((x ->> 'sortOrder')::int, 0),
            left(nullif(x ->> 'approvedScope', ''), 8000), left(nullif(x ->> 'approvedScope', ''), 8000), auth.uid())
    on conflict (estimate_id, source_group_id) do nothing
    returning id into v_id;
    if v_id is not null then
      v_n := v_n + 1;
      insert into public.project_scope_revisions (section_id, revision, content, summary, actor_id)
      select s.id, 1, public.scope_section_content(s), 'Created from the approved scope', auth.uid() from public.project_scope_sections s where s.id = v_id;
    end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.project_scope_init(uuid, uuid, jsonb) from public, anon;
grant execute on function public.project_scope_init(uuid, uuid, jsonb) to authenticated;

-- Save one section (revision-checked). Only internal work instructions change: never the estimate.
create or replace function public.project_scope_save(p_section_id uuid, p_base_revision integer, p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare s public.project_scope_sections; v_res uuid := nullif(p ->> 'resourceId', '')::uuid; r public.pm_resources;
begin
  select * into s from public.project_scope_sections where id = p_section_id for update;
  if not found or auth.uid() is null or not public.can_manage_project_scope(s.estimate_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.revision <> p_base_revision then raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text; end if;
  if v_res is not null then
    select * into r from public.pm_resources where id = v_res;
    if not found or r.status <> 'active' or (s.company_id is not null and r.company_id is distinct from s.company_id)
       or (s.company_id is null and r.owner_id is distinct from s.user_id) then
      raise exception 'bad_resource' using errcode = '22023';
    end if;
  end if;
  update public.project_scope_sections set
    title = left(coalesce(nullif(btrim(p ->> 'title'), ''), title), 200),
    work_description = left(nullif(p ->> 'workDescription', ''), 8000), technical_instructions = left(nullif(p ->> 'technicalInstructions', ''), 8000),
    installation_notes = left(nullif(p ->> 'installationNotes', ''), 8000), internal_notes = left(nullif(p ->> 'internalNotes', ''), 8000),
    customer_info = left(nullif(p ->> 'customerInfo', ''), 4000), resource_id = v_res,
    revision = s.revision + 1, updated_by = auth.uid(), updated_at = now()
  where id = p_section_id returning * into s;
  insert into public.project_scope_revisions (section_id, revision, content, summary, actor_id)
  values (s.id, s.revision, public.scope_section_content(s), left(coalesce(nullif(btrim(p ->> 'summary'), ''), 'Scope updated'), 300), auth.uid());
  if s.company_id is not null then perform public.company_audit(s.company_id, 'scope.saved', 'scope_section', s.id::text, jsonb_build_object('revision', s.revision)); end if;
  return s.revision;
end $$;
revoke execute on function public.project_scope_save(uuid, integer, jsonb) from public, anon;
grant execute on function public.project_scope_save(uuid, integer, jsonb) to authenticated;

-- 5. Scope sharing with a subcontractor --------------------------------------------------------------
create table if not exists public.scope_shares (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.project_scope_sections (id) on delete cascade,
  resource_id uuid references public.pm_resources (id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists scope_shares_section_idx on public.scope_shares (section_id, created_at desc);
create table if not exists public.scope_share_versions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.scope_shares (id) on delete cascade,
  version integer not null,
  section_revision integer not null,
  content jsonb not null,           -- only the fields the contractor selected
  photo_ids uuid[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (share_id, version)
);
drop trigger if exists scope_share_versions_write_once on public.scope_share_versions;
create trigger scope_share_versions_write_once before update or delete on public.scope_share_versions for each row execute function public.guard_write_once();
alter table public.scope_shares enable row level security;
alter table public.scope_share_versions enable row level security;
revoke all on public.scope_shares, public.scope_share_versions from anon, authenticated;
-- Contractors list their shares through project_scope_shares(); the token hash is never returned.

create or replace function public.can_share_project_scope(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_project_scope(p_estimate_id) and public.estimate_permission(p_estimate_id, 'share_subcontractor_scopes')
$$;
revoke execute on function public.can_share_project_scope(uuid) from public, anon;
grant execute on function public.can_share_project_scope(uuid) to authenticated;

-- Create a share (new link) or add a version to an existing one. The server builds p_content from the
-- selected fields and passes the photo ids; both are frozen here.
create or replace function public.scope_share_publish(p_section_id uuid, p_share_id uuid, p_resource_id uuid, p_token_hash text, p_content jsonb, p_photo_ids uuid[], p_days integer default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.project_scope_sections; sh public.scope_shares; v_ver integer; r public.pm_resources;
begin
  select * into s from public.project_scope_sections where id = p_section_id;
  if not found or auth.uid() is null or not public.can_share_project_scope(s.estimate_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_resource_id is not null then
    select * into r from public.pm_resources where id = p_resource_id;
    if not found or (s.company_id is not null and r.company_id is distinct from s.company_id) or (s.company_id is null and r.owner_id is distinct from s.user_id) then
      raise exception 'bad_resource' using errcode = '22023';
    end if;
  end if;
  -- Photos must belong to this project (or its customer) and be attached to this section.
  if exists (select 1 from unnest(coalesce(p_photo_ids, '{}')) pid where not exists (
       select 1 from public.project_photos ph where ph.id = pid and ph.scope_section_id = p_section_id and ph.archived_at is null)) then
    raise exception 'bad_photo' using errcode = '22023';
  end if;
  if p_share_id is null then
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_token' using errcode = '22023'; end if;
    insert into public.scope_shares (section_id, resource_id, token_hash, created_by, expires_at)
    values (p_section_id, p_resource_id, p_token_hash, auth.uid(), now() + make_interval(days => greatest(1, least(coalesce(p_days, 60), 180))))
    returning * into sh;
  else
    select * into sh from public.scope_shares where id = p_share_id and section_id = p_section_id for update;
    if not found or sh.revoked_at is not null then raise exception 'not_found' using errcode = '42501'; end if;
    update public.scope_shares set expires_at = greatest(expires_at, now() + make_interval(days => greatest(1, least(coalesce(p_days, 60), 180)))) where id = sh.id;
  end if;
  v_ver := coalesce((select max(version) from public.scope_share_versions where share_id = sh.id), 0) + 1;
  insert into public.scope_share_versions (share_id, version, section_revision, content, photo_ids, created_by)
  values (sh.id, v_ver, s.revision, p_content, coalesce(p_photo_ids, '{}'), auth.uid());
  if s.company_id is not null then perform public.company_audit(s.company_id, 'scope.shared', 'scope_section', s.id::text, jsonb_build_object('share', sh.id, 'version', v_ver, 'photos', cardinality(coalesce(p_photo_ids, '{}')))); end if;
  return jsonb_build_object('shareId', sh.id, 'version', v_ver);
end $$;
revoke execute on function public.scope_share_publish(uuid, uuid, uuid, text, jsonb, uuid[], integer) from public, anon;
grant execute on function public.scope_share_publish(uuid, uuid, uuid, text, jsonb, uuid[], integer) to authenticated;

create or replace function public.scope_share_revoke(p_share_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_est uuid;
begin
  select s.estimate_id into v_est from public.scope_shares sh join public.project_scope_sections s on s.id = sh.section_id where sh.id = p_share_id;
  if v_est is null or not public.can_share_project_scope(v_est) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.scope_shares set revoked_at = coalesce(revoked_at, now()) where id = p_share_id;
end $$;
revoke execute on function public.scope_share_revoke(uuid) from public, anon;
grant execute on function public.scope_share_revoke(uuid) to authenticated;

create or replace function public.project_scope_shares(p_estimate_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.project_scope_readable(p_estimate_id) then coalesce((select jsonb_agg(jsonb_build_object(
      'id', sh.id, 'sectionId', sh.section_id, 'resourceId', sh.resource_id, 'createdAt', sh.created_at, 'expiresAt', sh.expires_at, 'revokedAt', sh.revoked_at,
      'version', v.version, 'sectionRevision', v.section_revision, 'sharedAt', v.created_at, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v.content -> 'fields') k),
      'photoCount', cardinality(v.photo_ids)) order by sh.created_at desc)
    from public.scope_shares sh join public.project_scope_sections s on s.id = sh.section_id
    join lateral (select * from public.scope_share_versions x where x.share_id = sh.id order by x.version desc limit 1) v on true
    where s.estimate_id = p_estimate_id), '[]'::jsonb) else '[]'::jsonb end
$$;
revoke execute on function public.project_scope_shares(uuid) from public, anon;
grant execute on function public.project_scope_shares(uuid) to authenticated;

-- Public read of a share by token hash (service role; the page shows only the frozen content).
create or replace function public.scope_share_read(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('content', v.content, 'photoIds', to_jsonb(v.photo_ids), 'version', v.version, 'sharedAt', v.created_at, 'expiresAt', sh.expires_at)
  from public.scope_shares sh
  join lateral (select * from public.scope_share_versions x where x.share_id = sh.id order by x.version desc limit 1) v on true
  where sh.token_hash = p_token_hash and sh.revoked_at is null and sh.expires_at > now()
$$;
revoke all on function public.scope_share_read(text) from public, anon, authenticated;
grant execute on function public.scope_share_read(text) to service_role;

-- 6. Subcontractor quotes (start on an estimate line item) ------------------------------------------
create or replace function public.can_view_sub_costs(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when e.company_id is null then e.user_id = auth.uid()
      else public.estimate_readable(e.id) and (public.has_company_permission(e.company_id, 'view_subcontractor_costs')
           or (e.user_id = auth.uid() and public.has_company_permission(e.company_id, 'view_costs'))) end
    from public.estimates e where e.id = p_estimate_id), false)
$$;
-- Recording quotes: the bid's author while estimating (with cost access), or "Edit internal project costs".
create or replace function public.can_record_sub_quotes(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when e.company_id is null then e.user_id = auth.uid()
      else public.estimate_readable(e.id) and (public.has_company_permission(e.company_id, 'edit_project_costs')
           or (e.user_id = auth.uid() and public.has_company_permission(e.company_id, 'view_costs'))) end
    from public.estimates e where e.id = p_estimate_id), false)
$$;
revoke execute on function public.can_view_sub_costs(uuid), public.can_record_sub_quotes(uuid) from public, anon;
grant execute on function public.can_view_sub_costs(uuid), public.can_record_sub_quotes(uuid) to authenticated;

create table if not exists public.subcontractor_quotes (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  item_id uuid not null,                        -- estimate line item (kept if the item is later removed)
  group_id uuid,
  item_name text not null default '' check (char_length(item_name) <= 300),
  resource_id uuid references public.pm_resources (id) on delete set null,
  vendor_name text not null check (char_length(btrim(vendor_name)) between 1 and 200),
  estimated_cost numeric(14, 2) not null default 0,   -- the line's cost when the quote was first recorded
  status text not null default 'received' check (status in ('received', 'under_review', 'accepted', 'rejected')),
  internal_notes text check (char_length(internal_notes) <= 4000),
  applied_revision_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subcontractor_quotes_estimate_idx on public.subcontractor_quotes (estimate_id, item_id);
drop trigger if exists subcontractor_quotes_updated on public.subcontractor_quotes;
create trigger subcontractor_quotes_updated before update on public.subcontractor_quotes for each row execute function public.set_updated_at();

create table if not exists public.subcontractor_quote_revisions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.subcontractor_quotes (id) on delete cascade,
  revision integer not null check (revision >= 1),
  amount numeric(14, 2) not null check (amount >= 0 and amount <= 100000000),
  quote_date date,
  note text check (char_length(note) <= 2000),
  document_path text check (char_length(document_path) <= 500),
  document_name text check (char_length(document_name) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quote_id, revision)
);
drop trigger if exists subcontractor_quote_revisions_write_once on public.subcontractor_quote_revisions;
create trigger subcontractor_quote_revisions_write_once before update or delete on public.subcontractor_quote_revisions for each row execute function public.guard_write_once();

create table if not exists public.project_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  item_id uuid,
  group_id uuid,
  quote_id uuid references public.subcontractor_quotes (id) on delete set null,
  quote_revision_id uuid references public.subcontractor_quote_revisions (id) on delete set null,
  amount numeric(14, 2) not null,               -- change to the internal cost forecast (never a price)
  forecast_cost numeric(14, 2) not null,        -- the line's forecast cost after this adjustment
  note text check (char_length(note) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists project_cost_adjustments_estimate_idx on public.project_cost_adjustments (estimate_id, item_id, created_at);
drop trigger if exists project_cost_adjustments_write_once on public.project_cost_adjustments;
create trigger project_cost_adjustments_write_once before update or delete on public.project_cost_adjustments for each row execute function public.guard_write_once();

alter table public.subcontractor_quotes enable row level security;
alter table public.subcontractor_quote_revisions enable row level security;
alter table public.project_cost_adjustments enable row level security;
drop policy if exists subcontractor_quotes_select on public.subcontractor_quotes;
create policy subcontractor_quotes_select on public.subcontractor_quotes for select to authenticated using (public.can_view_sub_costs(estimate_id));
drop policy if exists subcontractor_quote_revisions_select on public.subcontractor_quote_revisions;
create policy subcontractor_quote_revisions_select on public.subcontractor_quote_revisions for select to authenticated
  using (exists (select 1 from public.subcontractor_quotes q where q.id = quote_id));
drop policy if exists project_cost_adjustments_select on public.project_cost_adjustments;
create policy project_cost_adjustments_select on public.project_cost_adjustments for select to authenticated using (public.can_view_sub_costs(estimate_id));
revoke all on public.subcontractor_quotes, public.subcontractor_quote_revisions, public.project_cost_adjustments from anon, authenticated;
grant select on public.subcontractor_quotes, public.subcontractor_quote_revisions, public.project_cost_adjustments to authenticated;

-- Add a quote to a line item, or a revised amount to an existing quote (both unapproved values).
-- p: {quoteId?, itemId, resourceId?, vendorName?, amount, quoteDate?, note?, documentPath?, documentName?, internalNotes?, status?}
create or replace function public.sub_quote_record(p_estimate_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates; q public.subcontractor_quotes; it public.estimate_items; r public.pm_resources;
  v_res uuid := nullif(p ->> 'resourceId', '')::uuid; v_rev integer; v_revid uuid; v_name text;
begin
  if auth.uid() is null or not public.can_record_sub_quotes(p_estimate_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate_id;
  if p ? 'documentPath' and nullif(p ->> 'documentPath', '') is not null
     and split_part(p ->> 'documentPath', '/', 1) <> coalesce(e.company_id, e.user_id)::text then
    raise exception 'bad_document' using errcode = '22023';
  end if;
  if nullif(p ->> 'quoteId', '') is not null then
    select * into q from public.subcontractor_quotes where id = (p ->> 'quoteId')::uuid and estimate_id = p_estimate_id for update;
    if not found then raise exception 'not_found' using errcode = '42501'; end if;
    if p ? 'internalNotes' or p ? 'status' then
      update public.subcontractor_quotes set internal_notes = case when p ? 'internalNotes' then left(nullif(btrim(p ->> 'internalNotes'), ''), 4000) else internal_notes end,
        status = coalesce(nullif(p ->> 'status', ''), status) where id = q.id;
    end if;
  else
    select * into it from public.estimate_items where id = (p ->> 'itemId')::uuid and estimate_id = p_estimate_id;
    if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
    if v_res is not null then
      select * into r from public.pm_resources where id = v_res;
      if not found or (e.company_id is not null and r.company_id is distinct from e.company_id) or (e.company_id is null and r.owner_id is distinct from e.user_id) then
        raise exception 'bad_resource' using errcode = '22023';
      end if;
    end if;
    v_name := coalesce(nullif(btrim(p ->> 'vendorName'), ''), r.name);
    if v_name is null then raise exception 'vendor_required' using errcode = '22023'; end if;
    insert into public.subcontractor_quotes (estimate_id, user_id, company_id, item_id, group_id, item_name, resource_id, vendor_name, estimated_cost, internal_notes, status, created_by)
    values (p_estimate_id, e.user_id, e.company_id, it.id, it.group_id, left(coalesce(it.name, ''), 300), v_res, left(v_name, 200),
            round(it.quantity * it.unit_cost, 2), left(nullif(btrim(p ->> 'internalNotes'), ''), 4000), coalesce(nullif(p ->> 'status', ''), 'received'), auth.uid())
    returning * into q;
  end if;
  if nullif(p ->> 'amount', '') is not null then
    v_rev := coalesce((select max(revision) from public.subcontractor_quote_revisions where quote_id = q.id), 0) + 1;
    insert into public.subcontractor_quote_revisions (quote_id, revision, amount, quote_date, note, document_path, document_name, created_by)
    values (q.id, v_rev, round((p ->> 'amount')::numeric, 2), nullif(p ->> 'quoteDate', '')::date, left(nullif(btrim(p ->> 'note'), ''), 2000),
            nullif(p ->> 'documentPath', ''), left(nullif(p ->> 'documentName', ''), 200), auth.uid())
    returning id into v_revid;
  end if;
  if e.company_id is not null then perform public.company_audit(e.company_id, 'sub_quote.recorded', 'sub_quote', q.id::text, jsonb_build_object('revision', v_rev)); end if;
  return jsonb_build_object('quoteId', q.id, 'revision', v_rev, 'revisionId', v_revid);
end $$;
revoke execute on function public.sub_quote_record(uuid, jsonb) from public, anon;
grant execute on function public.sub_quote_record(uuid, jsonb) to authenticated;

-- "Update internal project cost": the explicit, authorized step that moves the internal forecast for a
-- line to a quote revision. The adjustment is the difference from the line's current forecast, so
-- applying again (or another vendor) never double counts. Customer prices are never touched.
create or replace function public.sub_quote_apply_cost(p_quote_id uuid, p_revision_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.subcontractor_quotes; v public.subcontractor_quote_revisions; v_forecast numeric; v_delta numeric;
begin
  select * into q from public.subcontractor_quotes where id = p_quote_id for update;
  if not found or auth.uid() is null or not public.estimate_permission(q.estimate_id, 'edit_project_costs') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from public.subcontractor_quote_revisions where id = p_revision_id and quote_id = q.id;
  if not found then raise exception 'not_found' using errcode = '42501'; end if;
  perform 1 from public.estimates where id = q.estimate_id for update;  -- one forecast change at a time per bid
  v_forecast := coalesce((select a.forecast_cost from public.project_cost_adjustments a where a.estimate_id = q.estimate_id and a.item_id = q.item_id
                          order by a.created_at desc, a.id desc limit 1), q.estimated_cost);
  v_delta := v.amount - v_forecast;
  if q.applied_revision_id = v.id and v_delta = 0 then return jsonb_build_object('unchanged', true, 'forecastCost', v_forecast); end if;
  insert into public.project_cost_adjustments (estimate_id, item_id, group_id, quote_id, quote_revision_id, amount, forecast_cost, note, created_by)
  values (q.estimate_id, q.item_id, q.group_id, q.id, v.id, v_delta, v.amount,
          left(coalesce(nullif(btrim(p_note), ''), 'Internal cost updated to ' || q.vendor_name || ' quote revision ' || v.revision), 1000), auth.uid());
  update public.subcontractor_quotes set applied_revision_id = v.id, status = 'accepted' where id = q.id;
  if q.company_id is not null then perform public.company_audit(q.company_id, 'project_cost.updated', 'sub_quote', q.id::text, jsonb_build_object('delta', v_delta, 'revision', v.revision)); end if;
  return jsonb_build_object('delta', v_delta, 'forecastCost', v.amount);
end $$;
revoke execute on function public.sub_quote_apply_cost(uuid, uuid, text) from public, anon;
grant execute on function public.sub_quote_apply_cost(uuid, uuid, text) to authenticated;

-- Everything the line-item panels, project scope and internal report need, for one bid.
create or replace function public.sub_quotes_for_estimate(p_estimate_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'canView', public.can_view_sub_costs(p_estimate_id), 'canRecord', public.can_record_sub_quotes(p_estimate_id),
    'canApply', public.estimate_permission(p_estimate_id, 'edit_project_costs'),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'itemId', q.item_id, 'groupId', q.group_id, 'itemName', q.item_name, 'resourceId', q.resource_id, 'vendorName', q.vendor_name,
        'estimatedCost', q.estimated_cost, 'status', q.status, 'internalNotes', q.internal_notes, 'appliedRevisionId', q.applied_revision_id,
        'createdAt', q.created_at,
        'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'revision', r.revision, 'amount', r.amount, 'quoteDate', r.quote_date, 'note', r.note,
            'documentPath', r.document_path, 'documentName', r.document_name, 'createdAt', r.created_at, 'createdBy', r.created_by) order by r.revision)
          from public.subcontractor_quote_revisions r where r.quote_id = q.id), '[]'::jsonb)
      ) order by q.created_at) from public.subcontractor_quotes q where q.estimate_id = p_estimate_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'itemId', a.item_id, 'groupId', a.group_id, 'quoteId', a.quote_id, 'revisionId', a.quote_revision_id,
        'amount', a.amount, 'forecastCost', a.forecast_cost, 'note', a.note, 'createdAt', a.created_at, 'createdBy', a.created_by) order by a.created_at, a.id)
      from public.project_cost_adjustments a where a.estimate_id = p_estimate_id), '[]'::jsonb))
$$;
revoke execute on function public.sub_quotes_for_estimate(uuid) from public, anon;
grant execute on function public.sub_quotes_for_estimate(uuid) to authenticated;

-- Cross-project comparison for internal reporting (RLS: only bids whose sub costs the caller may see).
create or replace function public.sub_quote_report() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'estimateId', q.estimate_id, 'project', e.title, 'customerName', e.customer_name, 'number', e.estimate_number,
      'itemName', q.item_name, 'groupId', q.group_id, 'trade', coalesce(e.proposal_config -> 'worksheet' -> 'sectionTrades' ->> q.group_id::text, e.trades[1]),
      'vendorName', q.vendor_name, 'status', q.status, 'estimatedCost', q.estimated_cost,
      'original', (select r.amount from public.subcontractor_quote_revisions r where r.quote_id = q.id order by r.revision limit 1),
      'latest', (select r.amount from public.subcontractor_quote_revisions r where r.quote_id = q.id order by r.revision desc limit 1),
      'applied', (select r.amount from public.subcontractor_quote_revisions r where r.id = q.applied_revision_id),
      'revisions', (select count(*) from public.subcontractor_quote_revisions r where r.quote_id = q.id)
    ) order by e.title, q.item_name), '[]'::jsonb)
  from public.subcontractor_quotes q join public.estimates e on e.id = q.estimate_id
$$;
revoke execute on function public.sub_quote_report() from public, anon;
grant execute on function public.sub_quote_report() to authenticated;
