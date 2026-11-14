-- Enterprise Phase 1: company workspaces, licensed members, roles + granular permissions, teams,
-- invitations, company audit log, company-owned bids/customers, and the single entitlement function
-- that paid subscriptions, Enterprise seats and complimentary grants all feed into.
--
-- Safe to run more than once. Additive only: no existing row is changed. Existing accounts keep
-- company_id = NULL on every estimate/customer, so nothing about Free or Unlimited behavior changes
-- until a company exists. No company can exist until Enterprise checkout (Phase 2) or an Enterprise
-- complimentary grant (platform-owner thread) creates one through public.create_company().
--
-- Reads public.complimentary_grants (owned by 20261114004000_complimentary_access.sql) only when that
-- table exists, so this file runs before or after it.
--
-- Rollback notes are at the bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. Permission catalog (the one place role defaults live; src/lib/enterprise/permissions.ts mirrors it
--    for display and tests/db/enterprise-workspace.test.ts checks the two agree)
-- ---------------------------------------------------------------------------
create or replace function public.company_permission_keys() returns text[]
language sql immutable as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing'
  ]
$$;

create or replace function public.company_role_permissions(p_role text) returns text[]
language sql immutable as $$
  select case p_role
    when 'owner' then public.company_permission_keys()
    when 'manager' then array['view_own_bids', 'view_team_bids', 'create_estimates', 'edit_team_estimates',
                              'view_costs', 'view_margin', 'approve_bids', 'view_analytics']
    when 'estimator' then array['view_own_bids', 'create_estimates', 'view_costs']
    when 'viewer' then array['view_own_bids', 'view_team_bids', 'view_analytics']
    else array[]::text[]
  end
$$;

-- Permissions only the owner may hand out (billing and user administration).
create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable as $$ select array['manage_billing', 'manage_users'] $$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  -- RESTRICT: a company owner's login cannot be deleted while the company exists (transfer first).
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  billing_email text check (char_length(billing_email) <= 320),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists companies_updated on public.companies;
create trigger companies_updated before update on public.companies for each row execute function public.set_updated_at();

create table if not exists public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'estimator', 'viewer')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  -- Granular adjustments on top of the role defaults (keys from company_permission_keys()).
  permissions_granted text[] not null default '{}',
  permissions_revoked text[] not null default '{}',
  email text check (char_length(email) <= 320),
  display_name text check (char_length(display_name) <= 200),
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  constraint company_members_perms_known check (
    permissions_granted <@ public.company_permission_keys() and permissions_revoked <@ public.company_permission_keys()
  )
);
-- One active company per person; one owner per company.
create unique index if not exists company_members_one_active_company on public.company_members (user_id) where status = 'active';
create unique index if not exists company_members_one_owner on public.company_members (company_id) where role = 'owner';
create index if not exists company_members_company_idx on public.company_members (company_id, status);
drop trigger if exists company_members_updated on public.company_members;
create trigger company_members_updated before update on public.company_members for each row execute function public.set_updated_at();

create table if not exists public.company_teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  trade text check (char_length(trade) <= 60),
  created_at timestamptz not null default now()
);
create unique index if not exists company_teams_name_unique on public.company_teams (company_id, lower(name));

create table if not exists public.company_team_members (
  team_id uuid not null references public.company_teams (id) on delete cascade,
  company_id uuid not null,
  user_id uuid not null,
  is_manager boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade
);
create index if not exists company_team_members_user_idx on public.company_team_members (company_id, user_id);

create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320 and email = lower(email)),
  role text not null check (role in ('manager', 'estimator', 'viewer')),
  team_id uuid references public.company_teams (id) on delete set null,
  -- sha256 of the emailed token; the raw token is never stored.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists company_invitations_one_pending on public.company_invitations (company_id, email)
  where accepted_at is null and revoked_at is null;

create table if not exists public.company_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  target_type text check (char_length(target_type) <= 40),
  target_id text check (char_length(target_id) <= 80),
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists company_audit_log_company_idx on public.company_audit_log (company_id, created_at desc);

