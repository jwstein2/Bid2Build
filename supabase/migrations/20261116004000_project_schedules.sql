-- V4 Phases 6-7: project schedules built from an accepted estimate (Schedule Now), Gantt editing,
-- task progress, dependencies and delay handling with a revision history.
--
-- Access
--   * View: anyone who can read the source estimate under its existing RLS (own bid, or a company bid
--     the member may see). No PM entitlement is needed to VIEW, so a downgraded account keeps
--     read-only access to its schedules and nothing is ever deleted when the add-on ends.
--   * Create / edit: pm_entitlement(auth.uid()).can_edit (Phase 5) AND the estimate is the caller's
--     own personal bid, or a company bid in the caller's company that the caller can see while holding
--     a company PM editor seat. All writes go through schedule_create / schedule_save (no direct table
--     writes), which check access, the source estimate's scope and an optimistic revision number.
--
-- Snapshot semantics: schedule_create freezes the estimate's sections and line items (names,
-- quantities, units, section trade; never costs or prices) into source_snapshot, with the latest
-- finalized version id. Later estimate edits never rewrite a schedule.
--
-- Idempotent: safe to run more than once. Rollback: docs/pipeline/rollback_20261116004000.sql.

-- 1. Tables ------------------------------------------------------------------------------------------
create table if not exists public.project_schedules (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,            -- estimate owner
  company_id uuid references public.companies (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 300),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  provisional boolean not null default false,
  source_version_id uuid references public.estimate_versions (id) on delete set null,
  source_snapshot jsonb not null,
  calendar jsonb not null,
  start_date date not null,
  target_end_date date,
  progress_method text not null default 'duration' check (progress_method in ('duration', 'weight')),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_schedules_target_after_start check (target_end_date is null or target_end_date >= start_date),
  constraint project_schedules_calendar_shape check (
    jsonb_typeof(calendar -> 'workdays') = 'array' and jsonb_array_length(calendar -> 'workdays') between 1 and 7
    and jsonb_typeof(coalesce(calendar -> 'holidays', '[]'::jsonb)) = 'array'
    and jsonb_typeof(calendar -> 'timezone') = 'string')
);
-- One live schedule per estimate, so Schedule Now never creates a duplicate project.
create unique index if not exists project_schedules_one_per_estimate on public.project_schedules (estimate_id) where status <> 'archived';
create index if not exists project_schedules_user_idx on public.project_schedules (user_id, updated_at desc);
create index if not exists project_schedules_company_idx on public.project_schedules (company_id, updated_at desc) where company_id is not null;
drop trigger if exists project_schedules_updated on public.project_schedules;
create trigger project_schedules_updated before update on public.project_schedules for each row execute function public.set_updated_at();

create table if not exists public.schedule_tasks (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.project_schedules (id) on delete cascade,
  parent_id uuid references public.schedule_tasks (id) on delete cascade,
  kind text not null check (kind in ('section', 'item')),
  source_group_id uuid not null,
  source_item_id uuid,
  split_from uuid references public.schedule_tasks (id) on delete set null,
  name text not null check (char_length(name) between 1 and 300),
  sort_order integer not null default 0,
  planned_start date not null,
  planned_end date not null,
  duration_days integer not null check (duration_days between 1 and 3650),
  actual_start date,
  actual_finish date,
  percent_complete integer not null default 0 check (percent_complete between 0 and 100),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'complete', 'delayed', 'on_hold')),
  weight numeric(9, 2) check (weight is null or weight > 0),
  assignee text check (char_length(assignee) <= 200),
  notes text check (char_length(notes) <= 4000),
  updated_at timestamptz not null default now(),
  constraint schedule_tasks_dates check (planned_end >= planned_start),
  constraint schedule_tasks_actual check (actual_finish is null or actual_start is null or actual_finish >= actual_start),
  constraint schedule_tasks_shape check (
    (kind = 'section' and parent_id is null and source_item_id is null) or (kind = 'item' and parent_id is not null)),
  -- Complete needs an actual finish and 100%; reaching a planned date never marks anything complete.
  constraint schedule_tasks_complete check (status <> 'complete' or (percent_complete = 100 and actual_finish is not null))
);
create index if not exists schedule_tasks_schedule_idx on public.schedule_tasks (schedule_id, sort_order);
-- A line item or section becomes at most one task (split parts are extra segments of that task).
create unique index if not exists schedule_tasks_one_item on public.schedule_tasks (schedule_id, source_item_id) where source_item_id is not null and split_from is null;
create unique index if not exists schedule_tasks_one_section on public.schedule_tasks (schedule_id, source_group_id) where kind = 'section' and split_from is null;
drop trigger if exists schedule_tasks_updated on public.schedule_tasks;
create trigger schedule_tasks_updated before update on public.schedule_tasks for each row execute function public.set_updated_at();

