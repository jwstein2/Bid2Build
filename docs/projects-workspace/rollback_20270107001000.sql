-- Rollback for 20270107001000_assigned_pm_schedule_access.sql: assigned project managers go back to needing
-- the bid to be visible to them and theirs (or created by them) to edit its schedule.
create or replace function public.pm_estimate_access(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.estimates e
    cross join lateral public.pm_entitlement(auth.uid()) pe
    where e.id = p_estimate_id and coalesce(pe.can_edit, false) and (
      (e.company_id is null and e.user_id = auth.uid())
      or (e.company_id is not null and pe.scope = 'company' and pe.company_id = e.company_id
          and (e.company_id, e.user_id) in (select v.company_id, v.user_id from public.my_visible_bid_owners() v))
    ))
$$;
create or replace function public.schedule_permissions(p_schedule_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s record; e record; v_base boolean; v_scope boolean; v_view boolean; v_perms text[];
begin
  select * into s from public.project_schedules where id = p_schedule_id;
  if not found or v_uid is null then
    return jsonb_build_object('edit', false, 'progress', false, 'dependencies', false, 'publish', false, 'pdf', false);
  end if;
  select id, user_id, company_id into e from public.estimates where id = s.estimate_id;
  v_base := s.status <> 'archived' and public.pm_estimate_access(s.estimate_id);
  if e.company_id is null then
    return jsonb_build_object('edit', v_base, 'progress', v_base, 'dependencies', v_base, 'publish', v_base, 'pdf', e.user_id = v_uid);
  end if;
  select public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked) into v_perms
    from public.company_members m where m.company_id = e.company_id and m.user_id = v_uid and m.status = 'active';
  v_perms := coalesce(v_perms, '{}');
  v_scope := 'edit_all_schedules' = any (v_perms) or ('edit_assigned_schedules' = any (v_perms) and (e.user_id = v_uid or s.created_by = v_uid));
  -- Progress and publishing can be granted on their own to someone who can see the schedule (a field lead
  -- who only reports progress, an office manager who only publishes); dates and dependencies need edit scope.
  v_view := v_scope or 'view_schedules' = any (v_perms);
  return jsonb_build_object(
    'edit', v_base and v_scope,
    'progress', v_base and v_view and 'update_progress' = any (v_perms),
    'dependencies', v_base and v_scope and 'manage_dependencies' = any (v_perms),
    'publish', v_base and v_view and 'publish_customer_updates' = any (v_perms),
    'pdf', 'download_schedule_pdf' = any (v_perms));
end $$;
drop policy if exists project_schedules_select on public.project_schedules;
create policy project_schedules_select on public.project_schedules for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = project_schedules.estimate_id)
         and (project_schedules.company_id is null or public.has_company_permission(project_schedules.company_id, 'view_schedules')));