-- Company-owned data. NULL = personal (every existing row).
alter table public.estimates add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.estimates add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.customers add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.customers add column if not exists created_by uuid references auth.users (id) on delete set null;
-- 6.9 hook: company-shared pricing presets (policies arrive with the Saved Pricing UI in Phase 3).
alter table public.saved_items add column if not exists company_id uuid references public.companies (id) on delete cascade;
alter table public.assemblies add column if not exists company_id uuid references public.companies (id) on delete cascade;
create index if not exists estimates_company_idx on public.estimates (company_id, user_id, updated_at desc) where company_id is not null;
create index if not exists customers_company_idx on public.customers (company_id, user_id) where company_id is not null;

-- Enterprise billing rides on the existing subscriptions table (one Stripe pipeline).
alter table public.subscriptions add column if not exists company_id uuid references public.companies (id) on delete set null;
-- Total licensed users purchased (3 included + extra seat quantity). NULL for individual plans.
alter table public.subscriptions add column if not exists seat_quantity integer check (seat_quantity is null or seat_quantity >= 3);
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('monthly', 'annual', 'enterprise'));
create index if not exists subscriptions_company_idx on public.subscriptions (company_id) where company_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Membership + permission helpers (security definer, always about auth.uid() unless service-only)
-- ---------------------------------------------------------------------------
create or replace function public.member_permissions(p_role text, p_granted text[], p_revoked text[]) returns text[]
language sql immutable as $$
  select case when p_role = 'owner' then public.company_permission_keys()
    else array(
      select k from unnest(public.company_permission_keys()) k
      where (k = any (public.company_role_permissions(p_role)) or k = any (coalesce(p_granted, '{}')))
        and not (k = any (coalesce(p_revoked, '{}')))
    ) end
$$;

create or replace function public.my_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.company_members where user_id = auth.uid() and status = 'active'
$$;

create or replace function public.is_active_company_member(p_company_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members
                 where company_id = p_company_id and user_id = auth.uid() and status = 'active')
$$;

create or replace function public.has_company_permission(p_company_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p_permission = any (public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked))
    from public.company_members m
    where m.company_id = p_company_id and m.user_id = auth.uid() and m.status = 'active'
  ), false)
$$;

-- (company, bid owner) pairs whose company bids/customers the caller may read. Set-returning with no
-- row inputs, so RLS evaluates it once per query (not per row): cheap at 200+ members.
create or replace function public.my_visible_bid_owners() returns table (company_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  with me as (
    select m.company_id, m.user_id, public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked) as perms
    from public.company_members m where m.user_id = auth.uid() and m.status = 'active'
  )
  -- whole company
  select cm.company_id, cm.user_id from me join public.company_members cm on cm.company_id = me.company_id
  where 'view_company_bids' = any (me.perms)
  union
  -- own company bids
  select me.company_id, me.user_id from me where 'view_own_bids' = any (me.perms) or 'create_estimates' = any (me.perms)
  union
  -- members of teams the caller belongs to (managers and reviewers)
  select tm2.company_id, tm2.user_id from me
  join public.company_team_members tm on tm.company_id = me.company_id and tm.user_id = me.user_id
  join public.company_team_members tm2 on tm2.team_id = tm.team_id
  where 'view_team_bids' = any (me.perms)
$$;

revoke execute on function public.my_company_id(), public.is_active_company_member(uuid),
  public.has_company_permission(uuid, text), public.my_visible_bid_owners() from public, anon;
grant execute on function public.my_company_id(), public.is_active_company_member(uuid),
  public.has_company_permission(uuid, text), public.my_visible_bid_owners() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Entitlement: ONE function for paid, seat and complimentary access
