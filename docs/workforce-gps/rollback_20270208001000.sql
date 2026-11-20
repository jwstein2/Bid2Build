-- Rollback for 20270208001000_gps_timekeeping.sql (V8.2 customer GPS timekeeping).
-- Removes GPS settings, work locations, enrollments, geofence events, corrections, sign-offs, supervisors and the
-- audit log; drops the new time-entry columns; restores the original time clock functions from
-- 20261210001000_team_records.sql. Hours already recorded stay: GPS / travel entries become "Time clock" entries and
-- correction entries become "Added by manager". Run this BEFORE the rollback of any older team-records migration.

drop function if exists public.pm_project_labor(uuid);
drop function if exists public.pm_gps_events_list(uuid, integer);
drop function if exists public.pm_gps_exceptions();
drop function if exists public.pm_timesheet_signoff(uuid, date);
drop function if exists public.pm_time_corrections_list(text);
drop function if exists public.pm_time_correction_decide(uuid, boolean, text);
drop function if exists public.pm_time_correction_withdraw(uuid);
drop function if exists public.pm_time_correction_request(jsonb);
drop function if exists public.pm_time_correction_json(public.pm_time_corrections);
drop function if exists public.pm_gps_away_resolve(uuid, text, text);
drop function if exists public.pm_gps_event(jsonb);
drop function if exists public.pm_gps_in_window(public.pm_gps_settings, uuid, public.pm_work_locations, timestamptz);
drop function if exists public.pm_gps_my_status();
drop function if exists public.pm_gps_device_status(uuid, jsonb);
drop function if exists public.pm_gps_consent(uuid, boolean, integer);
drop function if exists public.pm_gps_my_resource(uuid);
drop function if exists public.pm_gps_enrollment_save(uuid, jsonb);
drop function if exists public.pm_work_location_assign(uuid, uuid[], boolean);
drop function if exists public.pm_work_location_set_status(uuid, text);
drop function if exists public.pm_work_location_save(jsonb);
drop function if exists public.pm_gps_settings_save(jsonb);
drop function if exists public.pm_gps_admin_overview();
drop function if exists public.pm_time_apply(public.pm_resources, uuid, jsonb, text, text, text);
drop function if exists public.pm_time_check_location(uuid, public.pm_resources);
drop function if exists public.pm_gps_active(uuid);
drop function if exists public.pm_gps_assigned(uuid, uuid, date);
drop function if exists public.pm_work_location_ready(public.pm_work_locations);
drop function if exists public.pm_gps_settings_json(public.pm_gps_settings);
drop function if exists public.pm_gps_settings_for(uuid, uuid);
drop function if exists public.pm_time_supervisor_set(uuid, text);
drop function if exists public.pm_gps_log(uuid, uuid, text, uuid, jsonb);

drop table if exists public.pm_timesheet_signoffs;
drop table if exists public.pm_time_corrections;
drop table if exists public.pm_geofence_events;
drop table if exists public.pm_gps_enrollments;
drop table if exists public.pm_work_location_assignments;

drop trigger if exists pm_time_entries_keep_original on public.pm_time_entries;
drop function if exists public.pm_time_keep_original();
alter table public.pm_time_entries drop constraint if exists pm_time_entries_away_open;
alter table public.pm_time_entries drop constraint if exists pm_time_entries_review_flag_check;
alter table public.pm_time_entries drop constraint if exists pm_time_entries_paid_break_check;
alter table public.pm_time_entries drop constraint if exists pm_time_entries_work_type_check;
alter table public.pm_time_entries drop constraint if exists pm_time_entries_source_check;
update public.pm_time_entries set source = case when source in ('gps', 'gps_confirmed', 'travel') then 'clock' else 'manual' end
 where source not in ('clock', 'manual');
alter table public.pm_time_entries add constraint pm_time_entries_source_check check (source in ('clock', 'manual'));
alter table public.pm_time_entries drop column if exists location_id;
alter table public.pm_time_entries drop column if exists work_type;
alter table public.pm_time_entries drop column if exists paid_break_minutes;
alter table public.pm_time_entries drop column if exists shift_id;
alter table public.pm_time_entries drop column if exists away_since;
alter table public.pm_time_entries drop column if exists review_flag;
alter table public.pm_time_entries drop column if exists original_clock_in;
alter table public.pm_time_entries drop column if exists original_clock_out;

drop table if exists public.pm_work_locations;
drop table if exists public.pm_gps_settings;
drop table if exists public.pm_gps_audit;
drop function if exists public.pm_time_approver(uuid, uuid);
drop function if exists public.pm_time_supervisor(uuid, uuid);
drop function if exists public.pm_time_admin(uuid, uuid);
drop table if exists public.pm_time_supervisors;

