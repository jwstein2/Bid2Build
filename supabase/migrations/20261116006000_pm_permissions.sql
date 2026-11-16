-- V4 Phase 9: Enterprise project-management and document permissions, PM seat reassignment.
--
-- 1. Granular company permissions (added to the existing role/permission model, so the Users &
--    Permissions screen, grants, revocations and anti-escalation rules all apply):
--      view_schedules, create_schedules, edit_assigned_schedules, edit_all_schedules, manage_dependencies,
--      update_progress, publish_customer_updates, download_schedule_pdf,
--      view_internal_reports, download_internal_reports, send_internal_reports,
--      manage_pm_seats, manage_pm_addons (owner-only grants, like billing and user administration).
--    Writing to a company schedule always needs BOTH an assigned PM editor seat (Phase 5) AND the
--    permission: a company owner or admin can't edit schedules just by being an admin.
--    "Assigned" schedules are those for the person's own bids or schedules they created.
-- 2. Defaults keep today's behaviour: managers and estimators keep what they could do; existing
--    explicit grants of billing / user administration carry over to the new seat and add-on permissions;
--    anyone who could open internal reports (costs + margin) keeps that.
-- 3. Every check is in the database (RLS + the schedule RPCs) and repeated by the API.
-- 4. Seat reassignment moves one existing seat from one person to another in a single step: the seat
--    count (and so billing) never changes and the seat keeps its place.
--
-- Safe to run more than once. Rollback: docs/pipeline/rollback_20261116006000.sql

-- 1. Permission keys and role defaults ---------------------------------------------------------------
create or replace function public.company_permission_keys() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'view_own_bids', 'view_team_bids', 'view_company_bids', 'create_estimates', 'edit_team_estimates',
    'view_costs', 'view_margin', 'approve_bids', 'manage_company_pricing', 'view_analytics',
    'manage_teams', 'manage_users', 'manage_billing',
    'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
    'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
    'view_internal_reports', 'download_internal_reports', 'send_internal_reports',
    'manage_pm_seats', 'manage_pm_addons'
  ]
$$;

create or replace function public.company_role_permissions(p_role text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'owner' then public.company_permission_keys()
    when 'manager' then array['view_own_bids', 'view_team_bids', 'create_estimates', 'edit_team_estimates',
                              'view_costs', 'view_margin', 'approve_bids', 'view_analytics',
                              'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'edit_all_schedules', 'manage_dependencies',
                              'update_progress', 'publish_customer_updates', 'download_schedule_pdf',
                              'view_internal_reports', 'download_internal_reports', 'send_internal_reports']
    when 'estimator' then array['view_own_bids', 'create_estimates', 'view_costs',
                                'view_schedules', 'create_schedules', 'edit_assigned_schedules', 'manage_dependencies', 'update_progress', 'download_schedule_pdf']
    when 'viewer' then array['view_own_bids', 'view_team_bids', 'view_analytics', 'view_schedules', 'download_schedule_pdf']
    else array[]::text[]
  end
$$;

create or replace function public.company_owner_only_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$ select array['manage_billing', 'manage_users', 'manage_pm_seats', 'manage_pm_addons'] $$;

-- Carry existing explicit grants over (no one loses access they had).
update public.company_members set permissions_granted = array(select distinct unnest(permissions_granted || array['manage_pm_seats']) order by 1)
 where role <> 'owner' and ('manage_users' = any (permissions_granted) or 'manage_billing' = any (permissions_granted)) and not ('manage_pm_seats' = any (permissions_granted));
update public.company_members set permissions_granted = array(select distinct unnest(permissions_granted || array['manage_pm_addons']) order by 1)
 where role <> 'owner' and 'manage_billing' = any (permissions_granted) and not ('manage_pm_addons' = any (permissions_granted));
update public.company_members m set permissions_granted = array(select distinct unnest(m.permissions_granted || array['view_internal_reports', 'download_internal_reports', 'send_internal_reports']) order by 1)
 where m.role in ('estimator', 'viewer')
   and public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked) @> array['view_costs', 'view_margin']
   and not (m.permissions_granted @> array['view_internal_reports', 'download_internal_reports', 'send_internal_reports']);

