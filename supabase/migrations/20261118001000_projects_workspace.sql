-- Projects Workspace V4.1: sales rep / project manager on each project, project activity log,
-- closeout, and one read model (pm_workspace) that feeds Overview, Calendar, Timeline, Workload and
-- My Work from the SAME project_schedules / schedule_tasks rows the Gantt editor uses. Nothing here
-- copies a schedule; task edits still go only through schedule_save (revision-checked).
--
-- Access
--   * pm_workspace is SECURITY INVOKER: it only ever returns schedules the caller can already read
--     under the existing RLS (own bids, or company bids the member may see + "View project schedules").
--     Filters (rep, PM, project, dates) narrow that set; they can never widen it.
--   * Salesperson and project manager are separate columns. The estimate creator is backfilled as the
--     salesperson; nobody becomes PM automatically.
--   * Changing people or closing a project needs the schedule "edit" permission (Phase 9 rules:
--     PM editor seat + edit scope). Viewing an assigned project never grants internal financial access.
--
-- Safe to run more than once. Rollback: docs/projects-workspace/rollback_20261118001000.sql

-- 1. People and closeout on the existing project row ------------------------------------------------
alter table public.project_schedules add column if not exists sales_rep_id uuid references auth.users (id) on delete set null;
alter table public.project_schedules add column if not exists project_manager_id uuid references auth.users (id) on delete set null;
alter table public.project_schedules add column if not exists actual_finish date;
alter table public.project_schedules add column if not exists closed_at timestamptz;
alter table public.project_schedules add column if not exists closed_by uuid references auth.users (id) on delete set null;
alter table public.project_schedules add column if not exists closeout_note text;
do $$ begin
  alter table public.project_schedules add constraint project_schedules_closeout_note_len check (char_length(closeout_note) <= 1000);
exception when duplicate_object then null; end $$;

-- The person who created the estimate sold it.
update public.project_schedules s set sales_rep_id = e.user_id
  from public.estimates e where e.id = s.estimate_id and s.sales_rep_id is null;

create index if not exists project_schedules_pm_idx on public.project_schedules (project_manager_id) where project_manager_id is not null;
create index if not exists project_schedules_rep_idx on public.project_schedules (sales_rep_id) where sales_rep_id is not null;
-- Calendar / timeline windows read tasks by date range.
create index if not exists schedule_tasks_dates_idx on public.schedule_tasks (schedule_id, planned_start, planned_end);

-- New schedules record the salesperson too.
create or replace function public.project_schedules_default_rep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sales_rep_id is null then new.sales_rep_id := (select user_id from public.estimates where id = new.estimate_id); end if;
  return new;
end $$;
drop trigger if exists project_schedules_default_rep on public.project_schedules;
create trigger project_schedules_default_rep before insert on public.project_schedules for each row execute function public.project_schedules_default_rep();

