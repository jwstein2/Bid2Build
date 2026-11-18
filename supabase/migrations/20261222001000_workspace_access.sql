-- V6.7 Enterprise Workspace & Granular Feature Access
--
-- Adds per-employee workspace access on top of the EXISTING Enterprise permission system (no second
-- permission system):
--   * company_members.access_profile: the access editor's UI intent (workspace master toggles, the role
--     template last applied, and on/off for the few app-gated features no permission backs). Permissions
--     themselves stay in permissions_granted / permissions_revoked, which RLS, has_company_permission(),
--     fin_has_permission() and every RPC already enforce.
--   * company_access_policies: primary account holder policies. denied = company-wide restriction (no
--     member but the owner may hold these; applied by a trigger so no write path can skip it). locked = only
--     the owner may change these for anyone (delegated administrators can't).
--   * company_member_access_save(): the access editor's single write, with the same rules as
--     update_company_member (manage_users, never self, never the owner, owner-only grants, can't hand out
--     what you don't hold) plus locks, a reason, and an audit entry (before/after).
--   * company_access_policy_save(), company_access_overview(), company_access_history(), my_workspace_access().
--   * fin_job_visible(): a project manager whose Financials access was explicitly revoked no longer sees job
--     financials through the PM fallback.
--
-- Nothing here changes seats, subscriptions, scheduling editor seats or financial seats, and nothing
-- charges anyone. Safe to run more than once. Requires every earlier migration (through 20261220001000).
-- Rollback: docs/workspace-access/rollback_20261222001000.sql

-- 1. Columns and the policy table ------------------------------------------------------------------------
alter table public.company_members add column if not exists access_profile jsonb;
alter table public.company_members add column if not exists policy_revoked text[] not null default '{}';
alter table public.company_members drop constraint if exists company_members_access_profile_shape;
alter table public.company_members add constraint company_members_access_profile_shape check (
  access_profile is null or (jsonb_typeof(access_profile) = 'object' and pg_column_size(access_profile) <= 4096));

create table if not exists public.company_access_policies (
  company_id uuid primary key references public.companies (id) on delete cascade,
  denied text[] not null default '{}',
  locked text[] not null default '{}',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint company_access_policies_known check (denied <@ public.company_permission_keys() and locked <@ public.company_permission_keys())
);
alter table public.company_access_policies enable row level security;
drop policy if exists company_access_policies_select on public.company_access_policies;
create policy company_access_policies_select on public.company_access_policies for select to authenticated
  using (public.has_company_permission(company_id, 'manage_users'));
revoke all on public.company_access_policies from anon;
revoke insert, update, delete on public.company_access_policies from authenticated;
grant select on public.company_access_policies to authenticated;

-- 2. Company-wide restrictions: applied on every write of a member row ----------------------------------
-- policy_revoked remembers which revocations the policy added, so lifting the policy restores exactly
-- those (a deny the admin set explicitly stays).
create or replace function public.company_members_apply_policy() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_denied text[]; v_user_revoked text[]; v_add text[];
begin
  v_user_revoked := array(select k from unnest(coalesce(new.permissions_revoked, '{}')) k
                          where not (k = any (coalesce(new.policy_revoked, '{}'))));
  if new.role = 'owner' then
    new.permissions_revoked := array(select distinct k from unnest(v_user_revoked) k order by 1);
    new.policy_revoked := '{}';
    return new;
  end if;
  select denied into v_denied from public.company_access_policies where company_id = new.company_id;
  v_denied := coalesce(v_denied, '{}');
  v_add := array(select k from unnest(v_denied) k where not (k = any (v_user_revoked)));
  new.permissions_revoked := array(select distinct k from unnest(v_user_revoked || v_add) k order by 1);
  new.permissions_granted := array(select distinct k from unnest(coalesce(new.permissions_granted, '{}')) k where not (k = any (v_denied)) order by 1);
  new.policy_revoked := array(select distinct k from unnest(v_add) k order by 1);
  return new;
end $$;
revoke execute on function public.company_members_apply_policy() from public, anon, authenticated;
drop trigger if exists company_members_apply_policy on public.company_members;
create trigger company_members_apply_policy before insert or update of role, permissions_granted, permissions_revoked, policy_revoked
  on public.company_members for each row execute function public.company_members_apply_policy();

-- Effective permission set of a member row (company permissions; financial ones still need a seat).
create or replace function public.company_member_perms(m public.company_members) returns text[]
language sql stable set search_path = public as $$
  select public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked)
$$;
revoke execute on function public.company_member_perms(public.company_members) from public, anon, authenticated;

-- Same multiset? (order-insensitive)
create or replace function public.access_same(a text[], b text[]) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(a, '{}') <@ coalesce(b, '{}') and coalesce(b, '{}') <@ coalesce(a, '{}')
$$;

-- 3. The older Users & Permissions editor respects owner locks too ---------------------------------------
create or replace function public.update_company_member(p_user_id uuid, p_role text, p_granted text[] default '{}', p_revoked text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_me public.company_members; v_target public.company_members;
  v_my_perms text[]; v_new_perms text[]; v_old_perms text[]; v_owner boolean; v_locked text[];
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
  v_old_perms := public.member_permissions(v_target.role, v_target.permissions_granted, v_target.permissions_revoked);
  -- Nobody hands out access they do not hold; billing and user administration are owner-only grants.
  if not v_owner and (
       not (v_new_perms <@ v_my_perms)
       or v_new_perms && public.company_owner_only_permissions()
       or v_old_perms && public.company_owner_only_permissions()
     ) then
    raise exception 'forbidden_permission' using errcode = '42501';
  end if;
  -- V6.7: a delegated administrator can't change what the primary account holder locked.
  select locked into v_locked from public.company_access_policies where company_id = v_company;
  if not v_owner and cardinality(coalesce(v_locked, '{}')) > 0 and not public.access_same(
       array(select k from unnest(v_new_perms) k where k = any (v_locked)),
       array(select k from unnest(v_old_perms) k where k = any (v_locked))) then
    raise exception 'locked_by_owner' using errcode = '42501';
  end if;

  update public.company_members set role = p_role,
    permissions_granted = array(select distinct unnest(coalesce(p_granted, '{}')) order by 1),
    permissions_revoked = array(select distinct unnest(coalesce(p_revoked, '{}')) order by 1)
  where company_id = v_company and user_id = p_user_id;
  perform public.company_audit(v_company, 'member.updated', 'user', p_user_id::text, jsonb_build_object(
    'from', jsonb_build_object('role', v_target.role, 'granted', v_target.permissions_granted, 'revoked', v_target.permissions_revoked),
    'to', jsonb_build_object('role', p_role, 'granted', p_granted, 'revoked', p_revoked)));
end $$;

-- 4. The access editor's write ---------------------------------------------------------------------------
-- p_profile is UI intent (validated shape, 4 KB max). Rules beyond update_company_member: a delegated admin
-- may keep permissions the member already had even if the admin lacks them, but may only ADD what they hold.
create or replace function public.company_member_access_save(
  p_user_id uuid, p_role text, p_granted text[], p_revoked text[], p_profile jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_me public.company_members; v_target public.company_members; v_after public.company_members;
  v_my_perms text[]; v_new_perms text[]; v_old_perms text[]; v_added text[]; v_owner boolean; v_locked text[];
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  if p_role not in ('manager', 'estimator', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if not (coalesce(p_granted, '{}') <@ public.company_permission_keys() and coalesce(p_revoked, '{}') <@ public.company_permission_keys()) then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  if p_profile is not null and (jsonb_typeof(p_profile) <> 'object' or pg_column_size(p_profile) > 4096
       or (p_profile ? 'workspaces' and jsonb_typeof(p_profile -> 'workspaces') <> 'object')
       or (p_profile ? 'app' and jsonb_typeof(p_profile -> 'app') <> 'object')) then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;
  select * into v_me from public.company_members where company_id = v_company and user_id = auth.uid();
  select * into v_target from public.company_members where company_id = v_company and user_id = p_user_id for update;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if v_target.role = 'owner' then raise exception 'cannot_change_owner' using errcode = '42501'; end if;
  if v_target.status <> 'active' then raise exception 'member_inactive' using errcode = '42501'; end if;

  v_owner := v_me.role = 'owner';
  v_my_perms := public.member_permissions(v_me.role, v_me.permissions_granted, v_me.permissions_revoked);
  v_new_perms := public.member_permissions(p_role, p_granted, p_revoked);
  v_old_perms := public.member_permissions(v_target.role, v_target.permissions_granted, v_target.permissions_revoked);
  v_added := array(select k from unnest(v_new_perms) k where not (k = any (v_old_perms)));
  if not v_owner and (
       not (v_added <@ v_my_perms)
       or v_new_perms && public.company_owner_only_permissions()
       or v_old_perms && public.company_owner_only_permissions()
     ) then
    raise exception 'forbidden_permission' using errcode = '42501';
  end if;
  select locked into v_locked from public.company_access_policies where company_id = v_company;
  if not v_owner and cardinality(coalesce(v_locked, '{}')) > 0 and not public.access_same(
       array(select k from unnest(v_new_perms) k where k = any (v_locked)),
       array(select k from unnest(v_old_perms) k where k = any (v_locked))) then
    raise exception 'locked_by_owner' using errcode = '42501';
  end if;

  update public.company_members set role = p_role,
    permissions_granted = array(select distinct unnest(coalesce(p_granted, '{}')) order by 1),
    permissions_revoked = array(select distinct unnest(coalesce(p_revoked, '{}')) order by 1),
    access_profile = p_profile
  where company_id = v_company and user_id = p_user_id
  returning * into v_after;
  perform public.company_audit(v_company, 'member.access_updated', 'user', p_user_id::text, jsonb_build_object(
    'from', jsonb_build_object('role', v_target.role, 'granted', v_target.permissions_granted, 'revoked', v_target.permissions_revoked, 'profile', v_target.access_profile),
    'to', jsonb_build_object('role', v_after.role, 'granted', v_after.permissions_granted, 'revoked', v_after.permissions_revoked, 'profile', v_after.access_profile),
    'reason', v_reason));
  return jsonb_build_object('role', v_after.role, 'permissions', to_jsonb(public.company_member_perms(v_after)),
    'policyRevoked', to_jsonb(v_after.policy_revoked));
end $$;
revoke execute on function public.company_member_access_save(uuid, text, text[], text[], jsonb, text) from public, anon;
grant execute on function public.company_member_access_save(uuid, text, text[], text[], jsonb, text) to authenticated;

-- 5. Owner policies -----------------------------------------------------------------------------------
create or replace function public.company_access_policy_save(p_denied text[], p_locked text[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_old public.company_access_policies; v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if v_company is null or not exists (select 1 from public.company_members where company_id = v_company and user_id = auth.uid() and role = 'owner' and status = 'active') then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if not (coalesce(p_denied, '{}') <@ public.company_permission_keys() and coalesce(p_locked, '{}') <@ public.company_permission_keys()) then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  select * into v_old from public.company_access_policies where company_id = v_company;
  insert into public.company_access_policies (company_id, denied, locked, updated_by, updated_at)
  values (v_company, array(select distinct unnest(coalesce(p_denied, '{}')) order by 1), array(select distinct unnest(coalesce(p_locked, '{}')) order by 1), auth.uid(), now())
  on conflict (company_id) do update set denied = excluded.denied, locked = excluded.locked, updated_by = excluded.updated_by, updated_at = now();
  -- Re-apply to every member (the trigger reads the new policy). Lifting a restriction restores only what it added.
  update public.company_members set policy_revoked = policy_revoked where company_id = v_company and role <> 'owner';
  perform public.company_audit(v_company, 'access.policy_updated', 'company', v_company::text, jsonb_build_object(
    'from', jsonb_build_object('denied', coalesce(v_old.denied, '{}'), 'locked', coalesce(v_old.locked, '{}')),
    'to', jsonb_build_object('denied', coalesce(p_denied, '{}'), 'locked', coalesce(p_locked, '{}')), 'reason', v_reason));
  return jsonb_build_object('denied', to_jsonb(coalesce(p_denied, '{}')), 'locked', to_jsonb(coalesce(p_locked, '{}')));
end $$;
revoke execute on function public.company_access_policy_save(text[], text[], text) from public, anon;
grant execute on function public.company_access_policy_save(text[], text[], text) to authenticated;

-- 6. What the Team & Access editor needs, in one read (manage_users only) ------------------------------
-- Includes each member's licenses so the editor can say why a grant has no effect yet: scheduling editor
-- seat (pm_entitlement) and financial seat (fin_seats + fin_seat_covered). Read-only; nothing is assigned.
create or replace function public.company_access_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id(); v_book uuid; v_fin_active boolean := false; v_owner uuid; v_pm record;
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select owner_user_id into v_owner from public.companies where id = v_company;
  select id into v_book from public.fin_books where company_id = v_company and sandbox_of is null order by created_at limit 1;
  if v_book is not null then v_fin_active := coalesce((select e.active from public.fin_entitlement(v_book) e), false); end if;
  select * into v_pm from public.pm_entitlement(v_owner);
  return jsonb_build_object(
    'policy', coalesce((select jsonb_build_object('denied', to_jsonb(p.denied), 'locked', to_jsonb(p.locked), 'updatedAt', p.updated_at)
                        from public.company_access_policies p where p.company_id = v_company), jsonb_build_object('denied', '[]'::jsonb, 'locked', '[]'::jsonb)),
    'licenses', jsonb_build_object('pm', coalesce(v_pm.scope, 'none') <> 'none', 'pmEditorLimit', coalesce(v_pm.editor_limit, 0),
      'pmEditorsAssigned', coalesce(v_pm.editors_assigned, 0), 'financials', v_book is not null and v_fin_active, 'finBook', v_book),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', m.user_id, 'role', m.role, 'status', m.status,
        'granted', to_jsonb(m.permissions_granted), 'revoked', to_jsonb(m.permissions_revoked), 'policyRevoked', to_jsonb(m.policy_revoked),
        'profile', m.access_profile,
        'pmEditor', coalesce((select e.can_edit from public.pm_entitlement(m.user_id) e), false),
        'pmEditorAssigned', exists (select 1 from public.pm_editors pe where pe.company_id = v_company and pe.user_id = m.user_id),
        'finRole', s.fin_role, 'finAccountantSeat', coalesce(s.is_accountant_seat, false),
        'finCovered', case when s.user_id is null then false when s.is_accountant_seat then true else public.fin_seat_covered(v_book, m.user_id) end
      ) order by (m.role = 'owner') desc, m.display_name nulls last)
      from public.company_members m
      left join public.fin_seats s on s.book_id = v_book and s.user_id = m.user_id
      where m.company_id = v_company and m.status = 'active'), '[]'::jsonb));
end $$;
revoke execute on function public.company_access_overview() from public, anon;
grant execute on function public.company_access_overview() to authenticated;

-- 7. Access change history (manage_users only). Shows who changed what and why; no emails or secrets.
create or replace function public.company_access_history(p_user_id uuid default null, p_limit integer default 50)
returns table (id bigint, created_at timestamptz, action text, actor_id uuid, actor_name text, target_id text, target_name text, details jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'manage_users') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select l.id, l.created_at, l.action, l.actor_id, coalesce(a.display_name, 'Former member'), l.target_id,
           case when l.target_type = 'user' then coalesce(t.display_name, 'Former member') else 'Company policy' end, l.details
    from public.company_audit_log l
    left join public.company_members a on a.company_id = l.company_id and a.user_id = l.actor_id
    left join public.company_members t on l.target_type = 'user' and t.company_id = l.company_id and t.user_id::text = l.target_id
    where l.company_id = v_company and l.action in ('member.access_updated', 'member.updated', 'access.policy_updated')
      and (p_user_id is null or l.target_id = p_user_id::text)
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;
revoke execute on function public.company_access_history(uuid, integer) from public, anon;
grant execute on function public.company_access_history(uuid, integer) to authenticated;

-- 8. The signed-in person's access in one call (navigation, URL guards, search, dashboard widgets) -------
-- Built on search_capabilities() (company + financial permissions as enforced) plus the access profile and
-- scheduling-editor coverage. Never returns another person's data.
create or replace function public.my_workspace_access() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_caps jsonb; m public.company_members; c public.companies; v_pm record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  v_caps := public.search_capabilities();
  select * into m from public.company_members where user_id = v_uid and status = 'active';
  if found then select * into c from public.companies where id = m.company_id; end if;
  select * into v_pm from public.pm_entitlement(v_uid);
  return v_caps || jsonb_build_object(
    'member', case when m.user_id is null then null else jsonb_build_object(
      'companyId', c.id, 'companyName', c.name, 'role', m.role, 'isOwner', c.owner_user_id = v_uid, 'profile', m.access_profile,
      'revoked', to_jsonb(m.permissions_revoked),
      'policy', coalesce((select jsonb_build_object('denied', to_jsonb(p.denied), 'locked', to_jsonb(p.locked)) from public.company_access_policies p where p.company_id = c.id),
                         jsonb_build_object('denied', '[]'::jsonb, 'locked', '[]'::jsonb))) end,
    'pm', jsonb_build_object('scope', coalesce(v_pm.scope, 'none'), 'canEdit', coalesce(v_pm.can_edit, false)));
end $$;
revoke execute on function public.my_workspace_access() from public, anon;
grant execute on function public.my_workspace_access() to authenticated;

-- 9. Financials PM fallback respects an explicit Financials revoke ------------------------------------
create or replace function public.fin_job_visible(p_job_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare j public.fin_jobs; v_company uuid;
begin
  select * into j from public.fin_jobs where id = p_job_id;
  if not found or auth.uid() is null then return false; end if;
  if public.fin_has_permission(j.book_id, 'view_company_financials') then return true; end if;
  if public.fin_has_permission(j.book_id, 'view_project_financials') and public.estimate_readable(j.estimate_id) then return true; end if;
  select company_id into v_company from public.fin_books where id = public.fin_book_live(j.book_id);
  return v_company is not null
    and exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = auth.uid() and m.status = 'active'
                and not ('view_project_financials' = any (m.permissions_revoked)))
    and exists (select 1 from public.project_schedules s where s.estimate_id = j.estimate_id and s.project_manager_id = auth.uid() and s.status <> 'archived');
end $$;
