-- V7.3 Contractors & Workforce directory (PM Hub). Extends V4.2 Team & Subcontractors; adds no second
-- directory and no second assignment record.
--
--   * pm_resources stays the one directory. New: parent_id (a worker's subcontracting company), entity
--     (subcontractor is a company or an individual), crew_size (headcount, when known), capacity_declared
--     (capacity was actually stated; until then a company's capacity is "unknown"), specialties.
--   * schedule_tasks.resource_id stays the ONE authoritative assignment. New detail columns on the task:
--     notes, estimated hours, optional start/end time of day. assignment_status gains 'cancelled'.
--   * pm_assignment_events: append-only audit of every assignment change, written by a trigger on
--     schedule_tasks, so changes from PM Hub (schedule_assign, Gantt) and from the directory are all logged.
--     Overridden conflict warnings are recorded with the manager's reason.
--   * pm_assign_resource(p): the directory's assign action. Same rules as schedule_assign (revision check,
--     same-directory resources, section -> task inheritance) plus server-side conflict checks, duplicate
--     prevention and override-with-reason. Nothing is rescheduled or deleted.
--   * pm_workforce(): directory + each entry's assignments (RLS decides which projects are visible).
--     Employee (staff) phone/email are only returned to people who can manage the team, or to that employee.
--   * Nothing creates a login, an invitation or a paid seat. Subcontractors and their workers never get one.
--
-- Safe to run more than once. Requires 20261118002000_team_assignments.sql.
-- Rollback: docs/workforce/rollback_20270102005000.sql

-- 1. Directory: companies, workers, crews ------------------------------------------------------------
alter table public.pm_resources add column if not exists parent_id uuid references public.pm_resources (id) on delete set null;
alter table public.pm_resources add column if not exists entity text;
alter table public.pm_resources add column if not exists crew_size integer;
alter table public.pm_resources add column if not exists capacity_declared boolean not null default false;
alter table public.pm_resources add column if not exists specialties text[] not null default '{}';
do $$ begin
  alter table public.pm_resources add constraint pm_resources_entity check (entity is null or (kind = 'subcontractor' and entity in ('company', 'individual')));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pm_resources add constraint pm_resources_parent check (parent_id is null or (kind = 'subcontractor' and entity = 'individual' and parent_id <> id));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pm_resources add constraint pm_resources_crew_size check (crew_size is null or crew_size between 1 and 500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pm_resources add constraint pm_resources_specialties check (cardinality(specialties) <= 20);
exception when duplicate_object then null; end $$;
create index if not exists pm_resources_parent_idx on public.pm_resources (parent_id) where parent_id is not null;

-- Capacity that was typed before V7.3 (crews, or more than one job at a time) counts as stated.
update public.pm_resources set capacity_declared = true where not capacity_declared and (kind = 'crew' or capacity > 1);

-- A worker's company must be an active-or-archived subcontracting company in the same directory, one level deep.
create or replace function public.pm_resources_parent_check() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if new.parent_id is null then return new; end if;
  select * into p from public.pm_resources where id = new.parent_id;
  if not found or p.kind <> 'subcontractor' or p.entity is not distinct from 'individual' or p.parent_id is not null
     or p.company_id is distinct from new.company_id or p.owner_id is distinct from new.owner_id then
    raise exception 'bad_parent' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists pm_resources_parent_check on public.pm_resources;
create trigger pm_resources_parent_check before insert or update of parent_id, company_id, owner_id on public.pm_resources
  for each row execute function public.pm_resources_parent_check();

-- 2. Assignment details on the task (still the one assignment record) ---------------------------------
alter table public.schedule_tasks add column if not exists assignment_notes text;
alter table public.schedule_tasks add column if not exists assignment_hours numeric(7, 2);
alter table public.schedule_tasks add column if not exists assignment_start_time time;
alter table public.schedule_tasks add column if not exists assignment_end_time time;
do $$ begin
  alter table public.schedule_tasks add constraint schedule_tasks_assignment_notes check (assignment_notes is null or char_length(assignment_notes) <= 2000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.schedule_tasks add constraint schedule_tasks_assignment_hours check (assignment_hours is null or (assignment_hours > 0 and assignment_hours <= 10000));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.schedule_tasks add constraint schedule_tasks_assignment_times check (assignment_start_time is null or assignment_end_time is null or assignment_end_time > assignment_start_time);
exception when duplicate_object then null; end $$;
alter table public.schedule_tasks drop constraint if exists schedule_tasks_assignment_status;
alter table public.schedule_tasks add constraint schedule_tasks_assignment_status
  check (assignment_status is null or assignment_status in ('tentative', 'requested', 'confirmed', 'declined', 'cancelled'));

-- 3. Audit history ------------------------------------------------------------------------------------
create table if not exists public.pm_assignment_events (
  id bigint generated always as identity primary key,
  schedule_id uuid not null references public.project_schedules (id) on delete cascade,
  task_id uuid references public.schedule_tasks (id) on delete set null,
  task_name text,
  resource_id uuid references public.pm_resources (id) on delete set null,
  previous_resource_id uuid references public.pm_resources (id) on delete set null,
  action text not null check (action in ('assigned', 'reassigned', 'cleared', 'status', 'details')),
  status text,
  previous_status text,
  inherited boolean not null default false,
  source text not null default 'pm_hub' check (source in ('pm_hub', 'directory')),
  override_reason text check (char_length(override_reason) <= 500),
  conflicts jsonb,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pm_assignment_events_resource_idx on public.pm_assignment_events (resource_id, created_at desc) where resource_id is not null;
create index if not exists pm_assignment_events_prev_idx on public.pm_assignment_events (previous_resource_id) where previous_resource_id is not null;
create index if not exists pm_assignment_events_schedule_idx on public.pm_assignment_events (schedule_id, created_at desc);
alter table public.pm_assignment_events enable row level security;
drop policy if exists pm_assignment_events_select on public.pm_assignment_events;
-- Readable by whoever can read the project (project_schedules RLS).
create policy pm_assignment_events_select on public.pm_assignment_events for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = pm_assignment_events.schedule_id));
revoke all on public.pm_assignment_events from anon, authenticated;
grant select on public.pm_assignment_events to authenticated;

-- Every change of who / status / details on a task is logged, whichever screen made it.
create or replace function public.schedule_tasks_assignment_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_src text := coalesce(nullif(current_setting('b2b.assign_source', true), ''), 'pm_hub');
  v_reason text := nullif(current_setting('b2b.assign_reason', true), '');
  v_conf jsonb := nullif(nullif(current_setting('b2b.assign_conflicts', true), ''), 'null')::jsonb;
begin
  if new.resource_id is not distinct from old.resource_id and new.assignment_status is not distinct from old.assignment_status
     and new.assignment_notes is not distinct from old.assignment_notes and new.assignment_hours is not distinct from old.assignment_hours
     and new.assignment_start_time is not distinct from old.assignment_start_time and new.assignment_end_time is not distinct from old.assignment_end_time then
    return new;
  end if;
  v_action := case
    when old.resource_id is null and new.resource_id is not null then 'assigned'
    when old.resource_id is not null and new.resource_id is null then 'cleared'
    when new.resource_id is distinct from old.resource_id then 'reassigned'
    when new.assignment_status is distinct from old.assignment_status then 'status'
    else 'details' end;
  insert into public.pm_assignment_events (schedule_id, task_id, task_name, resource_id, previous_resource_id, action, status, previous_status,
    inherited, source, override_reason, conflicts, actor_id)
  values (new.schedule_id, new.id, left(new.name, 300), new.resource_id, case when new.resource_id is distinct from old.resource_id then old.resource_id end,
    v_action, new.assignment_status, old.assignment_status, new.assignment_inherited,
    case when v_src = 'directory' then 'directory' else 'pm_hub' end,
    case when new.assignment_inherited then null else left(v_reason, 500) end, case when new.assignment_inherited then null else v_conf end, auth.uid());
  return new;
end $$;
drop trigger if exists schedule_tasks_assignment_log on public.schedule_tasks;
create trigger schedule_tasks_assignment_log after update of resource_id, assignment_status, assignment_notes, assignment_hours, assignment_start_time, assignment_end_time
  on public.schedule_tasks for each row execute function public.schedule_tasks_assignment_log();

-- 4. Conflict checks (server side) --------------------------------------------------------------------
-- How a directory entry is booked: 'person' (one job at a time: staff, individual subs, company workers),
-- 'crew' (stated capacity, default 1, plus each member as a person), 'company' (capacity only when stated).
create or replace function public.pm_resource_mode(r public.pm_resources) returns text
language sql immutable as $$
  select case when r.kind = 'crew' then 'crew'
              when r.kind = 'staff' or (r.kind = 'subcontractor' and r.entity = 'individual') then 'person'
              else 'company' end
$$;

-- Live bookings of a resource that overlap [p_from, p_to] on OTHER projects. Cancelled / declined
-- assignments and completed tasks don't count. When both sides give times of day and they don't overlap,
-- the two can share the day. "Atoms": a crew counts its members; a person counts crews they're on.
create or replace function public.pm_resource_conflicts(p_resource uuid, p_schedule uuid, p_task uuid, p_from date, p_to date,
  p_start time default null, p_end time default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.pm_resources; v_mode text; v_out jsonb := '[]'::jsonb; v_jobs integer; v_cap integer; v_unav date[]; m record;
begin
  select * into r from public.pm_resources where id = p_resource;
  if not found then return v_out; end if;
  v_mode := public.pm_resource_mode(r);

  -- Days off the person / crew marked.
  select array_agg(d order by d) into v_unav from unnest(r.unavailable) d where d between p_from and p_to;
  if v_unav is not null then
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'unavailable', 'resourceId', r.id, 'resource', r.name, 'days', to_jsonb(v_unav), 'tasks', '[]'::jsonb));
  end if;

  if v_mode = 'person' then
    -- The same person booked on another project (directly, or through a crew they're on).
    v_out := v_out || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('kind', 'double_booked', 'resourceId', r.id, 'resource', r.name,
        'tasks', jsonb_agg(distinct jsonb_build_object('taskId', t.id, 'scheduleId', t.schedule_id, 'project', s.name, 'task', t.name,
          'start', t.planned_start, 'end', t.planned_end, 'via', case when t.resource_id = r.id then null else (select c.name from public.pm_resources c where c.id = t.resource_id) end))) x
      from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id
      -- An inherited task uses its section's times of day.
      left join public.schedule_tasks par on par.id = t.parent_id and t.assignment_inherited
      cross join lateral (select coalesce(t.assignment_start_time, par.assignment_start_time) as st, coalesce(t.assignment_end_time, par.assignment_end_time) as et) tm
      where s.status <> 'archived' and t.schedule_id <> p_schedule and t.id <> coalesce(p_task, '00000000-0000-0000-0000-000000000000'::uuid)
        and t.status <> 'complete' and coalesce(t.assignment_status, '') not in ('declined', 'cancelled')
        and t.planned_start <= p_to and t.planned_end >= p_from
        and not (p_start is not null and p_end is not null and tm.st is not null and tm.et is not null and (tm.et <= p_start or tm.st >= p_end))
        and (t.resource_id = r.id or t.resource_id in (select cm.crew_id from public.pm_crew_members cm where cm.member_id = r.id))
        and not exists (select 1 from public.schedule_tasks c where c.parent_id = t.id and c.resource_id is not distinct from t.resource_id)
      having count(*) > 0) y), '[]'::jsonb);
  elsif v_mode = 'crew' then
    v_cap := greatest(1, r.capacity);
    select count(distinct t.schedule_id) into v_jobs
      from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id
      where s.status <> 'archived' and t.schedule_id <> p_schedule and t.resource_id = r.id and t.status <> 'complete'
        and coalesce(t.assignment_status, '') not in ('declined', 'cancelled') and t.planned_start <= p_to and t.planned_end >= p_from;
    if v_jobs >= v_cap then
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'over_capacity', 'resourceId', r.id, 'resource', r.name, 'jobs', v_jobs, 'capacity', v_cap, 'tasks', '[]'::jsonb));
    end if;
    -- Each member is a person who can't be in two places.
    for m in select q.id from public.pm_crew_members cm join public.pm_resources q on q.id = cm.member_id where cm.crew_id = r.id loop
      v_out := v_out || coalesce((select jsonb_agg(c) from jsonb_array_elements(public.pm_resource_conflicts(m.id, p_schedule, p_task, p_from, p_to, p_start, p_end)) c
        where c ->> 'kind' = 'double_booked' and not exists (select 1 from jsonb_array_elements(c -> 'tasks') tk where tk ->> 'via' = r.name)), '[]'::jsonb);
    end loop;
  else
    -- A company: concurrent jobs (its own and its workers'). Only a stated capacity can make it "overbooked".
    select count(distinct t.schedule_id) into v_jobs
      from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id
      where s.status <> 'archived' and t.schedule_id <> p_schedule and t.status <> 'complete'
        and coalesce(t.assignment_status, '') not in ('declined', 'cancelled') and t.planned_start <= p_to and t.planned_end >= p_from
        and (t.resource_id = r.id or t.resource_id in (select w.id from public.pm_resources w where w.parent_id = r.id));
    if r.capacity_declared and v_jobs >= greatest(1, r.capacity) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'possible_overbooking', 'resourceId', r.id, 'resource', r.name, 'jobs', v_jobs, 'capacity', r.capacity, 'tasks', '[]'::jsonb));
    elsif not r.capacity_declared and v_jobs > 0 then
      -- Information only: not a conflict, never needs an override.
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'capacity_unknown', 'resourceId', r.id, 'resource', r.name, 'jobs', v_jobs, 'tasks', '[]'::jsonb));
    end if;
  end if;
  return v_out;