-- Original time clock functions (verbatim from 20261210001000_team_records.sql) ------------------------------------
create or replace function public.pm_time_entry_json(e public.pm_time_entries) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', e.id, 'resourceId', e.resource_id, 'scheduleId', e.schedule_id, 'clockIn', e.clock_in, 'clockOut', e.clock_out,
    'breakMinutes', e.break_minutes, 'note', e.note, 'status', e.status, 'source', e.source,
    'inLocation', case when e.in_lat is not null then jsonb_build_object('lat', e.in_lat, 'lng', e.in_lng, 'accuracyM', e.in_accuracy_m) end,
    'outLocation', case when e.out_lat is not null then jsonb_build_object('lat', e.out_lat, 'lng', e.out_lng, 'accuracyM', e.out_accuracy_m) end,
    'edited', e.edited_at is not null, 'decisionNote', e.decision_note, 'decidedAt', e.decided_at)
$$;
revoke execute on function public.pm_time_entry_json(public.pm_time_entries) from public, anon;
grant execute on function public.pm_time_entry_json(public.pm_time_entries) to authenticated;

create or replace function public.pm_clock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; e public.pm_time_entries; v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid;
begin
  select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
  if not found or not public.pm_time_punch_allowed(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.pm_time_check_project(v_sched, r);
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open') then raise exception 'already_in' using errcode = '23505'; end if;
  perform public.pm_time_purge_locations(r.company_id, r.owner_id);
  insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, clock_in, note, status, source, in_lat, in_lng, in_accuracy_m, created_by)
  values (r.company_id, r.owner_id, r.id, v_sched, now(), left(nullif(btrim(p ->> 'note'), ''), 500), 'open', 'clock',
          round(nullif(p ->> 'lat', '')::numeric, 6), round(nullif(p ->> 'lng', '')::numeric, 6),
          case when nullif(p ->> 'lat', '') is not null then round(nullif(p ->> 'accuracyM', '')::numeric)::int end, auth.uid())
  returning * into e;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_clock_in(jsonb) from public, anon;
grant execute on function public.pm_clock_in(jsonb) to authenticated;

create or replace function public.pm_clock_out(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_out timestamptz := now();
begin
  select * into e from public.pm_time_entries where id = nullif(p ->> 'entryId', '')::uuid for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.pm_resources where id = e.resource_id;
  if not public.pm_time_punch_allowed(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  if e.status <> 'open' then raise exception 'not_open' using errcode = '22023'; end if;
  if p ? 'scheduleId' then perform public.pm_time_check_project(nullif(p ->> 'scheduleId', '')::uuid, r); end if;
  -- A forgotten punch is capped at 24 hours; a manager can fix the time afterwards.
  if v_out - e.clock_in > interval '24 hours' then v_out := e.clock_in + interval '24 hours'; end if;
  if v_out <= e.clock_in then v_out := e.clock_in + interval '1 second'; end if;
  update public.pm_time_entries set clock_out = v_out, status = 'pending',
    break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, break_minutes))),
    note = coalesce(left(nullif(btrim(p ->> 'note'), ''), 500), note),
    schedule_id = case when p ? 'scheduleId' then nullif(p ->> 'scheduleId', '')::uuid else schedule_id end,
    out_lat = round(nullif(p ->> 'lat', '')::numeric, 6), out_lng = round(nullif(p ->> 'lng', '')::numeric, 6),
    out_accuracy_m = case when nullif(p ->> 'lat', '') is not null then round(nullif(p ->> 'accuracyM', '')::numeric)::int end,
    updated_at = now()
  where id = e.id returning * into e;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_clock_out(jsonb) from public, anon;
grant execute on function public.pm_clock_out(jsonb) to authenticated;

create or replace function public.pm_time_entry_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.pm_time_entries; r public.pm_resources; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_in timestamptz := nullif(p ->> 'clockIn', '')::timestamptz; v_out timestamptz := nullif(p ->> 'clockOut', '')::timestamptz;
  v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_reason text := left(nullif(btrim(p ->> 'reason'), ''), 300); v_before jsonb;
