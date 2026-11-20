-- Rollback for 20270210001000_worker_hub.sql (V8.3 workforce & HR integration). Removes only what that file added and
-- restores pm_gps_enrollment_save as 20270208001000 defined it. Time entries, shifts' source data and HR records stay.
drop function if exists public.pm_labor_report(date, date);
drop function if exists public.pm_pay_inputs(uuid);
drop function if exists public.pm_worker_pay_prefs_save(uuid, jsonb);
drop function if exists public.pm_pay_settings_save(jsonb);
drop function if exists public.pm_pay_admin_overview();
drop function if exists public.pm_worker_week(uuid, date);
drop function if exists public.pm_pay_status(public.pm_resources);
drop function if exists public.pm_pay_worker_visible(public.pm_resources);
drop function if exists public.pm_pay_settings_json(public.pm_pay_settings);
drop function if exists public.pm_pay_settings_for(uuid, uuid);
drop table if exists public.pm_worker_pay_prefs;
drop table if exists public.pm_pay_settings;
drop function if exists public.pm_worker_schedule(uuid, date, date);
drop function if exists public.pm_worker_can_view(public.pm_resources);
drop function if exists public.pm_worker_schedule_raw(uuid, date, date);
drop function if exists public.pm_work_shift_cancel(uuid);
drop function if exists public.pm_work_shift_save(jsonb);
drop function if exists public.pm_work_shift_json(public.pm_work_shifts);
drop table if exists public.pm_work_shifts;
drop function if exists public.pm_worker_classifications();
drop function if exists public.pm_worker_classification_set(uuid, text);
alter table public.pm_employee_profiles drop constraint if exists pm_employee_profiles_classification_check;
alter table public.pm_employee_profiles drop column if exists classification;

