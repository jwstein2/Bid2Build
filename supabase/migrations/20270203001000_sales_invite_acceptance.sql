-- V8.9 + V8.10: sales invitations accepted by token, and one account with several workspaces.
--
-- Root cause this fixes (production logs, 2026-11-19): the invited rep's account WAS linked (by email, in
-- sales_me) and the Sales Hub loaded, but every other path after sign-in (the main log in, the site
-- header, auth links) defaulted to the contractor dashboard, with nothing pointing back. The invite link
-- itself was never tied to the account, so signing in with any other email silently failed.
--
-- 1. sales_invite_accept: the signed-in, verified person presents the invite token (only its SHA-256
--    hash reaches the database). The server checks the invite record and links the rep. Idempotent.
-- 2. sales_me: email auto-linking now respects revoked and expired invites.
-- 3. account_preferences + my_workspaces + set_my_workspace: which workspaces a person may open (sales
--    rep hub, admin sales hub, contractor dashboard), the last one used and their preferred landing.
--
-- Safe to run more than once. Nothing here changes prices, plans, subscriptions or commissions.

-- ---------------------------------------------------------------------------------------------------
-- 1. Accepting an invite
-- ---------------------------------------------------------------------------------------------------
alter table public.sales_rep_invites add column if not exists accepted_by uuid references auth.users (id) on delete set null;
alter table public.sales_rep_invites add column if not exists accepted_email text;

