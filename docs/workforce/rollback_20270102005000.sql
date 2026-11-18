-- Rollback for 20270102005000_workforce_directory.sql (V7.3 Contractors & Workforce).
-- Keeps every directory entry and every assignment. Removes: worker -> company links, entity, crew size,
-- specialties, assignment notes / hours / times, the assignment audit history, and the V7.3 RPCs.
-- 'cancelled' assignments become 'declined' (the closest V4.2 status). Restores the V4.2 pm_resource_save / pm_team.
-- Run newer rollbacks first (newest first).

do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pm_assignment_events') then
    alter publication supabase_realtime drop table public.pm_assignment_events;
  end if;
end $$;
drop function if exists public.pm_resource_history(uuid);
drop function if exists public.pm_assign_targets();
drop function if exists public.pm_workforce();
drop function if exists public.pm_assign_resource(jsonb);
drop function if exists public.pm_can_override(uuid);
drop function if exists public.pm_resource_conflicts(uuid, uuid, uuid, date, date, time, time);
drop function if exists public.pm_resource_mode(public.pm_resources);
drop trigger if exists schedule_tasks_assignment_log on public.schedule_tasks;
drop function if exists public.schedule_tasks_assignment_log();
drop table if exists public.pm_assignment_events;

update public.schedule_tasks set assignment_status = 'declined' where assignment_status = 'cancelled';
alter table public.schedule_tasks drop constraint if exists schedule_tasks_assignment_status;
alter table public.schedule_tasks add constraint schedule_tasks_assignment_status
  check (assignment_status is null or assignment_status in ('tentative', 'requested', 'confirmed', 'declined'));
alter table public.schedule_tasks drop constraint if exists schedule_tasks_assignment_notes;
alter table public.schedule_tasks drop constraint if exists schedule_tasks_assignment_hours;
alter table public.schedule_tasks drop constraint if exists schedule_tasks_assignment_times;
alter table public.schedule_tasks drop column if exists assignment_notes;
alter table public.schedule_tasks drop column if exists assignment_hours;
alter table public.schedule_tasks drop column if exists assignment_start_time;
alter table public.schedule_tasks drop column if exists assignment_end_time;

drop trigger if exists pm_resources_parent_check on public.pm_resources;
drop function if exists public.pm_resources_parent_check();
alter table public.pm_resources drop constraint if exists pm_resources_entity;
alter table public.pm_resources drop constraint if exists pm_resources_parent;
alter table public.pm_resources drop constraint if exists pm_resources_crew_size;
alter table public.pm_resources drop constraint if exists pm_resources_specialties;
drop index if exists public.pm_resources_parent_idx;
alter table public.pm_resources drop column if exists parent_id;
alter table public.pm_resources drop column if exists entity;
alter table public.pm_resources drop column if exists crew_size;
alter table public.pm_resources drop column if exists capacity_declared;
alter table public.pm_resources drop column if exists specialties;

-- V4.2 versions (copied from 20261118002000_team_assignments.sql).
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