create table if not exists public.schedule_dependencies (
  schedule_id uuid not null references public.project_schedules (id) on delete cascade,
  predecessor_id uuid not null references public.schedule_tasks (id) on delete cascade,
  successor_id uuid not null references public.schedule_tasks (id) on delete cascade,
  -- Successor may start this many working days after the predecessor finishes (negative = overlap).
  lag_days integer not null default 0 check (lag_days between -365 and 365),
  -- Overlap the contractor allows when the scheduler suggests ways to meet a target date.
  max_overlap integer not null default 0 check (max_overlap between 0 and 365),
  primary key (predecessor_id, successor_id),
  constraint schedule_dependencies_not_self check (predecessor_id <> successor_id)
);
create index if not exists schedule_dependencies_schedule_idx on public.schedule_dependencies (schedule_id);

create table if not exists public.schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.project_schedules (id) on delete cascade,
  revision integer not null,
  actor_id uuid references auth.users (id) on delete set null,
  summary text not null check (char_length(summary) between 1 and 500),
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (schedule_id, revision)
);

-- 2. Row-level security: read follows the source estimate; no direct writes ---------------------------
alter table public.project_schedules enable row level security;
alter table public.schedule_tasks enable row level security;
alter table public.schedule_dependencies enable row level security;
alter table public.schedule_revisions enable row level security;

drop policy if exists project_schedules_select on public.project_schedules;
create policy project_schedules_select on public.project_schedules for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = project_schedules.estimate_id));
drop policy if exists schedule_tasks_select on public.schedule_tasks;
create policy schedule_tasks_select on public.schedule_tasks for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = schedule_tasks.schedule_id));
drop policy if exists schedule_dependencies_select on public.schedule_dependencies;
create policy schedule_dependencies_select on public.schedule_dependencies for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = schedule_dependencies.schedule_id));
drop policy if exists schedule_revisions_select on public.schedule_revisions;
create policy schedule_revisions_select on public.schedule_revisions for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = schedule_revisions.schedule_id));

revoke insert, update, delete on public.project_schedules, public.schedule_tasks, public.schedule_dependencies, public.schedule_revisions from anon, authenticated;
grant select on public.project_schedules, public.schedule_tasks, public.schedule_dependencies, public.schedule_revisions to authenticated;

-- 3. Who may schedule / edit ------------------------------------------------------------------------
create or replace function public.can_schedule_estimate(p_estimate_id uuid) returns boolean
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
revoke execute on function public.can_schedule_estimate(uuid) from public, anon;
grant execute on function public.can_schedule_estimate(uuid) to authenticated;

create or replace function public.schedule_can_edit(p_schedule_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.status <> 'archived' and public.can_schedule_estimate(s.estimate_id)
                   from public.project_schedules s where s.id = p_schedule_id), false)
$$;
revoke execute on function public.schedule_can_edit(uuid) from public, anon;
grant execute on function public.schedule_can_edit(uuid) to authenticated;

-- Accepted = Won or a job stage, or a customer signature exists (never inferred from anything else).
create or replace function public.estimate_is_accepted(p_estimate_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.estimates e where e.id = p_estimate_id and e.pipeline_stage in ('won', 'scheduled', 'in_progress', 'completed'))
      or exists (select 1 from public.signatures s where s.estimate_id = p_estimate_id)
$$;
revoke execute on function public.estimate_is_accepted(uuid) from public, anon;
grant execute on function public.estimate_is_accepted(uuid) to authenticated;

-- 4. Snapshot of the estimate's scope (no costs) -----------------------------------------------------
create or replace function public.schedule_estimate_snapshot(p_estimate_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'estimate', jsonb_build_object('id', e.id, 'title', e.title, 'number', e.estimate_number, 'customerName', e.customer_name, 'projectAddress', e.project_address),
    'trades', to_jsonb(e.trades),
    'version', (select jsonb_build_object('id', v.id, 'number', v.version_number) from public.estimate_versions v where v.estimate_id = e.id order by v.version_number desc limit 1),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', coalesce(nullif(btrim(g.name), ''), 'Section ' || (g.sort_order + 1)),
        'trade', coalesce(e.proposal_config -> 'worksheet' -> 'sectionTrades' ->> g.id::text, e.trades[1]),
        'sortOrder', g.sort_order,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('id', i.id, 'name', coalesce(nullif(btrim(i.name), ''), 'Item'), 'quantity', i.quantity, 'unit', i.unit, 'sortOrder', i.sort_order) order by i.sort_order, i.id)
          from public.estimate_items i where i.group_id = g.id), '[]'::jsonb)
      ) order by g.sort_order, g.id)
      from public.estimate_groups g where g.estimate_id = e.id), '[]'::jsonb)
  ) from public.estimates e where e.id = p_estimate_id
