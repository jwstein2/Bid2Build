-- V8.3 Workforce & HR integration (customer companies' own workers; not Built2Bid staff).
-- Builds on 20270208001000_gps_timekeeping (run that first). Reuses the one employee record:
--   pm_resources (kind 'staff') + pm_employee_profiles + pm_employee_hr (pay rate / unit / frequency / FLSA),
--   schedule_tasks assignments (project schedule), pm_crew_members, pm_pto_entries, pm_time_entries,
--   pm_work_locations, pm_time_corrections.
-- New:
--   * Work categories on time entries / locations / corrections (moved here: 20270208001000 is already applied).
--   * pm_employee_profiles.classification (W-2 / 1099 / owner / other), kept in step with GPS "W-2 confirmed".
--   * pm_work_shifts: scheduled internal work (shop, office, training, admin, travel, other) or extra project days.
--   * pm_worker_schedule / pm_worker_week: one weekly view for the worker and their managers.
--   * Projected pay: pm_pay_settings + pm_worker_pay_prefs; pm_pay_inputs returns pay data ONLY to HR admins, or to
--     the worker when the company turned it on for them (off for workers by default). Math runs on the server.
--   * pm_labor_report: scheduled vs actual labor by job and by non-project category, costs only for cost viewers.

-- ==== Work categories (paid work without a project, job cost vs overhead) and manual-review reasons ====

-- What kind of paid work happens at a non-project place (job costing / overhead). Project sites are always 'project'.
alter table public.pm_work_locations add column if not exists work_category text;
alter table public.pm_work_locations drop constraint if exists pm_work_locations_category_check;
alter table public.pm_work_locations add constraint pm_work_locations_category_check check (
  (kind = 'project' and work_category is null) or (kind <> 'project' and work_category in ('shop', 'office', 'training', 'admin', 'other_paid')));

-- Work allocation category: customer project, shop, office, training, admin, paid travel, other paid work, or unpaid
-- (non-working time that is never paid or costed). A project is never required for paid work.
alter table public.pm_time_entries add column if not exists work_category text;
alter table public.pm_time_entries drop constraint if exists pm_time_entries_category_check;
alter table public.pm_time_entries add constraint pm_time_entries_category_check check (work_category is null or work_category in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid', 'unpaid'));
create or replace function public.pm_time_default_category(p_type text, p_sched uuid, p_loc uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p_type = 'travel' then 'travel' when p_sched is not null then 'project'
    else coalesce((select l.work_category from public.pm_work_locations l where l.id = p_loc), 'other_paid') end
$$;
revoke execute on function public.pm_time_default_category(text, uuid, uuid) from public, anon, authenticated;
create or replace function public.pm_time_set_category() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.work_category is null then new.work_category := public.pm_time_default_category(new.work_type, new.schedule_id, new.location_id); end if;
  return new;
end $$;
drop trigger if exists pm_time_entries_set_category on public.pm_time_entries;
create trigger pm_time_entries_set_category before insert or update on public.pm_time_entries for each row execute function public.pm_time_set_category();
update public.pm_time_entries set work_category = case when schedule_id is not null then 'project' else 'other_paid' end where work_category is null;
create index if not exists pm_time_entries_category_idx on public.pm_time_entries (resource_id, work_category);

-- Corrections say what to pay the time as and why a manual review is needed.
alter table public.pm_time_corrections add column if not exists work_category text;
alter table public.pm_time_corrections drop constraint if exists pm_time_corrections_work_category_check;
alter table public.pm_time_corrections add constraint pm_time_corrections_work_category_check check (work_category is null or work_category in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid', 'unpaid'));
-- Why a manual review is needed (GPS off, forgot phone, missed event, wrong site, disputing an automatic punch).
alter table public.pm_time_corrections add column if not exists issue text;
alter table public.pm_time_corrections drop constraint if exists pm_time_corrections_issue_check;
alter table public.pm_time_corrections add constraint pm_time_corrections_issue_check check (issue is null or issue in ('gps_unavailable', 'forgot_phone', 'missed_event', 'wrong_location', 'dispute_auto', 'other'));

create or replace function public.pm_time_entry_json(e public.pm_time_entries) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', e.id, 'resourceId', e.resource_id, 'scheduleId', e.schedule_id, 'clockIn', e.clock_in, 'clockOut', e.clock_out,
    'breakMinutes', e.break_minutes, 'paidBreakMinutes', e.paid_break_minutes, 'note', e.note, 'status', e.status, 'source', e.source,
    'locationId', e.location_id, 'workType', e.work_type, 'workCategory', e.work_category, 'shiftId', e.shift_id, 'awaySince', e.away_since, 'reviewFlag', e.review_flag,
    'originalClockIn', e.original_clock_in, 'originalClockOut', e.original_clock_out,
    'inLocation', case when e.in_lat is not null then jsonb_build_object('lat', e.in_lat, 'lng', e.in_lng, 'accuracyM', e.in_accuracy_m) end,
    'outLocation', case when e.out_lat is not null then jsonb_build_object('lat', e.out_lat, 'lng', e.out_lng, 'accuracyM', e.out_accuracy_m) end,
    'edited', e.edited_at is not null, 'decisionNote', e.decision_note, 'decidedAt', e.decided_at)
$$;

create or replace function public.pm_clock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; e public.pm_time_entries; v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_loc uuid := nullif(p ->> 'locationId', '')::uuid;
  v_type text := coalesce(nullif(p ->> 'workType', ''), 'regular'); v_cat text := nullif(p ->> 'workCategory', '');
begin
  select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
  if not found or not public.pm_time_punch_allowed(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.pm_time_check_project(v_sched, r);
  perform public.pm_time_check_location(v_loc, r);
  if v_type not in ('regular', 'travel', 'offsite') then raise exception 'bad_work_type' using errcode = '22023'; end if;
  if v_cat is not null and v_cat not in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid', 'unpaid') then raise exception 'bad_category' using errcode = '22023'; end if;
  if v_sched is null and v_loc is not null then select l.schedule_id into v_sched from public.pm_work_locations l where l.id = v_loc; end if;
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open') then raise exception 'already_in' using errcode = '23505'; end if;
  perform public.pm_time_purge_locations(r.company_id, r.owner_id);
  insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, location_id, work_type, work_category, clock_in, note, status, source, in_lat, in_lng, in_accuracy_m, created_by)
  values (r.company_id, r.owner_id, r.id, v_sched, v_loc, v_type, v_cat, now(), left(nullif(btrim(p ->> 'note'), ''), 500), 'open', 'clock',
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
  v_type text := coalesce(nullif(p ->> 'workType', ''), 'regular'); v_cat text := nullif(p ->> 'workCategory', '');
begin
  if v_in is null or v_out is null then raise exception 'times_required' using errcode = '22023'; end if;
  if v_out <= v_in then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_out - v_in > interval '24 hours' then raise exception 'too_long' using errcode = '22023'; end if;
  if v_in > now() + interval '1 day' then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_type not in ('regular', 'travel', 'offsite') then raise exception 'bad_work_type' using errcode = '22023'; end if;
  if v_cat is not null and v_cat not in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid', 'unpaid') then raise exception 'bad_category' using errcode = '22023'; end if;
  perform public.pm_time_check_project(v_sched, r);
  perform public.pm_time_check_location(v_loc, r);
  if exists (select 1 from public.pm_time_entries x where x.resource_id = r.id and x.id is distinct from p_id and x.status <> 'rejected'
               and tstzrange(x.clock_in, coalesce(x.clock_out, now()), '[)') && tstzrange(v_in, v_out, '[)')) then
    raise exception 'overlap' using errcode = '23P01';
  end if;
  if p_id is null then
    insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, location_id, work_type, work_category, clock_in, clock_out, break_minutes, paid_break_minutes,
                                        note, status, source, created_by, decided_by, decided_at)
    values (r.company_id, r.owner_id, r.id, v_sched, v_loc, v_type, v_cat, v_in, v_out, greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, 0))),
            greatest(0, least(720, coalesce(nullif(p ->> 'paidBreakMinutes', '')::int, 0))), left(nullif(btrim(p ->> 'note'), ''), 500), p_status,
            case when p_action = 'correction' then 'correction' else 'manual' end, auth.uid(),
            case when p_status = 'approved' then auth.uid() end, case when p_status = 'approved' then now() end)
    returning * into e;
    insert into public.pm_time_entry_changes (entry_id, changed_by, action, reason, after) values (e.id, auth.uid(), 'added', p_reason, public.pm_time_entry_json(e));
  else
    select * into e from public.pm_time_entries where id = p_id for update;
    v_before := public.pm_time_entry_json(e);
    update public.pm_time_entries set schedule_id = v_sched, location_id = v_loc, work_type = v_type,
      work_category = case when p ? 'workCategory' then v_cat when e.schedule_id is distinct from v_sched or e.location_id is distinct from v_loc or e.work_type is distinct from v_type then null else work_category end,
      clock_in = v_in, clock_out = v_out,
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
  v_confirm boolean := coalesce((p ->> 'confirm')::boolean, false); v_moved boolean; v_cat text := nullif(p ->> 'workCategory', '');
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
  if v_kind = 'project' then v_cat := null;
  elsif v_cat is null then v_cat := coalesce(l.work_category, case when v_kind = 'business' then 'shop' else 'other_paid' end);
  elsif v_cat not in ('shop', 'office', 'training', 'admin', 'other_paid') then raise exception 'bad_category' using errcode = '22023'; end if;
  v_moved := v_id is null or l.lat is distinct from v_lat or l.lng is distinct from v_lng or l.radius_m <> v_radius;
  if v_confirm and v_lat is null then raise exception 'pin_required' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.pm_work_locations (company_id, owner_id, kind, work_category, name, address, schedule_id, lat, lng, radius_m, pin_source, pin_accuracy_m, everyone, confirmed_at, confirmed_by, created_by)
    values (v_c, v_o, v_kind, v_cat, left(btrim(p ->> 'name'), 200), left(nullif(btrim(p ->> 'address'), ''), 500), v_sched, v_lat, v_lng, v_radius,
            case when v_lat is not null then coalesce(nullif(p ->> 'pinSource', ''), 'manual') end,
            case when v_lat is not null then nullif(p ->> 'pinAccuracyM', '')::numeric::int end, coalesce((p ->> 'everyone')::boolean, false),
            case when v_confirm then now() end, case when v_confirm then auth.uid() end, auth.uid())
    returning id into v_id;
  else
    update public.pm_work_locations set work_category = v_cat, name = left(btrim(p ->> 'name'), 200), address = left(nullif(btrim(p ->> 'address'), ''), 500), lat = v_lat, lng = v_lng,
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
    'workCategory', k.work_category, 'issue', k.issue, 'reason', k.reason, 'status', k.status, 'requestedAt', k.requested_at, 'decidedAt', k.decided_at, 'decisionNote', k.decision_note,
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
  if nullif(p ->> 'workCategory', '') is not null and p ->> 'workCategory' not in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid', 'unpaid') then raise exception 'bad_category' using errcode = '22023'; end if;
  if nullif(p ->> 'issue', '') is not null and p ->> 'issue' not in ('gps_unavailable', 'forgot_phone', 'missed_event', 'wrong_location', 'dispute_auto', 'other') then raise exception 'bad_issue' using errcode = '22023'; end if;
  insert into public.pm_time_corrections (company_id, owner_id, resource_id, entry_id, kind, clock_in, clock_out, break_minutes, paid_break_minutes, schedule_id, location_id, work_type, work_category, issue, reason, requested_by)
  values (r.company_id, r.owner_id, r.id, v_entry, case when v_entry is null then 'missing' else 'fix' end, v_in, v_out,
          greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, 0))), greatest(0, least(720, coalesce(nullif(p ->> 'paidBreakMinutes', '')::int, 0))),
          nullif(p ->> 'scheduleId', '')::uuid, nullif(p ->> 'locationId', '')::uuid, coalesce(nullif(p ->> 'workType', ''), 'regular'),
          nullif(p ->> 'workCategory', ''), nullif(p ->> 'issue', ''), left(btrim(p ->> 'reason'), 500), auth.uid())
  returning * into k;
  perform public.pm_gps_log(r.company_id, r.owner_id, 'correction.request', k.id, jsonb_build_object('kind', k.kind, 'issue', k.issue));
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
      'scheduleId', k.schedule_id, 'locationId', k.location_id, 'workType', k.work_type)
      || case when k.work_category is not null then jsonb_build_object('workCategory', k.work_category) else '{}'::jsonb end;
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


