-- Creator Partner Program: invitation-only Learning Enterprise for YouTube construction educators.
--
-- NOT a public plan. Nothing here touches pricing, checkout, Stripe, or the regular Enterprise
-- entitlement (user_entitlement / company_entitlement are unchanged).
--
-- Model (reuses Complimentary Access, 20261114004000):
--  * creator_programs   One per creator partner. The platform owner creates it, records that the
--                       creator accepted the program terms, then provisions it, which issues an
--                       ordinary 12-month complimentary ENTERPRISE grant for the creator's own business.
--                       The program window (starts_at..expires_at) is fixed when that grant activates.
--  * creator_gifts      Promotional seats. A creator invites a subscriber by email; the subscriber claims
--                       with a single-use, hashed, expiring token while signed in with that VERIFIED email.
--                       Claiming creates the subscriber's OWN complimentary UNLIMITED grant (their own
--                       account and company profile). Gifted subscribers never become company members.
--                       Gift grants can never outlive the program (trigger caps expires_at).
--  * mentorship_*       Opt-in, per-estimate sharing owned by the subscriber. Creators read only what a
--                       subscriber shares, through security-definer functions that redact customer
--                       contact details always, and costs / markup unless explicitly shared.
--
-- All tables: RLS on, no direct table grants for anon/authenticated. Every read and write goes through
-- the functions below, which check auth.uid() (customer functions) or is_admin(caller) (owner
-- functions, service role only). Every state change is written to audit_logs.
--
-- Safe to run more than once. Requires 20261114004000_complimentary_access.sql and
-- 20261114008000_enterprise_pipeline.sql. Rollback: supabase/rollback/20261117001000_creator_partner_program_down.sql

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.creator_programs (
  id uuid primary key default gen_random_uuid(),
  creator_email text not null check (creator_email = lower(btrim(creator_email)) and creator_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  creator_user_id uuid references auth.users (id) on delete set null,
  -- e.g. "Johnson Deck Academy — Built2Bid Learning Team"
  workspace_name text not null check (char_length(btrim(workspace_name)) between 2 and 120),
  channel_name text check (char_length(channel_name) <= 200),
  channel_url text check (channel_url is null or (channel_url ~ '^https://' and char_length(channel_url) <= 500)),
  prospect_id uuid,
  gift_allowance integer not null default 5 check (gift_allowance between 0 and 50),
  program_days integer not null default 365 check (program_days between 30 and 365),
  status text not null default 'draft' check (status in ('draft', 'provisioned', 'ended', 'revoked')),
  terms_version text check (char_length(terms_version) <= 40),
  terms_accepted_at timestamptz,
  terms_evidence text check (char_length(terms_evidence) <= 1000),
  -- The creator also confirms the program terms in-app before inviting anyone.
  creator_confirmed_at timestamptz,
  comp_grant_id uuid unique references public.complimentary_grants (id) on delete set null,
  starts_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  end_reason text check (char_length(end_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_programs_window check ((starts_at is null) = (expires_at is null) and (expires_at is null or expires_at > starts_at)),
  constraint creator_programs_provisioned check (status = 'draft' or terms_accepted_at is not null)
);
create unique index if not exists creator_programs_open_email_idx on public.creator_programs (creator_email) where status in ('draft', 'provisioned');
create index if not exists creator_programs_creator_idx on public.creator_programs (creator_user_id) where creator_user_id is not null;

create table if not exists public.creator_gifts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.creator_programs (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text check (char_length(display_name) <= 120),
  invite_token_hash text unique check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz not null,
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  invite_sent_at timestamptz,
  claimed_user_id uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  comp_grant_id uuid unique references public.complimentary_grants (id) on delete set null,
  -- Set when this gift re-uses a seat freed by an earlier one (reassignment). Never extends the term.
  replaces_gift_id uuid references public.creator_gifts (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (char_length(revoke_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_gifts_claim check ((claimed_at is null) = (claimed_user_id is null)),
  constraint creator_gifts_token check (claimed_at is null or invite_token_hash is null)
);
-- One open gift per email per program, and one live gift per account across ALL programs.
create unique index if not exists creator_gifts_open_email_idx on public.creator_gifts (program_id, email) where revoked_at is null;
create unique index if not exists creator_gifts_live_user_idx on public.creator_gifts (claimed_user_id) where revoked_at is null and claimed_user_id is not null;
create index if not exists creator_gifts_program_idx on public.creator_gifts (program_id, created_at desc);

-- The business's main trade, chosen by its owner during onboarding (shown on their own profile and,
-- for gifted participants, on the creator's roster). Additive; existing rows stay null.
alter table public.business_profiles add column if not exists primary_trade text check (char_length(primary_trade) <= 80);
-- Where the onboarding branding came from (audit of "what did we import, and did the user approve it").
alter table public.business_profiles add column if not exists branding_source jsonb check (branding_source is null or pg_column_size(branding_source) <= 4096);

-- Link complimentary grants back to the program / gift that produced them (nullable, additive).
alter table public.complimentary_grants add column if not exists creator_program_id uuid references public.creator_programs (id) on delete set null;
alter table public.complimentary_grants add column if not exists creator_gift_id uuid references public.creator_gifts (id) on delete set null;
create index if not exists complimentary_grants_creator_program_idx on public.complimentary_grants (creator_program_id) where creator_program_id is not null;

-- Subscriber-level mentorship choices for one program (all OFF until the subscriber turns them on).
create table if not exists public.mentorship_consents (
  program_id uuid not null references public.creator_programs (id) on delete cascade,
  participant_user_id uuid not null references auth.users (id) on delete cascade,
  allow_comments boolean not null default false,
  allow_suggestions boolean not null default false,
  share_pipeline_summary boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (program_id, participant_user_id)
);

-- One subscriber-chosen estimate shared for coaching. The proposal (scope, customer-facing totals)
-- is the base of every share; the other flags are independent opt-ins.
create table if not exists public.mentorship_shares (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.creator_programs (id) on delete cascade,
  participant_user_id uuid not null references auth.users (id) on delete cascade,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  share_costs boolean not null default false,
  share_margin boolean not null default false,
  share_project_info boolean not null default false,
  -- Customer-facing totals computed by the subscriber's own session when sharing (subtotal, tax, total).
  proposal_snapshot jsonb not null default '{}'::jsonb check (pg_column_size(proposal_snapshot) <= 8192),
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists mentorship_shares_open_idx on public.mentorship_shares (program_id, estimate_id) where revoked_at is null;
create index if not exists mentorship_shares_participant_idx on public.mentorship_shares (participant_user_id, program_id);

create table if not exists public.mentorship_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.mentorship_shares (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  kind text not null default 'comment' check (kind in ('comment', 'suggestion')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists mentorship_comments_share_idx on public.mentorship_comments (share_id, created_at);

create table if not exists public.creator_resources (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.creator_programs (id) on delete cascade,
  kind text not null check (kind in ('link', 'note', 'checklist')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 1000)),
  body text check (char_length(body) <= 4000),
  checklist jsonb check (checklist is null or (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 30)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_resources_link check (kind <> 'link' or url is not null)
);
create index if not exists creator_resources_program_idx on public.creator_resources (program_id, sort_order);

do $do$
declare t text;
begin
  foreach t in array array['creator_programs', 'creator_gifts', 'mentorship_consents', 'mentorship_shares', 'mentorship_comments', 'creator_resources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    if t not in ('mentorship_comments') then
      execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------------------
-- 2. State helpers
-- ---------------------------------------------------------------------------
-- draft | awaiting_activation | active | ended | revoked
create or replace function public.creator_program_state(p public.creator_programs) returns text
language sql stable set search_path = public as $$
  select case
    when p.status = 'revoked' then 'revoked'
    when p.status = 'ended' then 'ended'
    when p.status = 'draft' then 'draft'
    when p.starts_at is null then 'awaiting_activation'
    when p.expires_at <= now() then 'ended'
    else 'active'
  end
$$;

create or replace function public.creator_program_active(p_program_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.creator_program_state(p) = 'active' from public.creator_programs p where p.id = p_program_id), false)
$$;

-- invited | invite_expired | active | expired | revoked
create or replace function public.creator_gift_state(g public.creator_gifts) returns text
language sql stable security definer set search_path = public as $$
  select case
    when g.revoked_at is not null then 'revoked'
    when g.claimed_at is null then case when g.invite_expires_at <= now() then 'invite_expired' else 'invited' end
    when exists (select 1 from public.complimentary_grants c where c.id = g.comp_grant_id
                 and c.status = 'active' and c.starts_at <= now() and c.expires_at > now()) then 'active'
    else 'expired'
  end
$$;

-- Seats a gift occupies: open invitations that can still be claimed, plus claimed gifts not revoked.
create or replace function public.creator_seats_used(p_program_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.creator_gifts g
  where g.program_id = p_program_id and g.revoked_at is null
    and (g.claimed_at is not null or g.invite_expires_at > now())
$$;

-- The caller's program as its creator, if it is active (the gate for every creator function).
create or replace function public.creator_require_program(p_program_id uuid) returns public.creator_programs
language plpgsql stable security definer set search_path = public as $$
declare p public.creator_programs;
begin
  select * into p from public.creator_programs where id = p_program_id;
  if not found or auth.uid() is null or p.creator_user_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.creator_program_state(p) <> 'active' then raise exception 'program_inactive' using errcode = 'P0001'; end if;
  return p;
end $$;

-- Is this user an active participant (claimed, unrevoked gift whose grant is live) of the program?
create or replace function public.mentorship_is_participant(p_program_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.creator_program_active(p_program_id) and exists (
    select 1 from public.creator_gifts g
    where g.program_id = p_program_id and g.claimed_user_id = p_user_id and public.creator_gift_state(g) = 'active')
$$;

create or replace function public.creator_audit(p_actor uuid, p_action text, p_target_type text, p_target_id uuid, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_actor, p_action, p_target_type, p_target_id::text, p_details)
$$;

-- ---------------------------------------------------------------------------
-- 3. Program window and grant caps (triggers)
-- ---------------------------------------------------------------------------
-- Fix the program window the first time the creator's Enterprise grant is active.
create or replace function public.creator_program_sync(p_program_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs; c public.complimentary_grants;
begin
  select * into p from public.creator_programs where id = p_program_id for update;
  if not found or p.status <> 'provisioned' or p.comp_grant_id is null then return; end if;
  select * into c from public.complimentary_grants where id = p.comp_grant_id;
  if c.status = 'revoked' then
    update public.creator_programs set status = 'ended', ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'Creator grant revoked') where id = p.id;
    return;
  end if;
  if p.starts_at is null and c.status = 'active' and c.starts_at is not null then
    update public.creator_programs
      set starts_at = c.starts_at, expires_at = c.starts_at + make_interval(days => p.program_days), creator_user_id = c.user_id
      where id = p.id;
    perform public.creator_audit(c.user_id, 'creator_program.activate', 'creator_program', p.id,
      jsonb_build_object('starts_at', c.starts_at, 'expires_at', c.starts_at + make_interval(days => p.program_days)));
  end if;
end $$;

create or replace function public.creator_grant_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_program uuid;
begin
  if new.creator_program_id is not null and new.creator_gift_id is null then
    perform public.creator_program_sync(new.creator_program_id);
  end if;
  -- A gift grant revoked anywhere (owner admin or creator) frees the seat and ends mentorship.
  if new.creator_gift_id is not null and new.status = 'revoked' and (tg_op = 'INSERT' or old.status <> 'revoked') then
    update public.creator_gifts set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, new.revoked_by),
      revoke_reason = coalesce(revoke_reason, new.revoke_reason, 'Complimentary access revoked')
      where id = new.creator_gift_id and revoked_at is null returning program_id into v_program;
    update public.mentorship_shares set revoked_at = now()
      where participant_user_id = new.user_id and revoked_at is null
        and program_id = (select program_id from public.creator_gifts where id = new.creator_gift_id);
  end if;
  return new;
end $$;

drop trigger if exists complimentary_grants_creator_sync on public.complimentary_grants;
create trigger complimentary_grants_creator_sync after insert or update of status, starts_at on public.complimentary_grants
  for each row when (new.creator_program_id is not null or new.creator_gift_id is not null)
  execute function public.creator_grant_changed();

-- Gift grants can never run past the program's end, whatever path changes them (extend, resume...).
create or replace function public.creator_gift_grant_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_end timestamptz;
begin
  if new.creator_gift_id is null then return new; end if;
  select p.expires_at into v_end from public.creator_gifts g join public.creator_programs p on p.id = g.program_id where g.id = new.creator_gift_id;
  if v_end is null then raise exception 'program_inactive' using errcode = 'P0001'; end if;
  if new.expires_at is null or new.expires_at > v_end then new.expires_at := v_end; end if;
  if new.starts_at is not null and new.expires_at <= new.starts_at then new.expires_at := new.starts_at + interval '1 second'; end if;
  return new;
end $$;

drop trigger if exists complimentary_grants_creator_cap on public.complimentary_grants;
create trigger complimentary_grants_creator_cap before insert or update of expires_at, creator_gift_id on public.complimentary_grants
  for each row execute function public.creator_gift_grant_cap();

-- Shares can only ever point at the participant's own estimate.
create or replace function public.mentorship_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.estimates e where e.id = new.estimate_id and e.user_id = new.participant_user_id) then
    raise exception 'not_your_estimate' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.estimate_id <> old.estimate_id or new.participant_user_id <> old.participant_user_id or new.program_id <> old.program_id) then
    raise exception 'immutable' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists mentorship_shares_guard on public.mentorship_shares;
create trigger mentorship_shares_guard before insert or update on public.mentorship_shares
  for each row execute function public.mentorship_share_guard();

-- ---------------------------------------------------------------------------
-- 4. Owner (platform admin) functions: service role only, re-check is_admin(caller)
-- ---------------------------------------------------------------------------
create or replace function public.creator_program_row(p public.creator_programs) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'state', public.creator_program_state(p),
    'seats_used', public.creator_seats_used(p.id),
    'gifts_active', (select count(*) from public.creator_gifts g where g.program_id = p.id and public.creator_gift_state(g) = 'active'),
    'gifts_pending', (select count(*) from public.creator_gifts g where g.program_id = p.id and public.creator_gift_state(g) = 'invited'),
    'shares_open', (select count(*) from public.mentorship_shares s where s.program_id = p.id and s.revoked_at is null),
    'creator_grant_state', (select public.comp_grant_state(c) from public.complimentary_grants c where c.id = p.comp_grant_id),
    'gift_conversions', (select count(*) from public.creator_gifts g join public.complimentary_grants c on c.id = g.comp_grant_id
                         where g.program_id = p.id and not c.had_paid_subscription and public.has_paid_subscription(g.claimed_user_id))
  )
$$;

create or replace function public.admin_creator_program_create(
  p_caller uuid, p_email text, p_workspace_name text, p_channel_name text default null, p_channel_url text default null,
  p_gift_allowance integer default 5, p_prospect_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs;
begin
  perform public.comp_require_admin(p_caller);
  if p_gift_allowance is null or p_gift_allowance < 0 or p_gift_allowance > 50 then raise exception 'invalid_allowance' using errcode = '22023'; end if;
  begin
    insert into public.creator_programs (creator_email, workspace_name, channel_name, channel_url, gift_allowance, prospect_id, created_by)
    values (lower(btrim(p_email)), btrim(p_workspace_name), nullif(btrim(p_channel_name), ''), nullif(btrim(p_channel_url), ''), p_gift_allowance, p_prospect_id, p_caller)
    returning * into p;
  exception
    when unique_violation then raise exception 'program_exists' using errcode = 'P0001';
    when check_violation then raise exception 'invalid_program' using errcode = '22023';
  end;
  perform public.creator_audit(p_caller, 'creator_program.create', 'creator_program', p.id,
    jsonb_build_object('email', p.creator_email, 'gift_allowance', p.gift_allowance, 'workspace_name', p.workspace_name));
  return public.creator_program_row(p);
end $$;

-- Record that the creator explicitly accepted the program terms (e.g. their written reply). A casual
-- "sounds interesting" is not acceptance; the owner must confirm and give the evidence.
create or replace function public.admin_creator_program_record_terms(p_caller uuid, p_id uuid, p_terms_version text, p_evidence text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs;
begin
  perform public.comp_require_admin(p_caller);
  if char_length(btrim(coalesce(p_evidence, ''))) < 10 then raise exception 'evidence_required' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_terms_version, ''))) < 1 then raise exception 'terms_version_required' using errcode = '22023'; end if;
  update public.creator_programs set terms_version = btrim(p_terms_version), terms_evidence = btrim(p_evidence), terms_accepted_at = now()
    where id = p_id and status = 'draft' returning * into p;
  if not found then raise exception 'not_draft' using errcode = 'P0001'; end if;
  perform public.creator_audit(p_caller, 'creator_program.terms_recorded', 'creator_program', p.id, jsonb_build_object('terms_version', p.terms_version));
  return public.creator_program_row(p);
end $$;

-- Issue the creator's 12-month complimentary Enterprise grant (existing Complimentary Access path).
create or replace function public.admin_creator_program_provision(p_caller uuid, p_id uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs; v_grant jsonb;
begin
  perform public.comp_require_admin(p_caller);
  select * into p from public.creator_programs where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.status <> 'draft' then raise exception 'not_draft' using errcode = 'P0001'; end if;
  if p.terms_accepted_at is null then raise exception 'terms_not_accepted' using errcode = 'P0001'; end if;
  v_grant := public.admin_comp_create(p_caller, p.creator_email, 'enterprise', p.program_days, 0,
    left('Creator Partner Program: ' || p.workspace_name, 500), p_token_hash, 30);
  update public.complimentary_grants set creator_program_id = p.id where id = (v_grant ->> 'id')::uuid;
  update public.creator_programs set status = 'provisioned', comp_grant_id = (v_grant ->> 'id')::uuid where id = p.id returning * into p;
  perform public.creator_program_sync(p.id);
  select * into p from public.creator_programs where id = p.id;
  perform public.creator_audit(p_caller, 'creator_program.provision', 'creator_program', p.id, jsonb_build_object('comp_grant_id', v_grant ->> 'id'));
  return public.creator_program_row(p) || jsonb_build_object('existing_account', (v_grant ->> 'existing_account')::boolean, 'grant', v_grant);
end $$;

create or replace function public.admin_creator_program_set_allowance(p_caller uuid, p_id uuid, p_allowance integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs; v_old integer;
begin
  perform public.comp_require_admin(p_caller);
  if p_allowance is null or p_allowance < 0 or p_allowance > 50 then raise exception 'invalid_allowance' using errcode = '22023'; end if;
  select * into p from public.creator_programs where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.status in ('ended', 'revoked') then raise exception 'program_inactive' using errcode = 'P0001'; end if;
  if p_allowance < public.creator_seats_used(p.id) then raise exception 'below_used' using errcode = 'P0001'; end if;
  v_old := p.gift_allowance;
  update public.creator_programs set gift_allowance = p_allowance where id = p.id returning * into p;
  perform public.creator_audit(p_caller, 'creator_program.allowance', 'creator_program', p.id, jsonb_build_object('old', v_old, 'new', p_allowance));
  return public.creator_program_row(p);
end $$;

-- End a program now. Mentorship ends immediately. Optionally also ends gifted access and the creator's
-- own grant (owner chooses). Business data is never touched.
create or replace function public.admin_creator_program_end(p_caller uuid, p_id uuid, p_reason text, p_end_gifts boolean default false, p_end_creator_grant boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs; r record;
begin
  perform public.comp_require_admin(p_caller);
  select * into p from public.creator_programs where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.creator_programs set status = case when status = 'draft' then 'revoked' else 'ended' end,
    ended_at = now(), end_reason = nullif(btrim(p_reason), '') where id = p.id returning * into p;
  update public.mentorship_shares set revoked_at = now() where program_id = p.id and revoked_at is null;
  update public.creator_gifts set revoked_at = now(), revoked_by = p_caller, revoke_reason = 'Program ended', invite_token_hash = null
    where program_id = p.id and claimed_at is null and revoked_at is null;
  if p_end_gifts then
    for r in select g.comp_grant_id from public.creator_gifts g where g.program_id = p.id and g.comp_grant_id is not null loop
      perform public.admin_comp_revoke(p_caller, r.comp_grant_id, 'Creator program ended');
    end loop;
  end if;
  if p_end_creator_grant and p.comp_grant_id is not null then
    perform public.admin_comp_revoke(p_caller, p.comp_grant_id, 'Creator program ended');
  end if;
  perform public.creator_audit(p_caller, 'creator_program.end', 'creator_program', p.id,
    jsonb_build_object('reason', p.end_reason, 'end_gifts', p_end_gifts, 'end_creator_grant', p_end_creator_grant));
  return public.creator_program_row(p);
end $$;

create or replace function public.admin_creator_programs(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.comp_require_admin(p_caller);
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(public.creator_program_row(p) order by p.created_at desc) from public.creator_programs p), '[]'),
    'metrics', (select jsonb_build_object(
      'programs_active', count(*) filter (where public.creator_program_state(p) = 'active'),
      'programs_draft', count(*) filter (where p.status = 'draft'),
      'gift_allowance', coalesce(sum(p.gift_allowance) filter (where public.creator_program_state(p) in ('active', 'awaiting_activation')), 0),
      'gifts_active', (select count(*) from public.creator_gifts g where public.creator_gift_state(g) = 'active'),
      'gifts_pending', (select count(*) from public.creator_gifts g where public.creator_gift_state(g) = 'invited'),
      'shares_open', (select count(*) from public.mentorship_shares s where s.revoked_at is null),
      'gift_conversions', (select count(*) from public.creator_gifts g join public.complimentary_grants c on c.id = g.comp_grant_id
                           where not c.had_paid_subscription and public.has_paid_subscription(g.claimed_user_id))
    ) from public.creator_programs p)
  );
end $$;

create or replace function public.admin_creator_program_detail(p_caller uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.creator_programs;
begin
  perform public.comp_require_admin(p_caller);
  select * into p from public.creator_programs where id = p_id;
  if not found then return null; end if;
  return public.creator_program_row(p) || jsonb_build_object(
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'email', g.email, 'state', public.creator_gift_state(g),
        'invited_at', g.invited_at, 'claimed_at', g.claimed_at, 'revoked_at', g.revoked_at, 'revoke_reason', g.revoke_reason,
        'expires_at', (select c.expires_at from public.complimentary_grants c where c.id = g.comp_grant_id),
        'company_name', (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = g.claimed_user_id),
        'paid_now', g.claimed_user_id is not null and public.has_paid_subscription(g.claimed_user_id)) order by g.created_at desc)
      from public.creator_gifts g where g.program_id = p.id), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'details', a.details,
        'actor_email', (select u.email from auth.users u where u.id = a.actor_id)) order by a.created_at desc)
      from public.audit_logs a where a.target_type = 'creator_program' and a.target_id = p.id::text), '[]'));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Creator functions (authenticated; caller must be the program's creator)
-- ---------------------------------------------------------------------------
-- Programs where the caller is the creator, in any state (so an ended program can say so).
create or replace function public.my_creator_programs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'workspace_name', p.workspace_name, 'channel_name', p.channel_name, 'state', public.creator_program_state(p),
      'gift_allowance', p.gift_allowance, 'seats_used', public.creator_seats_used(p.id),
      'starts_at', p.starts_at, 'expires_at', p.expires_at, 'terms_version', p.terms_version,
      'creator_confirmed_at', p.creator_confirmed_at) order by p.created_at desc), '[]')
  from public.creator_programs p
  where auth.uid() is not null and p.creator_user_id = auth.uid() and p.status <> 'draft'
