-- Project Management Addendum V4.2: Team & Subcontractors directory and "who's doing the work".
--
--   * pm_resources: staff (optionally linked to an existing company member), subcontractors and crews,
--     owned by a company (Enterprise) or by a solo account. Subcontractors never get a Built2Bid login.
--   * pm_crew_members: which staff / subcontractors make up a crew (for double-booking checks).
--   * schedule_tasks gains resource_id + assignment status. Assigning a section fills the tasks inside it
--     that have no assignment of their own (assignment_inherited = true); a task-level override is kept
--     when the section is reassigned. "Confirmed" is recorded separately (who and when).
--   * project_schedules.report_assignees decides what the customer report shows: nothing, names, or
--     names with contact info. Default is names only, never contact details.
--   * Nothing here sends a message. Assignment notices are copied / opened in the user's own email app.
--
-- Access: reading follows "View project schedules" (company) or ownership (solo). Writes only through
-- the RPCs below; directory changes need schedule create/edit rights, assignments need schedule "edit".
-- Safe to run more than once. Requires 20261118001000_projects_workspace.sql.
-- Rollback: docs/projects-workspace/rollback_20261118002000.sql

-- 1. Directory ---------------------------------------------------------------------------------------
create table if not exists public.pm_resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('staff', 'subcontractor', 'crew')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  contact_name text check (char_length(contact_name) <= 200),
  linked_user_id uuid references auth.users (id) on delete set null,
  trades text[] not null default '{}' check (cardinality(trades) <= 20),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 40),
  notes text check (char_length(notes) <= 2000),
  capacity integer not null default 1 check (capacity between 1 and 50),
  unavailable date[] not null default '{}' check (cardinality(unavailable) <= 400),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_resources_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_resources_link check (linked_user_id is null or kind = 'staff')
);
create index if not exists pm_resources_company_idx on public.pm_resources (company_id, status) where company_id is not null;
create index if not exists pm_resources_owner_idx on public.pm_resources (owner_id, status) where owner_id is not null;
create unique index if not exists pm_resources_one_link on public.pm_resources (coalesce(company_id, owner_id), linked_user_id) where linked_user_id is not null;

create table if not exists public.pm_crew_members (
  crew_id uuid not null references public.pm_resources (id) on delete cascade,
  member_id uuid not null references public.pm_resources (id) on delete cascade,
  primary key (crew_id, member_id),
  check (crew_id <> member_id)
);

-- Who may read / change a directory.
create or replace function public.pm_resource_readable(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_company is null then p_owner = auth.uid()
              else public.has_company_permission(p_company, 'view_schedules') end
$$;
create or replace function public.pm_team_manageable(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and case when p_company is null then p_owner = auth.uid()
    else public.has_company_permission(p_company, 'edit_all_schedules') or public.has_company_permission(p_company, 'edit_assigned_schedules')
         or public.has_company_permission(p_company, 'create_schedules') end
$$;
revoke execute on function public.pm_resource_readable(uuid, uuid), public.pm_team_manageable(uuid, uuid) from public, anon;
grant execute on function public.pm_resource_readable(uuid, uuid), public.pm_team_manageable(uuid, uuid) to authenticated;

alter table public.pm_resources enable row level security;
alter table public.pm_crew_members enable row level security;
drop policy if exists pm_resources_select on public.pm_resources;
create policy pm_resources_select on public.pm_resources for select to authenticated
  using (public.pm_resource_readable(company_id, owner_id));
drop policy if exists pm_crew_members_select on public.pm_crew_members;
create policy pm_crew_members_select on public.pm_crew_members for select to authenticated
  using (exists (select 1 from public.pm_resources r where r.id = crew_id));
revoke all on public.pm_resources, public.pm_crew_members from anon, authenticated;
grant select on public.pm_resources, public.pm_crew_members to authenticated;

-- 2. Assignments on tasks ----------------------------------------------------------------------------
alter table public.schedule_tasks add column if not exists resource_id uuid references public.pm_resources (id) on delete set null;
alter table public.schedule_tasks add column if not exists assignment_status text;
alter table public.schedule_tasks add column if not exists assignment_inherited boolean not null default false;
alter table public.schedule_tasks add column if not exists assignment_confirmed_at timestamptz;
alter table public.schedule_tasks add column if not exists assignment_confirmed_by uuid references auth.users (id) on delete set null;
do $$ begin
  alter table public.schedule_tasks add constraint schedule_tasks_assignment_status
    check (assignment_status is null or assignment_status in ('tentative', 'requested', 'confirmed', 'declined'));
exception when duplicate_object then null; end $$;
create index if not exists schedule_tasks_resource_idx on public.schedule_tasks (resource_id) where resource_id is not null;

alter table public.project_schedules add column if not exists report_assignees text not null default 'names';
do $$ begin
  alter table public.project_schedules add constraint project_schedules_report_assignees check (report_assignees in ('hidden', 'names', 'names_contacts'));
exception when duplicate_object then null; end $$;

-- Typing a different name in the Gantt "Assigned to" field replaces a directory assignment (text wins),
-- so the two can never disagree.
create or replace function public.schedule_tasks_assignee_text() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.assignee is distinct from old.assignee and new.resource_id is not distinct from old.resource_id and new.resource_id is not null then
    new.resource_id := null; new.assignment_status := null; new.assignment_inherited := false;
    new.assignment_confirmed_at := null; new.assignment_confirmed_by := null;
  end if;
  return new;
end $$;
drop trigger if exists schedule_tasks_assignee_text on public.schedule_tasks;
create trigger schedule_tasks_assignee_text before update of assignee on public.schedule_tasks
  for each row execute function public.schedule_tasks_assignee_text();

-- 3. Directory RPCs -----------------------------------------------------------------------------------
-- The caller's directory: their company's, or their own when they aren't in a company.
create or replace function public.pm_team() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'companyId', public.my_company_id(),
    'canManage', public.pm_team_manageable(public.my_company_id(), case when public.my_company_id() is null then auth.uid() end),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'contactName', r.contact_name, 'linkedUserId', r.linked_user_id,
        'trades', to_jsonb(r.trades), 'email', r.email, 'phone', r.phone, 'notes', r.notes, 'capacity', r.capacity,
        'unavailable', to_jsonb(r.unavailable), 'status', r.status, 'updatedAt', r.updated_at,
        'members', coalesce((select jsonb_agg(m.member_id) from public.pm_crew_members m where m.crew_id = r.id), '[]'::jsonb)
      ) order by r.status, r.kind, lower(r.name))
      from public.pm_resources r
      where (public.my_company_id() is not null and r.company_id = public.my_company_id())
         or (public.my_company_id() is null and r.owner_id = auth.uid())), '[]'::jsonb))