-- 1. Classification on the canonical employee record ----------------------------------------------------------
alter table public.pm_employee_profiles add column if not exists classification text;
alter table public.pm_employee_profiles drop constraint if exists pm_employee_profiles_classification_check;
alter table public.pm_employee_profiles add constraint pm_employee_profiles_classification_check
  check (classification is null or classification in ('w2', '1099', 'owner', 'other'));
update public.pm_employee_profiles set classification = 'owner' where classification is null and pay_type = 'owner';
insert into public.pm_employee_profiles (resource_id, classification)
  select g.resource_id, 'w2' from public.pm_gps_enrollments g where g.w2_confirmed_at is not null
  on conflict (resource_id) do update set classification = 'w2' where public.pm_employee_profiles.classification is null;

-- Who may change classification: anyone who manages the team, an HR manager, or a time admin.
create or replace function public.pm_worker_classification_set(p_resource_id uuid, p_classification text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_class text := nullif(p_classification, '');
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id)
     or not (public.pm_team_manageable(r.company_id, r.owner_id) or public.pm_hr_can(r.company_id, r.owner_id) or public.pm_time_admin(r.company_id, r.owner_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.kind <> 'staff' then raise exception 'staff_only' using errcode = '22023'; end if;
  if v_class is not null and v_class not in ('w2', '1099', 'owner', 'other') then raise exception 'bad_classification' using errcode = '22023'; end if;
  insert into public.pm_employee_profiles as p (resource_id, classification, updated_by, updated_at) values (r.id, v_class, auth.uid(), now())
  on conflict (resource_id) do update set classification = v_class, updated_by = auth.uid(), updated_at = now();
  -- Automatic GPS time is for W-2 employees only: anything else switches it off and clears the W-2 confirmation.
  if v_class is distinct from 'w2' then
    update public.pm_gps_enrollments set enrolled = false, w2_confirmed_at = null, w2_confirmed_by = null, updated_at = now()
      where resource_id = r.id and (enrolled or w2_confirmed_at is not null);
  else
    insert into public.pm_gps_enrollments as x (resource_id, company_id, owner_id, enrolled, w2_confirmed_at, w2_confirmed_by)
    values (r.id, r.company_id, r.owner_id, false, now(), auth.uid())
    on conflict (resource_id) do update set w2_confirmed_at = coalesce(x.w2_confirmed_at, now()), w2_confirmed_by = coalesce(x.w2_confirmed_by, auth.uid()), updated_at = now();
  end if;
  perform public.pm_gps_log(r.company_id, r.owner_id, 'classification.set', r.id, jsonb_build_object('classification', v_class));
  return jsonb_build_object('classification', v_class, 'gpsActive', public.pm_gps_active(r.id));
end $$;
revoke execute on function public.pm_worker_classification_set(uuid, text) from public, anon;
grant execute on function public.pm_worker_classification_set(uuid, text) to authenticated;

-- Classification of each active staff record in my scope (time approvers, team managers, HR). No pay data.
create or replace function public.pm_worker_classifications() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end;
begin
  if not (public.pm_time_approver(v_c, v_o) or public.pm_team_manageable(v_c, v_o) or public.pm_hr_can(v_c, v_o)) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(r.id, pr.classification)
    from public.pm_resources r left join public.pm_employee_profiles pr on pr.resource_id = r.id
    where r.company_id is not distinct from v_c and r.owner_id is not distinct from v_o and r.kind = 'staff' and r.status = 'active'), '{}'::jsonb);
