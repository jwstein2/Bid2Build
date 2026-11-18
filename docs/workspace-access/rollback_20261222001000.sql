-- Rollback for 20261222001000_workspace_access.sql (V6.7 Enterprise Workspace & Granular Feature Access).
-- Puts back the earlier update_company_member() and fin_job_visible(), removes the V6.7 functions, trigger,
-- policy table and columns. Revocations a company-wide restriction added are removed first, so members end
-- up with exactly the permissions their own grants/revocations give. Explicit per-person settings saved in
-- the access editor stay (they are ordinary permissions_granted / permissions_revoked).
begin;

update public.company_members
   set permissions_revoked = array(select k from unnest(permissions_revoked) k where not (k = any (policy_revoked)))
 where cardinality(policy_revoked) > 0;

drop trigger if exists company_members_apply_policy on public.company_members;
drop function if exists public.company_members_apply_policy();
drop function if exists public.my_workspace_access();
drop function if exists public.company_access_history(uuid, integer);
drop function if exists public.company_access_overview();
drop function if exists public.company_access_policy_save(text[], text[], text);
drop function if exists public.company_member_access_save(uuid, text, text[], text[], jsonb, text);
drop function if exists public.company_member_perms(public.company_members);
drop function if exists public.access_same(text[], text[]);
drop table if exists public.company_access_policies;
alter table public.company_members drop constraint if exists company_members_access_profile_shape;
alter table public.company_members drop column if exists access_profile;
alter table public.company_members drop column if exists policy_revoked;

-- Earlier definitions (from 20261114005000_enterprise_workspace.sql and 20261130201000_fin_sandbox.sql).
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
    and exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = auth.uid() and m.status = 'active')
    and exists (select 1 from public.project_schedules s where s.estimate_id = j.estimate_id and s.project_manager_id = auth.uid() and s.status <> 'archived');
end $$;

commit;