begin
  if v_in is null or v_out is null then raise exception 'times_required' using errcode = '22023'; end if;
  if v_out <= v_in then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_out - v_in > interval '24 hours' then raise exception 'too_long' using errcode = '22023'; end if;
  if v_in > now() + interval '1 day' then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_id is not null then
    select * into e from public.pm_time_entries where id = v_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    select * into r from public.pm_resources where id = e.resource_id;
  else
    select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if r.kind <> 'staff' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_team_manageable(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.pm_time_check_project(v_sched, r);
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.id is distinct from v_id and x.status <> 'rejected'
               and tstzrange(x.clock_in, coalesce(x.clock_out, now()), '[)') && tstzrange(v_in, v_out, '[)')) then
    raise exception 'overlap' using errcode = '23P01';
  end if;
  if v_id is null then
    insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, clock_in, clock_out, break_minutes, note, status, source, created_by)
    values (r.company_id, r.owner_id, r.id, v_sched, v_in, v_out, greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, 0))),
            left(nullif(btrim(p ->> 'note'), ''), 500), 'pending', 'manual', auth.uid())
    returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, after) values (e.id, auth.uid(), 'added', v_reason, public.pm_time_entry_json(e));
  else
    if e.status = 'approved' then raise exception 'approved_locked' using errcode = '22023'; end if;
    if v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
    v_before := public.pm_time_entry_json(e);
    update public.pm_time_entries set schedule_id = v_sched, clock_in = v_in, clock_out = v_out,
      break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, break_minutes))),
      note = left(nullif(btrim(p ->> 'note'), ''), 500), status = case when status in ('open', 'rejected') then 'pending' else status end,
      edited_by = auth.uid(), edited_at = now(), updated_at = now()
    where id = e.id returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, before, after) values (e.id, auth.uid(), 'edited', v_reason, v_before, public.pm_time_entry_json(e));
  end if;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_time_entry_save(jsonb) from public, anon;
grant execute on function public.pm_time_entry_save(jsonb) to authenticated;

create or replace function public.pm_time_entries_decide(p_ids uuid[], p_action text, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_n integer := 0; v_before jsonb;
begin
  if p_action not in ('approve', 'reject', 'reopen') then raise exception 'bad_action' using errcode = '22023'; end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then raise exception 'bad_items' using errcode = '22023'; end if;
  if p_action = 'reject' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  for e in select * from public.pm_time_entries where id = any (p_ids) order by clock_in for update loop
    select * into r from public.pm_resources where id = e.resource_id;
    if not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_team_manageable(r.company_id, r.owner_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if r.company_id is not null and r.linked_user_id = auth.uid() and not public.team_is_company_owner(r.company_id) then
      raise exception 'forbidden_own' using errcode = '42501';
    end if;
    if e.status = 'open' then continue; end if;
    if (p_action = 'approve' and e.status = 'approved') or (p_action = 'reject' and e.status = 'rejected') or (p_action = 'reopen' and e.status = 'pending') then continue; end if;
    v_before := public.pm_time_entry_json(e);
    update public.pm_time_entries set
      status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'pending' end,
      decided_by = case when p_action = 'reopen' then null else auth.uid() end,
      decided_at = case when p_action = 'reopen' then null else now() end,
      decision_note = case when p_action = 'reopen' then null else left(nullif(btrim(p_note), ''), 300) end,
      updated_at = now()
    where id = e.id returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, before, after)
    values (e.id, auth.uid(), p_action, left(nullif(btrim(p_note), ''), 300), v_before, public.pm_time_entry_json(e));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.pm_time_entries_decide(uuid[], text, text) from public, anon;
grant execute on function public.pm_time_entries_decide(uuid[], text, text) to authenticated;

create or replace function public.pm_timesheet(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with scope as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o),
  mgr as (select public.pm_team_manageable(scope.c, scope.o) as m from scope),
  ents as (
    select e as ent, e.clock_in, e.schedule_id, e.resource_id from public.pm_time_entries e join public.pm_resources r on r.id = e.resource_id, scope
     where e.company_id is not distinct from scope.c and e.owner_id is not distinct from scope.o
       and e.clock_in < p_to and coalesce(e.clock_out, now()) >= p_from
       and ((select m from mgr) or r.linked_user_id = auth.uid())
     order by e.clock_in desc limit 5000)
  select jsonb_build_object(
    'canManage', (select m from mgr),
    'entries', coalesce((select jsonb_agg(public.pm_time_entry_json(ents.ent) order by ents.clock_in desc) from ents), '[]'::jsonb),
    'projects', coalesce((select jsonb_object_agg(s.id, s.name) from public.project_schedules s where s.id in (select schedule_id from ents)), '{}'::jsonb),
    'rates', case when (select m from mgr) then coalesce((select jsonb_object_agg(p.resource_id, p.hourly_cost) from public.pm_employee_profiles p
                 where p.hourly_cost is not null and p.resource_id in (select resource_id from ents)), '{}'::jsonb) else '{}'::jsonb end)
$$;
revoke execute on function public.pm_timesheet(timestamptz, timestamptz) from public, anon;
grant execute on function public.pm_timesheet(timestamptz, timestamptz) to authenticated;
