-- Complimentary Access (platform owner admin, master prompt Part 14).
--
-- Platform admins can give a person free, time-limited Unlimited or Enterprise access by email.
--  * A grant never touches Stripe: no customer, subscription or charge is created, and paid
--    subscriptions are left exactly as they are. When a grant ends the person simply falls back to
--    whatever else they have (a paid plan, or the Free credits).
--  * Expiry is enforced inside Postgres: every entitlement check compares expires_at with now(), so
--    access ends on time without a cron job, a page refresh, or anything in the browser.
--  * New recipients get a pending grant; the clock starts when they activate (first verified sign-in
--    with that email, or the invitation link). Existing verified accounts start immediately.
--  * Invitation tokens are random 32-byte values; only their SHA-256 hash is stored, a token is single
--    use, and it stops working when the invitation expires, is resent (rotated) or the grant is revoked.
--  * Everything an admin does goes through the admin_comp_* functions below, which re-check
--    is_admin(caller) and write audit_logs in the same transaction. Only the service role (the server,
--    after requireAdmin()) can execute them; customers, including Enterprise company admins, cannot.
--
-- Shared contract with the Enterprise migration (20261114005000_enterprise_workspace.sql): that
-- migration reads user_id, company_id, plan, status, starts_at, expires_at, extra_seats from this
-- table, with "active" = status = 'active' and starts_at <= now() and expires_at > now(). Keep those
-- names. company_id is a plain uuid here; the Enterprise migration adds the foreign key.
--
-- Safe to run more than once, and safe to run before or after the Enterprise migration.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.complimentary_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  -- Set when the grant is activated. Kept (set null) if the account is deleted so history survives.
  user_id uuid references auth.users (id) on delete set null,
  plan text not null check (plan in ('unlimited', 'enterprise')),
  -- Length of the complimentary period; the clock starts at activation.
  duration_days integer not null check (duration_days between 1 and 730),
  -- Licensed users included: 1 for Unlimited, 3 for Enterprise (admin + two team members).
  included_seats integer not null default 1 check (included_seats between 1 and 3),
  -- Extra complimentary Enterprise seats, only ever set by a platform admin.
  extra_seats integer not null default 0 check (extra_seats between 0 and 50),
  company_id uuid,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'revoked')),
  starts_at timestamptz,
  expires_at timestamptz,
  paused_at timestamptz,
  activated_at timestamptz,
  invite_token_hash text unique check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  invite_sent_at timestamptz,
  invite_send_count integer not null default 0,
  -- Snapshot at activation: did they already pay? Separates "converted" from "already a customer".
  had_paid_subscription boolean not null default false,
  note text check (char_length(note) <= 500),
  granted_by uuid references auth.users (id) on delete set null,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (char_length(revoke_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complimentary_grants_plan_seats check (
    (plan = 'unlimited' and included_seats = 1 and extra_seats = 0 and company_id is null)
    or (plan = 'enterprise' and included_seats = 3)
  ),
  constraint complimentary_grants_dates check (
    status not in ('active', 'paused')
    or (starts_at is not null and expires_at is not null and expires_at > starts_at)
  ),
  constraint complimentary_grants_paused check ((status = 'paused') = (paused_at is not null))
);

create index if not exists complimentary_grants_user_idx on public.complimentary_grants (user_id, status, expires_at);
create index if not exists complimentary_grants_email_idx on public.complimentary_grants (email, status);
create index if not exists complimentary_grants_company_idx on public.complimentary_grants (company_id) where company_id is not null;
create index if not exists complimentary_grants_created_idx on public.complimentary_grants (created_at desc);

drop trigger if exists complimentary_grants_updated_at on public.complimentary_grants;
create trigger complimentary_grants_updated_at before update on public.complimentary_grants
  for each row execute function public.set_updated_at();

-- No policies: nobody reads or writes this table directly except the service role. Signed-in users
-- see their own grant through my_comp_access(), which never returns the invitation token hash.
alter table public.complimentary_grants enable row level security;
revoke all on public.complimentary_grants from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. State and entitlement
-- ---------------------------------------------------------------------------
-- Display state, derived from the stored status and the clock:
--   revoked | paused | pending | invite_expired | scheduled | active | expired
create or replace function public.comp_grant_state(g public.complimentary_grants) returns text
language sql stable set search_path = public as $$
  select case
    when g.status = 'revoked' then 'revoked'
    when g.status = 'paused' then 'paused'
    when g.status = 'pending' then case when g.invite_expires_at is not null and g.invite_expires_at <= now() then 'invite_expired' else 'pending' end
    when g.starts_at > now() then 'scheduled'
    when g.expires_at > now() then 'active'
    else 'expired'
  end
$$;

-- The grant currently giving this user access, or null. THE activeness rule; keep in sync with the
-- Enterprise migration's reader.
create or replace function public.active_comp_grant(p_user_id uuid) returns public.complimentary_grants
language sql stable security definer set search_path = public as $$
  select g.* from public.complimentary_grants g
  where p_user_id is not null and g.user_id = p_user_id
    and g.status = 'active' and g.starts_at <= now() and g.expires_at > now()
  order by (g.plan = 'enterprise') desc, g.expires_at desc
  limit 1
$$;

-- Stripe-only view of "is paying": used to snapshot conversions and by checkout (via the server).
create or replace function public.has_paid_subscription(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  )
$$;

-- has_unlimited now also honours an active complimentary grant (either plan). credit_status,
-- finalize_bid and library_access all call it, so comp users get unlimited bids, Saved Items and
-- Proposal Templates, and lose them the moment the grant ends.
-- If the Enterprise migration already ran it owns has_unlimited (via user_entitlement(), which reads
-- this table itself), so leave its definition alone.
do $do$ begin
  if to_regprocedure('public.user_entitlement(uuid)') is null then
    execute $f$
      create or replace function public.has_unlimited(p_user_id uuid) returns boolean
      language sql stable security definer set search_path = public as $b$
        select public.has_paid_subscription(p_user_id)
          or (public.active_comp_grant(p_user_id)).id is not null
      $b$
    $f$;
  end if;
end $do$;

-- The signed-in user's own complimentary access (current grant, else the most recent one that
-- ended in the last 90 days so the app can say "your complimentary access ended on ...").
create or replace function public.my_comp_access()
returns table (plan text, state text, starts_at timestamptz, expires_at timestamptz, included_seats integer, extra_seats integer, has_paid_subscription boolean)
language sql stable security definer set search_path = public as $$
  select g.plan, public.comp_grant_state(g), g.starts_at, g.expires_at, g.included_seats, g.extra_seats,
         public.has_paid_subscription(auth.uid())
  from public.complimentary_grants g
  where auth.uid() is not null and g.user_id = auth.uid() and g.status in ('active', 'paused', 'revoked')
    and g.starts_at is not null
    and (g.status <> 'revoked' or g.revoked_at > now() - interval '90 days')
    and (g.expires_at > now() - interval '90 days')
  order by (public.comp_grant_state(g) = 'active') desc, g.expires_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3. Activation