$$;

create or replace function public.creator_confirm_terms(p_program_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs;
begin
  p := public.creator_require_program(p_program_id);
  if p.creator_confirmed_at is null then
    update public.creator_programs set creator_confirmed_at = now() where id = p.id;
    perform public.creator_audit(auth.uid(), 'creator_program.creator_confirmed', 'creator_program', p.id, jsonb_build_object('terms_version', p.terms_version));
  end if;
end $$;

-- Overview + roster. Participants appear by display name and business name only; nothing from their
-- estimates beyond what they chose to share.
create or replace function public.creator_dashboard(p_program_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.creator_programs;
begin
  p := public.creator_require_program(p_program_id);
  return jsonb_build_object(
    'program', jsonb_build_object('id', p.id, 'workspace_name', p.workspace_name, 'channel_name', p.channel_name,
      'gift_allowance', p.gift_allowance, 'seats_used', public.creator_seats_used(p.id), 'starts_at', p.starts_at,
      'expires_at', p.expires_at, 'creator_confirmed_at', p.creator_confirmed_at, 'terms_version', p.terms_version),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'email', g.email, 'display_name', g.display_name, 'state', public.creator_gift_state(g),
        'invited_at', g.invited_at, 'invite_expires_at', g.invite_expires_at, 'claimed_at', g.claimed_at,
        'business_name', case when g.claimed_user_id is not null then (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = g.claimed_user_id) end,
        'primary_trade', case when g.claimed_user_id is not null then (select nullif(bp.primary_trade, '') from public.business_profiles bp where bp.user_id = g.claimed_user_id) end,
        'last_engagement', case when g.claimed_user_id is not null then greatest(
            (select max(s.updated_at) from public.mentorship_shares s where s.program_id = p.id and s.participant_user_id = g.claimed_user_id),
            (select max(mc.created_at) from public.mentorship_comments mc join public.mentorship_shares s on s.id = mc.share_id
              where s.program_id = p.id and mc.author_id = g.claimed_user_id)) end,
        'shared_count', (select count(*) from public.mentorship_shares s where s.program_id = p.id and s.participant_user_id = g.claimed_user_id and s.revoked_at is null),
        'consent', (select jsonb_build_object('allow_comments', c.allow_comments, 'allow_suggestions', c.allow_suggestions, 'share_pipeline_summary', c.share_pipeline_summary)
                    from public.mentorship_consents c where c.program_id = p.id and c.participant_user_id = g.claimed_user_id)
      ) order by g.created_at desc) from public.creator_gifts g where g.program_id = p.id and g.revoked_at is null), '[]'),
    'shares_awaiting_review', (select count(*) from public.mentorship_shares s where s.program_id = p.id and s.revoked_at is null
        and public.mentorship_is_participant(p.id, s.participant_user_id)
        and not exists (select 1 from public.mentorship_comments mc where mc.share_id = s.id and mc.author_id = p.creator_user_id)),
    'comments_30d', (select count(*) from public.mentorship_comments mc join public.mentorship_shares s on s.id = mc.share_id
        where s.program_id = p.id and mc.created_at > now() - interval '30 days')
  );