$$;
revoke execute on function public.schedule_estimate_snapshot(uuid) from public, anon, authenticated;

-- Validates one task's source references against the frozen snapshot.
create or replace function public.schedule_source_ok(p_snapshot jsonb, p_group uuid, p_item uuid) returns boolean
language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements(p_snapshot -> 'sections') s
    where s ->> 'id' = p_group::text
      and (p_item is null or exists (select 1 from jsonb_array_elements(s -> 'items') i where i ->> 'id' = p_item::text)))
$$;

-- 5. Create (wizard step 8: save as draft) -----------------------------------------------------------
-- p: { name, calendar, startDate, targetEndDate, tasks: [{key, kind, sourceGroupId, sourceItemId, parentKey,
--      name, plannedStart, plannedEnd, durationDays, sortOrder}], deps: [{from, to, lagDays, maxOverlap}] }
-- Dates and durations are validated by the app server first (src/lib/schedule); the table checks hold regardless.
create or replace function public.schedule_create(p_estimate_id uuid, p_provisional boolean, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e record;
  v_id uuid;
  v_existing uuid;
  v_snapshot jsonb;
  v_accepted boolean;
  v_keys jsonb := '{}'::jsonb;
  t jsonb;
  d jsonb;
  v_task uuid;
  v_parent uuid;
begin
  if v_uid is null or not public.can_schedule_estimate(p_estimate_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into e from public.estimates where id = p_estimate_id;
  select id into v_existing from public.project_schedules where estimate_id = p_estimate_id and status <> 'archived';
  if v_existing is not null then
    raise exception 'schedule_exists' using errcode = '23505', detail = v_existing::text;
  end if;
  v_accepted := public.estimate_is_accepted(p_estimate_id);
  if not v_accepted and not coalesce(p_provisional, false) then
    raise exception 'not_accepted' using errcode = '42501';
  end if;
  v_snapshot := public.schedule_estimate_snapshot(p_estimate_id);
  if jsonb_array_length(coalesce(p -> 'tasks', '[]'::jsonb)) = 0 then
    raise exception 'no_tasks' using errcode = '22023';
  end if;

  insert into public.project_schedules (estimate_id, user_id, company_id, created_by, name, provisional, source_version_id, source_snapshot, calendar, start_date, target_end_date)
  values (p_estimate_id, e.user_id, e.company_id, v_uid,
          left(coalesce(nullif(btrim(p ->> 'name'), ''), nullif(btrim(e.title), ''), 'Project schedule'), 300),
          not v_accepted, nullif(v_snapshot #>> '{version,id}', '')::uuid, v_snapshot, p -> 'calendar',
          (p ->> 'startDate')::date, nullif(p ->> 'targetEndDate', '')::date)
  returning id into v_id;

  -- Sections first, then items (items reference their section by key).
  for t in select x from jsonb_array_elements(p -> 'tasks') x order by (x ->> 'kind') = 'item', coalesce((x ->> 'sortOrder')::int, 0) loop
    if not public.schedule_source_ok(v_snapshot, (t ->> 'sourceGroupId')::uuid, nullif(t ->> 'sourceItemId', '')::uuid) then
      raise exception 'unknown_source' using errcode = '22023';
    end if;
    v_parent := case when t ->> 'kind' = 'item' then (v_keys ->> (t ->> 'parentKey'))::uuid end;
    if t ->> 'kind' = 'item' and (v_parent is null or not exists (
        select 1 from public.schedule_tasks p2 where p2.id = v_parent and p2.source_group_id = (t ->> 'sourceGroupId')::uuid)) then
      raise exception 'bad_parent' using errcode = '22023';
    end if;
    insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, source_item_id, name, sort_order, planned_start, planned_end, duration_days)
    values (v_id, v_parent, t ->> 'kind', (t ->> 'sourceGroupId')::uuid, nullif(t ->> 'sourceItemId', '')::uuid,
            left(btrim(t ->> 'name'), 300), coalesce((t ->> 'sortOrder')::int, 0),
            (t ->> 'plannedStart')::date, (t ->> 'plannedEnd')::date, (t ->> 'durationDays')::int)
    returning id into v_task;
    v_keys := v_keys || jsonb_build_object(t ->> 'key', v_task);
  end loop;

  for d in select x from jsonb_array_elements(coalesce(p -> 'deps', '[]'::jsonb)) x loop
    insert into public.schedule_dependencies (schedule_id, predecessor_id, successor_id, lag_days, max_overlap)
    values (v_id, (v_keys ->> (d ->> 'from'))::uuid, (v_keys ->> (d ->> 'to'))::uuid,
            coalesce((d ->> 'lagDays')::int, 0), coalesce((d ->> 'maxOverlap')::int, 0));
  end loop;

  insert into public.schedule_revisions (schedule_id, revision, actor_id, summary, changes)
  values (v_id, 1, v_uid, case when v_accepted then 'Schedule created as a draft' else 'Provisional schedule created (bid not yet accepted)' end, '[]'::jsonb);
  if e.company_id is not null then
    insert into public.company_audit_log (company_id, actor_id, action, target_type, target_id, details)
    values (e.company_id, v_uid, 'schedule.created', 'estimate', p_estimate_id::text, jsonb_build_object('schedule_id', v_id, 'provisional', not v_accepted));
  end if;
  return v_id;
end $$;
revoke execute on function public.schedule_create(uuid, boolean, jsonb) from public, anon;
grant execute on function public.schedule_create(uuid, boolean, jsonb) to authenticated;

-- 6. Save edits ---------------------------------------------------------------------------------------
-- p: { schedule?: {name, status, calendar, startDate, targetEndDate, progressMethod},
--      tasks?: [{id | key, kind, sourceGroupId, sourceItemId, parentId, splitFrom, name, sortOrder, plannedStart,
--               plannedEnd, durationDays, actualStart, actualFinish, percentComplete, status, weight, assignee, notes}],
--      delete?: [task ids], deps?: [{from, to, lagDays, maxOverlap}] (full replacement; from/to = id or new key),
--      summary, changes }
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
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or v_uid is null or not public.schedule_can_edit(p_schedule_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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

-- 7. Reads (SECURITY INVOKER: RLS decides what comes back) -------------------------------------------
create or replace function public.schedule_get(p_schedule_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'schedule', to_jsonb(s) - 'source_snapshot',
    'snapshot', s.source_snapshot,
    'canEdit', public.schedule_can_edit(s.id),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order, t.planned_start, t.id) from public.schedule_tasks t where t.schedule_id = s.id), '[]'::jsonb),
    'deps', coalesce((select jsonb_agg(to_jsonb(d)) from public.schedule_dependencies d where d.schedule_id = s.id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from (
        select * from public.schedule_revisions r where r.schedule_id = s.id order by r.revision desc limit 50) r), '[]'::jsonb)
  ) from public.project_schedules s where s.id = p_schedule_id