-- ---------------------------------------------------------------------------
-- Internal: start a pending grant for a user. Caller has locked the row.
create or replace function public.comp_activate(p_grant_id uuid, p_user_id uuid) returns public.complimentary_grants
language plpgsql security definer set search_path = public as $$
declare
  g public.complimentary_grants;
  v_company uuid;
begin
  update public.complimentary_grants set
    user_id = p_user_id,
    status = 'active',
    starts_at = now(),
    expires_at = now() + make_interval(days => duration_days),
    activated_at = now(),
    invite_token_hash = null,          -- single use
    had_paid_subscription = public.has_paid_subscription(p_user_id)
  where id = p_grant_id and status = 'pending'
  returning * into g;
  if not found then return null; end if;

  -- Enterprise: attach the recipient's company workspace once the Enterprise schema exists
  -- (create_company is idempotent and returns their existing company). Until then the grant still
  -- gives the owner Unlimited, and the Enterprise migration links companies for active grants.
  -- If that fails (e.g. they are already a member of another company) activation still succeeds and
  -- the grant acts as Unlimited until an admin sorts out the company.
  if g.plan = 'enterprise' and g.company_id is null and to_regprocedure('public.create_company(uuid,text)') is not null then
    begin
      execute 'select public.create_company($1, $2)' into v_company
        using p_user_id, coalesce(nullif((select bp.company_name from public.business_profiles bp where bp.user_id = p_user_id), ''), 'My company');
      update public.complimentary_grants set company_id = v_company where id = g.id returning * into g;
    exception when others then
      raise warning 'complimentary enterprise grant %: company not created (%)', g.id, sqlerrm;
    end;
  end if;

  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_user_id, 'comp.activate', 'complimentary_grant', g.id::text,
          jsonb_build_object('plan', g.plan, 'expires_at', g.expires_at, 'had_paid_subscription', g.had_paid_subscription));
  return g;