create or replace function public.pm_gps_enrollment_save(p_resource_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; e public.pm_gps_enrollments; v_w2 boolean; v_enrolled boolean;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_time_admin(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.kind <> 'staff' then raise exception 'staff_only' using errcode = '22023'; end if;
  select * into e from public.pm_gps_enrollments where resource_id = r.id for update;
  v_w2 := coalesce((p ->> 'w2Confirmed')::boolean, e.w2_confirmed_at is not null);
  v_enrolled := coalesce((p ->> 'enrolled')::boolean, coalesce(e.enrolled, false)) and v_w2;
  if coalesce((p ->> 'enrolled')::boolean, false) and not v_w2 then raise exception 'w2_required' using errcode = '22023'; end if;
  insert into public.pm_gps_enrollments as x (resource_id, company_id, owner_id, enrolled, w2_confirmed_at, w2_confirmed_by)
  values (r.id, r.company_id, r.owner_id, v_enrolled, case when v_w2 then now() end, case when v_w2 then auth.uid() end)
  on conflict (resource_id) do update set enrolled = v_enrolled,
    w2_confirmed_at = case when not v_w2 then null when x.w2_confirmed_at is null then now() else x.w2_confirmed_at end,
    w2_confirmed_by = case when not v_w2 then null when x.w2_confirmed_at is null then auth.uid() else x.w2_confirmed_by end,
    updated_at = now()
  returning * into e;
  perform public.pm_gps_log(r.company_id, r.owner_id, 'enrollment.save', r.id, jsonb_build_object('enrolled', e.enrolled, 'w2Confirmed', e.w2_confirmed_at is not null));
  return jsonb_build_object('enrolled', e.enrolled, 'w2ConfirmedAt', e.w2_confirmed_at, 'active', public.pm_gps_active(r.id));
end $$;
revoke execute on function public.pm_gps_enrollment_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_gps_enrollment_save(uuid, jsonb) to authenticated;

-- Restore the V8.2 (20270208001000) versions of the functions this migration changed.

drop trigger if exists pm_time_entries_set_category on public.pm_time_entries;

drop function if exists public.pm_time_set_category();

drop function if exists public.pm_time_default_category(text, uuid, uuid);

drop index if exists public.pm_time_entries_category_idx;

alter table public.pm_time_entries drop constraint if exists pm_time_entries_category_check;
alter table public.pm_time_entries drop column if exists work_category;

alter table public.pm_work_locations drop constraint if exists pm_work_locations_category_check;
alter table public.pm_work_locations drop column if exists work_category;

alter table public.pm_time_corrections drop column if exists work_category;
alter table public.pm_time_corrections drop column if exists issue;

create or replace function public.pm_time_entry_json(e public.pm_time_entries) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', e.id, 'resourceId', e.resource_id, 'scheduleId', e.schedule_id, 'clockIn', e.clock_in, 'clockOut', e.clock_out,
    'breakMinutes', e.break_minutes, 'paidBreakMinutes', e.paid_break_minutes, 'note', e.note, 'status', e.status, 'source', e.source,
    'locationId', e.location_id, 'workType', e.work_type, 'shiftId', e.shift_id, 'awaySince', e.away_since, 'reviewFlag', e.review_flag,
    'originalClockIn', e.original_clock_in, 'originalClockOut', e.original_clock_out,
    'inLocation', case when e.in_lat is not null then jsonb_build_object('lat', e.in_lat, 'lng', e.in_lng, 'accuracyM', e.in_accuracy_m) end,
    'outLocation', case when e.out_lat is not null then jsonb_build_object('lat', e.out_lat, 'lng', e.out_lng, 'accuracyM', e.out_accuracy_m) end,
    'edited', e.edited_at is not null, 'decisionNote', e.decision_note, 'decidedAt', e.decided_at)
$$;

create or replace function public.pm_clock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; e public.pm_time_entries; v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_loc uuid := nullif(p ->> 'locationId', '')::uuid;
  v_type text := coalesce(nullif(p ->> 'workType', ''), 'regular');
begin
  select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
  if not found or not public.pm_time_punch_allowed(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.pm_time_check_project(v_sched, r);
  perform public.pm_time_check_location(v_loc, r);
  if v_type not in ('regular', 'travel', 'offsite') then raise exception 'bad_work_type' using errcode = '22023'; end if;
  if v_sched is null and v_loc is not null then select l.schedule_id into v_sched from public.pm_work_locations l where l.id = v_loc; end if;
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open') then raise exception 'already_in' using errcode = '23505'; end if;
  perform public.pm_time_purge_locations(r.company_id, r.owner_id);
  insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, location_id, work_type, clock_in, note, status, source, in_lat, in_lng, in_accuracy_m, created_by)
  values (r.company_id, r.owner_id, r.id, v_sched, v_loc, v_type, now(), left(nullif(btrim(p ->> 'note'), ''), 500), 'open', 'clock',
          round(nullif(p ->> 'lat', '')::numeric, 6), round(nullif(p ->> 'lng', '')::numeric, 6),
          case when nullif(p ->> 'lat', '') is not null then round(nullif(p ->> 'accuracyM', '')::numeric)::int end, auth.uid())
  returning * into e;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_clock_in(jsonb) from public, anon;
grant execute on function public.pm_clock_in(jsonb) to authenticated;

create or replace function public.pm_time_apply(r public.pm_resources, p_id uuid, p jsonb, p_action text, p_reason text, p_status text) returns public.pm_time_entries
language plpgsql security definer set search_path = public as $$
declare
  e public.pm_time_entries; v_before jsonb;
  v_in timestamptz := nullif(p ->> 'clockIn', '')::timestamptz; v_out timestamptz := nullif(p ->> 'clockOut', '')::timestamptz;
  v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_loc uuid := nullif(p ->> 'locationId', '')::uuid;
  v_type text := coalesce(nullif(p ->> 'workType', ''), 'regular');
begin
  if v_in is null or v_out is null then raise exception 'times_required' using errcode = '22023'; end if;
  if v_out <= v_in then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_out - v_in > interval '24 hours' then raise exception 'too_long' using errcode = '22023'; end if;
  if v_in > now() + interval '1 day' then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_type not in ('regular', 'travel', 'offsite') then raise exception 'bad_work_type' using errcode = '22023'; end if;
  perform public.pm_time_check_project(v_sched, r);
  perform public.pm_time_check_location(v_loc, r);
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.id is distinct from p_id and x.status <> 'rejected'
               and tstzrange(x.clock_in, coalesce(x.clock_out, now()), '[)') && tstzrange(v_in, v_out, '[)')) then
    raise exception 'overlap' using errcode = '23P01';
  end if;
  if p_id is null then
    insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, location_id, work_type, clock_in, clock_out, break_minutes, paid_break_minutes,
                                        note, status, source, created_by, decided_by, decided_at)
    values (r.company_id, r.owner_id, r.id, v_sched, v_loc, v_type, v_in, v_out, greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, 0))),
            greatest(0, least(720, coalesce(nullif(p ->> 'paidBreakMinutes', '')::int, 0))), left(nullif(btrim(p ->> 'note'), ''), 500), p_status,
            case when p_action = 'correction' then 'correction' else 'manual' end, auth.uid(),
            case when p_status = 'approved' then auth.uid() end, case when p_status = 'approved' then now() end)
    returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, after) values (e.id, auth.uid(), 'added', p_reason, public.pm_time_entry_json(e));
  else
    select * into e from public.pm_time_entries where id = p_id for update;
    v_before := public.pm_time_entry_json(e);
    update public.pm_time_entries set schedule_id = v_sched, location_id = v_loc, work_type = v_type, clock_in = v_in, clock_out = v_out,
      break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, break_minutes))),
      paid_break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'paidBreakMinutes', '')::int, paid_break_minutes))),
      note = case when p ? 'note' then left(nullif(btrim(p ->> 'note'), ''), 500) else note end,
      status = p_status, away_since = null,
      decided_by = case when p_status = 'approved' then auth.uid() when p_status = 'pending' then null else decided_by end,
      decided_at = case when p_status = 'approved' then now() when p_status = 'pending' then null else decided_at end,
      edited_by = auth.uid(), edited_at = now(), updated_at = now()
    where id = e.id returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, before, after) values (e.id, auth.uid(), p_action, p_reason, v_before, public.pm_time_entry_json(e));
  end if;
  return e;