-- ---------------------------------------------------------------------------
-- Enterprise comp grant for a company (complimentary_grants is owned by the platform-owner thread).
create or replace function public.company_comp_grant(p_company_id uuid, out extra_seats integer, out expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.complimentary_grants') is null then return; end if;
  execute $q$
    select coalesce(g.extra_seats, 0), g.expires_at from public.complimentary_grants g
    where g.company_id = $1 and g.plan = 'enterprise' and g.status = 'active'
      and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
    order by g.extra_seats desc nulls last, g.expires_at desc nulls first limit 1
  $q$ into extra_seats, expires_at using p_company_id;
end $$;

-- Is this company entitled to Enterprise right now, and how many licensed users may it have?
create or replace function public.company_entitlement(p_company_id uuid)
returns table (active boolean, source text, seat_limit integer, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_paid integer; v_paid_end timestamptz;
  v_comp_extra integer; v_comp_end timestamptz;
begin
  select greatest(coalesce(s.seat_quantity, 3), 3), s.current_period_end into v_paid, v_paid_end
  from public.subscriptions s
  where s.company_id = p_company_id and s.plan = 'enterprise'
    and s.status in ('active', 'trialing', 'past_due')
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.seat_quantity desc nulls last limit 1;

  select c.extra_seats, c.expires_at into v_comp_extra, v_comp_end from public.company_comp_grant(p_company_id) c;

  if v_paid is null and v_comp_extra is null then
    return query select false, null::text, 0, null::timestamptz;
  elsif v_paid is not null and (v_comp_extra is null or v_paid >= 3 + v_comp_extra) then
    return query select true, 'stripe'::text, v_paid, v_paid_end;
  else
    return query select true, 'complimentary'::text, 3 + v_comp_extra, v_comp_end;
  end if;
end $$;

-- Highest tier a person holds right now. tier: free | unlimited | enterprise.
-- source: company_seat | subscription | complimentary.
create or replace function public.user_entitlement(p_user_id uuid)
returns table (tier text, source text, company_id uuid, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid; v_ent record; v_sub_end timestamptz; v_has_sub boolean;
  v_comp_plan text; v_comp_end timestamptz;
begin
  if p_user_id is null then return query select 'free'::text, null::text, null::uuid, null::timestamptz; return; end if;

  -- Enterprise: an active licensed member of a company whose Enterprise entitlement is active.
  select m.company_id into v_company from public.company_members m where m.user_id = p_user_id and m.status = 'active';
  if v_company is not null then
    select * into v_ent from public.company_entitlement(v_company);
    if v_ent.active then
      return query select 'enterprise'::text, 'company_seat'::text, v_company, v_ent.expires_at; return;
    end if;
  end if;

  -- Individual Unlimited subscription (same rule as before: past_due keeps access during Stripe retries).
  select count(*) > 0, max(s.current_period_end) into v_has_sub, v_sub_end from public.subscriptions s
  where s.user_id = p_user_id and coalesce(s.plan, '') <> 'enterprise'
    and s.status in ('active', 'trialing', 'past_due')
    and (s.current_period_end is null or s.current_period_end > now());
  if v_has_sub then
    return query select 'unlimited'::text, 'subscription'::text, null::uuid, v_sub_end; return;
  end if;

  -- Complimentary grant held by the person (an Enterprise grant without a company yet acts as Unlimited).
  if to_regclass('public.complimentary_grants') is not null then
    execute $q$
      select g.plan, g.expires_at from public.complimentary_grants g
      where g.user_id = $1 and g.status = 'active' and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
      order by g.expires_at desc nulls first limit 1
    $q$ into v_comp_plan, v_comp_end using p_user_id;
    if v_comp_plan is not null then
      return query select 'unlimited'::text, 'complimentary'::text, null::uuid, v_comp_end; return;
    end if;
  end if;

  return query select 'free'::text, null::text, null::uuid, null::timestamptz;
end $$;

-- Existing callers (credit_status, finalize_bid, quota_status, library_access, checkout guard) keep
-- calling has_unlimited and now see Enterprise seats and complimentary grants too.
create or replace function public.has_unlimited(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.tier <> 'free' from public.user_entitlement(p_user_id) e), false)
$$;

revoke execute on function public.company_comp_grant(uuid), public.company_entitlement(uuid), public.user_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.company_comp_grant(uuid), public.company_entitlement(uuid), public.user_entitlement(uuid) to service_role;

-- The caller's own entitlement (browser-safe: takes no argument).
create or replace function public.my_entitlement() returns table (tier text, source text, company_id uuid, expires_at timestamptz)
language sql stable security definer set search_path = public as $$ select * from public.user_entitlement(auth.uid()) $$;
revoke execute on function public.my_entitlement() from public, anon;
grant execute on function public.my_entitlement() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seats
-- ---------------------------------------------------------------------------
-- Licensed seats in use: active members plus unexpired pending invitations (an invite reserves a seat).
create or replace function public.company_seats_used(p_company_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.company_members where company_id = p_company_id and status = 'active')::integer
       + (select count(*) from public.company_invitations
          where company_id = p_company_id and accepted_at is null and revoked_at is null and expires_at > now())::integer
$$;
revoke execute on function public.company_seats_used(uuid) from public, anon, authenticated;
grant execute on function public.company_seats_used(uuid) to service_role;

create or replace function public.company_audit(p_company_id uuid, p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
  values (p_company_id, auth.uid(), p_action, p_target_type, p_target_id, p_details)
$$;
revoke execute on function public.company_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Company-owned bids: stamp new rows; keep history when a login is deleted
-- ---------------------------------------------------------------------------
create or replace function public.stamp_company_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, new.user_id);
  if new.company_id is null then
    select m.company_id into new.company_id from public.company_members m where m.user_id = new.user_id and m.status = 'active';
  end if;
  return new;
end $$;
drop trigger if exists estimates_stamp_company on public.estimates;
create trigger estimates_stamp_company before insert on public.estimates for each row execute function public.stamp_company_owner();
drop trigger if exists customers_stamp_company on public.customers;
create trigger customers_stamp_company before insert on public.customers for each row execute function public.stamp_company_owner();

-- Company bids must not be cascade-deleted with an employee's login: hand them to the company owner
-- first (created_by keeps the original author until that login is gone).
create or replace function public.preserve_company_records() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; v_owner uuid; v_company uuid;
begin
  for v_company, v_owner in
    select distinct c.id, c.owner_user_id from public.companies c
    where c.owner_user_id <> old.id
      and (exists (select 1 from public.estimates e where e.company_id = c.id and e.user_id = old.id)
        or exists (select 1 from public.customers cu where cu.company_id = c.id and cu.user_id = old.id))
  loop
    foreach t in array array['estimate_groups', 'estimate_items', 'estimate_versions', 'estimate_project_profiles'] loop
      if to_regclass('public.' || t) is not null then
        execute format('update public.%I x set user_id = $1 where x.user_id = $2 and x.estimate_id in (select id from public.estimates where company_id = $3 and user_id = $2)', t)
          using v_owner, old.id, v_company;
      end if;
    end loop;
    update public.generated_documents d set user_id = v_owner where d.user_id = old.id
      and d.version_id in (select v.id from public.estimate_versions v join public.estimates e on e.id = v.estimate_id
                           where e.company_id = v_company and e.user_id = old.id);
    update public.estimates set user_id = v_owner where company_id = v_company and user_id = old.id;
    update public.customers set user_id = v_owner where company_id = v_company and user_id = old.id;
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (v_company, null, 'records.reassigned_on_account_deletion', 'user', old.id::text, jsonb_build_object('new_owner', v_owner));
  end loop;
  return old;
end $$;
drop trigger if exists auth_users_preserve_company_records on auth.users;
create trigger auth_users_preserve_company_records before delete on auth.users for each row execute function public.preserve_company_records();

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_teams enable row level security;
alter table public.company_team_members enable row level security;
alter table public.company_invitations enable row level security;
alter table public.company_audit_log enable row level security;

drop policy if exists companies_member_select on public.companies;
create policy companies_member_select on public.companies for select to authenticated
  using (id = (select public.my_company_id()));
-- Own row always; whole roster for people who manage users (emails included).
drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members for select to authenticated
  using (user_id = (select auth.uid()) or public.has_company_permission(company_id, 'manage_users'));
drop policy if exists company_teams_member_select on public.company_teams;
create policy company_teams_member_select on public.company_teams for select to authenticated
  using (company_id = (select public.my_company_id()));
drop policy if exists company_team_members_member_select on public.company_team_members;
create policy company_team_members_member_select on public.company_team_members for select to authenticated
  using (company_id = (select public.my_company_id()));
drop policy if exists company_audit_log_select on public.company_audit_log;
create policy company_audit_log_select on public.company_audit_log for select to authenticated
  using (public.has_company_permission(company_id, 'manage_users'));
-- company_invitations: no policies (token hashes stay server-side; listed through RPCs).

-- Estimates / customers: personal rows unchanged; company rows need an ACTIVE membership, so a
-- deactivated employee loses access to company bids they wrote while the company keeps them.
drop policy if exists estimates_own_all on public.estimates;
create policy estimates_own_all on public.estimates for all to authenticated
  using (user_id = (select auth.uid()) and (company_id is null or company_id = (select public.my_company_id())))
  with check (user_id = (select auth.uid()) and (company_id is null or company_id = (select public.my_company_id())));
drop policy if exists estimates_company_select on public.estimates;
create policy estimates_company_select on public.estimates for select to authenticated
  using (company_id is not null and (company_id, user_id) in (select v.company_id, v.user_id from public.my_visible_bid_owners() v));

drop policy if exists customers_own_all on public.customers;
create policy customers_own_all on public.customers for all to authenticated
  using (user_id = (select auth.uid()) and (company_id is null or company_id = (select public.my_company_id())))
  with check (user_id = (select auth.uid()) and (company_id is null or company_id = (select public.my_company_id())));
drop policy if exists customers_company_select on public.customers;
create policy customers_company_select on public.customers for select to authenticated
  using (company_id is not null and (company_id, user_id) in (select v.company_id, v.user_id from public.my_visible_bid_owners() v));

-- Line items follow their estimate's visibility (the estimates subquery is itself RLS-filtered).
drop policy if exists estimate_groups_company_select on public.estimate_groups;
create policy estimate_groups_company_select on public.estimate_groups for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_groups.estimate_id and e.company_id is not null));
drop policy if exists estimate_items_company_select on public.estimate_items;
create policy estimate_items_company_select on public.estimate_items for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_items.estimate_id and e.company_id is not null));