create or replace function public.sales_invite_accept(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv public.sales_rep_invites;
  rep public.sales_reps;
  v_uid uuid := auth.uid();
  v_email text; v_confirmed timestamptz;
  v_match boolean;
begin
  if v_uid is null then return jsonb_build_object('status', 'signed_out'); end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('status', 'not_found'); end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then return jsonb_build_object('status', 'unverified'); end if;

  select * into inv from public.sales_rep_invites where token_hash = lower(p_token_hash) for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into rep from public.sales_reps where id = inv.rep_id for update;

  -- Clicking the invite again after joining: just open the hub.
  if rep.user_id = v_uid then
    return jsonb_build_object('status', case when rep.status = 'active' then 'already_member' else rep.status end, 'rep_id', rep.id, 'sells', rep.sells, 'role', rep.role);
  end if;
  if rep.user_id is not null or inv.accepted_at is not null then return jsonb_build_object('status', 'accepted'); end if;
  if inv.revoked_at is not null or rep.status in ('removed', 'suspended') then return jsonb_build_object('status', 'revoked'); end if;
  if inv.expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
  -- One person, one team record: an account that already belongs to another team record can't take a second one.
  if exists (select 1 from public.sales_reps where user_id = v_uid) then return jsonb_build_object('status', 'other_record'); end if;

  v_match := v_email = rep.email;
  -- A Sales Administrator invite only opens for the exact invited email (privileged role).
  if rep.role = 'admin' and not v_match then return jsonb_build_object('status', 'email_mismatch', 'email_hint', regexp_replace(rep.email, '^(.)[^@]*(@.*)$', '\1•••\2')); end if;

  update public.sales_reps set user_id = v_uid, status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
  where id = rep.id returning * into rep;
  update public.sales_rep_invites set accepted_at = coalesce(accepted_at, now()), accepted_by = v_uid, accepted_email = v_email where id = inv.id;
  perform public.sales_audit(v_uid, 'sales.invite_accepted', 'sales_rep', rep.id::text,
    jsonb_build_object('invite', inv.id, 'email_matched', v_match, 'signed_in_email', case when v_match then null else v_email end));
  return jsonb_build_object('status', 'joined', 'rep_id', rep.id, 'sells', rep.sells, 'role', rep.role, 'email_matched', v_match);
end $$;

revoke execute on function public.sales_invite_accept(text) from public, anon;
grant execute on function public.sales_invite_accept(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2. Email auto-linking respects the invite's state
-- ---------------------------------------------------------------------------------------------------
-- Signing in with the exact invited email still links the record (people who never click the link, and
-- members the owner set up before invite links existed). It no longer links once every invite for that
-- member was revoked or has expired: the owner has to send a fresh one.
create or replace function public.sales_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rep public.sales_reps;
  v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select * into rep from public.sales_reps where user_id = auth.uid();
  if not found then
    select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
    if v_email is null or v_confirmed is null then return null; end if;
    update public.sales_reps r set user_id = auth.uid(), status = case when r.status = 'invited' then 'active' else r.status end,
      activated_at = coalesce(r.activated_at, now()), updated_at = now()
    where r.email = v_email and r.user_id is null and r.status in ('invited', 'active')
      and (not exists (select 1 from public.sales_rep_invites i where i.rep_id = r.id)
           or exists (select 1 from public.sales_rep_invites i where i.rep_id = r.id and i.revoked_at is null and i.accepted_at is null and i.expires_at >= now()))
    returning * into rep;
    if not found then return null; end if;
  end if;
  if rep.status not in ('active') then return jsonb_build_object('status', rep.status); end if;
  return jsonb_build_object('id', rep.id, 'full_name', rep.full_name, 'email', rep.email, 'role', rep.role, 'status', rep.status,
    'code', rep.code, 'sells', rep.sells);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Workspaces: one account, one login, several authorized workspaces
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.account_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 'auto' = open the workspace used last (or the only one the person has).
  landing text not null default 'auto' check (landing in ('auto', 'contractor', 'sales')),
  last_workspace text check (last_workspace in ('contractor', 'sales')),
  sales_view text check (sales_view in ('my', 'admin')),
  updated_at timestamptz not null default now()
);
alter table public.account_preferences enable row level security;
revoke all on public.account_preferences from public, anon, authenticated;
grant all on public.account_preferences to service_role;

-- What the signed-in person may open. Contractor access = they use the contractor platform: a bid, a
-- live subscription, an active company seat, or the platform owner. A new sales-only account has none.
create or replace function public.my_workspaces() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  caps text[];
  p public.account_preferences;
  v_contractor boolean;
begin
  if v_uid is null then return null; end if;
  caps := public.sales_capabilities(v_uid);
  select * into p from public.account_preferences where user_id = v_uid;
  v_contractor := public.is_admin(v_uid)
    or exists (select 1 from public.estimates e where e.user_id = v_uid)
    or exists (select 1 from public.subscriptions s where s.user_id = v_uid and s.status in ('active', 'trialing', 'past_due'))
    or exists (select 1 from public.company_members m where m.user_id = v_uid and m.status = 'active');
  return jsonb_build_object(
    'sales_my', 'view_own_leads' = any (caps),
    'sales_admin', 'view_admin_hub' = any (caps),
    'contractor', v_contractor,
    'landing', coalesce(p.landing, 'auto'),
    'last_workspace', p.last_workspace,
    'sales_view', p.sales_view);
end $$;

-- Records a switch or a landing preference. Only remembers; never grants anything. Every page checks again.
create or replace function public.set_my_workspace(p_last text default null, p_sales_view text default null, p_landing text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_last is not null and p_last not in ('contractor', 'sales') then raise exception 'invalid'; end if;
  if p_sales_view is not null and p_sales_view not in ('my', 'admin') then raise exception 'invalid'; end if;
  if p_landing is not null and p_landing not in ('auto', 'contractor', 'sales') then raise exception 'invalid'; end if;
  insert into public.account_preferences (user_id, landing, last_workspace, sales_view)
  values (v_uid, coalesce(p_landing, 'auto'), p_last, p_sales_view)
  on conflict (user_id) do update set
    landing = coalesce(p_landing, account_preferences.landing),
    last_workspace = coalesce(p_last, account_preferences.last_workspace),
    sales_view = coalesce(p_sales_view, account_preferences.sales_view),
    updated_at = now();
  return public.my_workspaces();
end $$;

revoke execute on function public.my_workspaces(), public.set_my_workspace(text, text, text) from public, anon;
grant execute on function public.my_workspaces(), public.set_my_workspace(text, text, text) to authenticated, service_role;