end $$;
revoke execute on function public.pm_time_apply(public.pm_resources, uuid, jsonb, text, text, text) from public, anon, authenticated;

create or replace function public.pm_work_location_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end;
  v_id uuid := nullif(p ->> 'id', '')::uuid; l public.pm_work_locations; v_kind text := p ->> 'kind';
  v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_lat numeric := round(nullif(p ->> 'lat', '')::numeric, 6); v_lng numeric := round(nullif(p ->> 'lng', '')::numeric, 6);
  v_radius integer := coalesce(nullif(p ->> 'radiusM', '')::int, (public.pm_gps_settings_for(v_c, v_o)).default_radius_m);
  v_confirm boolean := coalesce((p ->> 'confirm')::boolean, false); v_moved boolean;
begin
  if not public.pm_time_admin(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'name_required' using errcode = '22023'; end if;
  if v_radius not between 30 and 322 then raise exception 'bad_radius' using errcode = '22023'; end if;
  if (v_lat is null) <> (v_lng is null) then raise exception 'bad_pin' using errcode = '22023'; end if;
  if v_id is not null then
    select * into l from public.pm_work_locations where id = v_id for update;
    if not found or l.company_id is distinct from v_c or l.owner_id is distinct from v_o then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_kind := l.kind; v_sched := l.schedule_id;
  else
    if v_kind not in ('business', 'project', 'other') then raise exception 'bad_kind' using errcode = '22023'; end if;
    if v_kind = 'project' then
      if v_sched is null or not exists (select 1 from public.project_schedules s where s.id = v_sched and s.status <> 'archived'
            and ((v_c is not null and s.company_id = v_c) or (v_c is null and s.company_id is null and s.user_id = v_o))) then
        raise exception 'bad_project' using errcode = '22023';
      end if;
    else v_sched := null; end if;
  end if;
  v_moved := v_id is null or l.lat is distinct from v_lat or l.lng is distinct from v_lng or l.radius_m <> v_radius;
  if v_confirm and v_lat is null then raise exception 'pin_required' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.pm_work_locations (company_id, owner_id, kind, name, address, schedule_id, lat, lng, radius_m, pin_source, pin_accuracy_m, everyone, confirmed_at, confirmed_by, created_by)
    values (v_c, v_o, v_kind, left(btrim(p ->> 'name'), 200), left(nullif(btrim(p ->> 'address'), ''), 500), v_sched, v_lat, v_lng, v_radius,
            case when v_lat is not null then coalesce(nullif(p ->> 'pinSource', ''), 'manual') end,
            case when v_lat is not null then nullif(p ->> 'pinAccuracyM', '')::numeric::int end, coalesce((p ->> 'everyone')::boolean, false),
            case when v_confirm then now() end, case when v_confirm then auth.uid() end, auth.uid())
    returning id into v_id;
  else
    update public.pm_work_locations set name = left(btrim(p ->> 'name'), 200), address = left(nullif(btrim(p ->> 'address'), ''), 500), lat = v_lat, lng = v_lng,
      radius_m = v_radius,
      pin_source = case when v_lat is null then null when v_moved then coalesce(nullif(p ->> 'pinSource', ''), 'manual') else pin_source end,
      pin_accuracy_m = case when v_lat is null then null when v_moved then nullif(p ->> 'pinAccuracyM', '')::numeric::int else pin_accuracy_m end,
      everyone = coalesce((p ->> 'everyone')::boolean, everyone),
      confirmed_at = case when v_confirm then now() when v_moved then null else confirmed_at end,
      confirmed_by = case when v_confirm then auth.uid() when v_moved then null else confirmed_by end,
      updated_at = now()
    where id = v_id;
  end if;
  perform public.pm_gps_log(v_c, v_o, 'location.save', v_id, jsonb_build_object('kind', v_kind, 'radiusM', v_radius, 'pinChanged', v_moved, 'confirmed', v_confirm));
  return v_id;
end $$;
revoke execute on function public.pm_work_location_save(jsonb) from public, anon;
grant execute on function public.pm_work_location_save(jsonb) to authenticated;

create or replace function public.pm_time_correction_json(k public.pm_time_corrections) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', k.id, 'resourceId', k.resource_id, 'entryId', k.entry_id, 'kind', k.kind, 'clockIn', k.clock_in, 'clockOut', k.clock_out,
    'breakMinutes', k.break_minutes, 'paidBreakMinutes', k.paid_break_minutes, 'scheduleId', k.schedule_id, 'locationId', k.location_id, 'workType', k.work_type,
    'reason', k.reason, 'status', k.status, 'requestedAt', k.requested_at, 'decidedAt', k.decided_at, 'decisionNote', k.decision_note,
    'current', (select public.pm_time_entry_json(e) from public.pm_time_entries e where e.id = k.entry_id))