end $$;
revoke execute on function public.pm_worker_classifications() from public, anon;
grant execute on function public.pm_worker_classifications() to authenticated;

-- GPS enrollment: confirming W-2 there sets the classification too; a 1099 / owner / other record can't be enrolled.
create or replace function public.pm_gps_enrollment_save(p_resource_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; e public.pm_gps_enrollments; v_w2 boolean; v_enrolled boolean; v_class text;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_time_admin(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.kind <> 'staff' then raise exception 'staff_only' using errcode = '22023'; end if;
  select classification into v_class from public.pm_employee_profiles where resource_id = r.id;
  if coalesce((p ->> 'w2Confirmed')::boolean, false) and v_class in ('1099', 'owner', 'other') then raise exception 'not_w2' using errcode = '22023'; end if;
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
  insert into public.pm_employee_profiles as pp (resource_id, classification, updated_by, updated_at)
  values (r.id, case when v_w2 then 'w2' end, auth.uid(), now())
  on conflict (resource_id) do update set classification = case when v_w2 then 'w2' when pp.classification = 'w2' then null else pp.classification end,
    updated_at = now();
  perform public.pm_gps_log(r.company_id, r.owner_id, 'enrollment.save', r.id, jsonb_build_object('enrolled', e.enrolled, 'w2Confirmed', e.w2_confirmed_at is not null));
  return jsonb_build_object('enrolled', e.enrolled, 'w2ConfirmedAt', e.w2_confirmed_at, 'active', public.pm_gps_active(r.id));
end $$;
revoke execute on function public.pm_gps_enrollment_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_gps_enrollment_save(uuid, jsonb) to authenticated;

-- 2. Scheduled internal work (and extra project days) ---------------------------------------------------------
create table if not exists public.pm_work_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes between 0 and 240),
  work_category text not null check (work_category in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid')),
  schedule_id uuid references public.project_schedules (id) on delete set null,
  location_id uuid references public.pm_work_locations (id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint pm_work_shifts_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_work_shifts_times check (end_time > start_time),
  constraint pm_work_shifts_break check (unpaid_break_minutes * interval '1 minute' < end_time - start_time)
);
create index if not exists pm_work_shifts_resource_idx on public.pm_work_shifts (resource_id, work_date) where status = 'scheduled';
create index if not exists pm_work_shifts_scope_idx on public.pm_work_shifts (coalesce(company_id, owner_id), work_date);
alter table public.pm_work_shifts enable row level security;
revoke all on public.pm_work_shifts from anon, authenticated;
drop policy if exists pm_work_shifts_select on public.pm_work_shifts;
create policy pm_work_shifts_select on public.pm_work_shifts for select to authenticated
  using (public.pm_time_approver(company_id, owner_id) or exists (select 1 from public.pm_resources r where r.id = resource_id and r.linked_user_id = auth.uid()));
grant select on public.pm_work_shifts to authenticated;

create or replace function public.pm_work_shift_json(w public.pm_work_shifts) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', w.id, 'resourceId', w.resource_id, 'date', w.work_date, 'startTime', to_char(w.start_time, 'HH24:MI'), 'endTime', to_char(w.end_time, 'HH24:MI'),
    'unpaidBreakMinutes', w.unpaid_break_minutes, 'category', w.work_category, 'scheduleId', w.schedule_id, 'locationId', w.location_id, 'notes', w.notes, 'status', w.status)
$$;
revoke execute on function public.pm_work_shift_json(public.pm_work_shifts) from public, anon;
grant execute on function public.pm_work_shift_json(public.pm_work_shifts) to authenticated;

-- Create or update a shift; p.dates (array) creates the same shift on several days. Managers / time supervisors.
-- p {id?, resourceId, date | dates[], startTime, endTime, unpaidBreakMinutes?, category, scheduleId?, locationId?, notes?}
create or replace function public.pm_work_shift_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.pm_resources; w public.pm_work_shifts; v_id uuid := nullif(p ->> 'id', '')::uuid; v_dates date[]; d date; v_out jsonb := '[]'::jsonb;
  v_st time := nullif(p ->> 'startTime', '')::time; v_et time := nullif(p ->> 'endTime', '')::time; v_cat text := p ->> 'category';
  v_sched uuid := nullif(p ->> 'scheduleId', '')::uuid; v_loc uuid := nullif(p ->> 'locationId', '')::uuid;
  v_brk integer := greatest(0, least(240, coalesce(nullif(p ->> 'unpaidBreakMinutes', '')::int, 0)));
begin
  if v_id is not null then
    select * into w from public.pm_work_shifts where id = v_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    select * into r from public.pm_resources where id = w.resource_id;
  else
    select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_time_approver(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.kind <> 'staff' or r.status <> 'active' then raise exception 'staff_only' using errcode = '22023'; end if;
  if v_st is null or v_et is null or v_et <= v_st then raise exception 'bad_times' using errcode = '22023'; end if;
  if v_brk * interval '1 minute' >= v_et - v_st then raise exception 'bad_break' using errcode = '22023'; end if;
  if v_cat is null or v_cat not in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid') then raise exception 'bad_category' using errcode = '22023'; end if;
  if v_cat = 'project' and v_sched is null then raise exception 'project_required' using errcode = '22023'; end if;
  if v_cat <> 'project' and v_cat <> 'travel' then v_sched := null; end if;
  perform public.pm_time_check_project(v_sched, r);
  perform public.pm_time_check_location(v_loc, r);
  if v_id is not null then v_dates := array[coalesce(nullif(p ->> 'date', '')::date, w.work_date)];
  elsif jsonb_typeof(p -> 'dates') = 'array' then
    select array_agg(distinct x::date order by x::date) into v_dates from jsonb_array_elements_text(p -> 'dates') x;
  else v_dates := array[nullif(p ->> 'date', '')::date]; end if;
  if v_dates is null or cardinality(v_dates) = 0 or array_position(v_dates, null) is not null then raise exception 'date_required' using errcode = '22023'; end if;
  if cardinality(v_dates) > 62 then raise exception 'too_many_dates' using errcode = '22023'; end if;
  foreach d in array v_dates loop
    if d < current_date - 366 or d > current_date + 400 then raise exception 'bad_date' using errcode = '22023'; end if;
    if exists (select 1 from public.pm_work_shifts x where x.resource_id = r.id and x.status = 'scheduled' and x.work_date = d and x.id is distinct from v_id
                 and x.start_time < v_et and x.end_time > v_st) then
      raise exception 'shift_overlap' using errcode = '23P01', detail = d::text;
    end if;
    if v_id is null then
      insert into public.pm_work_shifts (company_id, owner_id, resource_id, work_date, start_time, end_time, unpaid_break_minutes, work_category, schedule_id, location_id, notes, created_by, updated_by)
      values (r.company_id, r.owner_id, r.id, d, v_st, v_et, v_brk, v_cat, v_sched, v_loc, left(nullif(btrim(p ->> 'notes'), ''), 1000), auth.uid(), auth.uid())
      returning * into w;
    else
      update public.pm_work_shifts set work_date = d, start_time = v_st, end_time = v_et, unpaid_break_minutes = v_brk, work_category = v_cat, schedule_id = v_sched,
        location_id = v_loc, notes = left(nullif(btrim(p ->> 'notes'), ''), 1000), status = 'scheduled', updated_by = auth.uid(), updated_at = now()
      where id = v_id returning * into w;
    end if;
    v_out := v_out || jsonb_build_array(public.pm_work_shift_json(w));
  end loop;
  perform public.pm_gps_log(r.company_id, r.owner_id, case when v_id is null then 'shift.add' else 'shift.edit' end, r.id, jsonb_build_object('days', cardinality(v_dates), 'category', v_cat));
  return v_out;
end $$;
revoke execute on function public.pm_work_shift_save(jsonb) from public, anon;
grant execute on function public.pm_work_shift_save(jsonb) to authenticated;

create or replace function public.pm_work_shift_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.pm_work_shifts;
begin
  select * into w from public.pm_work_shifts where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.team_in_my_scope(w.company_id, w.owner_id) or not public.pm_time_approver(w.company_id, w.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.pm_work_shifts set status = 'cancelled', updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.pm_gps_log(w.company_id, w.owner_id, 'shift.cancel', w.resource_id, jsonb_build_object('date', w.work_date));
end $$;
revoke execute on function public.pm_work_shift_cancel(uuid) from public, anon;
grant execute on function public.pm_work_shift_cancel(uuid) to authenticated;

-- 3. One schedule for a worker: internal shifts + project assignments (directly or through a crew) + approved time off.
-- Hours per project day: the assignment's times of day, else its estimated hours spread over the task's workdays,
-- else the company's standard day (work_end - work_start - 30 min, from the time tracking settings).
-- Internal (no permission check): callers check.
create or replace function public.pm_worker_schedule_raw(p_resource uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; s public.pm_gps_settings; v_day numeric;
begin
  select * into r from public.pm_resources where id = p_resource;
  if not found then return '[]'::jsonb; end if;
  s := public.pm_gps_settings_for(r.company_id, r.owner_id);
  v_day := greatest(1, least(12, extract(epoch from (s.work_end - s.work_start)) / 3600.0 - 0.5));
  return coalesce((
    select jsonb_agg(x order by x ->> 'date', x ->> 'startTime' nulls last, x ->> 'title') from (
      -- Internal / extra shifts
      select jsonb_build_object('kind', 'shift', 'id', w.id, 'date', w.work_date, 'startTime', to_char(w.start_time, 'HH24:MI'), 'endTime', to_char(w.end_time, 'HH24:MI'),
          'hours', round(extract(epoch from (w.end_time - w.start_time)) / 3600.0 - w.unpaid_break_minutes / 60.0, 2), 'unpaidBreakMinutes', w.unpaid_break_minutes,
          'category', w.work_category, 'scheduleId', w.schedule_id, 'project', ps.name, 'title', coalesce(ps.name, l.name),
          'locationId', w.location_id, 'location', l.name, 'address', coalesce(l.address, es.project_address), 'notes', w.notes,
          'responsibilities', null, 'status', 'scheduled', 'estimated', false) as x
        from public.pm_work_shifts w
        left join public.project_schedules ps on ps.id = w.schedule_id
        left join public.estimates es on es.id = ps.estimate_id
        left join public.pm_work_locations l on l.id = w.location_id
        where w.resource_id = r.id and w.status = 'scheduled' and w.work_date between p_from and p_to
      union all
      -- Project assignments, one row per scheduled workday
      select jsonb_build_object('kind', 'task', 'id', t.id, 'date', d.day, 'startTime', to_char(tm.st, 'HH24:MI'), 'endTime', to_char(tm.et, 'HH24:MI'),
          'hours', round(case when tm.st is not null and tm.et is not null then extract(epoch from (tm.et - tm.st)) / 3600.0
                              when t.assignment_hours is not null then t.assignment_hours / greatest(1, wd.n) else v_day end, 2),
          'unpaidBreakMinutes', 0, 'category', 'project', 'scheduleId', t.schedule_id, 'project', ps.name, 'title', ps.name,
          'task', t.name, 'locationId', pl.id, 'location', pl.name, 'address', es.project_address, 'notes', t.assignment_notes,
          'responsibilities', t.notes, 'status', coalesce(t.assignment_status, 'assigned'), 'taskStatus', t.status,
          'via', case when t.resource_id = r.id then null else (select c.name from public.pm_resources c where c.id = t.resource_id) end,
          'estimated', not (tm.st is not null and tm.et is not null)) as x
        from public.schedule_tasks t
        join public.project_schedules ps on ps.id = t.schedule_id and ps.status <> 'archived'
        left join public.estimates es on es.id = ps.estimate_id
        left join public.pm_work_locations pl on pl.schedule_id = ps.id and pl.status = 'active'
        left join public.schedule_tasks par on par.id = t.parent_id and t.assignment_inherited
        cross join lateral (select coalesce(t.assignment_start_time, par.assignment_start_time) as st, coalesce(t.assignment_end_time, par.assignment_end_time) as et) tm
        cross join lateral (select coalesce((select array_agg(v::int) from jsonb_array_elements_text(ps.calendar -> 'workdays') v), '{1,2,3,4,5}') as wds,
                                   coalesce((select array_agg(v) from jsonb_array_elements_text(ps.calendar -> 'holidays') v), '{}') as hols) cal
        cross join lateral (select count(*)::int as n from generate_series(t.planned_start, t.planned_end, interval '1 day') g
                             where extract(dow from g)::int = any(cal.wds) and not (to_char(g, 'YYYY-MM-DD') = any(cal.hols))) wd
        cross join lateral (select g::date as day from generate_series(greatest(t.planned_start, p_from), least(t.planned_end, p_to), interval '1 day') g
                             where extract(dow from g)::int = any(cal.wds) and not (to_char(g, 'YYYY-MM-DD') = any(cal.hols))) d
        where t.planned_start <= p_to and t.planned_end >= p_from
          and t.status <> 'complete' and coalesce(t.assignment_status, '') not in ('declined', 'cancelled')
          and (t.resource_id = r.id or t.resource_id in (select cm.crew_id from public.pm_crew_members cm where cm.member_id = r.id))
          and not exists (select 1 from public.schedule_tasks c where c.parent_id = t.id and c.resource_id is not distinct from t.resource_id)
      union all
      -- Approved time off (paid unless unpaid), spread evenly over its days
      select jsonb_build_object('kind', 'time_off', 'id', o.id, 'date', g::date, 'startTime', null, 'endTime', null,
          'hours', round(o.hours / (o.end_date - o.start_date + 1), 2), 'unpaidBreakMinutes', 0,
          'category', case when o.kind = 'unpaid' then 'unpaid' else 'time_off' end, 'title', initcap(replace(o.kind, '_', ' ')),
          'status', o.status, 'estimated', false) as x
        from public.pm_pto_entries o cross join lateral generate_series(greatest(o.start_date, p_from), least(o.end_date, p_to), interval '1 day') g
        where o.resource_id = r.id and o.status = 'approved' and o.start_date <= p_to and o.end_date >= p_from
    ) q), '[]'::jsonb);
end $$;
revoke execute on function public.pm_worker_schedule_raw(uuid, date, date) from public, anon, authenticated;

-- The worker themself, or anyone who approves their time.
create or replace function public.pm_worker_can_view(r public.pm_resources) returns boolean
language sql stable security definer set search_path = public as $$
  select r.kind = 'staff' and public.team_in_my_scope(r.company_id, r.owner_id)
    and (r.linked_user_id = auth.uid() or public.pm_time_approver(r.company_id, r.owner_id))
$$;
revoke execute on function public.pm_worker_can_view(public.pm_resources) from public, anon, authenticated;

create or replace function public.pm_worker_schedule(p_resource uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources;
begin
  select * into r from public.pm_resources where id = p_resource;
  if not found or not public.pm_worker_can_view(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'bad_range' using errcode = '22023'; end if;
  return public.pm_worker_schedule_raw(r.id, p_from, p_to);
end $$;
revoke execute on function public.pm_worker_schedule(uuid, date, date) from public, anon;
grant execute on function public.pm_worker_schedule(uuid, date, date) to authenticated;

-- Everything the worker dashboard shows for one week (Monday start, company time zone). No pay amounts here.
create or replace function public.pm_worker_week(p_resource uuid, p_week date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; s public.pm_gps_settings; v_from timestamptz; v_to timestamptz; v_mon date; v_today date; pr public.pm_employee_profiles; v_flsa text;
begin
  select * into r from public.pm_resources where id = p_resource;
  if not found or not public.pm_worker_can_view(r) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := public.pm_gps_settings_for(r.company_id, r.owner_id);
  v_mon := date_trunc('week', p_week)::date;
  v_today := (now() at time zone s.timezone)::date;
  v_from := v_mon::timestamp at time zone s.timezone; v_to := (v_mon + 7)::timestamp at time zone s.timezone;
  select * into pr from public.pm_employee_profiles where resource_id = r.id;
  select h.flsa_status into v_flsa from public.pm_employee_hr h where h.resource_id = r.id;
  return jsonb_build_object(
    'resource', jsonb_build_object('id', r.id, 'name', r.name, 'title', pr.title, 'classification', pr.classification, 'payType', coalesce(pr.pay_type, 'hourly'),
        'exempt', v_flsa = 'exempt', 'isMe', r.linked_user_id = auth.uid(), 'gpsActive', public.pm_gps_active(r.id)),
    'week', v_mon, 'today', v_today, 'timezone', s.timezone, 'overtimeRule', s.overtime_rule,
    'schedule', public.pm_worker_schedule_raw(r.id, v_mon, v_mon + 6),
    'upcoming', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select x from jsonb_array_elements(public.pm_worker_schedule_raw(r.id, v_today, v_today + 21)) x
        where x ->> 'kind' <> 'time_off' and ((x ->> 'date')::date > v_today or ((x ->> 'date')::date = v_today and coalesce(x ->> 'endTime', '23:59') > to_char(now() at time zone s.timezone, 'HH24:MI')))
        limit 6) y),
    'entries', coalesce((select jsonb_agg(public.pm_time_entry_json(e) order by e.clock_in) from public.pm_time_entries e
        where e.resource_id = r.id and e.status <> 'rejected' and e.clock_in < v_to and coalesce(e.clock_out, now()) > v_from), '[]'::jsonb),
    'open', (select public.pm_time_entry_json(e) from public.pm_time_entries e where e.resource_id = r.id and e.status = 'open' limit 1),
    'corrections', coalesce((select jsonb_agg(public.pm_time_correction_json(k) order by k.requested_at desc) from public.pm_time_corrections k
        where k.resource_id = r.id and (k.status = 'pending' or k.requested_at > now() - interval '30 days')), '[]'::jsonb),
    'signedOff', exists (select 1 from public.pm_timesheet_signoffs so where so.resource_id = r.id and so.week_start = v_mon),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind, 'category', coalesce(l.work_category, 'project'), 'address', l.address, 'scheduleId', l.schedule_id) order by l.kind, l.name)
        from public.pm_work_locations l where l.company_id is not distinct from r.company_id and l.owner_id is not distinct from r.owner_id and l.status = 'active'), '[]'::jsonb),
    'pay', public.pm_pay_status(r));
end $$;
revoke execute on function public.pm_worker_week(uuid, date) from public, anon;
grant execute on function public.pm_worker_week(uuid, date) to authenticated;

-- 4. Projected pay -----------------------------------------------------------------------------------------------
create table if not exists public.pm_pay_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  enabled boolean not null default false,                   -- module on: forecasts for HR admins
  workers_can_see boolean not null default false,           -- workers see their own estimate (off until the admin turns it on)
  display_period text not null default 'week' check (display_period in ('week', 'pay_period')),
  pay_frequency text not null default 'biweekly' check (pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  period_anchor date not null default date '2026-01-05',    -- first day of any pay period (weekly / biweekly)
  overtime_rule text check (overtime_rule is null or overtime_rule in ('federal', 'california', 'colorado', 'alaska', 'nevada', 'none')),
  ot_multiplier numeric(4, 2) not null default 1.5 check (ot_multiplier between 1 and 3),
  dt_multiplier numeric(4, 2) not null default 2.0 check (dt_multiplier between 1 and 4),
  differentials jsonb not null default '{}'::jsonb check (jsonb_typeof(differentials) = 'object' and pg_column_size(differentials) <= 2048),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint pm_pay_settings_scope check ((company_id is null) <> (owner_id is null))
);
create unique index if not exists pm_pay_settings_scope_uq on public.pm_pay_settings (coalesce(company_id, owner_id));
alter table public.pm_pay_settings enable row level security;
revoke all on public.pm_pay_settings from anon, authenticated;
-- No direct reads: settings come back through the functions below.

create table if not exists public.pm_worker_pay_prefs (
  resource_id uuid primary key references public.pm_resources (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  projection_enabled boolean not null default true,
  worker_can_see boolean,                                   -- null = company default
  rates jsonb not null default '{}'::jsonb check (jsonb_typeof(rates) = 'object' and pg_column_size(rates) <= 2048), -- category -> hourly rate
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint pm_worker_pay_prefs_scope check ((company_id is null) <> (owner_id is null))
);
alter table public.pm_worker_pay_prefs enable row level security;
revoke all on public.pm_worker_pay_prefs from anon, authenticated;

create or replace function public.pm_pay_settings_for(p_company uuid, p_owner uuid) returns public.pm_pay_settings
language plpgsql stable security definer set search_path = public as $$
declare s public.pm_pay_settings;
begin
  select * into s from public.pm_pay_settings x where x.company_id is not distinct from p_company and x.owner_id is not distinct from p_owner;
  if not found then s.company_id := p_company; s.owner_id := p_owner; s.enabled := false; s.workers_can_see := false; s.display_period := 'week';
    s.pay_frequency := 'biweekly'; s.period_anchor := date '2026-01-05'; s.ot_multiplier := 1.5; s.dt_multiplier := 2.0; s.differentials := '{}'::jsonb; end if;
  return s;
end $$;
revoke execute on function public.pm_pay_settings_for(uuid, uuid) from public, anon, authenticated;

create or replace function public.pm_pay_settings_json(s public.pm_pay_settings) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('enabled', s.enabled, 'workersCanSee', s.workers_can_see, 'displayPeriod', s.display_period, 'payFrequency', s.pay_frequency,
    'periodAnchor', s.period_anchor, 'overtimeRule', s.overtime_rule, 'otMultiplier', s.ot_multiplier, 'dtMultiplier', s.dt_multiplier,
    'differentials', s.differentials, 'saved', s.id is not null, 'updatedAt', s.updated_at)
$$;
revoke execute on function public.pm_pay_settings_json(public.pm_pay_settings) from public, anon, authenticated;

-- Can the worker see their own estimate? (company module on + company or per-worker visibility on + worker not excluded)
create or replace function public.pm_pay_worker_visible(r public.pm_resources) returns boolean
language sql stable security definer set search_path = public as $$
  select s.enabled and coalesce(p.projection_enabled, true) and coalesce(p.worker_can_see, s.workers_can_see)
  from (select (public.pm_pay_settings_for(r.company_id, r.owner_id)).*) s
  left join public.pm_worker_pay_prefs p on p.resource_id = r.id
$$;
revoke execute on function public.pm_pay_worker_visible(public.pm_resources) from public, anon, authenticated;

-- What the worker dashboard may show about pay (never amounts).
create or replace function public.pm_pay_status(r public.pm_resources) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', public.pm_hr_can(r.company_id, r.owner_id),
    'visible', public.pm_hr_can(r.company_id, r.owner_id) or (r.linked_user_id = auth.uid() and coalesce(public.pm_pay_worker_visible(r), false)))
$$;
revoke execute on function public.pm_pay_status(public.pm_resources) from public, anon, authenticated;

create or replace function public.pm_pay_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end; s public.pm_pay_settings;
begin
  if not public.pm_hr_can(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := public.pm_pay_settings_for(v_c, v_o);
  return jsonb_build_object('settings', public.pm_pay_settings_json(s), 'gpsOvertimeRule', (public.pm_gps_settings_for(v_c, v_o)).overtime_rule,
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'linked', r.linked_user_id is not null,
        'classification', pr.classification, 'payType', coalesce(pr.pay_type, 'hourly'), 'payRate', h.pay_rate, 'payRateUnit', h.pay_rate_unit,
        'payFrequency', h.pay_frequency, 'exempt', h.flsa_status = 'exempt',
        'projectionEnabled', coalesce(p.projection_enabled, true), 'workerCanSee', p.worker_can_see, 'rates', coalesce(p.rates, '{}'::jsonb),
        'workerSees', s.enabled and coalesce(p.projection_enabled, true) and coalesce(p.worker_can_see, s.workers_can_see)) order by r.name)
      from public.pm_resources r
      left join public.pm_employee_profiles pr on pr.resource_id = r.id
      left join public.pm_employee_hr h on h.resource_id = r.id
      left join public.pm_worker_pay_prefs p on p.resource_id = r.id
      where r.company_id is not distinct from v_c and r.owner_id is not distinct from v_o and r.kind = 'staff' and r.status = 'active'), '[]'::jsonb));