end $$;

-- Activate every pending, unexpired invitation addressed to this user's VERIFIED email.
-- Proving control of the inbox is what entitles someone to an invitation sent there, so an invitation
-- can never land on a different person's account. Returns how many grants were activated.
create or replace function public.claim_comp_grants_for(p_user_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  r record;
  n integer := 0;
begin
  select lower(btrim(u.email)) into v_email from auth.users u
    where u.id = p_user_id and u.email is not null and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  for r in
    select g.id from public.complimentary_grants g
    where g.email = v_email and g.status = 'pending'
      and (g.invite_expires_at is null or g.invite_expires_at > now())
    order by g.created_at
    for update
  loop
    if public.comp_activate(r.id, p_user_id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Invitation link: the signed-in user presents the token (server hashes it). Only the verified owner
-- of the invited email can claim it.
create or replace function public.claim_comp_grant_by_token(p_user_id uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g public.complimentary_grants;
  v_email text;
begin
  if p_user_id is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into g from public.complimentary_grants where invite_token_hash = p_token_hash for update;
  if not found then
    -- Already used? Tell the rightful owner their access is on; tell everyone else nothing.
    select * into g from public.active_comp_grant(p_user_id);
    if g.id is not null then return jsonb_build_object('ok', true, 'state', 'active', 'plan', g.plan, 'expires_at', g.expires_at); end if;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if g.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if g.invite_expires_at is not null and g.invite_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'invite_expired');
  end if;
  select lower(btrim(u.email)) into v_email from auth.users u
    where u.id = p_user_id and u.email is not null and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'email_unverified'); end if;
  if v_email <> g.email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch',
      'hint', left(g.email, 1) || '***' || substr(g.email, position('@' in g.email)));
  end if;
  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  g := public.comp_activate(g.id, p_user_id);
  if g.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  return jsonb_build_object('ok', true, 'state', 'active', 'plan', g.plan, 'expires_at', g.expires_at);
end $$;

-- Activate on email verification, whatever sign-in path was used. Must never block sign-up.
create or replace function public.on_auth_user_email_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and new.email is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or old.email is distinct from new.email) then
    begin
      perform public.claim_comp_grants_for(new.id);
    exception when others then
      raise warning 'complimentary access claim failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_verified_comp on auth.users;
create trigger on_auth_user_email_verified_comp
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.on_auth_user_email_verified();

