-- Worker dashboard: My profile + clock-in review notices (2026-11-23).
--
-- Builds on V8.2 time corrections (20270208001000) and V8.3 My work (20270210001000). Nothing there changes.
--   1. pm_worker_my_profile(): the signed-in worker's own staff record(s) — name, title, department, supervisor,
--      trades, hire date, contact details and emergency contact. Never pay, tax, bank or ID numbers.
--   2. pm_worker_profile_save(): the worker updates only their preferred name, personal phone/email and emergency
--      contact. Logged in pm_hr_audit (field names only, never values).
--   3. In-app notices (the bell): a new clock-in review request notifies the company owner and Time admins /
--      supervisors (the people who can open Time tracking → Corrections); the worker is notified when it's
--      approved or denied. A withdrawn or decided request clears the managers' notice.
--   4. notification_dismiss(): clear a time-correction notice.
-- Safe to run more than once.

-- 1. Read my profile ---------------------------------------------------------------------------------
create or replace function public.pm_worker_my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'resourceId', r.id, 'name', r.name, 'companyName', c.name,
      'title', p.title, 'trades', to_jsonb(r.trades), 'hireDate', p.hire_date,
      'workEmail', r.email, 'workPhone', r.phone,
      'preferredName', h.preferred_name, 'personalPhone', h.personal_phone, 'personalEmail', h.personal_email,
      'employmentType', h.employment_type, 'department', h.department, 'workLocation', h.work_location,
      'supervisorName', (select s.name from public.pm_resources s where s.id = h.supervisor_id),
      'emergencyName', coalesce(h.emergency1_name, p.emergency_name),
      'emergencyRelation', h.emergency1_relation,
      'emergencyPhone', coalesce(h.emergency1_phone, p.emergency_phone),
      -- Jobs I'm on: open projects where I (or a crew I'm in) have unfinished tasks, or I have an upcoming shift.
      'jobs', coalesce((select jsonb_agg(jsonb_build_object(
          'scheduleId', j.id, 'name', j.name, 'status', j.status, 'address', j.address,
          'openTasks', j.open_tasks, 'nextDate', j.next_date, 'lastDate', j.last_date
        ) order by j.next_date nulls last, lower(j.name))
        from (
          select s.id, s.name, s.status, s.source_snapshot #>> '{estimate,projectAddress}' as address,
                 count(t.id) filter (where t.status <> 'complete')::int as open_tasks,
                 least(min(greatest(t.planned_start, current_date)) filter (where t.status <> 'complete' and t.planned_end >= current_date),
                       (select min(w.work_date) from public.pm_work_shifts w where w.schedule_id = s.id and w.resource_id = r.id and w.status = 'scheduled' and w.work_date >= current_date)) as next_date,
                 greatest(max(t.planned_end), (select max(w.work_date) from public.pm_work_shifts w where w.schedule_id = s.id and w.resource_id = r.id and w.status = 'scheduled')) as last_date
          from public.project_schedules s
          left join public.schedule_tasks t on t.schedule_id = s.id
            and (t.resource_id = r.id or t.resource_id in (select cm.crew_id from public.pm_crew_members cm where cm.member_id = r.id))
          where s.status = 'active'
            and s.company_id is not distinct from r.company_id
            and (t.id is not null
                 or exists (select 1 from public.pm_work_shifts w where w.schedule_id = s.id and w.resource_id = r.id and w.status = 'scheduled' and w.work_date >= current_date))
          group by s.id
          having count(t.id) filter (where t.status <> 'complete') > 0
              or exists (select 1 from public.pm_work_shifts w where w.schedule_id = s.id and w.resource_id = r.id and w.status = 'scheduled' and w.work_date >= current_date)
          limit 25
        ) j), '[]'::jsonb)
    ) order by lower(r.name)), '[]'::jsonb)
  from public.pm_resources r
  left join public.companies c on c.id = r.company_id
  left join public.pm_employee_profiles p on p.resource_id = r.id
  left join public.pm_employee_hr h on h.resource_id = r.id
  where auth.uid() is not null and r.linked_user_id = auth.uid() and r.kind = 'staff' and r.status = 'active'
    and public.team_in_my_scope(r.company_id, r.owner_id)