end $$;
revoke execute on function public.pm_pay_admin_overview() from public, anon;
grant execute on function public.pm_pay_admin_overview() to authenticated;

create or replace function public.pm_pay_settings_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end; s public.pm_pay_settings; k text; v jsonb;
begin
  if not public.pm_hr_can(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := public.pm_pay_settings_for(v_c, v_o);
  if p ? 'differentials' then
    if jsonb_typeof(p -> 'differentials') <> 'object' then raise exception 'bad_differentials' using errcode = '22023'; end if;
    for k, v in select * from jsonb_each(p -> 'differentials') loop
      if k not in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid', 'night', 'weekend') or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 200 then
        raise exception 'bad_differentials' using errcode = '22023';
      end if;
    end loop;
  end if;
  insert into public.pm_pay_settings as x (company_id, owner_id, enabled, workers_can_see, display_period, pay_frequency, period_anchor, overtime_rule, ot_multiplier, dt_multiplier, differentials, updated_by, updated_at)
  values (v_c, v_o, coalesce((p ->> 'enabled')::boolean, s.enabled), coalesce((p ->> 'workersCanSee')::boolean, s.workers_can_see),
          coalesce(nullif(p ->> 'displayPeriod', ''), s.display_period), coalesce(nullif(p ->> 'payFrequency', ''), s.pay_frequency),
          coalesce(nullif(p ->> 'periodAnchor', '')::date, s.period_anchor),
          case when p ? 'overtimeRule' then nullif(p ->> 'overtimeRule', '') else s.overtime_rule end,
          coalesce(nullif(p ->> 'otMultiplier', '')::numeric, s.ot_multiplier), coalesce(nullif(p ->> 'dtMultiplier', '')::numeric, s.dt_multiplier),
          coalesce(p -> 'differentials', s.differentials), auth.uid(), now())
  on conflict (coalesce(company_id, owner_id)) do update set enabled = excluded.enabled, workers_can_see = excluded.workers_can_see, display_period = excluded.display_period,
    pay_frequency = excluded.pay_frequency, period_anchor = excluded.period_anchor, overtime_rule = excluded.overtime_rule, ot_multiplier = excluded.ot_multiplier,
    dt_multiplier = excluded.dt_multiplier, differentials = excluded.differentials, updated_by = auth.uid(), updated_at = now()
  returning * into s;
  perform public.pm_gps_log(v_c, v_o, 'pay.settings', s.id, public.pm_pay_settings_json(s) - 'updatedAt' - 'saved');
  return public.pm_pay_settings_json(s);
end $$;
revoke execute on function public.pm_pay_settings_save(jsonb) from public, anon;
grant execute on function public.pm_pay_settings_save(jsonb) to authenticated;

-- Per worker: projection on/off, visibility to the worker (null = company default), extra hourly rates by category.
create or replace function public.pm_worker_pay_prefs_save(p_resource_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; x public.pm_worker_pay_prefs; k text; v jsonb;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_hr_can(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.kind <> 'staff' then raise exception 'staff_only' using errcode = '22023'; end if;
  if p ? 'rates' then
    if jsonb_typeof(p -> 'rates') <> 'object' then raise exception 'bad_rates' using errcode = '22023'; end if;
    for k, v in select * from jsonb_each(p -> 'rates') loop
      if k not in ('project', 'shop', 'office', 'training', 'admin', 'travel', 'other_paid') or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 2000 then
        raise exception 'bad_rates' using errcode = '22023';
      end if;
    end loop;
  end if;
  insert into public.pm_worker_pay_prefs as y (resource_id, company_id, owner_id, projection_enabled, worker_can_see, rates, updated_by, updated_at)
  values (r.id, r.company_id, r.owner_id, coalesce((p ->> 'projectionEnabled')::boolean, true),
          case when p ? 'workerCanSee' then (p ->> 'workerCanSee')::boolean end, coalesce(p -> 'rates', '{}'::jsonb), auth.uid(), now())
  on conflict (resource_id) do update set projection_enabled = coalesce((p ->> 'projectionEnabled')::boolean, y.projection_enabled),
    worker_can_see = case when p ? 'workerCanSee' then (p ->> 'workerCanSee')::boolean else y.worker_can_see end,
    rates = coalesce(p -> 'rates', y.rates), updated_by = auth.uid(), updated_at = now()
  returning * into x;
  perform public.pm_gps_log(r.company_id, r.owner_id, 'pay.worker', r.id, jsonb_build_object('projectionEnabled', x.projection_enabled, 'workerCanSee', x.worker_can_see));
  return jsonb_build_object('projectionEnabled', x.projection_enabled, 'workerCanSee', x.worker_can_see, 'rates', x.rates);
end $$;
revoke execute on function public.pm_worker_pay_prefs_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_worker_pay_prefs_save(uuid, jsonb) to authenticated;

-- The only door to pay numbers. HR admins always; the worker only when visible to them. Anyone else (or a hidden
-- worker) gets {available:false} with no amounts at all.
create or replace function public.pm_pay_inputs(p_resource_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources; s public.pm_pay_settings; v_admin boolean; pr public.pm_employee_profiles; h public.pm_employee_hr; x public.pm_worker_pay_prefs;
begin
  select * into r from public.pm_resources where id = p_resource_id;
  if not found or r.kind <> 'staff' or not public.team_in_my_scope(r.company_id, r.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_admin := public.pm_hr_can(r.company_id, r.owner_id);
  if not v_admin then
    if r.linked_user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
    if not coalesce(public.pm_pay_worker_visible(r), false) then return jsonb_build_object('available', false, 'reason', 'hidden'); end if;
  end if;
  s := public.pm_pay_settings_for(r.company_id, r.owner_id);
  if not v_admin and not s.enabled then return jsonb_build_object('available', false, 'reason', 'hidden'); end if;
  select * into pr from public.pm_employee_profiles where resource_id = r.id;
  select * into h from public.pm_employee_hr where resource_id = r.id;
  select * into x from public.pm_worker_pay_prefs where resource_id = r.id;
  if x.resource_id is not null and not x.projection_enabled and not v_admin then return jsonb_build_object('available', false, 'reason', 'hidden'); end if;
  return jsonb_build_object('available', true, 'audience', case when v_admin then 'admin' else 'worker' end,
    'payType', coalesce(pr.pay_type, 'hourly'), 'classification', pr.classification, 'payRate', h.pay_rate, 'payRateUnit', h.pay_rate_unit,
    'employeePayFrequency', h.pay_frequency, 'exempt', h.flsa_status = 'exempt', 'rates', coalesce(x.rates, '{}'::jsonb),
    'projectionEnabled', coalesce(x.projection_enabled, true),
    'settings', public.pm_pay_settings_json(s), 'overtimeRule', coalesce(s.overtime_rule, (public.pm_gps_settings_for(r.company_id, r.owner_id)).overtime_rule),
    'timezone', (public.pm_gps_settings_for(r.company_id, r.owner_id)).timezone,
    'payrollProvider', null);
end $$;
revoke execute on function public.pm_pay_inputs(uuid) from public, anon;
grant execute on function public.pm_pay_inputs(uuid) to authenticated;

-- 5. Employer labor report ---------------------------------------------------------------------------------------
-- Scheduled vs actual hours by job and by non-project category for a date range; cost only for people who manage
-- the team (same rule as the project Labor panel). Pay rates never leave this function.
create or replace function public.pm_labor_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end; v_cost boolean; s public.pm_gps_settings;
  v_from timestamptz; v_to timestamptz; v_sched jsonb := '[]'::jsonb; r record;
begin
  if not public.pm_time_approver(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 92 then raise exception 'bad_range' using errcode = '22023'; end if;
  v_cost := case when v_c is null then true else public.pm_team_manageable(v_c, null) or public.team_is_company_owner(v_c) end;
  s := public.pm_gps_settings_for(v_c, v_o);
  v_from := p_from::timestamp at time zone s.timezone; v_to := (p_to + 1)::timestamp at time zone s.timezone;
  for r in select x.id from public.pm_resources x where x.company_id is not distinct from v_c and x.owner_id is not distinct from v_o and x.kind = 'staff' and x.status = 'active' loop
    v_sched := v_sched || (select coalesce(jsonb_agg(i || jsonb_build_object('resourceId', r.id)), '[]'::jsonb) from jsonb_array_elements(public.pm_worker_schedule_raw(r.id, p_from, p_to)) i
                           where i ->> 'category' not in ('time_off', 'unpaid'));
  end loop;
  return (
    with sch as (
      select (i ->> 'resourceId')::uuid as resource_id, nullif(i ->> 'scheduleId', '')::uuid as schedule_id, i ->> 'category' as category, (i ->> 'hours')::numeric as h
        from jsonb_array_elements(v_sched) i),
    act as (
      select e.resource_id, e.schedule_id, coalesce(e.work_category, 'other_paid') as category, e.status,
             greatest(extract(epoch from (least(coalesce(e.clock_out, now()), v_to) - greatest(e.clock_in, v_from))) / 3600.0
               - case when e.clock_in >= v_from and coalesce(e.clock_out, now()) <= v_to then e.break_minutes / 60.0 else 0 end, 0)::numeric as h
        from public.pm_time_entries e
        where e.company_id is not distinct from v_c and e.owner_id is not distinct from v_o and e.status <> 'rejected'
          and e.clock_in < v_to and coalesce(e.clock_out, now()) > v_from),
    actc as (select a.*, p.hourly_cost from act a left join public.pm_employee_profiles p on p.resource_id = a.resource_id),
    schc as (select sc.*, p.hourly_cost from sch sc left join public.pm_employee_profiles p on p.resource_id = sc.resource_id),
    jobs as (select distinct schedule_id from (select schedule_id from schc where category in ('project', 'travel') and schedule_id is not null
                                                union select schedule_id from actc where schedule_id is not null and category <> 'unpaid') z)
    select jsonb_build_object('from', p_from, 'to', p_to, 'canSeeCost', v_cost, 'timezone', s.timezone,
      'jobs', coalesce((select jsonb_agg(jsonb_build_object('scheduleId', j.schedule_id, 'name', ps.name,
          'scheduledHours', round(coalesce((select sum(h) from schc where schc.schedule_id = j.schedule_id), 0), 2),
          'actualHours', round(coalesce((select sum(h) from actc where actc.schedule_id = j.schedule_id and category <> 'unpaid'), 0), 2),
          'approvedHours', round(coalesce((select sum(h) from actc where actc.schedule_id = j.schedule_id and category <> 'unpaid' and status = 'approved'), 0), 2),
          'scheduledCost', case when v_cost then round(coalesce((select sum(h * hourly_cost) from schc where schc.schedule_id = j.schedule_id), 0), 2) end,
          'actualCost', case when v_cost then round(coalesce((select sum(h * hourly_cost) from actc where actc.schedule_id = j.schedule_id and category <> 'unpaid'), 0), 2) end,
          'approvedCost', case when v_cost then round(coalesce((select sum(h * hourly_cost) from actc where actc.schedule_id = j.schedule_id and category <> 'unpaid' and status = 'approved'), 0), 2) end,
          'uncostedHours', round(coalesce((select sum(h) from actc where actc.schedule_id = j.schedule_id and category <> 'unpaid' and hourly_cost is null), 0), 2),
          'people', (select count(distinct resource_id) from actc where actc.schedule_id = j.schedule_id))
        order by ps.name) from jobs j join public.project_schedules ps on ps.id = j.schedule_id), '[]'::jsonb),
      'nonProject', coalesce((select jsonb_agg(jsonb_build_object('category', c.category,
          'scheduledHours', round(coalesce((select sum(h) from schc where schc.category = c.category and schc.schedule_id is null), 0), 2),
          'actualHours', round(coalesce((select sum(h) from actc where actc.category = c.category and actc.schedule_id is null), 0), 2),
          'approvedHours', round(coalesce((select sum(h) from actc where actc.category = c.category and actc.schedule_id is null and status = 'approved'), 0), 2),
          'actualCost', case when v_cost and c.category <> 'unpaid' then round(coalesce((select sum(h * hourly_cost) from actc where actc.category = c.category and actc.schedule_id is null), 0), 2) end)
        order by c.ord) from (values ('shop', 1), ('office', 2), ('training', 3), ('admin', 4), ('travel', 5), ('other_paid', 6), ('project', 7), ('unpaid', 8)) c(category, ord)
        where exists (select 1 from schc where schc.category = c.category and schc.schedule_id is null) or exists (select 1 from actc where actc.category = c.category and actc.schedule_id is null)), '[]'::jsonb),
      'totals', jsonb_build_object(
          'scheduledHours', round(coalesce((select sum(h) from schc), 0), 2),
          'actualHours', round(coalesce((select sum(h) from actc where category <> 'unpaid'), 0), 2),
          'projectHours', round(coalesce((select sum(h) from actc where schedule_id is not null and category <> 'unpaid'), 0), 2),
          'overheadHours', round(coalesce((select sum(h) from actc where schedule_id is null and category <> 'unpaid'), 0), 2),
          'unpaidHours', round(coalesce((select sum(h) from actc where category = 'unpaid'), 0), 2),
          'actualCost', case when v_cost then round(coalesce((select sum(h * hourly_cost) from actc where category <> 'unpaid'), 0), 2) end,
          'overheadCost', case when v_cost then round(coalesce((select sum(h * hourly_cost) from actc where schedule_id is null and category <> 'unpaid'), 0), 2) end)));
end $$;
revoke execute on function public.pm_labor_report(date, date) from public, anon;
grant execute on function public.pm_labor_report(date, date) to authenticated;