$$;
revoke execute on function public.pm_team() from public, anon;
grant execute on function public.pm_team() to authenticated;

-- Create or update one directory entry (and a crew's members). Returns its id.
create or replace function public.pm_resource_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_owner uuid := case when public.my_company_id() is null then auth.uid() end;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_kind text := p ->> 'kind';
  v_link uuid := nullif(p ->> 'linkedUserId', '')::uuid;
  v_trades text[];
  v_unav date[];
  v_members uuid[];
  r record;
begin
  if not public.pm_team_manageable(v_company, v_owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_id is not null then
    select * into r from public.pm_resources where id = v_id for update;
    if not found or r.company_id is distinct from v_company or r.owner_id is distinct from v_owner then raise exception 'not_found' using errcode = '42501'; end if;
    v_kind := r.kind; -- the kind of an entry doesn't change
  end if;
  if v_kind is null or v_kind not in ('staff', 'subcontractor', 'crew') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if v_kind <> 'staff' then v_link := null; end if;
  if v_link is not null and not (
       (v_company is not null and exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = v_link and m.status = 'active'))
       or (v_company is null and v_link = auth.uid())) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct left(lower(btrim(x)), 40)) filter (where btrim(x) <> ''), '{}') into v_trades
    from jsonb_array_elements_text(coalesce(p -> 'trades', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_unav
    from jsonb_array_elements_text(coalesce(p -> 'unavailable', '[]'::jsonb)) x;

  if v_id is null then
    insert into public.pm_resources (company_id, owner_id, kind, name, contact_name, linked_user_id, trades, email, phone, notes, capacity, unavailable, created_by)
    values (v_company, v_owner, v_kind, left(btrim(p ->> 'name'), 200), left(nullif(btrim(p ->> 'contactName'), ''), 200), v_link, v_trades,
            left(nullif(btrim(p ->> 'email'), ''), 320), left(nullif(btrim(p ->> 'phone'), ''), 40), left(nullif(btrim(p ->> 'notes'), ''), 2000),
            greatest(1, least(50, coalesce((p ->> 'capacity')::int, 1))), v_unav, auth.uid())
    returning id into v_id;
  else
    update public.pm_resources set name = left(btrim(p ->> 'name'), 200), contact_name = left(nullif(btrim(p ->> 'contactName'), ''), 200),
      linked_user_id = v_link, trades = v_trades, email = left(nullif(btrim(p ->> 'email'), ''), 320), phone = left(nullif(btrim(p ->> 'phone'), ''), 40),
      notes = left(nullif(btrim(p ->> 'notes'), ''), 2000), capacity = greatest(1, least(50, coalesce((p ->> 'capacity')::int, capacity))),
      unavailable = v_unav, updated_at = now()
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

-- Archive (or restore). Archived entries keep their past assignments but aren't offered for new work.
create or replace function public.pm_resource_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_status not in ('active', 'archived') then raise exception 'bad_status' using errcode = '22023'; end if;
  select * into r from public.pm_resources where id = p_id for update;
  if not found or not public.pm_team_manageable(r.company_id, r.owner_id)
     or r.company_id is distinct from public.my_company_id()
     or (r.company_id is null and r.owner_id <> auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.pm_resources set status = p_status, updated_at = now() where id = p_id;
  if p_status = 'archived' then delete from public.pm_crew_members where member_id = p_id; end if;
end $$;
revoke execute on function public.pm_resource_set_status(uuid, text) from public, anon;
grant execute on function public.pm_resource_set_status(uuid, text) to authenticated;

-- 4. Assign work --------------------------------------------------------------------------------------
-- p_items: [{taskId, resourceId (null clears), status}]. A section assignment flows into its tasks
-- unless a task has its own assignment. One revision per call, so every view and the history agree.
create or replace function public.schedule_assign(p_schedule_id uuid, p_base_revision integer, p_items jsonb, p_summary text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record; it jsonb; t record; r record; v_name text; v_res uuid; v_status text; v_rev integer; v_n integer := 0;
begin
  select * into s from public.project_schedules where id = p_schedule_id for update;
  if not found or auth.uid() is null or not coalesce((public.schedule_permissions(p_schedule_id) ->> 'edit')::boolean, false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.revision <> p_base_revision then raise exception 'stale_revision' using errcode = '40001', detail = s.revision::text; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then
    raise exception 'bad_items' using errcode = '22023';
  end if;

  for it in select x from jsonb_array_elements(p_items) x loop
    select * into t from public.schedule_tasks where id = (it ->> 'taskId')::uuid and schedule_id = p_schedule_id for update;
    if not found then raise exception 'bad_task' using errcode = '22023'; end if;
    v_res := nullif(it ->> 'resourceId', '')::uuid;
    v_status := case when v_res is null then null else coalesce(nullif(it ->> 'status', ''), 'tentative') end;
    if v_status is not null and v_status not in ('tentative', 'requested', 'confirmed', 'declined') then raise exception 'bad_status' using errcode = '22023'; end if;
    v_name := null;
    if v_res is not null then
      select * into r from public.pm_resources where id = v_res;
      -- Only the project's own directory: the same company, or the solo owner's.
      if not found or r.status <> 'active'
         or (s.company_id is not null and r.company_id is distinct from s.company_id)
         or (s.company_id is null and r.owner_id is distinct from s.user_id) then
        raise exception 'bad_resource' using errcode = '22023';
      end if;
      v_name := left(r.name, 200);
    end if;

    update public.schedule_tasks set
      resource_id = v_res, assignee = v_name,
      assignment_status = v_status, assignment_inherited = false,
      assignment_confirmed_at = case when v_status = 'confirmed' then case when t.assignment_status = 'confirmed' and t.resource_id = v_res then t.assignment_confirmed_at else now() end end,
      assignment_confirmed_by = case when v_status = 'confirmed' then case when t.assignment_status = 'confirmed' and t.resource_id = v_res then t.assignment_confirmed_by else auth.uid() end end,
      updated_at = now()
    where id = t.id;
    v_n := v_n + 1;

    if t.kind = 'section' then
      -- Tasks inside follow the section unless they carry their own assignment (an override).
      update public.schedule_tasks c set
        resource_id = v_res, assignee = v_name,
        assignment_status = v_status, assignment_inherited = v_res is not null,
        assignment_confirmed_at = case when v_status = 'confirmed' then now() end,
        assignment_confirmed_by = case when v_status = 'confirmed' then auth.uid() end,
        updated_at = now()
      where c.schedule_id = p_schedule_id and c.parent_id = t.id
        and (c.assignment_inherited or (c.resource_id is null and c.assignee is null));
    end if;
  end loop;

  v_rev := s.revision + 1;
  update public.project_schedules set revision = v_rev, updated_at = now() where id = p_schedule_id;
  insert into public.schedule_revisions (schedule_id, revision, actor_id, summary, changes)
  values (p_schedule_id, v_rev, auth.uid(), left(coalesce(nullif(btrim(p_summary), ''), 'Assignments updated (' || v_n || ')'), 500), '[]'::jsonb);
  return v_rev;
end $$;
revoke execute on function public.schedule_assign(uuid, integer, jsonb, text) from public, anon;
grant execute on function public.schedule_assign(uuid, integer, jsonb, text) to authenticated;

-- What the customer report shows about who's doing the work.
create or replace function public.schedule_set_report_assignees(p_schedule_id uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare v jsonb := public.schedule_permissions(p_schedule_id);
begin
  if p_mode not in ('hidden', 'names', 'names_contacts') then raise exception 'bad_mode' using errcode = '22023'; end if;
  if not (coalesce((v ->> 'edit')::boolean, false) or coalesce((v ->> 'publish')::boolean, false)) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.project_schedules set report_assignees = p_mode where id = p_schedule_id;
end $$;
revoke execute on function public.schedule_set_report_assignees(uuid, text) from public, anon;
grant execute on function public.schedule_set_report_assignees(uuid, text) to authenticated;

-- Assignment fields for the workspace window (merged into pm_workspace tasks by the app).
create or replace function public.pm_task_assignments(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'resourceId', t.resource_id, 'status', t.assignment_status,
           'inherited', t.assignment_inherited, 'confirmedAt', t.assignment_confirmed_at)), '[]'::jsonb)
  from public.schedule_tasks t join public.project_schedules s on s.id = t.schedule_id
  where s.status <> 'archived' and t.resource_id is not null and t.planned_end >= p_from and t.planned_start <= p_to
$$;
revoke execute on function public.pm_task_assignments(date, date) from public, anon;
grant execute on function public.pm_task_assignments(date, date) to authenticated;