end $$;
revoke execute on function public.pm_resource_conflicts(uuid, uuid, uuid, date, date, time, time) from public, anon, authenticated;

-- Can this person override a conflict warning? Solo owner, or a company member who edits all schedules.
create or replace function public.pm_can_override(p_schedule uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce((select case when s.company_id is null then s.user_id = auth.uid()
    else public.has_company_permission(s.company_id, 'edit_all_schedules') end from public.project_schedules s where s.id = p_schedule), false)
$$;
revoke execute on function public.pm_can_override(uuid) from public, anon;
grant execute on function public.pm_can_override(uuid) to authenticated;

-- 5. Assign from the directory --------------------------------------------------------------------------
-- p: {taskId, resourceId, status, notes, hours, startTime, endTime, baseRevision, overrideReason, dryRun, allowSameProject}
-- Returns {ok, revision?, conflicts, needsOverride?, duplicate?, alreadyOnProject?}. A refused call writes nothing.
create or replace function public.pm_assign_resource(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record; s record; r record;
  v_res uuid := nullif(p ->> 'resourceId', '')::uuid;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'tentative');
  v_notes text := left(nullif(btrim(coalesce(p ->> 'notes', '')), ''), 2000);
  v_hours numeric := nullif(p ->> 'hours', '')::numeric;
  v_st time := nullif(p ->> 'startTime', '')::time;
  v_et time := nullif(p ->> 'endTime', '')::time;
  v_reason text := left(nullif(btrim(coalesce(p ->> 'overrideReason', '')), ''), 500);
  v_dry boolean := coalesce((p ->> 'dryRun')::boolean, false);
  v_conf jsonb; v_hard jsonb; v_same jsonb; v_rev integer;
begin
  select * into t from public.schedule_tasks where id = nullif(p ->> 'taskId', '')::uuid;
  if not found then raise exception 'bad_task' using errcode = '22023'; end if;
  select * into s from public.project_schedules where id = t.schedule_id for update;
  if not found or auth.uid() is null or not coalesce((public.schedule_permissions(s.id) ->> 'edit')::boolean, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p ? 'baseRevision' and s.revision <> (p ->> 'baseRevision')::int then
    raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text;
  end if;
  if v_res is null then raise exception 'bad_resource' using errcode = '22023'; end if;
  if v_status not in ('tentative', 'requested', 'confirmed', 'declined', 'cancelled') then raise exception 'bad_status' using errcode = '22023'; end if;
  if v_hours is not null and (v_hours <= 0 or v_hours > 10000) then raise exception 'bad_hours' using errcode = '22023'; end if;
  if v_st is not null and v_et is not null and v_et <= v_st then raise exception 'bad_times' using errcode = '22023'; end if;
  select * into r from public.pm_resources where id = v_res;
  if not found or r.status <> 'active'
     or (s.company_id is not null and r.company_id is distinct from s.company_id)
     or (s.company_id is null and r.owner_id is distinct from s.user_id) then
    raise exception 'bad_resource' using errcode = '22023';
  end if;

  -- Same resource, same task, nothing new: a duplicate click. Nothing to do.
  if t.resource_id = v_res and t.assignment_status is not distinct from v_status and t.assignment_notes is not distinct from v_notes
     and t.assignment_hours is not distinct from v_hours and t.assignment_start_time is not distinct from v_st and t.assignment_end_time is not distinct from v_et then
    return jsonb_build_object('ok', true, 'duplicate', true, 'revision', s.revision, 'conflicts', '[]'::jsonb);
  end if;

  -- Already working elsewhere on this project at the same time? Ask before adding them twice.
  select coalesce(jsonb_agg(jsonb_build_object('taskId', x.id, 'task', x.name, 'start', x.planned_start, 'end', x.planned_end)), '[]'::jsonb) into v_same
    from public.schedule_tasks x
   where x.schedule_id = s.id and x.id <> t.id and x.resource_id = v_res and coalesce(x.assignment_status, '') not in ('declined', 'cancelled')
     and x.parent_id is distinct from t.id and t.parent_id is distinct from x.id
     and x.planned_start <= t.planned_end and x.planned_end >= t.planned_start;

  v_conf := case when v_status in ('declined', 'cancelled') then '[]'::jsonb
                 else public.pm_resource_conflicts(v_res, s.id, t.id, t.planned_start, t.planned_end, v_st, v_et) end;
  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_hard from jsonb_array_elements(v_conf) c where c ->> 'kind' <> 'capacity_unknown';

  if v_dry then
    return jsonb_build_object('ok', true, 'dryRun', true, 'conflicts', v_conf, 'alreadyOnProject', v_same,
      'needsOverride', jsonb_array_length(v_hard) > 0, 'canOverride', public.pm_can_override(s.id), 'revision', s.revision);
  end if;
  if jsonb_array_length(v_same) > 0 and not coalesce((p ->> 'allowSameProject')::boolean, false) then
    return jsonb_build_object('ok', false, 'alreadyOnProject', v_same, 'conflicts', v_conf, 'revision', s.revision);
  end if;
  if jsonb_array_length(v_hard) > 0 then
    if v_reason is null then
      return jsonb_build_object('ok', false, 'needsOverride', true, 'canOverride', public.pm_can_override(s.id), 'conflicts', v_conf, 'revision', s.revision);
    end if;
    if not public.pm_can_override(s.id) then raise exception 'override_forbidden' using errcode = '42501'; end if;
  end if;

  perform set_config('b2b.assign_source', 'directory', true);
  perform set_config('b2b.assign_reason', case when jsonb_array_length(v_hard) > 0 then coalesce(v_reason, '') else '' end, true);
  perform set_config('b2b.assign_conflicts', case when jsonb_array_length(v_hard) > 0 then v_hard::text else '' end, true);

  update public.schedule_tasks set
    resource_id = v_res, assignee = left(r.name, 200), assignment_status = v_status, assignment_inherited = false,
    assignment_confirmed_at = case when v_status = 'confirmed' then case when t.assignment_status = 'confirmed' and t.resource_id = v_res then t.assignment_confirmed_at else now() end end,
    assignment_confirmed_by = case when v_status = 'confirmed' then case when t.assignment_status = 'confirmed' and t.resource_id = v_res then t.assignment_confirmed_by else auth.uid() end end,
    assignment_notes = v_notes, assignment_hours = v_hours, assignment_start_time = v_st, assignment_end_time = v_et,
    updated_at = now()
  where id = t.id;
  if t.kind = 'section' then
    -- Same inheritance as schedule_assign: tasks inside follow unless they carry their own assignment.
    update public.schedule_tasks c set
      resource_id = v_res, assignee = left(r.name, 200), assignment_status = v_status, assignment_inherited = true,
      assignment_confirmed_at = case when v_status = 'confirmed' then now() end,
      assignment_confirmed_by = case when v_status = 'confirmed' then auth.uid() end,
      updated_at = now()
    where c.schedule_id = s.id and c.parent_id = t.id and (c.assignment_inherited or (c.resource_id is null and c.assignee is null));
  end if;
  perform set_config('b2b.assign_source', '', true);
  perform set_config('b2b.assign_reason', '', true);
  perform set_config('b2b.assign_conflicts', '', true);

  v_rev := s.revision + 1;
  update public.project_schedules set revision = v_rev, updated_at = now() where id = s.id;
  insert into public.schedule_revisions (schedule_id, revision, actor_id, summary, changes)
  values (s.id, v_rev, auth.uid(), left(r.name || ' assigned to ' || t.name || ' (Contractors & Workforce)', 500), '[]'::jsonb);
  return jsonb_build_object('ok', true, 'revision', v_rev, 'conflicts', v_conf, 'overridden', jsonb_array_length(v_hard) > 0);
end $$;
revoke execute on function public.pm_assign_resource(jsonb) from public, anon;
grant execute on function public.pm_assign_resource(jsonb) to authenticated;

-- 6. Directory save with the new fields (same rules as V4.2, plus company / worker links) ----------------
create or replace function public.pm_resource_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_kind text := p ->> 'kind';
  v_link uuid := nullif(p ->> 'linkedUserId', '')::uuid;
  v_entity text := nullif(p ->> 'entity', '');
  v_parent uuid := nullif(p ->> 'parentId', '')::uuid;
  v_trades text[]; v_specs text[]; v_unav date[]; v_members uuid[];
  v_crew int := nullif(p ->> 'crewSize', '')::int;
  -- Capacity counts as stated only when the caller says so (the V4.2 form always sends capacity 1), or it's above 1.
  v_cap_decl boolean := case when p ? 'capacityDeclared' then coalesce((p ->> 'capacityDeclared')::boolean, false) end;
  r record;
begin
  if not public.pm_team_manageable(v_company, v_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_id is not null then
    select * into r from public.pm_resources where id = v_id for update;
    if not found or r.company_id is distinct from v_company or r.owner_id is distinct from v_owner then raise exception 'not_found' using errcode = '42501'; end if;
    v_kind := r.kind; -- the kind of an entry doesn't change
    if not (p ? 'entity') then v_entity := r.entity; end if;
    if not (p ? 'parentId') then v_parent := r.parent_id; end if;
    if not (p ? 'crewSize') then v_crew := r.crew_size; end if;
  end if;
  if v_kind is null or v_kind not in ('staff', 'subcontractor', 'crew') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if v_kind <> 'staff' then v_link := null; end if;
  if v_kind <> 'subcontractor' then v_entity := null; v_parent := null; end if;
  if v_entity is not null and v_entity not in ('company', 'individual') then raise exception 'bad_entity' using errcode = '22023'; end if;
  if v_parent is not null then v_entity := 'individual'; end if;
  if v_parent is not null and v_parent = v_id then raise exception 'bad_parent' using errcode = '22023'; end if;
  if v_id is not null and v_entity = 'individual' and exists (select 1 from public.pm_resources w where w.parent_id = v_id) then
    raise exception 'has_workers' using errcode = '22023';
  end if;
  if v_crew is not null and (v_crew < 1 or v_crew > 500) then raise exception 'bad_crew_size' using errcode = '22023'; end if;
  if v_link is not null and not (
       (v_company is not null and exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = v_link and m.status = 'active'))
       or (v_company is null and v_link = auth.uid())) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  -- Primary trade first: keep the order given, drop duplicates.
  select coalesce(array_agg(x order by o), '{}') into v_trades from (
    select x, min(o) o from (select left(lower(btrim(x)), 40) x, o from jsonb_array_elements_text(coalesce(p -> 'trades', '[]'::jsonb)) with ordinality a(x, o)) q
    where x <> '' group by x) z;
  select coalesce(array_agg(x order by o), '{}') into v_specs from (
    select x, min(o) o from (select left(btrim(x), 60) x, o from jsonb_array_elements_text(coalesce(p -> 'specialties', '[]'::jsonb)) with ordinality a(x, o)) q
    where x <> '' group by x) z;
  if cardinality(v_trades) > 20 or cardinality(v_specs) > 20 then raise exception 'too_many' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_unav
    from jsonb_array_elements_text(coalesce(p -> 'unavailable', '[]'::jsonb)) x;

  if v_id is null then
    insert into public.pm_resources (company_id, owner_id, kind, name, contact_name, linked_user_id, trades, specialties, email, phone, notes,
      capacity, capacity_declared, unavailable, entity, parent_id, crew_size, created_by)
    values (v_company, v_owner, v_kind, left(btrim(p ->> 'name'), 200), left(nullif(btrim(p ->> 'contactName'), ''), 200), v_link, v_trades, v_specs,
            left(nullif(btrim(p ->> 'email'), ''), 320), left(nullif(btrim(p ->> 'phone'), ''), 40), left(nullif(btrim(p ->> 'notes'), ''), 2000),
            greatest(1, least(50, coalesce((p ->> 'capacity')::int, 1))), coalesce(v_cap_decl, v_kind = 'crew' or coalesce((p ->> 'capacity')::int, 1) > 1), v_unav, v_entity, v_parent, v_crew, auth.uid())
    returning id into v_id;
  else
    update public.pm_resources set name = left(btrim(p ->> 'name'), 200), contact_name = left(nullif(btrim(p ->> 'contactName'), ''), 200),
      linked_user_id = v_link, trades = v_trades, specialties = case when p ? 'specialties' then v_specs else specialties end,
      email = left(nullif(btrim(p ->> 'email'), ''), 320), phone = left(nullif(btrim(p ->> 'phone'), ''), 40),
      notes = left(nullif(btrim(p ->> 'notes'), ''), 2000), capacity = greatest(1, least(50, coalesce((p ->> 'capacity')::int, capacity))),
      capacity_declared = coalesce(v_cap_decl, capacity_declared or kind = 'crew' or coalesce((p ->> 'capacity')::int, capacity) > 1),
      unavailable = v_unav, entity = v_entity, parent_id = v_parent, crew_size = v_crew, updated_at = now()
    where id = v_id;
  end if;

  if v_kind = 'crew' and p ? 'members' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_members from jsonb_array_elements_text(p -> 'members') x;
    if exists (select 1 from unnest(v_members) m where not exists (
         select 1 from public.pm_resources q where q.id = m and q.kind <> 'crew' and q.status = 'active'
            and q.company_id is not distinct from v_company and q.owner_id is not distinct from v_owner)) then
      raise exception 'bad_member' using errcode = '22023';
    end if;
    delete from public.pm_crew_members where crew_id = v_id and member_id <> all (v_members);
    insert into public.pm_crew_members (crew_id, member_id) select v_id, m from unnest(v_members) m on conflict do nothing;
  end if;
  return v_id;
end $$;
revoke execute on function public.pm_resource_save(jsonb) from public, anon;
grant execute on function public.pm_resource_save(jsonb) to authenticated;

-- V4.2 pm_team keeps working for the existing screens; it now also returns the new fields.
create or replace function public.pm_team() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'companyId', public.my_company_id(),
    'canManage', public.pm_team_manageable(public.my_company_id(), case when public.my_company_id() is null then auth.uid() end),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'contactName', r.contact_name, 'linkedUserId', r.linked_user_id,
        'trades', to_jsonb(r.trades), 'email', r.email, 'phone', r.phone, 'notes', r.notes, 'capacity', r.capacity,
        'unavailable', to_jsonb(r.unavailable), 'status', r.status, 'updatedAt', r.updated_at,
        'members', coalesce((select jsonb_agg(m.member_id) from public.pm_crew_members m where m.crew_id = r.id), '[]'::jsonb),
        'entity', r.entity, 'parentId', r.parent_id, 'crewSize', r.crew_size, 'capacityDeclared', r.capacity_declared, 'specialties', to_jsonb(r.specialties)
      ) order by r.status, r.kind, lower(r.name))
      from public.pm_resources r
      where (public.my_company_id() is not null and r.company_id = public.my_company_id())
         or (public.my_company_id() is null and r.owner_id = auth.uid())), '[]'::jsonb))