end $$;

-- Invite a subscriber. The token hash is generated server-side; the raw token only goes into the link.
-- Capacity is checked under a row lock on the program, so two invites can never take the last seat.
create or replace function public.creator_invite_gift(p_program_id uuid, p_email text, p_display_name text, p_token_hash text, p_replaces uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs; g public.creator_gifts; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  p := public.creator_require_program(p_program_id);
  if p.creator_confirmed_at is null then raise exception 'confirm_terms_first' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token' using errcode = '22023'; end if;
  if v_email = p.creator_email then raise exception 'cannot_gift_self' using errcode = 'P0001'; end if;
  select * into p from public.creator_programs where id = p.id for update;
  if public.creator_seats_used(p.id) >= p.gift_allowance then raise exception 'no_seats' using errcode = 'P0001'; end if;
  -- Anti-loop: someone who already had a gift in this program that was claimed and then removed
  -- can't be re-gifted in the same program (a fresh gift would otherwise look like a "new" seat).
  if exists (select 1 from public.creator_gifts x where x.program_id = p.id and x.email = v_email and x.claimed_at is not null) then
    raise exception 'already_gifted' using errcode = 'P0001';
  end if;
  -- Throttle: at most 3x the allowance in invitations per program, and 20 per day.
  if (select count(*) from public.creator_gifts x where x.program_id = p.id) >= greatest(p.gift_allowance * 3, 10) then
    raise exception 'invite_limit' using errcode = 'P0001';
  end if;
  if (select count(*) from public.creator_gifts x where x.program_id = p.id and x.created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  begin
    insert into public.creator_gifts (program_id, email, display_name, invite_token_hash, invite_expires_at, invited_by, replaces_gift_id)
    values (p.id, v_email, nullif(btrim(p_display_name), ''), p_token_hash, least(now() + interval '30 days', p.expires_at), auth.uid(),
            (select x.id from public.creator_gifts x where x.id = p_replaces and x.program_id = p.id and x.revoked_at is not null))
    returning * into g;
  exception when unique_violation then raise exception 'already_invited' using errcode = 'P0001';
  end;
  perform public.creator_audit(auth.uid(), 'creator_gift.invite', 'creator_gift', g.id, jsonb_build_object('program_id', p.id, 'email', v_email));
  return jsonb_build_object('id', g.id, 'email', g.email, 'state', public.creator_gift_state(g), 'invite_expires_at', g.invite_expires_at);
end $$;

-- Rotate an unclaimed invitation's link (old link stops working). Never extends past the program.
create or replace function public.creator_rotate_gift(p_gift_id uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.creator_gifts; p public.creator_programs;
begin
  select * into g from public.creator_gifts where id = p_gift_id for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  p := public.creator_require_program(g.program_id);
  if g.claimed_at is not null or g.revoked_at is not null then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token' using errcode = '22023'; end if;
  if g.invite_expires_at <= now() then
    select * into p from public.creator_programs where id = p.id for update;
    if public.creator_seats_used(p.id) >= p.gift_allowance then raise exception 'no_seats' using errcode = 'P0001'; end if;
  end if;
  update public.creator_gifts set invite_token_hash = p_token_hash, invite_expires_at = least(now() + interval '30 days', p.expires_at)
    where id = g.id returning * into g;
  perform public.creator_audit(auth.uid(), 'creator_gift.rotate', 'creator_gift', g.id, null);
  return jsonb_build_object('id', g.id, 'state', public.creator_gift_state(g), 'invite_expires_at', g.invite_expires_at);
end $$;

create or replace function public.creator_record_gift_sent(p_gift_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.creator_gifts;
begin
  select * into g from public.creator_gifts where id = p_gift_id;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.creator_require_program(g.program_id);
  update public.creator_gifts set invite_sent_at = now() where id = g.id;
end $$;

-- Remove a participant / cancel an invitation. Frees the seat. The participant keeps their account and
-- every record; only their complimentary Unlimited (and this program's mentorship sharing) ends.
-- The creator gains no access of any kind by doing this.
create or replace function public.creator_revoke_gift(p_gift_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.creator_gifts; p public.creator_programs;
begin
  select * into g from public.creator_gifts where id = p_gift_id for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  p := public.creator_require_program(g.program_id);
  if g.revoked_at is not null then return jsonb_build_object('id', g.id, 'state', 'revoked'); end if;
  update public.creator_gifts set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = nullif(btrim(left(p_reason, 300)), ''), invite_token_hash = null
    where id = g.id returning * into g;
  if g.comp_grant_id is not null then
    update public.complimentary_grants set status = 'revoked', paused_at = null, revoked_at = now(), revoked_by = auth.uid(),
      revoke_reason = 'Removed from creator program', invite_token_hash = null
      where id = g.comp_grant_id and status <> 'revoked';
    perform public.comp_audit(auth.uid(), 'comp.revoke', g.comp_grant_id, jsonb_build_object('reason', 'creator_gift_removed', 'program_id', p.id));
  end if;
  update public.mentorship_shares set revoked_at = now() where program_id = p.id and participant_user_id = g.claimed_user_id and revoked_at is null;
  perform public.creator_audit(auth.uid(), 'creator_gift.revoke', 'creator_gift', g.id, jsonb_build_object('program_id', p.id, 'was_claimed', g.claimed_at is not null));
  return jsonb_build_object('id', g.id, 'state', 'revoked');
end $$;

-- Shares the creator may see: active participant + open share.
create or replace function public.creator_shares(p_program_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.creator_programs;
begin
  p := public.creator_require_program(p_program_id);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'shared_at', s.shared_at, 'updated_at', s.updated_at,
      'participant', coalesce((select nullif(g.display_name, '') from public.creator_gifts g where g.program_id = p.id and g.claimed_user_id = s.participant_user_id and g.revoked_at is null),
                              (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = s.participant_user_id), 'Participant'),
      'business_name', (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = s.participant_user_id),
      'title', case when s.share_project_info then (select e.title from public.estimates e where e.id = s.estimate_id) end,
      'trades', (select e.trades from public.estimates e where e.id = s.estimate_id),
      'share_costs', s.share_costs, 'share_margin', s.share_margin, 'share_project_info', s.share_project_info,
      'total', s.proposal_snapshot -> 'total',
      'comment_count', (select count(*) from public.mentorship_comments mc where mc.share_id = s.id),
      'reviewed', exists (select 1 from public.mentorship_comments mc where mc.share_id = s.id and mc.author_id = p.creator_user_id)
    ) order by s.updated_at desc)
    from public.mentorship_shares s
    where s.program_id = p.id and s.revoked_at is null and public.mentorship_is_participant(p.id, s.participant_user_id)), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Shared view of one estimate (creator or the participant). Redaction happens HERE.
-- Never included: customer name/email/phone, project address, customer notes, customer_id, internal
-- item notes, or any other estimate of the participant.
-- ---------------------------------------------------------------------------
create or replace function public.mentorship_share_view(p_share_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.mentorship_shares; p public.creator_programs; e public.estimates; v_is_creator boolean; c public.mentorship_consents;
begin
  select * into s from public.mentorship_shares where id = p_share_id;
  if not found or auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.creator_programs where id = s.program_id;
  v_is_creator := p.creator_user_id = auth.uid();
  if not v_is_creator and s.participant_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_is_creator then
    if s.revoked_at is not null or public.creator_program_state(p) <> 'active' or not public.mentorship_is_participant(p.id, s.participant_user_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  select * into e from public.estimates where id = s.estimate_id and user_id = s.participant_user_id;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.mentorship_consents where program_id = p.id and participant_user_id = s.participant_user_id;

  return jsonb_build_object(
    'id', s.id, 'program_id', p.id, 'workspace_name', p.workspace_name, 'viewer', case when v_is_creator then 'creator' else 'participant' end,
    'revoked', s.revoked_at is not null,
    'permissions', jsonb_build_object('proposal', true, 'costs', s.share_costs, 'margin', s.share_margin, 'project_info', s.share_project_info,
      'comments', coalesce(c.allow_comments, false), 'suggestions', coalesce(c.allow_suggestions, false)),
    'business_name', (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = s.participant_user_id),
    'trades', e.trades,
    'project', case when s.share_project_info then jsonb_build_object('title', e.title, 'estimate_date', e.estimate_date,
        'city', e.location_city, 'state', e.location_state, 'pipeline_stage', e.pipeline_stage) end,
    'totals', s.proposal_snapshot,
    'pricing', case when s.share_margin then jsonb_build_object('mode', e.pricing_mode, 'percent', e.pricing_percent,
        'fixed_adjustment', e.fixed_adjustment, 'tax_rate', e.tax_rate) end,
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'name', gr.name, 'description', gr.description,
        'pricing', case when s.share_margin and gr.pricing_mode is not null then jsonb_build_object('mode', gr.pricing_mode, 'percent', gr.pricing_percent) end,
        'items', coalesce((select jsonb_agg(
            jsonb_build_object('id', it.id, 'name', it.name, 'description', case when it.show_on_proposal then it.description end, 'unit', it.unit,
              'on_proposal', it.show_on_proposal)
            || case when s.share_costs then jsonb_build_object('quantity', it.quantity, 'unit_cost', it.unit_cost, 'cost_type', it.cost_type, 'treatment', it.treatment) else '{}'::jsonb end
            || case when s.share_margin and it.pricing_mode is not null then jsonb_build_object('pricing', jsonb_build_object('mode', it.pricing_mode, 'percent', it.pricing_percent)) else '{}'::jsonb end
            order by it.sort_order)
          from public.estimate_items it where it.group_id = gr.id and it.estimate_id = e.id
            and (it.show_on_proposal or s.share_costs)), '[]')
      ) order by gr.sort_order) from public.estimate_groups gr where gr.estimate_id = e.id), '[]'),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', mc.id, 'kind', mc.kind, 'body', mc.body, 'created_at', mc.created_at,
        'resolved_at', mc.resolved_at, 'from', case when mc.author_id = p.creator_user_id then 'creator' when mc.author_id = s.participant_user_id then 'participant' else 'other' end)
        order by mc.created_at) from public.mentorship_comments mc where mc.share_id = s.id), '[]')
  );