$$;
revoke execute on function public.schedule_get(uuid) from public, anon;
grant execute on function public.schedule_get(uuid) to authenticated;

-- Projects list. Progress uses the same documented rule as the app (src/lib/schedule/progress.ts):
-- leaf tasks weighted by working-day duration (or explicit weight when the method is "weight").
create or replace function public.schedule_list() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(j order by (j ->> 'updated_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'estimate_id', s.estimate_id, 'name', s.name, 'status', s.status, 'provisional', s.provisional,
      'company_id', s.company_id, 'start_date', s.start_date, 'target_end_date', s.target_end_date, 'updated_at', s.updated_at,
      'customer_name', s.source_snapshot #>> '{estimate,customerName}',
      'finish_date', (select max(t.planned_end) from public.schedule_tasks t where t.schedule_id = s.id),
      'progress', (select round(coalesce(sum(w * t.percent_complete) / nullif(sum(w), 0), 0))
                   from public.schedule_tasks t
                   cross join lateral (select case when s.progress_method = 'weight' and t.weight is not null then t.weight else t.duration_days end::numeric as w) ww
                   where t.schedule_id = s.id and not exists (select 1 from public.schedule_tasks c where c.parent_id = t.id))
    ) as j
    from public.project_schedules s where s.status <> 'archived'
  ) x
$$;
revoke execute on function public.schedule_list() from public, anon;
grant execute on function public.schedule_list() to authenticated;