$$;
revoke execute on function public.pm_time_correction_json(public.pm_time_corrections) from public, anon;
grant execute on function public.pm_time_correction_json(public.pm_time_corrections) to authenticated;

create or replace function public.pm_time_correction_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_gps_my_resource(nullif(p ->> 'resourceId', '')::uuid); k public.pm_time_corrections; v_entry uuid := nullif(p ->> 'entryId', '')::uuid;
  v_in timestamptz := nullif(p ->> 'clockIn', '')::timestamptz; v_out timestamptz := nullif(p ->> 'clockOut', '')::timestamptz;
begin
  if nullif(btrim(coalesce(p ->> 'reason', '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if v_in is null or v_out is null or v_out <= v_in then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_out - v_in > interval '24 hours' then raise exception 'too_long' using errcode = '22023'; end if;
  if v_in > now() + interval '1 hour' then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_entry is not null and not exists (select 1 from public.pm_time_entries e where e.id = v_entry and e.resource_id = r.id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_entry is not null and exists (select 1 from public.pm_time_corrections x where x.entry_id = v_entry and x.status = 'pending') then raise exception 'already_requested' using errcode = '23505'; end if;
  perform public.pm_time_check_project(nullif(p ->> 'scheduleId', '')::uuid, r);
  perform public.pm_time_check_location(nullif(p ->> 'locationId', '')::uuid, r);
  if coalesce(nullif(p ->> 'workType', ''), 'regular') not in ('regular', 'travel', 'offsite') then raise exception 'bad_work_type' using errcode = '22023'; end if;
  insert into public.pm_time_corrections (company_id, owner_id, resource_id, entry_id, kind, clock_in, clock_out, break_minutes, paid_break_minutes, schedule_id, location_id, work_type, reason, requested_by)
  values (r.company_id, r.owner_id, r.id, v_entry, case when v_entry is null then 'missing' else 'fix' end, v_in, v_out,
          greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, 0))), greatest(0, least(720, coalesce(nullif(p ->> 'paidBreakMinutes', '')::int, 0))),
          nullif(p ->> 'scheduleId', '')::uuid, nullif(p ->> 'locationId', '')::uuid, coalesce(nullif(p ->> 'workType', ''), 'regular'), left(btrim(p ->> 'reason'), 500), auth.uid())
  returning * into k;
  perform public.pm_gps_log(r.company_id, r.owner_id, 'correction.request', k.id, jsonb_build_object('kind', k.kind));
  return public.pm_time_correction_json(k);
end $$;
revoke execute on function public.pm_time_correction_request(jsonb) from public, anon;
grant execute on function public.pm_time_correction_request(jsonb) to authenticated;

create or replace function public.pm_time_correction_decide(p_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.pm_time_corrections; r public.pm_resources; e public.pm_time_entries; v_payload jsonb;
begin
  select * into k from public.pm_time_corrections where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.pm_resources where id = k.resource_id;
  if not public.team_in_my_scope(k.company_id, k.owner_id) or not public.pm_time_approver(k.company_id, k.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.linked_user_id = auth.uid() and k.company_id is not null and not public.team_is_company_owner(k.company_id) then raise exception 'forbidden_own' using errcode = '42501'; end if;
  if k.status <> 'pending' then raise exception 'not_pending' using errcode = '22023'; end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_approve then
    v_payload := jsonb_build_object('clockIn', k.clock_in, 'clockOut', k.clock_out, 'breakMinutes', k.break_minutes, 'paidBreakMinutes', k.paid_break_minutes,
      'scheduleId', k.schedule_id, 'locationId', k.location_id, 'workType', k.work_type);
    if k.entry_id is not null then
      select * into e from public.pm_time_entries where id = k.entry_id;
      if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
      e := public.pm_time_apply(r, k.entry_id, v_payload, 'correction', left('Employee correction: ' || k.reason, 300), 'approved');
    else
      e := public.pm_time_apply(r, null, v_payload || jsonb_build_object('note', 'Added from a correction request'), 'correction', left('Employee correction: ' || k.reason, 300), 'approved');
    end if;
    update public.pm_time_corrections set status = 'approved', entry_id = e.id, decided_by = auth.uid(), decided_at = now(), decision_note = left(nullif(btrim(p_note), ''), 300) where id = k.id returning * into k;
  else
    update public.pm_time_corrections set status = 'denied', decided_by = auth.uid(), decided_at = now(), decision_note = left(btrim(p_note), 300) where id = k.id returning * into k;
  end if;
  perform public.pm_gps_log(k.company_id, k.owner_id, case when p_approve then 'correction.approve' else 'correction.deny' end, k.id, '{}'::jsonb);
  return public.pm_time_correction_json(k);
end $$;
revoke execute on function public.pm_time_correction_decide(uuid, boolean, text) from public, anon;
grant execute on function public.pm_time_correction_decide(uuid, boolean, text) to authenticated;