-- 2. Schedules: who may do what ----------------------------------------------------------------------
-- Seat + visibility (the Phase 6-7 rule), without the new permissions.
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
revoke execute on function public.pm_estimate_access(uuid) from public, anon;
grant execute on function public.pm_estimate_access(uuid) to authenticated;

-- Create a schedule: seat + visibility, and for company bids "Create schedule" plus either "Edit all
-- company schedules" or the bid being the caller's own.
create or replace function public.can_schedule_estimate(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.pm_estimate_access(p_estimate_id) and exists (
    select 1 from public.estimates e where e.id = p_estimate_id and (
      e.company_id is null
      or (public.has_company_permission(e.company_id, 'create_schedules')
          and (public.has_company_permission(e.company_id, 'edit_all_schedules') or e.user_id = auth.uid()))))
$$;

-- What the caller may do with one schedule.
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
revoke execute on function public.schedule_permissions(uuid) from public, anon;
grant execute on function public.schedule_permissions(uuid) to authenticated;

-- Any write at all (dates/structure or progress).
create or replace function public.schedule_can_edit(p_schedule_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (j ->> 'edit')::boolean or (j ->> 'progress')::boolean from (select public.schedule_permissions(p_schedule_id) j) x), false)
$$;

create or replace function public.schedule_can_publish(p_schedule_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.schedule_permissions(p_schedule_id) ->> 'publish')::boolean, false)
$$;
revoke execute on function public.schedule_can_publish(uuid) from public, anon;
grant execute on function public.schedule_can_publish(uuid) to authenticated;

-- Viewing a company schedule also needs "View project schedules" (on by default for every role).
drop policy if exists project_schedules_select on public.project_schedules;
create policy project_schedules_select on public.project_schedules for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = project_schedules.estimate_id)
         and (project_schedules.company_id is null or public.has_company_permission(project_schedules.company_id, 'view_schedules')));

-- schedule_get now reports the caller's permissions.
create or replace function public.schedule_get(p_schedule_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'schedule', to_jsonb(s) - 'source_snapshot',
    'snapshot', s.source_snapshot,
    'canEdit', public.schedule_can_edit(s.id),
    'permissions', public.schedule_permissions(s.id),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order, t.planned_start, t.id) from public.schedule_tasks t where t.schedule_id = s.id), '[]'::jsonb),
    'deps', coalesce((select jsonb_agg(to_jsonb(d)) from public.schedule_dependencies d where d.schedule_id = s.id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from (
        select * from public.schedule_revisions r where r.schedule_id = s.id order by r.revision desc limit 50) r), '[]'::jsonb)
  ) from public.project_schedules s where s.id = p_schedule_id
$$;