$$;
revoke execute on function public.pm_worker_my_profile() from public, anon;
grant execute on function public.pm_worker_my_profile() to authenticated;

-- 2. Update my own contact details --------------------------------------------------------------------
-- p: preferredName, personalPhone, personalEmail, emergencyName, emergencyRelation, emergencyPhone.
-- Keys left out are kept; "" clears. Everything else on the HR file stays manager-only.
create or replace function public.pm_worker_profile_save(p_resource_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_gps_my_resource(p_resource_id); v_fields text[] := '{}'; k text;
  v_email text := nullif(btrim(coalesce(p ->> 'personalEmail', '')), '');
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid' using errcode = '22023'; end if;
  foreach k in array array['preferredName', 'personalPhone', 'personalEmail', 'emergencyName', 'emergencyRelation', 'emergencyPhone'] loop
    if p ? k then v_fields := v_fields || k; end if;
  end loop;
  if cardinality(v_fields) = 0 then return public.pm_worker_my_profile(); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_personal_email' using errcode = '22023'; end if;
  if char_length(coalesce(p ->> 'preferredName', '')) > 100 or char_length(coalesce(p ->> 'personalPhone', '')) > 40 or char_length(coalesce(p ->> 'personalEmail', '')) > 320
     or char_length(coalesce(p ->> 'emergencyName', '')) > 200 or char_length(coalesce(p ->> 'emergencyRelation', '')) > 60 or char_length(coalesce(p ->> 'emergencyPhone', '')) > 40 then
    raise exception 'field_length' using errcode = '22023';
  end if;

  insert into public.pm_employee_hr (resource_id, updated_by) values (r.id, auth.uid()) on conflict (resource_id) do nothing;
  update public.pm_employee_hr set
    preferred_name      = case when p ? 'preferredName' then nullif(btrim(p ->> 'preferredName'), '') else preferred_name end,
    personal_phone      = case when p ? 'personalPhone' then nullif(btrim(p ->> 'personalPhone'), '') else personal_phone end,
    personal_email      = case when p ? 'personalEmail' then v_email else personal_email end,
    emergency1_name     = case when p ? 'emergencyName' then nullif(btrim(p ->> 'emergencyName'), '') else emergency1_name end,
    emergency1_relation = case when p ? 'emergencyRelation' then nullif(btrim(p ->> 'emergencyRelation'), '') else emergency1_relation end,
    emergency1_phone    = case when p ? 'emergencyPhone' then nullif(btrim(p ->> 'emergencyPhone'), '') else emergency1_phone end,
    updated_by = auth.uid(), updated_at = now()
  where resource_id = r.id;

  -- Team & Subcontractors shows the emergency contact from the employee profile; keep it in step.
  if p ? 'emergencyName' or p ? 'emergencyPhone' then
    insert into public.pm_employee_profiles (resource_id, updated_by) values (r.id, auth.uid()) on conflict (resource_id) do nothing;
    update public.pm_employee_profiles set
      emergency_name  = case when p ? 'emergencyName' then nullif(btrim(p ->> 'emergencyName'), '') else emergency_name end,
      emergency_phone = case when p ? 'emergencyPhone' then nullif(btrim(p ->> 'emergencyPhone'), '') else emergency_phone end,
      updated_by = auth.uid(), updated_at = now()
    where resource_id = r.id;
  end if;

  insert into public.pm_hr_audit (resource_id, company_id, owner_id, actor, action, fields)
  values (r.id, r.company_id, r.owner_id, auth.uid(), 'worker_self_update', v_fields);
  return public.pm_worker_my_profile();
end $$;
revoke execute on function public.pm_worker_profile_save(uuid, jsonb) from public, anon;
grant execute on function public.pm_worker_profile_save(uuid, jsonb) to authenticated;

-- 3. Clock-in review notices --------------------------------------------------------------------------
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check
  check (kind in ('task_review', 'customer_update', 'customer_reply', 'time_correction', 'time_correction_decided'));

create or replace function public.pm_time_correction_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources; v_tz text; v_name text;
begin
  -- A notice must never block the request or the decision itself.
  begin
    select * into r from public.pm_resources where id = new.resource_id;
    v_name := coalesce(nullif(btrim(r.name), ''), 'An employee');
    v_tz := coalesce((select s.timezone from public.pm_gps_settings s
                       where s.company_id is not distinct from new.company_id and s.owner_id is not distinct from new.owner_id limit 1), 'America/Chicago');
    if tg_op = 'INSERT' then
      if new.status = 'pending' then
        insert into public.user_notifications (user_id, company_id, kind, dedupe_key, title, data)
        select a.u, new.company_id, 'time_correction', 'time_correction:' || new.id,
               left(v_name || case when new.kind = 'missing' then ' asked to add missing time' else ' asked for a clock-in review' end, 300),
               jsonb_build_object('correctionId', new.id, 'employeeName', v_name, 'issue', new.issue, 'requestKind', new.kind,
                 'clockIn', new.clock_in, 'clockOut', new.clock_out, 'timezone', v_tz, 'reason', left(new.reason, 160))
        from (
          select c.owner_user_id as u from public.companies c where new.company_id is not null and c.id = new.company_id
          union
          select t.user_id from public.pm_time_supervisors t
            join public.company_members m on m.company_id = t.company_id and m.user_id = t.user_id and m.status = 'active'
           where new.company_id is not null and t.company_id = new.company_id
          union
          select new.owner_id where new.company_id is null
        ) a
        where a.u is not null and a.u is distinct from new.requested_by
        on conflict (user_id, dedupe_key) do nothing;
      end if;
    elsif old.status = 'pending' and new.status is distinct from old.status then
      update public.user_notifications set status = 'resolved', resolution = 'handled', resolved_at = now(), resolved_by = auth.uid()
       where kind = 'time_correction' and dedupe_key = 'time_correction:' || new.id and status in ('open', 'snoozed');
      if new.status in ('approved', 'denied') and r.linked_user_id is not null and r.linked_user_id is distinct from new.decided_by then
        insert into public.user_notifications (user_id, company_id, kind, dedupe_key, title, data)
        values (r.linked_user_id, new.company_id, 'time_correction_decided', 'time_correction_decided:' || new.id,
                case when new.status = 'approved' then 'Your time fix was approved' else 'Your time fix was denied' end,
                jsonb_build_object('correctionId', new.id, 'decision', new.status, 'note', new.decision_note, 'requestKind', new.kind,
                  'clockIn', new.clock_in, 'clockOut', new.clock_out, 'timezone', v_tz))
        on conflict (user_id, dedupe_key) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'pm_time_correction_notify: %', sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public.pm_time_correction_notify() from public, anon, authenticated;

drop trigger if exists pm_time_corrections_notify on public.pm_time_corrections;
create trigger pm_time_corrections_notify after insert or update of status on public.pm_time_corrections
  for each row execute function public.pm_time_correction_notify();

-- 4. Clear a time-correction notice ------------------------------------------------------------------
create or replace function public.notification_dismiss(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.user_notifications set status = 'resolved', resolution = 'handled', resolved_at = now(), resolved_by = auth.uid(), read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid() and kind in ('time_correction', 'time_correction_decided');
  if not found then raise exception 'not_found' using errcode = '42501'; end if;
  return jsonb_build_object('status', 'resolved');
end $$;
revoke execute on function public.notification_dismiss(uuid) from public, anon;
grant execute on function public.notification_dismiss(uuid) to authenticated;