-- 2. Activity log ----------------------------------------------------------------------------------
create table if not exists public.project_activity (
  id bigint generated always as identity primary key,
  schedule_id uuid not null references public.project_schedules (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('schedule_created', 'schedule_changed', 'people_changed', 'task_started', 'task_completed',
                                     'delay_recorded', 'customer_update', 'project_completed', 'project_reopened', 'note')),
  -- internal = team-only edits; customer = something the customer was shown.
  audience text not null default 'internal' check (audience in ('internal', 'customer')),
  summary text not null check (char_length(summary) between 1 and 500),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists project_activity_schedule_idx on public.project_activity (schedule_id, created_at desc);
alter table public.project_activity enable row level security;
drop policy if exists project_activity_select on public.project_activity;
create policy project_activity_select on public.project_activity for select to authenticated
  using (exists (select 1 from public.project_schedules s where s.id = project_activity.schedule_id));
revoke insert, update, delete on public.project_activity from anon, authenticated;
grant select on public.project_activity to authenticated;

-- Revisions: creation and each saved change (one row per save, not per drag pixel).
create or replace function public.project_activity_from_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Closeout / reopen log their own, clearer entry.
  if current_setting('app.project_closeout', true) = 'on' then return new; end if;
  insert into public.project_activity (schedule_id, actor_id, kind, summary, meta)
  values (new.schedule_id, new.actor_id, case when new.revision = 1 then 'schedule_created' else 'schedule_changed' end,
          left(new.summary, 500), jsonb_build_object('revision', new.revision, 'tasks', jsonb_array_length(coalesce(new.changes, '[]'::jsonb))));
  return new;
end $$;
drop trigger if exists project_activity_revision on public.schedule_revisions;
create trigger project_activity_revision after insert on public.schedule_revisions for each row execute function public.project_activity_from_revision();

-- Task state changes worth remembering: started, completed, delayed.
create or replace function public.project_activity_from_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('in_progress', 'complete', 'delayed') then
    insert into public.project_activity (schedule_id, actor_id, kind, summary, meta)
    values (new.schedule_id, auth.uid(),
            case new.status when 'complete' then 'task_completed' when 'delayed' then 'delay_recorded' else 'task_started' end,
            left(case new.status when 'complete' then 'Completed: ' when 'delayed' then 'Delayed: ' else 'Started: ' end || new.name, 500),
            jsonb_build_object('taskId', new.id));
  end if;
  return new;
end $$;
drop trigger if exists project_activity_task on public.schedule_tasks;
create trigger project_activity_task after update of status on public.schedule_tasks for each row execute function public.project_activity_from_task();

-- Customer updates (the frozen published snapshot itself stays in schedule_publications).
create or replace function public.project_activity_from_publication() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_activity (schedule_id, actor_id, kind, audience, summary, meta)
  values (new.schedule_id, new.published_by, 'customer_update', 'customer', 'Customer update #' || new.version || ' published',
          jsonb_build_object('publicationId', new.id, 'version', new.version));
  return new;
end $$;
do $$ begin
  if to_regclass('public.schedule_publications') is not null then
    drop trigger if exists project_activity_publication on public.schedule_publications;
    create trigger project_activity_publication after insert on public.schedule_publications for each row execute function public.project_activity_from_publication();
  end if;
end $$;

-- 3. Assign salesperson / project manager ------------------------------------------------------------
-- Company projects: both people must be active members of that company. Personal projects: only the
-- account owner (a solo contractor is their own rep and PM).
create or replace function public.schedule_set_people(p_schedule_id uuid, p_sales_rep uuid, p_project_manager uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s record; v_old_rep uuid; v_old_pm uuid; v_names text := '';
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or auth.uid() is null or not coalesce((public.schedule_permissions(p_schedule_id) ->> 'edit')::boolean, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.company_id is null then
    if (p_sales_rep is not null and p_sales_rep <> s.user_id) or (p_project_manager is not null and p_project_manager <> s.user_id) then
      raise exception 'not_member' using errcode = '22023';
    end if;
  elsif exists (select 1 from unnest(array[p_sales_rep, p_project_manager]) u(id)
                where u.id is not null and not exists (select 1 from public.company_members m
                  where m.company_id = s.company_id and m.user_id = u.id and m.status = 'active')) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  v_old_rep := s.sales_rep_id; v_old_pm := s.project_manager_id;
  if v_old_rep is not distinct from p_sales_rep and v_old_pm is not distinct from p_project_manager then return; end if;
  update public.project_schedules set sales_rep_id = p_sales_rep, project_manager_id = p_project_manager where id = p_schedule_id;
  if v_old_pm is distinct from p_project_manager then v_names := 'Project manager ' || case when p_project_manager is null then 'removed' else 'assigned' end; end if;
  if v_old_rep is distinct from p_sales_rep then v_names := v_names || case when v_names = '' then '' else '; ' end || 'Salesperson ' || case when p_sales_rep is null then 'removed' else 'changed' end; end if;
  insert into public.project_activity (schedule_id, actor_id, kind, summary, meta)
  values (p_schedule_id, auth.uid(), 'people_changed', v_names,
          jsonb_build_object('salesRep', p_sales_rep, 'projectManager', p_project_manager, 'previousSalesRep', v_old_rep, 'previousProjectManager', v_old_pm));
end $$;
revoke execute on function public.schedule_set_people(uuid, uuid, uuid) from public, anon;
grant execute on function public.schedule_set_people(uuid, uuid, uuid) to authenticated;

-- 4. Closeout and reopen -----------------------------------------------------------------------------
-- Completing a project never requires payment. Unfinished tasks block it unless the editor overrides
-- with a reason (recorded). Tasks are never auto-marked complete.
create or replace function public.schedule_closeout(p_schedule_id uuid, p_base_revision integer, p_actual_finish date, p_override_reason text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare s record; v_open integer; v_rev integer; v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or auth.uid() is null or not coalesce((public.schedule_permissions(p_schedule_id) ->> 'edit')::boolean, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.status = 'completed' then raise exception 'already_completed' using errcode = '22023'; end if;
  if s.revision <> p_base_revision then raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text; end if;
  if p_actual_finish is null or p_actual_finish < s.start_date then raise exception 'bad_finish' using errcode = '22023'; end if;
  select count(*) into v_open from public.schedule_tasks t
   where t.schedule_id = p_schedule_id and t.status <> 'complete' and not exists (select 1 from public.schedule_tasks c where c.parent_id = t.id);
  if v_open > 0 and v_reason is null then raise exception 'incomplete_tasks' using errcode = '22023', detail = v_open::text; end if;
  v_rev := s.revision + 1;
  perform set_config('app.project_closeout', 'on', true);
  update public.project_schedules set status = 'completed', actual_finish = p_actual_finish, closed_at = now(), closed_by = auth.uid(),
         closeout_note = left(v_reason, 1000), revision = v_rev, updated_at = now() where id = p_schedule_id;
  insert into public.schedule_revisions (schedule_id, revision, actor_id, summary, changes)
  values (p_schedule_id, v_rev, auth.uid(), left('Project completed' || case when v_reason is not null then ' (' || v_open || ' unfinished: ' || v_reason || ')' else '' end, 500), '[]'::jsonb);
  perform set_config('app.project_closeout', 'off', true);
  insert into public.project_activity (schedule_id, actor_id, kind, summary, meta)
  values (p_schedule_id, auth.uid(), 'project_completed', 'Project completed', jsonb_build_object('actualFinish', p_actual_finish, 'unfinished', v_open, 'reason', v_reason));
  return v_rev;
end $$;
revoke execute on function public.schedule_closeout(uuid, integer, date, text) from public, anon;
grant execute on function public.schedule_closeout(uuid, integer, date, text) to authenticated;

create or replace function public.schedule_reopen(p_schedule_id uuid, p_base_revision integer) returns integer
language plpgsql security definer set search_path = public as $$
declare s record; v_rev integer;
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  -- schedule_permissions refuses archived only; completed schedules keep their edit rights for reopening.
  if not found or auth.uid() is null or not coalesce((public.schedule_permissions(p_schedule_id) ->> 'edit')::boolean, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.status <> 'completed' then raise exception 'not_completed' using errcode = '22023'; end if;
  if s.revision <> p_base_revision then raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text; end if;
  v_rev := s.revision + 1;
  perform set_config('app.project_closeout', 'on', true);
  update public.project_schedules set status = 'active', closed_at = null, closed_by = null, revision = v_rev, updated_at = now() where id = p_schedule_id;
  insert into public.schedule_revisions (schedule_id, revision, actor_id, summary) values (p_schedule_id, v_rev, auth.uid(), 'Project reopened');
  perform set_config('app.project_closeout', 'off', true);
  insert into public.project_activity (schedule_id, actor_id, kind, summary) values (p_schedule_id, auth.uid(), 'project_reopened', 'Project reopened');
  return v_rev;
end $$;
revoke execute on function public.schedule_reopen(uuid, integer) from public, anon;
grant execute on function public.schedule_reopen(uuid, integer) to authenticated;

-- 5. Workspace read model ----------------------------------------------------------------------------
-- Display names for people the caller may see: themselves, and active members of their company.
create or replace function public.pm_people() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', x.id, 'name', x.name, 'role', x.role)), '[]'::jsonb) from (
    select u.id, coalesce(nullif(btrim(bp.contact_name), ''), split_part(u.email, '@', 1)) as name, 'self'::text as role
      from auth.users u left join public.business_profiles bp on bp.user_id = u.id
     where u.id = auth.uid() and public.my_company_id() is null
    union all
    select m.user_id, coalesce(nullif(btrim(m.display_name), ''), split_part(coalesce(m.email, ''), '@', 1), 'Team member'), m.role
      from public.company_members m where m.company_id = public.my_company_id() and m.status = 'active'
  ) x
$$;
revoke execute on function public.pm_people() from public, anon;
grant execute on function public.pm_people() to authenticated;

-- Every authorized project (summary) + the tasks inside a date window. One call per screen.
create or replace function public.pm_workspace(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_from date := coalesce(p_from, current_date - 30); v_to date := coalesce(p_to, current_date + 90);
begin
  if v_to < v_from or v_to - v_from > 400 then raise exception 'bad_window' using errcode = '22023'; end if;
  return jsonb_build_object(
    'me', auth.uid(),
    'people', public.pm_people(),
    'projects', coalesce((
      -- Materialized once: inlining the leaf test into each FILTER made the planner expand every RLS
      -- policy per aggregate (seconds of planning even with no rows).
      with tl as materialized (
        select t.schedule_id, t.status, t.percent_complete, t.planned_end,
               (case when s.progress_method = 'weight' and t.weight is not null then t.weight else t.duration_days end)::numeric as w,
               not exists (select 1 from public.schedule_tasks c where c.parent_id = t.id) as leaf
        from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id where s.status <> 'archived'
      ), agg as materialized (
        select schedule_id, max(planned_end) as finish,
               count(*) filter (where leaf) as total,
               count(*) filter (where leaf and status = 'complete') as done,
               count(*) filter (where leaf and status = 'delayed') as delayed,
               count(*) filter (where leaf and status <> 'complete' and planned_end < current_date) as overdue,
               round(coalesce(sum(w * percent_complete) filter (where leaf) / nullif(sum(w) filter (where leaf), 0), 0)) as progress
        from tl group by schedule_id
      ), pub as materialized (
        select schedule_id, max(published_at) as last_at from public.schedule_publications group by schedule_id
      )
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'estimate_id', s.estimate_id, 'company_id', s.company_id, 'name', s.name, 'status', s.status, 'provisional', s.provisional,
        'start_date', s.start_date, 'target_end_date', s.target_end_date, 'actual_finish', s.actual_finish, 'revision', s.revision,
        'sales_rep_id', s.sales_rep_id, 'project_manager_id', s.project_manager_id, 'created_by', s.created_by, 'owner_id', s.user_id,
        'customer_name', s.source_snapshot #>> '{estimate,customerName}',
        'trades', coalesce(s.source_snapshot -> 'trades', '[]'::jsonb),
        'calendar', s.calendar,
        'finish_date', agg.finish, 'tasks_total', coalesce(agg.total, 0), 'tasks_done', coalesce(agg.done, 0), 'tasks_delayed', coalesce(agg.delayed, 0),
        'tasks_overdue', coalesce(agg.overdue, 0), 'progress', coalesce(agg.progress, 0),
        'last_update_at', pub.last_at, 'last_change_at', s.updated_at,
        'permissions', public.schedule_permissions(s.id)
      ) order by s.start_date, s.name)
      from public.project_schedules s left join agg on agg.schedule_id = s.id left join pub on pub.schedule_id = s.id
      where s.status <> 'archived'
    ), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'schedule_id', t.schedule_id, 'parent_id', t.parent_id, 'kind', t.kind, 'name', t.name, 'sort_order', t.sort_order,
        'planned_start', t.planned_start, 'planned_end', t.planned_end, 'duration_days', t.duration_days,
        'actual_start', t.actual_start, 'actual_finish', t.actual_finish, 'percent_complete', t.percent_complete, 'status', t.status,
        'assignee', t.assignee, 'section_trade', (select g ->> 'trade' from jsonb_array_elements(s.source_snapshot -> 'sections') g where g ->> 'id' = t.source_group_id::text limit 1)
      ) order by t.planned_start, t.sort_order)
      from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id
      where s.status <> 'archived' and t.planned_end >= v_from and t.planned_start <= v_to), '[]'::jsonb),
    'deps', coalesce((select jsonb_agg(jsonb_build_object('from', d.predecessor_id, 'to', d.successor_id, 'lagDays', d.lag_days))
      from public.schedule_dependencies d join public.project_schedules s on s.id = d.schedule_id where s.status <> 'archived'), '[]'::jsonb),
    'from', v_from, 'to', v_to
  );
end $$;
revoke execute on function public.pm_workspace(date, date) from public, anon;
grant execute on function public.pm_workspace(date, date) to authenticated;

-- Activity feed for one project: logged events plus bid approval and signature from their own tables.
create or replace function public.project_activity_feed(p_schedule_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(j order by (j ->> 'at') desc), '[]'::jsonb) from (
    select jsonb_build_object('kind', a.kind, 'audience', a.audience, 'summary', a.summary, 'actor', a.actor_id, 'at', a.created_at) j
      from public.project_activity a where a.schedule_id = p_schedule_id
    union all
    select jsonb_build_object('kind', 'bid_approved', 'audience', 'internal', 'summary', 'Bid marked Won (approved manually)', 'actor', h.changed_by, 'at', h.created_at)
      from public.estimate_stage_history h join public.project_schedules s on s.estimate_id = h.estimate_id
     where s.id = p_schedule_id and h.to_stage = 'won'
    union all
    select jsonb_build_object('kind', 'proposal_signed', 'audience', 'customer', 'summary', 'Proposal signed electronically by the customer', 'actor', null, 'at', g.signed_at)
      from public.signatures g join public.project_schedules s on s.estimate_id = g.estimate_id
     where s.id = p_schedule_id
  ) x
$$;
revoke execute on function public.project_activity_feed(uuid) from public, anon;
grant execute on function public.project_activity_feed(uuid) to authenticated;