-- Reads only; every change goes through the functions below.
revoke all on public.companies, public.company_members, public.company_teams, public.company_team_members,
  public.company_invitations, public.company_audit_log from anon, authenticated;
grant select on public.companies, public.company_members, public.company_teams, public.company_team_members,
  public.company_audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Server entry point: create a company (Enterprise checkout webhook, complimentary activation)
-- ---------------------------------------------------------------------------
create or replace function public.create_company(p_owner uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text; v_other uuid;
begin
  select c.id into v_id from public.companies c where c.owner_user_id = p_owner order by c.created_at limit 1;
  if v_id is not null then return v_id; end if;
  select m.company_id into v_other from public.company_members m where m.user_id = p_owner and m.status = 'active';
  if v_other is not null then raise exception 'already_in_company' using errcode = 'P0001'; end if;
  select u.email into v_email from auth.users u where u.id = p_owner;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  insert into public.companies (name, owner_user_id, billing_email)
    values (coalesce(nullif(btrim(p_name), ''), 'My Company'), p_owner, v_email) returning id into v_id;
  insert into public.company_members (company_id, user_id, role, status, email)
    values (v_id, p_owner, 'owner', 'active', lower(v_email));
  insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id)
    values (v_id, p_owner, 'company.created', 'company', v_id::text);
  return v_id;