end $$;

-- Comment (creator: needs allow_comments; suggestion: needs allow_suggestions). Participants can always
-- reply on their own shares. Suggestions are text only: nothing ever edits the participant's estimate.
create or replace function public.mentorship_add_comment(p_share_id uuid, p_kind text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.mentorship_shares; p public.creator_programs; c public.mentorship_consents; v_id uuid;
begin
  select * into s from public.mentorship_shares where id = p_share_id;
  if not found or auth.uid() is null or s.revoked_at is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.creator_programs where id = s.program_id;
  if p_kind not in ('comment', 'suggestion') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'invalid_body' using errcode = '22023'; end if;
  if public.creator_program_state(p) <> 'active' or not public.mentorship_is_participant(p.id, s.participant_user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into c from public.mentorship_consents where program_id = p.id and participant_user_id = s.participant_user_id;
  if auth.uid() = p.creator_user_id then
    if p_kind = 'comment' and not coalesce(c.allow_comments, false) then raise exception 'comments_off' using errcode = '42501'; end if;
    if p_kind = 'suggestion' and not coalesce(c.allow_suggestions, false) then raise exception 'suggestions_off' using errcode = '42501'; end if;
    if (select count(*) from public.mentorship_comments where author_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  elsif auth.uid() = s.participant_user_id then
    if p_kind <> 'comment' then raise exception 'invalid_kind' using errcode = '22023'; end if;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.mentorship_comments (share_id, author_id, kind, body) values (s.id, auth.uid(), p_kind, btrim(p_body)) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Participant marks a comment/suggestion handled.
create or replace function public.mentorship_resolve_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.mentorship_comments mc set resolved_at = coalesce(mc.resolved_at, now())
  from public.mentorship_shares s
  where mc.id = p_comment_id and s.id = mc.share_id and s.participant_user_id = auth.uid();
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- Aggregate pipeline coaching data. Counts only: no customer names, addresses, contacts or amounts.
create or replace function public.creator_pipeline_summary(p_program_id uuid, p_gift_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.creator_programs; g public.creator_gifts; c public.mentorship_consents;
begin
  p := public.creator_require_program(p_program_id);
  select * into g from public.creator_gifts where id = p_gift_id and program_id = p.id;
  if not found or g.claimed_user_id is null or not public.mentorship_is_participant(p.id, g.claimed_user_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.mentorship_consents where program_id = p.id and participant_user_id = g.claimed_user_id;
  if not coalesce(c.share_pipeline_summary, false) then raise exception 'not_shared' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'by_stage', coalesce((select jsonb_object_agg(stage, n) from (
          select e.pipeline_stage as stage, count(*) as n from public.estimates e
          where e.user_id = g.claimed_user_id and e.status <> 'archived' group by e.pipeline_stage) x), '{}'),
      'sent_90d', (select count(*) from public.estimates e where e.user_id = g.claimed_user_id and e.pipeline_stage not in ('draft', 'ready_for_review', 'approved') and e.updated_at > now() - interval '90 days'),
      'won_90d', (select count(*) from public.estimates e where e.user_id = g.claimed_user_id and e.won_at > now() - interval '90 days'),
      'lost_90d', (select count(*) from public.estimates e where e.user_id = g.claimed_user_id and e.pipeline_stage = 'lost' and e.stage_changed_at > now() - interval '90 days'),
      'created_90d', (select count(*) from public.estimates e where e.user_id = g.claimed_user_id and e.created_at > now() - interval '90 days')
    ));
end $$;

create or replace function public.creator_save_resource(p_program_id uuid, p_id uuid, p_kind text, p_title text, p_url text, p_body text, p_checklist jsonb, p_sort integer default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs; v_id uuid;
begin
  p := public.creator_require_program(p_program_id);
  if (select count(*) from public.creator_resources where program_id = p.id) >= 100 and p_id is null then raise exception 'too_many' using errcode = 'P0001'; end if;
  begin
    if p_id is null then
      insert into public.creator_resources (program_id, kind, title, url, body, checklist, sort_order)
      values (p.id, p_kind, btrim(p_title), nullif(btrim(p_url), ''), nullif(btrim(p_body), ''), p_checklist, coalesce(p_sort, 0)) returning id into v_id;
    else
      update public.creator_resources set kind = p_kind, title = btrim(p_title), url = nullif(btrim(p_url), ''), body = nullif(btrim(p_body), ''),
        checklist = p_checklist, sort_order = coalesce(p_sort, 0)
        where id = p_id and program_id = p.id returning id into v_id;
      if v_id is null then raise exception 'forbidden' using errcode = '42501'; end if;
    end if;
  exception when check_violation then raise exception 'invalid_resource' using errcode = '22023';
  end;
  return v_id;
end $$;

create or replace function public.creator_delete_resource(p_program_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.creator_programs;
begin
  p := public.creator_require_program(p_program_id);
  delete from public.creator_resources where id = p_id and program_id = p.id;
end $$;

-- Resources: the creator, and the program's active participants.
create or replace function public.program_resources(p_program_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.creator_programs;
begin
  select * into p from public.creator_programs where id = p_program_id;
  if not found or auth.uid() is null or public.creator_program_state(p) <> 'active'
     or not (p.creator_user_id = auth.uid() or public.mentorship_is_participant(p.id, auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'url', r.url, 'body', r.body,
      'checklist', r.checklist, 'sort_order', r.sort_order) order by r.sort_order, r.created_at)
    from public.creator_resources r where r.program_id = p.id), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Gift claim (subscriber)
-- ---------------------------------------------------------------------------
-- Public, token-only preview for the claim page (creator workspace name and the invited email hint).
create or replace function public.creator_gift_preview(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when g.id is null then jsonb_build_object('ok', false, 'reason', 'invalid') else jsonb_build_object(
    'ok', public.creator_gift_state(g) = 'invited' and public.creator_program_active(g.program_id),
    'reason', case when public.creator_gift_state(g) = 'invite_expired' then 'invite_expired'
                   when public.creator_gift_state(g) = 'revoked' then 'revoked'
                   when not public.creator_program_active(g.program_id) then 'program_inactive' end,
    'workspace_name', p.workspace_name, 'channel_name', p.channel_name, 'program_expires_at', p.expires_at,
    'email_hint', left(g.email, 1) || '***' || substr(g.email, position('@' in g.email))) end
  from (select 1) one
  left join public.creator_gifts g on g.invite_token_hash = p_token_hash
  left join public.creator_programs p on p.id = g.program_id
$$;

create or replace function public.claim_creator_gift(p_user_id uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.creator_gifts; p public.creator_programs; v_email text; v_grant uuid; v_paid boolean;
begin
  if p_user_id is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into g from public.creator_gifts where invite_token_hash = p_token_hash for update;
  if not found then
    -- Already used? Tell the rightful owner it's on; tell everyone else nothing (replay-safe).
    if exists (select 1 from public.creator_gifts x where x.claimed_user_id = p_user_id and public.creator_gift_state(x) = 'active') then
      return jsonb_build_object('ok', true, 'state', 'active', 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if g.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if g.invite_expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'invite_expired'); end if;
  select * into p from public.creator_programs where id = g.program_id;
  if public.creator_program_state(p) <> 'active' then return jsonb_build_object('ok', false, 'reason', 'program_inactive'); end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id and u.email is not null and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'email_unverified'); end if;
  if v_email <> g.email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch', 'hint', left(g.email, 1) || '***' || substr(g.email, position('@' in g.email)));
  end if;
  if p_user_id = p.creator_user_id then return jsonb_build_object('ok', false, 'reason', 'cannot_gift_self'); end if;
  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  if exists (select 1 from public.creator_gifts x where x.claimed_user_id = p_user_id and x.revoked_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'already_gifted');
  end if;
  if exists (select 1 from public.complimentary_grants x where x.email = v_email and public.comp_grant_state(x) in ('pending', 'active', 'scheduled', 'paused')) then
    return jsonb_build_object('ok', false, 'reason', 'already_complimentary');
  end if;
  v_paid := public.has_paid_subscription(p_user_id);
  -- The subscriber's own Unlimited grant. Never touches Stripe. Capped to the program end by trigger.
  insert into public.complimentary_grants (email, user_id, plan, duration_days, included_seats, extra_seats, status, starts_at, expires_at,
                                           activated_at, had_paid_subscription, note, granted_by, creator_program_id, creator_gift_id)
  values (v_email, p_user_id, 'unlimited', greatest(1, least(730, ceil(extract(epoch from (p.expires_at - now())) / 86400)::integer)), 1, 0,
          'active', now(), p.expires_at, now(), v_paid, left('Creator gift: ' || p.workspace_name, 500), p.creator_user_id, p.id, g.id)
  returning id into v_grant;
  update public.creator_gifts set claimed_user_id = p_user_id, claimed_at = now(), invite_token_hash = null, comp_grant_id = v_grant where id = g.id;
  insert into public.mentorship_consents (program_id, participant_user_id) values (p.id, p_user_id) on conflict do nothing;
  perform public.comp_audit(p_user_id, 'comp.activate', v_grant, jsonb_build_object('plan', 'unlimited', 'source', 'creator_gift', 'program_id', p.id, 'had_paid_subscription', v_paid));
  perform public.creator_audit(p_user_id, 'creator_gift.claim', 'creator_gift', g.id, jsonb_build_object('program_id', p.id));
  return jsonb_build_object('ok', true, 'state', 'active', 'expires_at', p.expires_at, 'workspace_name', p.workspace_name);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Participant functions (the subscriber controls everything here)
-- ---------------------------------------------------------------------------
create or replace function public.my_mentorship() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'program_id', p.id, 'workspace_name', p.workspace_name, 'channel_name', p.channel_name,
      'state', public.creator_gift_state(g), 'program_state', public.creator_program_state(p),
      'expires_at', (select c.expires_at from public.complimentary_grants c where c.id = g.comp_grant_id),
      'consent', (select jsonb_build_object('allow_comments', mc.allow_comments, 'allow_suggestions', mc.allow_suggestions, 'share_pipeline_summary', mc.share_pipeline_summary)
                  from public.mentorship_consents mc where mc.program_id = p.id and mc.participant_user_id = auth.uid()),
      'shares', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'estimate_id', s.estimate_id, 'share_costs', s.share_costs,
          'share_margin', s.share_margin, 'share_project_info', s.share_project_info, 'shared_at', s.shared_at,
          'title', (select e.title from public.estimates e where e.id = s.estimate_id),
          'unread', (select count(*) from public.mentorship_comments x where x.share_id = s.id and x.author_id <> auth.uid() and x.resolved_at is null))
          order by s.updated_at desc)
        from public.mentorship_shares s where s.program_id = p.id and s.participant_user_id = auth.uid() and s.revoked_at is null), '[]')
    ) order by g.claimed_at desc), '[]')
  from public.creator_gifts g join public.creator_programs p on p.id = g.program_id
  where auth.uid() is not null and g.claimed_user_id = auth.uid()
    and (g.revoked_at is null or g.revoked_at > now() - interval '90 days')