-- 3. Saving checks each kind of change ---------------------------------------------------------------
create or replace function public.schedule_save(p_schedule_id uuid, p_base_revision integer, p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s record;
  v_keys jsonb := '{}'::jsonb;
  t jsonb;
  d jsonb;
  v_task uuid;
  v_rev integer;
  v_from uuid;
  v_to uuid;
  v_perm jsonb;
  v_need_edit boolean := false;
  v_need_progress boolean := false;
  v_old public.schedule_tasks;
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or v_uid is null or not public.schedule_can_edit(p_schedule_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Phase 9: each kind of change needs its own permission (dates/structure, progress, dependencies).
  v_perm := public.schedule_permissions(p_schedule_id);
  v_need_edit := (p ? 'schedule' and (p -> 'schedule') - 'status' <> '{}'::jsonb)
              or jsonb_array_length(coalesce(p -> 'delete', '[]'::jsonb)) > 0;
  v_need_progress := p ? 'schedule' and p -> 'schedule' ? 'status';
  for t in select x from jsonb_array_elements(coalesce(p -> 'tasks', '[]'::jsonb)) x loop
    if t ->> 'id' is null then v_need_edit := true; continue; end if;
    select * into v_old from public.schedule_tasks where id = (t ->> 'id')::uuid and schedule_id = p_schedule_id;
    if not found then continue; end if;
    if v_old.name is distinct from left(coalesce(nullif(btrim(t ->> 'name'), ''), v_old.name), 300)
       or v_old.sort_order is distinct from coalesce((t ->> 'sortOrder')::int, v_old.sort_order)
       or v_old.planned_start is distinct from (t ->> 'plannedStart')::date or v_old.planned_end is distinct from (t ->> 'plannedEnd')::date
       or v_old.duration_days is distinct from (t ->> 'durationDays')::int
       or v_old.weight is distinct from nullif(t ->> 'weight', '')::numeric
       or v_old.assignee is distinct from nullif(btrim(t ->> 'assignee'), '') or v_old.notes is distinct from nullif(btrim(t ->> 'notes'), '') then
      v_need_edit := true;
    end if;
    if v_old.status is distinct from coalesce(t ->> 'status', 'not_started') or v_old.percent_complete is distinct from coalesce((t ->> 'percentComplete')::int, 0)
       or v_old.actual_start is distinct from nullif(t ->> 'actualStart', '')::date or v_old.actual_finish is distinct from nullif(t ->> 'actualFinish', '')::date then
      v_need_progress := true;
    end if;
  end loop;
  if v_need_edit and not coalesce((v_perm ->> 'edit')::boolean, false) then raise exception 'forbidden_edit' using errcode = '42501'; end if;
  if v_need_progress and not coalesce((v_perm ->> 'progress')::boolean, false) then raise exception 'forbidden_progress' using errcode = '42501'; end if;
  if p ? 'deps' and not coalesce((v_perm ->> 'dependencies')::boolean, false) then raise exception 'forbidden_dependencies' using errcode = '42501'; end if;
  if s.revision <> p_base_revision then
    raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text;
  end if;

  if p ? 'schedule' then
    update public.project_schedules set
      name = left(coalesce(nullif(btrim(p #>> '{schedule,name}'), ''), name), 300),
      status = coalesce(p #>> '{schedule,status}', status),
      calendar = coalesce(p #> '{schedule,calendar}', calendar),
      start_date = coalesce((p #>> '{schedule,startDate}')::date, start_date),
      target_end_date = case when p -> 'schedule' ? 'targetEndDate' then nullif(p #>> '{schedule,targetEndDate}', '')::date else target_end_date end,
      progress_method = coalesce(p #>> '{schedule,progressMethod}', progress_method)
    where id = p_schedule_id;
  end if;

  if jsonb_array_length(coalesce(p -> 'delete', '[]'::jsonb)) > 0 then
    if exists (select 1 from public.schedule_tasks where schedule_id = p_schedule_id and id::text in (select jsonb_array_elements_text(p -> 'delete'))
               and kind = 'section' and split_from is null) then
      raise exception 'cannot_delete_section' using errcode = '22023';
    end if;
    delete from public.schedule_tasks where schedule_id = p_schedule_id and id::text in (select jsonb_array_elements_text(p -> 'delete'));
  end if;

  -- Existing tasks: update. New tasks (no id): insert; sections before items so parents exist.
  for t in select x from jsonb_array_elements(coalesce(p -> 'tasks', '[]'::jsonb)) x order by (x ->> 'id') is null, (x ->> 'kind') = 'item' loop
    if t ->> 'id' is not null then
      update public.schedule_tasks set
        name = left(coalesce(nullif(btrim(t ->> 'name'), ''), name), 300),
        sort_order = coalesce((t ->> 'sortOrder')::int, sort_order),
        planned_start = (t ->> 'plannedStart')::date, planned_end = (t ->> 'plannedEnd')::date,
        duration_days = (t ->> 'durationDays')::int,
        actual_start = nullif(t ->> 'actualStart', '')::date, actual_finish = nullif(t ->> 'actualFinish', '')::date,
        percent_complete = coalesce((t ->> 'percentComplete')::int, 0),
        status = coalesce(t ->> 'status', 'not_started'),
        weight = nullif(t ->> 'weight', '')::numeric,
        assignee = nullif(btrim(t ->> 'assignee'), ''), notes = nullif(btrim(t ->> 'notes'), '')
      where id = (t ->> 'id')::uuid and schedule_id = p_schedule_id;
      if not found then raise exception 'unknown_task' using errcode = '22023'; end if;
    else
      if not public.schedule_source_ok(s.source_snapshot, (t ->> 'sourceGroupId')::uuid, nullif(t ->> 'sourceItemId', '')::uuid) then
        raise exception 'unknown_source' using errcode = '22023';
      end if;
      if t ->> 'kind' = 'item' and not exists (
          select 1 from public.schedule_tasks p2 where p2.schedule_id = p_schedule_id and p2.kind = 'section' and p2.split_from is null
            and p2.id = (t ->> 'parentId')::uuid and p2.source_group_id = (t ->> 'sourceGroupId')::uuid) then
        raise exception 'bad_parent' using errcode = '22023';
      end if;
      if t ->> 'splitFrom' is not null and not exists (select 1 from public.schedule_tasks x where x.id = (t ->> 'splitFrom')::uuid and x.schedule_id = p_schedule_id) then
        raise exception 'unknown_task' using errcode = '22023';
      end if;
      insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, source_item_id, split_from, name, sort_order,
        planned_start, planned_end, duration_days, actual_start, actual_finish, percent_complete, status, weight, assignee, notes)
      values (p_schedule_id, case when t ->> 'kind' = 'item' then (t ->> 'parentId')::uuid end, t ->> 'kind', (t ->> 'sourceGroupId')::uuid,
        nullif(t ->> 'sourceItemId', '')::uuid, nullif(t ->> 'splitFrom', '')::uuid, left(btrim(t ->> 'name'), 300), coalesce((t ->> 'sortOrder')::int, 0),
        (t ->> 'plannedStart')::date, (t ->> 'plannedEnd')::date, (t ->> 'durationDays')::int,
        nullif(t ->> 'actualStart', '')::date, nullif(t ->> 'actualFinish', '')::date, coalesce((t ->> 'percentComplete')::int, 0),
        coalesce(t ->> 'status', 'not_started'), nullif(t ->> 'weight', '')::numeric, nullif(btrim(t ->> 'assignee'), ''), nullif(btrim(t ->> 'notes'), ''))
      returning id into v_task;
      if t ->> 'key' is not null then v_keys := v_keys || jsonb_build_object(t ->> 'key', v_task); end if;
    end if;
  end loop;

  if p ? 'deps' then
    delete from public.schedule_dependencies where schedule_id = p_schedule_id;
    for d in select x from jsonb_array_elements(coalesce(p -> 'deps', '[]'::jsonb)) x loop
      v_from := coalesce((v_keys ->> (d ->> 'from'))::uuid, (d ->> 'from')::uuid);
      v_to := coalesce((v_keys ->> (d ->> 'to'))::uuid, (d ->> 'to')::uuid);
      if not exists (select 1 from public.schedule_tasks where id = v_from and schedule_id = p_schedule_id)
         or not exists (select 1 from public.schedule_tasks where id = v_to and schedule_id = p_schedule_id) then
        raise exception 'unknown_task' using errcode = '22023';
      end if;
      insert into public.schedule_dependencies (schedule_id, predecessor_id, successor_id, lag_days, max_overlap)
      values (p_schedule_id, v_from, v_to, coalesce((d ->> 'lagDays')::int, 0), coalesce((d ->> 'maxOverlap')::int, 0));
    end loop;
  end if;

  v_rev := s.revision + 1;
  update public.project_schedules set revision = v_rev, updated_at = now() where id = p_schedule_id;
  insert into public.schedule_revisions (schedule_id, revision, actor_id, summary, changes)
  values (p_schedule_id, v_rev, v_uid, left(coalesce(nullif(btrim(p ->> 'summary'), ''), 'Schedule updated'), 500), coalesce(p -> 'changes', '[]'::jsonb));
  return v_rev;
end $$;
revoke execute on function public.schedule_save(uuid, integer, jsonb) from public, anon;
grant execute on function public.schedule_save(uuid, integer, jsonb) to authenticated;

-- 4. Customer updates need "Publish customer updates" ------------------------------------------------
create or replace function public.schedule_publish(p_schedule_id uuid, p_base_revision integer, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s record;
  v_version integer;
  v_id uuid;
  v_at timestamptz;
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or v_uid is null or not public.schedule_can_publish(p_schedule_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.revision <> p_base_revision then
    raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text;
  end if;
  if jsonb_typeof(p -> 'content') is distinct from 'object' or jsonb_typeof(p -> 'options') is distinct from 'object'
     or coalesce(p ->> 'contentHash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.schedule_publications where schedule_id = p_schedule_id;
  insert into public.schedule_publications (schedule_id, estimate_id, company_id, version, schedule_revision, published_by, publisher_name,
                                            options, content, content_hash, logo_path)
  values (p_schedule_id, s.estimate_id, s.company_id, v_version, s.revision, v_uid, left(nullif(btrim(p ->> 'publisherName'), ''), 200),
          p -> 'options', p -> 'content', p ->> 'contentHash', left(nullif(btrim(p ->> 'logoPath'), ''), 500))
  returning id, published_at into v_id, v_at;
  if s.company_id is not null then
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (s.company_id, v_uid, 'schedule.update_published', 'estimate', s.estimate_id::text, jsonb_build_object('schedule_id', p_schedule_id, 'publication_id', v_id, 'version', v_version));
  end if;
  return jsonb_build_object('id', v_id, 'version', v_version, 'publishedAt', v_at);
end $$;
revoke execute on function public.schedule_publish(uuid, integer, jsonb) from public, anon;
grant execute on function public.schedule_publish(uuid, integer, jsonb) to authenticated;

create or replace function public.schedule_publication_link(p_publication_id uuid, p_token_hash text, p_days integer default 30) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sched uuid;
  v_exp timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
begin
  select schedule_id into v_sched from public.schedule_publications where id = p_publication_id for update;
  if v_sched is null or v_uid is null or not public.schedule_can_publish(v_sched) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'invalid' using errcode = '22023'; end if;
  update public.schedule_publications
     set token_hash = p_token_hash, link_created_at = now(), link_expires_at = v_exp, link_revoked_at = null,
         delivery = (delivery || jsonb_build_array(jsonb_build_object('method', 'link_created', 'at', now(), 'by', v_uid)))
   where id = p_publication_id;
  return v_exp;
end $$;
revoke execute on function public.schedule_publication_link(uuid, text, integer) from public, anon;
grant execute on function public.schedule_publication_link(uuid, text, integer) to authenticated;

create or replace function public.schedule_publication_revoke_link(p_publication_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sched uuid;
begin
  select schedule_id into v_sched from public.schedule_publications where id = p_publication_id for update;
  if v_sched is null or auth.uid() is null or not public.schedule_can_publish(v_sched) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.schedule_publications set link_revoked_at = now() where id = p_publication_id and token_hash is not null and link_revoked_at is null;
end $$;
revoke execute on function public.schedule_publication_revoke_link(uuid) from public, anon;
grant execute on function public.schedule_publication_revoke_link(uuid) to authenticated;

create or replace function public.schedule_publication_delivery(p_publication_id uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sched uuid;
begin
  if p_method not in ('pdf_download', 'email_draft', 'share_sheet', 'link_copied') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select schedule_id into v_sched from public.schedule_publications where id = p_publication_id for update;
  if v_sched is null or v_uid is null or not public.schedule_can_publish(v_sched) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.schedule_publications
     set delivery = case when jsonb_array_length(delivery) >= 200 then delivery
                         else delivery || jsonb_build_array(jsonb_build_object('method', p_method, 'at', now(), 'by', v_uid)) end
   where id = p_publication_id;
end $$;
revoke execute on function public.schedule_publication_delivery(uuid, text) from public, anon;
grant execute on function public.schedule_publication_delivery(uuid, text) to authenticated;

-- 5. PM editor seats ---------------------------------------------------------------------------------
alter table public.pm_editors add column if not exists changed_at timestamptz;
alter table public.pm_editors add column if not exists changed_by uuid references auth.users (id) on delete set null;

create or replace function public.company_pm_assign(p_user_id uuid, p_assign boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_limit integer; v_assigned integer;
begin
  v_company := public.my_company_id();
  if v_company is null or not public.has_company_permission(v_company, 'manage_pm_seats') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = v_company for update; -- serialize seat changes
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user_id and m.status = 'active') then
    raise exception 'not_member' using errcode = 'P0002';
  end if;
  if p_assign then
    if exists (select 1 from public.pm_editors where company_id = v_company and user_id = p_user_id) then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    select e.editor_limit, e.editors_assigned into v_limit, v_assigned
      from public.pm_entitlement((select m.user_id from public.company_members m where m.company_id = v_company and m.role = 'owner')) e;
    if coalesce(v_assigned, 0) >= coalesce(v_limit, 0) then
      raise exception 'editor_limit' using errcode = 'P0001';
    end if;
    insert into public.pm_editors (company_id, user_id, assigned_by, changed_at, changed_by) values (v_company, p_user_id, auth.uid(), now(), auth.uid());
  else
    delete from public.pm_editors where company_id = v_company and user_id = p_user_id;
    if not found then return jsonb_build_object('ok', true, 'changed', false); end if;
  end if;
  insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (v_company, auth.uid(), case when p_assign then 'pm.editor_assigned' else 'pm.editor_removed' end, 'user', p_user_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

-- Move one seat from one person to another. The seat count and billing don't change, the seat keeps
-- its place (assigned_at), and the previous editor keeps whatever view access their role allows.
create or replace function public.company_pm_reassign(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  v_company := public.my_company_id();
  if v_company is null or not public.has_company_permission(v_company, 'manage_pm_seats') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = v_company for update;
  if p_from = p_to then raise exception 'same_user' using errcode = '22023'; end if;
  if not exists (select 1 from public.pm_editors where company_id = v_company and user_id = p_from) then
    raise exception 'not_editor' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_to and m.status = 'active') then
    raise exception 'not_member' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.pm_editors where company_id = v_company and user_id = p_to) then
    raise exception 'already_editor' using errcode = '23505';
  end if;
  update public.pm_editors set user_id = p_to, assigned_by = auth.uid(), changed_at = now(), changed_by = auth.uid()
   where company_id = v_company and user_id = p_from;
  insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (v_company, auth.uid(), 'pm.editor_reassigned', 'user', p_to::text, jsonb_build_object('from', p_from, 'to', p_to));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.company_pm_reassign(uuid, uuid) from public, anon;
grant execute on function public.company_pm_reassign(uuid, uuid) to authenticated;

-- Seats overview for whoever manages seats: seat type, whether the plan covers it, last change, and how
-- many company schedules each member could lose editing on (so removal can warn first).
create or replace function public.company_pm_seats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid; v_ent record; v_paid boolean; v_extra integer;
begin
  v_company := public.my_company_id();
  if v_company is null or not public.has_company_permission(v_company, 'manage_pm_seats') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_ent from public.pm_entitlement((select m.user_id from public.company_members m where m.company_id = v_company and m.role = 'owner'));
  select count(*) > 0, coalesce(max(s.pm_extra_editors), 0) into v_paid, v_extra from public.subscriptions s
   where s.company_id = v_company and s.plan = 'enterprise' and s.status in ('active', 'trialing', 'past_due')
     and (s.current_period_end is null or s.current_period_end > now());
  return jsonb_build_object(
    'limit', coalesce(v_ent.editor_limit, 0), 'source', v_ent.source, 'paid', v_paid, 'extraPaid', v_extra,
    'seats', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', r.user_id, 'rank', r.rn,
        'seatType', case when r.rn = 1 and v_paid then 'included' when v_paid and r.rn <= 1 + v_extra then 'paid' when r.rn <= coalesce(v_ent.editor_limit, 0) then 'complimentary' else 'uncovered' end,
        'covered', r.rn <= coalesce(v_ent.editor_limit, 0),
        'assignedAt', r.assigned_at, 'changedAt', coalesce(r.changed_at, r.assigned_at), 'changedBy', coalesce(r.changed_by, r.assigned_by)) order by r.rn)
      from (select e.*, row_number() over (order by e.assigned_at, e.user_id) rn from public.pm_editors e
              join public.company_members m on m.company_id = e.company_id and m.user_id = e.user_id and m.status = 'active'
             where e.company_id = v_company) r), '[]'::jsonb),
    'schedules', coalesce((select jsonb_object_agg(x.uid, x.n) from (
        select m.user_id uid, count(distinct s.id) n from public.company_members m
          join public.project_schedules s on s.company_id = v_company and s.status <> 'archived'
          join public.estimates e on e.id = s.estimate_id
         where m.company_id = v_company and m.status = 'active'
           and (e.user_id = m.user_id or s.created_by = m.user_id
                or 'edit_all_schedules' = any (public.member_permissions(m.role, m.permissions_granted, m.permissions_revoked)))
         group by m.user_id) x), '{}'::jsonb));
end $$;
revoke execute on function public.company_pm_seats() from public, anon;
grant execute on function public.company_pm_seats() to authenticated;