end $$;
revoke execute on function public.create_company(uuid, text) from public, anon, authenticated;
grant execute on function public.create_company(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Member administration (callers can never raise their own access)
-- ---------------------------------------------------------------------------
create or replace function public.my_company() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.company_members; c public.companies; e record;
begin
  select * into m from public.company_members where user_id = auth.uid() and status = 'active';
  if not found then return null; end if;
  select * into c from public.companies where id = m.company_id;
  select * into e from public.company_entitlement(c.id);
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'role', m.role, 'isOwner', c.owner_user_id = m.user_id,
    'permissions', to_jsonb(public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked)),
    'entitlement', jsonb_build_object('active', e.active, 'source', e.source, 'seatLimit', e.seat_limit, 'expiresAt', e.expires_at),
    'seatsUsed', public.company_seats_used(c.id)
  );
end $$;

-- Roster for any active member (names, roles, teams); emails only for people who manage users.
create or replace function public.company_roster()
returns table (user_id uuid, display_name text, email text, role text, status text, team_ids uuid[], managed_team_ids uuid[], joined_at timestamptz, last_active_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_emails boolean;
begin
  if v_company is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  v_emails := public.has_company_permission(v_company, 'manage_users');
  return query
    select m.user_id, m.display_name, case when v_emails or m.user_id = auth.uid() then m.email end, m.role, m.status,
      coalesce(array_agg(t.team_id) filter (where t.team_id is not null), '{}'),
      coalesce(array_agg(t.team_id) filter (where t.is_manager), '{}'),
      m.joined_at, m.last_active_at
    from public.company_members m
    left join public.company_team_members t on t.company_id = m.company_id and t.user_id = m.user_id
    where m.company_id = v_company and (v_emails or m.status = 'active')
    group by m.company_id, m.user_id
    order by (m.role = 'owner') desc, m.display_name nulls last, m.email;
end $$;

create or replace function public.update_company_member(p_user_id uuid, p_role text, p_granted text[] default '{}', p_revoked text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_me public.company_members; v_target public.company_members;
  v_my_perms text[]; v_new_perms text[]; v_owner boolean;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  if p_role not in ('manager', 'estimator', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if not (coalesce(p_granted, '{}') <@ public.company_permission_keys() and coalesce(p_revoked, '{}') <@ public.company_permission_keys()) then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  select * into v_me from public.company_members where company_id = v_company and user_id = auth.uid();
  select * into v_target from public.company_members where company_id = v_company and user_id = p_user_id for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if v_target.role = 'owner' then raise exception 'cannot_change_owner' using errcode = '42501'; end if;

  v_owner := v_me.role = 'owner';
  v_my_perms := public.member_permissions(v_me.role, v_me.permissions_granted, v_me.permissions_revoked);
  v_new_perms := public.member_permissions(p_role, p_granted, p_revoked);
  -- Nobody hands out access they do not hold; billing and user administration are owner-only grants.
  if not v_owner and (
       not (v_new_perms <@ v_my_perms)
       or v_new_perms && public.company_owner_only_permissions()
       or public.member_permissions(v_target.role, v_target.permissions_granted, v_target.permissions_revoked) && public.company_owner_only_permissions()
     ) then
    raise exception 'forbidden_permission' using errcode = '42501';
  end if;

  update public.company_members set role = p_role,
    permissions_granted = array(select distinct unnest(coalesce(p_granted, '{}')) order by 1),
    permissions_revoked = array(select distinct unnest(coalesce(p_revoked, '{}')) order by 1)
  where company_id = v_company and user_id = p_user_id;
  perform public.company_audit(v_company, 'member.updated', 'user', p_user_id::text, jsonb_build_object(
    'from', jsonb_build_object('role', v_target.role, 'granted', v_target.permissions_granted, 'revoked', v_target.permissions_revoked),
    'to', jsonb_build_object('role', p_role, 'granted', p_granted, 'revoked', p_revoked)));
end $$;

create or replace function public.set_company_member_status(p_user_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_target public.company_members; v_ent record;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  if p_status not in ('active', 'deactivated') then raise exception 'invalid_status' using errcode = '22023'; end if;
  perform 1 from public.companies where id = v_company for update; -- serialize seat changes
  select * into v_target from public.company_members where company_id = v_company and user_id = p_user_id for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if v_target.role = 'owner' then raise exception 'cannot_change_owner' using errcode = '42501'; end if;
  if v_target.status = p_status then return; end if;
  if p_status = 'active' then
    select * into v_ent from public.company_entitlement(v_company);
    if not v_ent.active or public.company_seats_used(v_company) + 1 > v_ent.seat_limit then
      raise exception 'no_seats_available' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.company_members where user_id = p_user_id and status = 'active') then
      raise exception 'already_in_company' using errcode = 'P0001';
    end if;
  end if;
  update public.company_members set status = p_status,
    deactivated_at = case when p_status = 'deactivated' then now() end
  where company_id = v_company and user_id = p_user_id;
  perform public.company_audit(v_company, case when p_status = 'active' then 'member.reactivated' else 'member.deactivated' end,
    'user', p_user_id::text, null);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Teams
-- ---------------------------------------------------------------------------
create or replace function public.create_company_team(p_name text, p_trade text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_id uuid;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_teams') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.company_teams (company_id, name, trade) values (v_company, btrim(p_name), nullif(btrim(p_trade), ''))
    returning id into v_id;
  perform public.company_audit(v_company, 'team.created', 'team', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
end $$;

-- p_remove = true takes the person off the team.
create or replace function public.set_company_team_member(p_team_id uuid, p_user_id uuid, p_is_manager boolean default false, p_remove boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_teams') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_teams where id = p_team_id and company_id = v_company) then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.company_members where company_id = v_company and user_id = p_user_id) then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if p_remove then
    delete from public.company_team_members where team_id = p_team_id and user_id = p_user_id;
  else
    insert into public.company_team_members (team_id, company_id, user_id, is_manager) values (p_team_id, v_company, p_user_id, coalesce(p_is_manager, false))
    on conflict (team_id, user_id) do update set is_manager = excluded.is_manager;
  end if;
  perform public.company_audit(v_company, case when p_remove then 'team.member_removed' else 'team.member_set' end,
    'team', p_team_id::text, jsonb_build_object('user_id', p_user_id, 'is_manager', p_is_manager));
end $$;

-- ---------------------------------------------------------------------------
-- 11. Invitations (raw token goes to the server route that emails it; only its hash is stored)
-- ---------------------------------------------------------------------------
create or replace function public.create_company_invitation(p_email text, p_role text, p_team_id uuid default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id(); v_ent record; v_email text := lower(btrim(p_email));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid; v_exp timestamptz;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'estimator', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email' using errcode = '22023'; end if;
  if p_team_id is not null and not exists (select 1 from public.company_teams where id = p_team_id and company_id = v_company) then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.companies where id = v_company for update; -- serialize seat changes
  if exists (select 1 from public.company_members where company_id = v_company and email = v_email and status = 'active') then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  -- Re-inviting replaces the old pending invitation (old link stops working).
  update public.company_invitations set revoked_at = now()
  where company_id = v_company and email = v_email and accepted_at is null and revoked_at is null;
  select * into v_ent from public.company_entitlement(v_company);
  if not v_ent.active or public.company_seats_used(v_company) + 1 > v_ent.seat_limit then
    raise exception 'no_seats_available' using errcode = 'P0001';
  end if;
  insert into public.company_invitations (company_id, email, role, team_id, token_hash, invited_by)
    values (v_company, v_email, p_role, p_team_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
    returning id, company_invitations.expires_at into v_id, v_exp;
  perform public.company_audit(v_company, 'invitation.created', 'invitation', v_id::text, jsonb_build_object('email', v_email, 'role', p_role));
  return query select v_id, v_token, v_exp;
end $$;

create or replace function public.revoke_company_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.company_invitations set revoked_at = now()
  where id = p_invitation_id and company_id = v_company and accepted_at is null and revoked_at is null;
  if found then perform public.company_audit(v_company, 'invitation.revoked', 'invitation', p_invitation_id::text, null); end if;
end $$;

create or replace function public.list_company_invitations()
returns table (id uuid, email text, role text, team_id uuid, expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select i.id, i.email, i.role, i.team_id, i.expires_at, i.created_at from public.company_invitations i
    where i.company_id = v_company and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    order by i.created_at desc;
end $$;

-- The signed-in person claims an invitation. Their account must carry the invited email, verified,
-- so a forwarded link or someone else's phone number cannot join another person's seat.
create or replace function public.accept_company_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv public.company_invitations; v_email text; v_confirmed timestamptz; v_ent record;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_inv from public.company_invitations where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_email is distinct from v_inv.email or v_confirmed is null then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = v_inv.company_id for update;
  -- re-read under the lock (a concurrent accept or revoke may have won)
  select * into v_inv from public.company_invitations where id = v_inv.id;
  if v_inv.revoked_at is not null or v_inv.accepted_at is not null then raise exception 'invitation_invalid' using errcode = 'P0001'; end if;
  if exists (select 1 from public.company_members where user_id = auth.uid() and status = 'active') then
    raise exception 'already_in_company' using errcode = 'P0001';
  end if;
  select * into v_ent from public.company_entitlement(v_inv.company_id);
  -- the pending invite already holds a seat, so this only fails if seats were reduced since
  if not v_ent.active or public.company_seats_used(v_inv.company_id) > v_ent.seat_limit then
    raise exception 'no_seats_available' using errcode = 'P0001';
  end if;
  update public.company_invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  insert into public.company_members (company_id, user_id, role, status, email, invited_by)
    values (v_inv.company_id, auth.uid(), v_inv.role, 'active', v_email, v_inv.invited_by)
    on conflict (company_id, user_id) do update set role = excluded.role, status = 'active', deactivated_at = null,
      permissions_granted = '{}', permissions_revoked = '{}';
  if v_inv.team_id is not null then
    insert into public.company_team_members (team_id, company_id, user_id, is_manager)
      values (v_inv.team_id, v_inv.company_id, auth.uid(), v_inv.role = 'manager') on conflict do nothing;
  end if;
  perform public.company_audit(v_inv.company_id, 'invitation.accepted', 'user', auth.uid()::text, jsonb_build_object('invitation_id', v_inv.id));
  return v_inv.company_id;
end $$;

revoke execute on function public.my_company(), public.company_roster(),
  public.update_company_member(uuid, text, text[], text[]), public.set_company_member_status(uuid, text),
  public.create_company_team(text, text), public.set_company_team_member(uuid, uuid, boolean, boolean),
  public.create_company_invitation(text, text, uuid), public.revoke_company_invitation(uuid),
  public.list_company_invitations(), public.accept_company_invitation(text) from public, anon;
grant execute on function public.my_company(), public.company_roster(),
  public.update_company_member(uuid, text, text[], text[]), public.set_company_member_status(uuid, text),
  public.create_company_team(text, text), public.set_company_team_member(uuid, uuid, boolean, boolean),
  public.create_company_invitation(text, text, uuid), public.revoke_company_invitation(uuid),
  public.list_company_invitations(), public.accept_company_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback (only while no company exists; run in one transaction):
--   drop trigger auth_users_preserve_company_records on auth.users;
--   drop trigger estimates_stamp_company on public.estimates; drop trigger customers_stamp_company on public.customers;
--   restore has_unlimited from 20261112000200_functions.sql (or 20261114004000 if the comp-grant version was applied);
--   restore estimates_own_all / customers_own_all from 20261112000100_core_schema.sql;
--   drop policy estimates_company_select, customers_company_select, estimate_groups_company_select, estimate_items_company_select;
--   alter table ... drop column company_id / created_by / seat_quantity; drop the company_* tables and functions above.
-- ---------------------------------------------------------------------------