$$;

create or replace function public.set_mentorship_consent(p_program_id uuid, p_allow_comments boolean, p_allow_suggestions boolean, p_share_pipeline boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.mentorship_is_participant(p_program_id, auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.mentorship_consents (program_id, participant_user_id, allow_comments, allow_suggestions, share_pipeline_summary, updated_at)
  values (p_program_id, auth.uid(), coalesce(p_allow_comments, false), coalesce(p_allow_suggestions, false), coalesce(p_share_pipeline, false), now())
  on conflict (program_id, participant_user_id) do update set allow_comments = excluded.allow_comments,
    allow_suggestions = excluded.allow_suggestions, share_pipeline_summary = excluded.share_pipeline_summary, updated_at = now();
  perform public.creator_audit(auth.uid(), 'mentorship.consent', 'creator_program', p_program_id,
    jsonb_build_object('comments', p_allow_comments, 'suggestions', p_allow_suggestions, 'pipeline', p_share_pipeline));
end $$;

-- Share (or update the permissions of) one of MY estimates with a program I belong to.
create or replace function public.share_estimate_for_mentorship(p_program_id uuid, p_estimate_id uuid, p_costs boolean, p_margin boolean, p_project_info boolean, p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_snap jsonb;
begin
  if auth.uid() is null or not public.mentorship_is_participant(p_program_id, auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Only known numeric total fields are kept from the snapshot.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_snap from jsonb_each(coalesce(p_snapshot, '{}'::jsonb)) as x(k, v)
    where k in ('subtotal', 'tax', 'total', 'adjustment') and jsonb_typeof(v) in ('number', 'string') and char_length(v::text) <= 32;
  update public.mentorship_shares set share_costs = coalesce(p_costs, false), share_margin = coalesce(p_margin, false),
    share_project_info = coalesce(p_project_info, false), proposal_snapshot = v_snap
    where program_id = p_program_id and estimate_id = p_estimate_id and revoked_at is null returning id into v_id;
  if v_id is null then
    if (select count(*) from public.mentorship_shares where participant_user_id = auth.uid() and revoked_at is null) >= 50 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
    insert into public.mentorship_shares (program_id, participant_user_id, estimate_id, share_costs, share_margin, share_project_info, proposal_snapshot)
    values (p_program_id, auth.uid(), p_estimate_id, coalesce(p_costs, false), coalesce(p_margin, false), coalesce(p_project_info, false), v_snap)
    returning id into v_id;
  end if;
  perform public.creator_audit(auth.uid(), 'mentorship.share', 'mentorship_share', v_id,
    jsonb_build_object('costs', p_costs, 'margin', p_margin, 'project_info', p_project_info));
  return v_id;
end $$;

create or replace function public.revoke_mentorship_share(p_share_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.mentorship_shares set revoked_at = now() where id = p_share_id and participant_user_id = auth.uid() and revoked_at is null;
  if found then perform public.creator_audit(auth.uid(), 'mentorship.unshare', 'mentorship_share', p_share_id, null); end if;
end $$;

-- Open shares for one of my estimates (to render the share control on the bid).
create or replace function public.my_estimate_shares(p_estimate_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'program_id', s.program_id, 'share_costs', s.share_costs, 'share_margin', s.share_margin,
      'share_project_info', s.share_project_info)), '[]')
  from public.mentorship_shares s where s.estimate_id = p_estimate_id and s.participant_user_id = auth.uid() and s.revoked_at is null
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges
-- ---------------------------------------------------------------------------
do $do$
declare f text;
begin
  -- Service role only (server after requireAdmin(), or internal helpers).
  foreach f in array array[
    'public.creator_program_state(public.creator_programs)',
    'public.creator_program_active(uuid)',
    'public.creator_gift_state(public.creator_gifts)',
    'public.creator_seats_used(uuid)',
    'public.creator_require_program(uuid)',
    'public.mentorship_is_participant(uuid, uuid)',
    'public.creator_audit(uuid, text, text, uuid, jsonb)',
    'public.creator_program_sync(uuid)',
    'public.creator_grant_changed()',
    'public.creator_gift_grant_cap()',
    'public.mentorship_share_guard()',
    'public.creator_program_row(public.creator_programs)',
    'public.admin_creator_program_create(uuid, text, text, text, text, integer, uuid)',
    'public.admin_creator_program_record_terms(uuid, uuid, text, text)',
    'public.admin_creator_program_provision(uuid, uuid, text)',
    'public.admin_creator_program_set_allowance(uuid, uuid, integer)',
    'public.admin_creator_program_end(uuid, uuid, text, boolean, boolean)',
    'public.admin_creator_programs(uuid)',
    'public.admin_creator_program_detail(uuid, uuid)',
    'public.claim_creator_gift(uuid, text)',
    'public.creator_gift_preview(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Signed-in customers; each checks auth.uid() itself.
  foreach f in array array[
    'public.my_creator_programs()',
    'public.creator_confirm_terms(uuid)',
    'public.creator_dashboard(uuid)',
    'public.creator_invite_gift(uuid, text, text, text, uuid)',
    'public.creator_rotate_gift(uuid, text)',
    'public.creator_record_gift_sent(uuid)',
    'public.creator_revoke_gift(uuid, text)',
    'public.creator_shares(uuid)',
    'public.mentorship_share_view(uuid)',
    'public.mentorship_add_comment(uuid, text, text)',
    'public.mentorship_resolve_comment(uuid)',
    'public.creator_pipeline_summary(uuid, uuid)',
    'public.creator_save_resource(uuid, uuid, text, text, text, text, jsonb, integer)',
    'public.creator_delete_resource(uuid, uuid)',
    'public.program_resources(uuid)',
    'public.my_mentorship()',
    'public.set_mentorship_consent(uuid, boolean, boolean, boolean)',
    'public.share_estimate_for_mentorship(uuid, uuid, boolean, boolean, boolean, jsonb)',
    'public.revoke_mentorship_share(uuid)',
    'public.my_estimate_shares(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