$$;
revoke execute on function public.pm_team() from public, anon;
grant execute on function public.pm_team() to authenticated;

-- 7. The directory page's data ----------------------------------------------------------------------------
-- SECURITY INVOKER: project_schedules / schedule_tasks RLS decide which assignments come back, so a member
-- never learns about a project they can't open. Staff phone / email only for team managers or the person.
create or replace function public.pm_workforce() returns jsonb
language sql stable security invoker set search_path = public as $$
  with me as materialized (
    select public.my_company_id() as company, auth.uid() as uid,
           public.pm_team_manageable(public.my_company_id(), case when public.my_company_id() is null then auth.uid() end) as manage
  ), res as materialized (
    select r.* from public.pm_resources r, me
    where (me.company is not null and r.company_id = me.company) or (me.company is null and r.owner_id = me.uid)
  ), asg as materialized (
    select t.id, t.schedule_id, t.parent_id, t.kind, t.name, t.planned_start, t.planned_end, t.status, t.percent_complete,
           t.resource_id, t.assignment_status, t.assignment_inherited, t.assignment_notes, t.assignment_hours,
           t.assignment_start_time, t.assignment_end_time, t.updated_at,
           s.name as project, s.status as project_status, s.revision, s.source_snapshot #>> '{estimate,customerName}' as customer,
           (select g ->> 'trade' from jsonb_array_elements(s.source_snapshot -> 'sections') g where g ->> 'id' = t.source_group_id::text limit 1) as trade
    from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id
    where s.status <> 'archived' and t.resource_id in (select id from res)
      -- A section's inherited copies on its tasks are the same booking; show the section once.
      and not (t.assignment_inherited and exists (select 1 from public.schedule_tasks p2 where p2.id = t.parent_id and p2.resource_id = t.resource_id))
  )
  select jsonb_build_object(
    'companyId', (select company from me),
    'me', (select uid from me),
    'canManage', (select manage from me),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'contactName', r.contact_name, 'linkedUserId', r.linked_user_id,
        'trades', to_jsonb(r.trades), 'specialties', to_jsonb(r.specialties),
        'email', case when r.kind <> 'staff' or me.manage or r.linked_user_id = me.uid then r.email end,
        'phone', case when r.kind <> 'staff' or me.manage or r.linked_user_id = me.uid then r.phone end,
        'contactHidden', r.kind = 'staff' and not me.manage and r.linked_user_id is distinct from me.uid and (r.email is not null or r.phone is not null),
        'notes', case when me.manage then r.notes end,
        'capacity', r.capacity, 'capacityDeclared', r.capacity_declared, 'crewSize', r.crew_size,
        'unavailable', to_jsonb(r.unavailable), 'status', r.status, 'entity', r.entity, 'parentId', r.parent_id,
        'createdAt', r.created_at, 'updatedAt', r.updated_at,
        'members', coalesce((select jsonb_agg(m.member_id) from public.pm_crew_members m where m.crew_id = r.id), '[]'::jsonb)
      ) order by r.status, lower(r.name)) from res r, me), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'taskId', a.id, 'scheduleId', a.schedule_id, 'parentId', a.parent_id, 'kind', a.kind, 'task', a.name,
        'start', a.planned_start, 'end', a.planned_end, 'taskStatus', a.status, 'percent', a.percent_complete,
        'resourceId', a.resource_id, 'status', a.assignment_status, 'inherited', a.assignment_inherited,
        'notes', a.assignment_notes, 'hours', a.assignment_hours, 'startTime', a.assignment_start_time, 'endTime', a.assignment_end_time,
        'project', a.project, 'projectStatus', a.project_status, 'customer', a.customer, 'trade', a.trade, 'revision', a.revision
      ) order by a.planned_start, a.name) from asg a), '[]'::jsonb)
  )