-- ---------------------------------------------------------------------------
-- 4. Admin operations (service role only; each re-checks the caller and audits)
-- ---------------------------------------------------------------------------
create or replace function public.comp_require_admin(p_caller uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller is null or not public.is_admin(p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.comp_audit(p_caller uuid, p_action text, p_grant_id uuid, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_caller, p_action, 'complimentary_grant', p_grant_id::text, p_details)
$$;

-- One row as the admin UI sees it (no token hash).
create or replace function public.comp_admin_row(g public.complimentary_grants) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'email', g.email, 'user_id', g.user_id, 'plan', g.plan, 'state', public.comp_grant_state(g),
    'status', g.status, 'duration_days', g.duration_days, 'included_seats', g.included_seats, 'extra_seats', g.extra_seats,
    'company_id', g.company_id, 'starts_at', g.starts_at, 'expires_at', g.expires_at, 'paused_at', g.paused_at,
    'activated_at', g.activated_at, 'invite_expires_at', g.invite_expires_at, 'invite_sent_at', g.invite_sent_at,
    'invite_send_count', g.invite_send_count, 'note', g.note, 'created_at', g.created_at,
    'revoked_at', g.revoked_at, 'revoke_reason', g.revoke_reason,
    'granted_by_email', (select u.email from auth.users u where u.id = g.granted_by),
    'account_name', (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = g.user_id),
    'last_activity_at', greatest(
      (select max(e.updated_at) from public.estimates e where e.user_id = g.user_id),
      (select u.last_sign_in_at from auth.users u where u.id = g.user_id)),
    'paid_now', g.user_id is not null and public.has_paid_subscription(g.user_id),
    'converted', g.user_id is not null and not g.had_paid_subscription and exists (
      select 1 from public.subscriptions s where s.user_id = g.user_id
        and s.status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused'))
  )
$$;

-- Grant access. p_token_hash = sha256 of a fresh invitation token (server-generated); it is only kept
-- when the recipient has no verified account yet. Returns the admin row plus 'existing_account'.
create or replace function public.admin_comp_create(
  p_caller uuid, p_email text, p_plan text, p_days integer, p_extra_seats integer default 0,
  p_note text default null, p_token_hash text default null, p_invite_days integer default 30
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
  g public.complimentary_grants;
begin
  perform public.comp_require_admin(p_caller);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_plan not in ('unlimited', 'enterprise') then raise exception 'invalid_plan' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  if coalesce(p_extra_seats, 0) < 0 or coalesce(p_extra_seats, 0) > 50 then raise exception 'invalid_seats' using errcode = '22023'; end if;
  if p_plan = 'unlimited' and coalesce(p_extra_seats, 0) <> 0 then raise exception 'invalid_seats' using errcode = '22023'; end if;
  if p_invite_days < 1 or p_invite_days > 60 then raise exception 'invalid_invite_days' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('comp:' || v_email));
  -- Abuse / accident guard: at most 50 new grants per admin per day.
  if (select count(*) from public.complimentary_grants where granted_by = p_caller and created_at > now() - interval '1 day') >= 50 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  -- One open grant per email: extend the existing one instead of stacking.
  if exists (select 1 from public.complimentary_grants x where x.email = v_email
             and public.comp_grant_state(x) in ('pending', 'active', 'scheduled', 'paused')) then
    raise exception 'grant_exists' using errcode = 'P0001';
  end if;

  select u.id into v_user from auth.users u
    where lower(btrim(u.email)) = v_email and u.email_confirmed_at is not null
    order by u.created_at limit 1;

  insert into public.complimentary_grants (email, plan, duration_days, included_seats, extra_seats, note, granted_by,
                                           invite_token_hash, invite_expires_at)
  values (v_email, p_plan, p_days, case when p_plan = 'enterprise' then 3 else 1 end, coalesce(p_extra_seats, 0),
          nullif(btrim(p_note), ''), p_caller,
          case when v_user is null then p_token_hash end,
          case when v_user is null then now() + make_interval(days => p_invite_days) end)
  returning * into g;

  perform public.comp_audit(p_caller, 'comp.grant', g.id, jsonb_build_object(
    'email', v_email, 'plan', p_plan, 'days', p_days, 'extra_seats', coalesce(p_extra_seats, 0), 'existing_account', v_user is not null));

  if v_user is not null then
    g := public.comp_activate(g.id, v_user);
  end if;
  return public.comp_admin_row(g) || jsonb_build_object('existing_account', v_user is not null);
end $$;

-- Add days. Active/paused: pushes the end date out (an already-ended "active" grant restarts from now).
-- Pending: lengthens the period that starts at activation.
create or replace function public.admin_comp_extend(p_caller uuid, p_id uuid, p_days integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants; v_old timestamptz;
begin
  perform public.comp_require_admin(p_caller);
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.status = 'revoked' then raise exception 'revoked' using errcode = 'P0001'; end if;
  v_old := g.expires_at;
  if g.status = 'pending' then
    if g.duration_days + p_days > 730 then raise exception 'too_long' using errcode = 'P0001'; end if;
    update public.complimentary_grants set duration_days = duration_days + p_days where id = p_id returning * into g;
  else
    if greatest(g.expires_at, now()) + make_interval(days => p_days) > now() + interval '730 days' then
      raise exception 'too_long' using errcode = 'P0001';
    end if;
    update public.complimentary_grants
      set expires_at = greatest(expires_at, now()) + make_interval(days => p_days),
          duration_days = least(730, duration_days + p_days)
      where id = p_id returning * into g;
  end if;
  perform public.comp_audit(p_caller, 'comp.extend', g.id, jsonb_build_object('days', p_days, 'old_expires_at', v_old, 'new_expires_at', g.expires_at));
  return public.comp_admin_row(g);
end $$;

-- Pause policy: access stops immediately; on resume the end date moves out by however long the grant
-- was paused, so the recipient never loses days. Only an active, unexpired grant can be paused.
create or replace function public.admin_comp_pause(p_caller uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants;
begin
  perform public.comp_require_admin(p_caller);
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if public.comp_grant_state(g) <> 'active' then raise exception 'not_active' using errcode = 'P0001'; end if;
  update public.complimentary_grants set status = 'paused', paused_at = now() where id = p_id returning * into g;
  perform public.comp_audit(p_caller, 'comp.pause', g.id, jsonb_build_object('expires_at', g.expires_at));
  return public.comp_admin_row(g);
end $$;

create or replace function public.admin_comp_resume(p_caller uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants;
begin
  perform public.comp_require_admin(p_caller);
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.status <> 'paused' then raise exception 'not_paused' using errcode = 'P0001'; end if;
  update public.complimentary_grants
    set status = 'active', expires_at = expires_at + (now() - paused_at), paused_at = null
    where id = p_id returning * into g;
  perform public.comp_audit(p_caller, 'comp.resume', g.id, jsonb_build_object('expires_at', g.expires_at));
  return public.comp_admin_row(g);
end $$;

create or replace function public.admin_comp_revoke(p_caller uuid, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants;
begin
  perform public.comp_require_admin(p_caller);
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.status = 'revoked' then return public.comp_admin_row(g); end if;
  update public.complimentary_grants
    set status = 'revoked', paused_at = null, revoked_at = now(), revoked_by = p_caller,
        revoke_reason = nullif(btrim(p_reason), ''), invite_token_hash = null
    where id = p_id returning * into g;
  perform public.comp_audit(p_caller, 'comp.revoke', g.id, jsonb_build_object('reason', g.revoke_reason));
  return public.comp_admin_row(g);
end $$;

-- Extra complimentary Enterprise seats (on top of the 3 included). Platform admins only.
create or replace function public.admin_comp_set_extra_seats(p_caller uuid, p_id uuid, p_extra integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants; v_old integer;
begin
  perform public.comp_require_admin(p_caller);
  if p_extra is null or p_extra < 0 or p_extra > 50 then raise exception 'invalid_seats' using errcode = '22023'; end if;
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.plan <> 'enterprise' then raise exception 'invalid_seats' using errcode = '22023'; end if;
  if g.status = 'revoked' then raise exception 'revoked' using errcode = 'P0001'; end if;
  v_old := g.extra_seats;
  update public.complimentary_grants set extra_seats = p_extra where id = p_id returning * into g;
  perform public.comp_audit(p_caller, 'comp.extra_seats', g.id, jsonb_build_object('old', v_old, 'new', p_extra));
  return public.comp_admin_row(g);
end $$;

-- Resend: rotates the token (the old link stops working) and restarts the invitation window.
-- Throttled to once a minute and 10 sends per grant.
create or replace function public.admin_comp_rotate_invite(p_caller uuid, p_id uuid, p_token_hash text, p_invite_days integer default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.complimentary_grants;
begin
  perform public.comp_require_admin(p_caller);
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token' using errcode = '22023'; end if;
  if p_invite_days < 1 or p_invite_days > 60 then raise exception 'invalid_invite_days' using errcode = '22023'; end if;
  select * into g from public.complimentary_grants where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if g.invite_sent_at > now() - interval '1 minute' then raise exception 'too_soon' using errcode = 'P0001'; end if;
  if g.invite_send_count >= 10 then raise exception 'too_many_invites' using errcode = 'P0001'; end if;
  update public.complimentary_grants
    set invite_token_hash = p_token_hash, invite_expires_at = now() + make_interval(days => p_invite_days)
    where id = p_id returning * into g;
  perform public.comp_audit(p_caller, 'comp.invite_rotate', g.id, jsonb_build_object('invite_expires_at', g.invite_expires_at));
  return public.comp_admin_row(g);
end $$;

-- Record the outcome of an invitation email the server attempted to send.
create or replace function public.admin_comp_record_invite(p_caller uuid, p_id uuid, p_sent boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.comp_require_admin(p_caller);
  if p_sent then
    update public.complimentary_grants set invite_sent_at = now(), invite_send_count = invite_send_count + 1 where id = p_id;
  end if;
  perform public.comp_audit(p_caller, case when p_sent then 'comp.invite_sent' else 'comp.invite_failed' end, p_id,
    case when p_error is null then null else jsonb_build_object('error', left(p_error, 200)) end);
end $$;

-- Table + summary metrics. Filters (all optional): q (email or account text), plan, state,
-- from / to (grant created date, ISO). Metrics honour plan + date filters but not q/state.
create or replace function public.admin_comp_list(p_caller uuid, p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(btrim(p_filters ->> 'q'), '');
  v_plan text := nullif(p_filters ->> 'plan', '');
  v_state text := nullif(p_filters ->> 'state', '');
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_rows jsonb;
  v_metrics jsonb;
begin
  perform public.comp_require_admin(p_caller);
  with base as (
    select g, public.comp_grant_state(g) as st from public.complimentary_grants g
    where (v_plan is null or g.plan = v_plan)
      and (v_from is null or g.created_at >= v_from)
      and (v_to is null or g.created_at < v_to + interval '1 day')
  ), picked as (
    select b.g from base b
    where (v_state is null or b.st = v_state
           or (v_state = 'expiring_soon' and b.st = 'active' and (b.g).expires_at < now() + interval '7 days'))
      and (v_q is null or (b.g).email ilike '%' || v_q || '%'
           or exists (select 1 from public.business_profiles bp where bp.user_id = (b.g).user_id and bp.company_name ilike '%' || v_q || '%'))
    order by (b.g).created_at desc
    limit 500
  )
  select coalesce(jsonb_agg(public.comp_admin_row(p.g) order by (p.g).created_at desc), '[]') into v_rows from picked p;

  with base as (
    select g.*, public.comp_grant_state(g) as st from public.complimentary_grants g
    where (v_plan is null or g.plan = v_plan)
      and (v_from is null or g.created_at >= v_from)
      and (v_to is null or g.created_at < v_to + interval '1 day')
  )
  select jsonb_build_object(
    'active', count(*) filter (where st = 'active'),
    'pending', count(*) filter (where st = 'pending'),
    'expiring_soon', count(*) filter (where st = 'active' and expires_at < now() + interval '7 days'),
    'expired', count(*) filter (where st = 'expired'),
    'invite_expired', count(*) filter (where st = 'invite_expired'),
    'revoked', count(*) filter (where st = 'revoked'),
    'paused', count(*) filter (where st = 'paused'),
    'unlimited', count(*) filter (where plan = 'unlimited'),
    'enterprise', count(*) filter (where plan = 'enterprise'),
    'converted', count(*) filter (where user_id is not null and not had_paid_subscription and exists (
      select 1 from public.subscriptions s where s.user_id = base.user_id
        and s.status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused'))),
    'total', count(*)
  ) into v_metrics from base;

  return jsonb_build_object('rows', v_rows, 'metrics', v_metrics);
end $$;

create or replace function public.admin_comp_detail(p_caller uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.complimentary_grants;
begin
  perform public.comp_require_admin(p_caller);
  select * into g from public.complimentary_grants where id = p_id;
  if not found then return null; end if;
  return public.comp_admin_row(g) || jsonb_build_object('history', coalesce((
    select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'details', a.details,
                     'actor_email', (select u.email from auth.users u where u.id = a.actor_id)) order by a.created_at desc)
    from public.audit_logs a where a.target_type = 'complimentary_grant' and a.target_id = p_id::text), '[]'));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.comp_grant_state(public.complimentary_grants)',
    'public.active_comp_grant(uuid)',
    'public.has_paid_subscription(uuid)',
    'public.has_unlimited(uuid)',
    'public.comp_activate(uuid, uuid)',
    'public.claim_comp_grants_for(uuid)',
    'public.claim_comp_grant_by_token(uuid, text)',
    'public.on_auth_user_email_verified()',
    'public.comp_require_admin(uuid)',
    'public.comp_audit(uuid, text, uuid, jsonb)',
    'public.comp_admin_row(public.complimentary_grants)',
    'public.admin_comp_create(uuid, text, text, integer, integer, text, text, integer)',
    'public.admin_comp_extend(uuid, uuid, integer)',
    'public.admin_comp_pause(uuid, uuid)',
    'public.admin_comp_resume(uuid, uuid)',
    'public.admin_comp_revoke(uuid, uuid, text)',
    'public.admin_comp_set_extra_seats(uuid, uuid, integer)',
    'public.admin_comp_rotate_invite(uuid, uuid, text, integer)',
    'public.admin_comp_record_invite(uuid, uuid, boolean, text)',
    'public.admin_comp_list(uuid, jsonb)',
    'public.admin_comp_detail(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

revoke execute on function public.my_comp_access() from public, anon;
grant execute on function public.my_comp_access() to authenticated;