$$;
revoke execute on function public.pm_workforce() from public, anon;
grant execute on function public.pm_workforce() to authenticated;

-- Projects to assign to: open schedules the caller can see, with their sections and tasks.
create or replace function public.pm_assign_targets() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'status', s.status, 'revision', s.revision, 'startDate', s.start_date,
      'customer', s.source_snapshot #>> '{estimate,customerName}', 'canEdit', coalesce((public.schedule_permissions(s.id) ->> 'edit')::boolean, false),
      'tasks', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.id, 'parentId', t.parent_id, 'kind', t.kind, 'name', t.name, 'start', t.planned_start, 'end', t.planned_end,
          'status', t.status, 'resourceId', t.resource_id, 'assignee', t.assignee, 'assignmentStatus', t.assignment_status, 'inherited', t.assignment_inherited,
          'trade', (select g ->> 'trade' from jsonb_array_elements(s.source_snapshot -> 'sections') g where g ->> 'id' = t.source_group_id::text limit 1)
        ) order by t.sort_order, t.planned_start) from public.schedule_tasks t where t.schedule_id = s.id), '[]'::jsonb)
    ) order by s.start_date desc, s.name), '[]'::jsonb)
  from public.project_schedules s where s.status in ('draft', 'active')
$$;
revoke execute on function public.pm_assign_targets() from public, anon;
grant execute on function public.pm_assign_targets() to authenticated;

-- Activity for one directory entry (and a company's workers). RLS on events limits it to visible projects.
create or replace function public.pm_resource_history(p_resource uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'status', e.status, 'previousStatus', e.previous_status,
      'task', e.task_name, 'scheduleId', e.schedule_id, 'project', s.name, 'resourceId', e.resource_id, 'previousResourceId', e.previous_resource_id,
      'source', e.source, 'overrideReason', e.override_reason, 'actorId', e.actor_id, 'at', e.created_at) order by e.created_at desc), '[]'::jsonb)
  from (select * from public.pm_assignment_events e
         where not e.inherited and (e.resource_id = p_resource or e.previous_resource_id = p_resource
            or e.resource_id in (select id from public.pm_resources w where w.parent_id = p_resource))
           and exists (select 1 from public.pm_resources r where r.id = p_resource)
         order by e.created_at desc limit 100) e
  join public.project_schedules s on s.id = e.schedule_id
$$;
revoke execute on function public.pm_resource_history(uuid) from public, anon;
grant execute on function public.pm_resource_history(uuid) to authenticated;

-- Realtime: the directory and PM Hub refresh when assignments change (only rows the viewer may read are sent).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.pm_assignment_events; exception when duplicate_object then null; end;
  end if;
end $$;
