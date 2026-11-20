-- V8.2 Customer workforce: automatic GPS timekeeping for a contractor company's own W-2 employees.
--
-- This is customer-facing (Projects → Contractors & Workforce → Time tracking). It is NOT Built2Bid LLC's
-- internal staff / sales rep / payout system and shares nothing with it.
--
-- Builds on the existing records instead of a second employee list:
--   * employees = Staff entries in pm_resources (kind 'staff'); subcontractors and crews can never be enrolled
--   * time      = pm_time_entries + pm_time_entry_changes (the existing time clock and its change log)
--   * projects  = project_schedules (+ the estimate's project address); schedule_tasks assignments
--   * pay rates = pm_employee_profiles.hourly_cost (managers only), FLSA status from pm_employee_hr
--
-- New:
--   1. pm_gps_settings: company (or solo account) switch "Automatic GPS Time Tracking" (OFF by default, and it
--      can't be switched on until a work location is confirmed and the admin confirms employees were told),
--      geofence timing, what happens on exit (ask the employee, or clock out automatically), work hours,
--      overtime rule for exports, retention.
--   2. pm_work_locations: main business address, project/jobsite addresses and other approved places (shop,
--      yard, satellite office, temporary site). Each has a pin and a geofence radius of 30-322 m (322 m = 0.2 mi,
--      the maximum). A changed pin or radius needs the admin to confirm it again.
--   3. pm_work_location_assignments: who is assigned where (or "everyone" on the location). Project locations
--      also count anyone assigned to that project's schedule tasks around the task dates.
--   4. pm_gps_enrollments: per employee. The admin must confirm "W-2 employee whose hours are tracked" (never
--      assumed from having a login), and the employee must accept the location disclosure themselves.
--      Permission status / app mode are reported by the employee's device.
--   5. pm_geofence_events: event-based only (arrived / stayed / left / still away), with the distance from the
--      site centre and the GPS accuracy. Raw coordinates are never stored for geofence events, so there is no
--      travel history to look at. Purged after the company's retention period (default 90 days).
--   6. pm_time_entries gains location, work type (regular / travel / offsite), paid breaks, a shift reference,
--      "away since" (left the site, waiting for the employee to say whether they're still working), a review
--      flag, and the original punch times (kept on the first edit; every edit is still logged in full).
--   7. pm_time_corrections: employees ask for a fix or for missing time; an approver decides. Approving applies
--      the change through the normal log and approves the resulting hours.
--   8. pm_timesheet_signoffs: an employee confirms their own week.
--   9. pm_time_supervisors: the company owner names Time admins (set up GPS) and Time supervisors (see
--      exceptions and geofence events, approve corrections). Location events are visible only to them, the
--      owner and the employee themself.
--  10. pm_gps_audit: every settings / location / enrollment / consent / supervisor / correction change.
--  11. pm_project_labor(): estimated labor hours/cost (from the estimate's labor lines, read-only) vs actual.
--
-- GPS never deletes or reduces time: a weak signal never clocks anyone out, an exit only clocks out
-- automatically when the company chose that, and even then the entry is flagged for review. Nothing deducts
-- lunch. Safe to run more than once. Requires 20270205001000_hr_records_complete.sql.
-- Rollback: docs/workforce-gps/rollback_20270208001000.sql

-- 0. Who may do what -------------------------------------------------------------------------------------------
create table if not exists public.pm_time_supervisors (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'supervisor')),
  added_by   uuid references auth.users (id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (company_id, user_id)
);
alter table public.pm_time_supervisors enable row level security;
revoke all on public.pm_time_supervisors from anon, authenticated;
drop policy if exists pm_time_supervisors_select on public.pm_time_supervisors;
create policy pm_time_supervisors_select on public.pm_time_supervisors for select to authenticated
  using (public.team_is_company_owner(company_id) or user_id = auth.uid());
grant select on public.pm_time_supervisors to authenticated;

-- Time admin: sets up GPS time tracking. Solo account owner, company owner, or a named Time admin.
create or replace function public.pm_time_admin(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null and public.team_in_my_scope(p_company, p_owner) and case
    when p_company is null then p_owner = auth.uid()
    else public.team_is_company_owner(p_company)
      or exists (select 1 from public.pm_time_supervisors t join public.company_members m on m.company_id = t.company_id and m.user_id = t.user_id and m.status = 'active'
                  where t.company_id = p_company and t.user_id = auth.uid() and t.role = 'admin')
  end, false)
$$;
-- Time supervisor: sees exceptions and geofence events, approves corrections.
create or replace function public.pm_time_supervisor(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.pm_time_admin(p_company, p_owner) or (auth.uid() is not null and p_company is not null and public.team_in_my_scope(p_company, p_owner)
      and exists (select 1 from public.pm_time_supervisors t join public.company_members m on m.company_id = t.company_id and m.user_id = t.user_id and m.status = 'active'
                   where t.company_id = p_company and t.user_id = auth.uid())), false)
$$;
-- Approver of hours and corrections: a time supervisor, or anyone who already manages the team.
create or replace function public.pm_time_approver(p_company uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.pm_time_supervisor(p_company, p_owner) or (public.team_in_my_scope(p_company, p_owner) and public.pm_team_manageable(p_company, p_owner)), false)
$$;
revoke execute on function public.pm_time_admin(uuid, uuid), public.pm_time_supervisor(uuid, uuid), public.pm_time_approver(uuid, uuid) from public, anon;
grant execute on function public.pm_time_admin(uuid, uuid), public.pm_time_supervisor(uuid, uuid), public.pm_time_approver(uuid, uuid) to authenticated;

-- Audit log (never coordinates).
create table if not exists public.pm_gps_audit (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 60),
  target_id uuid,
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 4096),
  at timestamptz not null default now()
);
create index if not exists pm_gps_audit_scope_idx on public.pm_gps_audit (coalesce(company_id, owner_id), at desc);
alter table public.pm_gps_audit enable row level security;
revoke all on public.pm_gps_audit from anon, authenticated;
drop policy if exists pm_gps_audit_select on public.pm_gps_audit;
create policy pm_gps_audit_select on public.pm_gps_audit for select to authenticated using (public.pm_time_admin(company_id, owner_id));
grant select on public.pm_gps_audit to authenticated;

create or replace function public.pm_gps_log(p_company uuid, p_owner uuid, p_action text, p_target uuid, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.pm_gps_audit (company_id, owner_id, actor_id, action, target_id, detail) values (p_company, p_owner, auth.uid(), p_action, p_target, coalesce(p_detail, '{}'::jsonb))
$$;
revoke execute on function public.pm_gps_log(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- Company owner names Time admins and supervisors (p_role null removes).
create or replace function public.pm_time_supervisor_set(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.team_is_company_owner(v_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role is not null and p_role not in ('admin', 'supervisor') then raise exception 'bad_role' using errcode = '22023'; end if;
  if p_role is null then
    delete from public.pm_time_supervisors where company_id = v_company and user_id = p_user;
  else
    if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user and m.status = 'active') then
      raise exception 'not_member' using errcode = '22023';
    end if;
    insert into public.pm_time_supervisors (company_id, user_id, role, added_by) values (v_company, p_user, p_role, auth.uid())
    on conflict (company_id, user_id) do update set role = excluded.role, added_by = auth.uid(), added_at = now();
  end if;
  perform public.pm_gps_log(v_company, null, 'supervisor.set', p_user, jsonb_build_object('role', p_role));
end $$;
revoke execute on function public.pm_time_supervisor_set(uuid, text) from public, anon;
grant execute on function public.pm_time_supervisor_set(uuid, text) to authenticated;

-- 1. Settings ---------------------------------------------------------------------------------------------------
create table if not exists public.pm_gps_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  disclosure_ack_at timestamptz,
  disclosure_ack_by uuid references auth.users (id) on delete set null,
  disclosure_version integer not null default 1 check (disclosure_version between 1 and 1000),
  disclosure_extra text check (char_length(disclosure_extra) <= 2000),
  default_radius_m integer not null default 322 check (default_radius_m between 30 and 322),
  entry_dwell_min integer not null default 3 check (entry_dwell_min between 1 and 30),
  exit_grace_min integer not null default 10 check (exit_grace_min between 2 and 60),
  entry_action text not null default 'auto' check (entry_action in ('auto', 'ask')),
  exit_action text not null default 'ask' check (exit_action in ('ask', 'auto')),
  start_rule text not null default 'schedule' check (start_rule in ('schedule', 'any_time')),
  work_days integer[] not null default '{1,2,3,4,5}' check (cardinality(work_days) between 1 and 7 and work_days <@ '{1,2,3,4,5,6,7}'),
  work_start time not null default '06:00',
  work_end time not null default '19:00',
  early_min integer not null default 30 check (early_min between 0 and 180),
  travel_window_min integer not null default 90 check (travel_window_min between 10 and 240),
  max_accuracy_m integer not null default 100 check (max_accuracy_m between 20 and 500),
  overtime_rule text not null default 'federal' check (overtime_rule in ('federal', 'california', 'colorado', 'alaska', 'nevada', 'none')),
  timezone text not null default 'America/Chicago' check (char_length(timezone) between 1 and 64),
  retention_days integer not null default 90 check (retention_days between 30 and 365),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint pm_gps_settings_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_gps_settings_hours check (work_end > work_start)
);
create unique index if not exists pm_gps_settings_scope_uq on public.pm_gps_settings (coalesce(company_id, owner_id));
alter table public.pm_gps_settings enable row level security;
revoke all on public.pm_gps_settings from anon, authenticated;
drop policy if exists pm_gps_settings_select on public.pm_gps_settings;
create policy pm_gps_settings_select on public.pm_gps_settings for select to authenticated using (public.team_in_my_scope(company_id, owner_id));
grant select on public.pm_gps_settings to authenticated;

-- The scope's settings, or the defaults when nothing has been saved.
create or replace function public.pm_gps_settings_for(p_company uuid, p_owner uuid) returns public.pm_gps_settings
language plpgsql stable security definer set search_path = public as $$
declare s public.pm_gps_settings;
begin
  select * into s from public.pm_gps_settings x where x.company_id is not distinct from p_company and x.owner_id is not distinct from p_owner;
  if found then return s; end if;
  s.company_id := p_company; s.owner_id := p_owner; s.enabled := false; s.disclosure_version := 1; s.default_radius_m := 322;
  s.entry_dwell_min := 3; s.exit_grace_min := 10; s.entry_action := 'auto'; s.exit_action := 'ask'; s.start_rule := 'schedule';
  s.work_days := '{1,2,3,4,5}'; s.work_start := '06:00'; s.work_end := '19:00'; s.early_min := 30; s.travel_window_min := 90;
  s.max_accuracy_m := 100; s.overtime_rule := 'federal'; s.timezone := 'America/Chicago'; s.retention_days := 90;
  return s;
end $$;
revoke execute on function public.pm_gps_settings_for(uuid, uuid) from public, anon, authenticated;

create or replace function public.pm_gps_settings_json(s public.pm_gps_settings) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('enabled', s.enabled, 'disclosureAckAt', s.disclosure_ack_at, 'disclosureVersion', s.disclosure_version,
    'disclosureExtra', s.disclosure_extra, 'defaultRadiusM', s.default_radius_m, 'entryDwellMin', s.entry_dwell_min, 'exitGraceMin', s.exit_grace_min,
    'entryAction', s.entry_action, 'exitAction', s.exit_action, 'startRule', s.start_rule, 'workDays', to_jsonb(s.work_days),
    'workStart', to_char(s.work_start, 'HH24:MI'), 'workEnd', to_char(s.work_end, 'HH24:MI'), 'earlyMin', s.early_min,
    'travelWindowMin', s.travel_window_min, 'maxAccuracyM', s.max_accuracy_m, 'overtimeRule', s.overtime_rule, 'timezone', s.timezone,
    'retentionDays', s.retention_days, 'saved', s.id is not null, 'updatedAt', s.updated_at)
$$;
revoke execute on function public.pm_gps_settings_json(public.pm_gps_settings) from public, anon;
grant execute on function public.pm_gps_settings_json(public.pm_gps_settings) to authenticated;

-- 2. Work locations ---------------------------------------------------------------------------------------------
create table if not exists public.pm_work_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('business', 'project', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  address text check (char_length(address) <= 500),
  schedule_id uuid references public.project_schedules (id) on delete cascade,
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  radius_m integer not null default 322 check (radius_m between 30 and 322),
  pin_source text check (pin_source in ('device', 'census', 'manual')),
  pin_accuracy_m integer check (pin_accuracy_m is null or pin_accuracy_m >= 0),
  everyone boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_work_locations_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_work_locations_project check ((kind = 'project') = (schedule_id is not null)),
  constraint pm_work_locations_pin check ((lat is null) = (lng is null)),
  constraint pm_work_locations_confirm check (confirmed_at is null or lat is not null)
);
create unique index if not exists pm_work_locations_one_business on public.pm_work_locations (coalesce(company_id, owner_id)) where kind = 'business' and status = 'active';
create unique index if not exists pm_work_locations_one_project on public.pm_work_locations (schedule_id) where schedule_id is not null and status = 'active';
create index if not exists pm_work_locations_scope_idx on public.pm_work_locations (coalesce(company_id, owner_id), status);

create table if not exists public.pm_work_location_assignments (
  location_id uuid not null references public.pm_work_locations (id) on delete cascade,
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  starts_on date,
  ends_on date,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (location_id, resource_id),
  constraint pm_wla_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists pm_wla_resource_idx on public.pm_work_location_assignments (resource_id);

alter table public.pm_work_locations enable row level security;
alter table public.pm_work_location_assignments enable row level security;
revoke all on public.pm_work_locations, public.pm_work_location_assignments from anon, authenticated;
drop policy if exists pm_work_locations_select on public.pm_work_locations;
create policy pm_work_locations_select on public.pm_work_locations for select to authenticated using (public.pm_time_approver(company_id, owner_id));
drop policy if exists pm_wla_select on public.pm_work_location_assignments;
create policy pm_wla_select on public.pm_work_location_assignments for select to authenticated
  using (exists (select 1 from public.pm_work_locations l where l.id = location_id));
grant select on public.pm_work_locations, public.pm_work_location_assignments to authenticated;

-- A location is usable for geofencing when it is active, has a pin and the admin confirmed it.
create or replace function public.pm_work_location_ready(l public.pm_work_locations) returns boolean
language sql immutable set search_path = public as $$
  select l.status = 'active' and l.lat is not null and l.confirmed_at is not null
$$;

-- Is a staff member assigned to a location at a moment? Explicit assignment (with optional dates), "everyone",
-- or (project locations) assigned to that project's schedule tasks, directly or through a crew, from the day
-- before a task starts to the day after it ends.
create or replace function public.pm_gps_assigned(p_resource uuid, p_location uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pm_work_locations l
     where l.id = p_location and (
       l.everyone
       or exists (select 1 from public.pm_work_location_assignments a where a.location_id = l.id and a.resource_id = p_resource
                    and (a.starts_on is null or a.starts_on <= p_day) and (a.ends_on is null or a.ends_on >= p_day))
       or (l.schedule_id is not null and exists (
             select 1 from public.schedule_tasks t
              where t.schedule_id = l.schedule_id and t.status <> 'complete'
                and p_day between t.planned_start - 1 and t.planned_end + 1
                and (t.resource_id = p_resource or t.resource_id in (select c.crew_id from public.pm_crew_members c where c.member_id = p_resource))))))
$$;
revoke execute on function public.pm_gps_assigned(uuid, uuid, date) from public, anon, authenticated;

-- 3. Enrollment + consent ---------------------------------------------------------------------------------------
create table if not exists public.pm_gps_enrollments (
  resource_id uuid primary key references public.pm_resources (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  enrolled boolean not null default false,
  w2_confirmed_at timestamptz,
  w2_confirmed_by uuid references auth.users (id) on delete set null,
  consent_version integer,
  consent_at timestamptz,
  consent_withdrawn_at timestamptz,
  permission text not null default 'unknown' check (permission in ('unknown', 'granted', 'prompt', 'denied', 'unavailable')),
  permission_at timestamptz,
  app_mode text check (app_mode in ('browser', 'pwa', 'native_ios', 'native_android')),
  device text check (char_length(device) <= 60),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pm_gps_enrollments_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_gps_enrollments_w2 check (not enrolled or w2_confirmed_at is not null)
);
alter table public.pm_gps_enrollments enable row level security;
revoke all on public.pm_gps_enrollments from anon, authenticated;
drop policy if exists pm_gps_enrollments_select on public.pm_gps_enrollments;
create policy pm_gps_enrollments_select on public.pm_gps_enrollments for select to authenticated
  using (public.pm_time_approver(company_id, owner_id) or exists (select 1 from public.pm_resources r where r.id = resource_id and r.linked_user_id = auth.uid()));
grant select on public.pm_gps_enrollments to authenticated;

-- Automatic GPS timekeeping is live for an employee only when every gate is open.
create or replace function public.pm_gps_active(p_resource uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pm_resources r
      join public.pm_gps_enrollments e on e.resource_id = r.id
      join public.pm_gps_settings s on s.company_id is not distinct from r.company_id and s.owner_id is not distinct from r.owner_id
     where r.id = p_resource and r.kind = 'staff' and r.status = 'active'
       and coalesce((select p.clock_enabled from public.pm_employee_profiles p where p.resource_id = r.id), true)
       and s.enabled and e.enrolled and e.w2_confirmed_at is not null
       and e.consent_at is not null and e.consent_withdrawn_at is null and e.consent_version >= s.disclosure_version)
$$;
revoke execute on function public.pm_gps_active(uuid) from public, anon, authenticated;

-- 4. Geofence events --------------------------------------------------------------------------------------------
create table if not exists public.pm_geofence_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  location_id uuid references public.pm_work_locations (id) on delete set null,
  kind text not null check (kind in ('enter', 'dwell', 'exit', 'exit_confirmed', 'resolve')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  accuracy_m integer check (accuracy_m is null or accuracy_m >= 0),
  distance_m integer check (distance_m is null or distance_m >= 0),
  source text not null check (source in ('browser', 'pwa', 'native_ios', 'native_android')),
  outcome text not null check (outcome in ('noted', 'clocked_in', 'clocked_out', 'transferred', 'asked', 'confirmed', 'returned',
                                           'ignored_not_assigned', 'ignored_duplicate', 'ignored_low_accuracy', 'ignored_no_arrival')),
  entry_id uuid references public.pm_time_entries (id) on delete set null,
  client_event_id text check (char_length(client_event_id) <= 80),
  detail text check (char_length(detail) <= 300),
  constraint pm_geofence_events_scope check ((company_id is null) <> (owner_id is null))
);
create unique index if not exists pm_geofence_events_client_uq on public.pm_geofence_events (resource_id, client_event_id) where client_event_id is not null;
create index if not exists pm_geofence_events_resource_idx on public.pm_geofence_events (resource_id, occurred_at desc);
create index if not exists pm_geofence_events_scope_idx on public.pm_geofence_events (coalesce(company_id, owner_id), recorded_at);
alter table public.pm_geofence_events enable row level security;
revoke all on public.pm_geofence_events from anon, authenticated;
drop policy if exists pm_geofence_events_select on public.pm_geofence_events;
create policy pm_geofence_events_select on public.pm_geofence_events for select to authenticated
  using (public.pm_time_supervisor(company_id, owner_id) or exists (select 1 from public.pm_resources r where r.id = resource_id and r.linked_user_id = auth.uid()));
grant select on public.pm_geofence_events to authenticated;

-- 5. Time entries: location, work type, paid breaks, shifts, away, originals -------------------------------------
alter table public.pm_time_entries add column if not exists location_id uuid references public.pm_work_locations (id) on delete set null;
alter table public.pm_time_entries add column if not exists work_type text not null default 'regular';
alter table public.pm_time_entries add column if not exists paid_break_minutes integer not null default 0;
alter table public.pm_time_entries add column if not exists shift_id uuid;
alter table public.pm_time_entries add column if not exists away_since timestamptz;
alter table public.pm_time_entries add column if not exists review_flag text;
alter table public.pm_time_entries add column if not exists original_clock_in timestamptz;
alter table public.pm_time_entries add column if not exists original_clock_out timestamptz;
alter table public.pm_time_entries drop constraint if exists pm_time_entries_source_check;
alter table public.pm_time_entries add constraint pm_time_entries_source_check check (source in ('clock', 'manual', 'gps', 'gps_confirmed', 'travel', 'correction'));
alter table public.pm_time_entries drop constraint if exists pm_time_entries_work_type_check;
alter table public.pm_time_entries add constraint pm_time_entries_work_type_check check (work_type in ('regular', 'travel', 'offsite'));
alter table public.pm_time_entries drop constraint if exists pm_time_entries_paid_break_check;
alter table public.pm_time_entries add constraint pm_time_entries_paid_break_check check (paid_break_minutes between 0 and 720);
alter table public.pm_time_entries drop constraint if exists pm_time_entries_review_flag_check;
alter table public.pm_time_entries add constraint pm_time_entries_review_flag_check check (review_flag is null or review_flag in ('auto_clock_out', 'travel', 'away_no_answer', 'travel_gap', 'long_shift'));
alter table public.pm_time_entries drop constraint if exists pm_time_entries_away_open;
alter table public.pm_time_entries add constraint pm_time_entries_away_open check (away_since is null or status = 'open');
create index if not exists pm_time_entries_location_idx on public.pm_time_entries (location_id) where location_id is not null;
create index if not exists pm_time_entries_shift_idx on public.pm_time_entries (shift_id) where shift_id is not null;

-- Keep the punch times as first recorded, the first time an entry's times are changed.
create or replace function public.pm_time_keep_original() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.original_clock_in is null and (new.clock_in is distinct from old.clock_in
      or (old.clock_out is not null and new.clock_out is distinct from old.clock_out)) then
    new.original_clock_in := old.clock_in;
    new.original_clock_out := old.clock_out;
  end if;
  return new;
end $$;
drop trigger if exists pm_time_entries_keep_original on public.pm_time_entries;
create trigger pm_time_entries_keep_original before update on public.pm_time_entries for each row execute function public.pm_time_keep_original();

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

create or replace function public.pm_time_check_location(p_location uuid, r public.pm_resources) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_location is null then return; end if;
  if not exists (select 1 from public.pm_work_locations l where l.id = p_location and l.status = 'active'
                   and l.company_id is not distinct from r.company_id and l.owner_id is not distinct from r.owner_id) then
    raise exception 'bad_location' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.pm_time_check_location(uuid, public.pm_resources) from public, anon, authenticated;

-- Manual clock in (now also takes a work location and work type). p {resourceId, scheduleId?, locationId?, workType?, note?, lat?, lng?, accuracyM?}
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

-- Manual clock out (now also takes paid break minutes; clears "away"). p {entryId, breakMinutes?, paidBreakMinutes?, note?, scheduleId?, lat?, lng?, accuracyM?}
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
  if v_out - e.clock_in > interval '24 hours' then v_out := e.clock_in + interval '24 hours'; end if;
  if v_out <= e.clock_in then v_out := e.clock_in + interval '1 second'; end if;
  update public.pm_time_entries set clock_out = v_out, status = 'pending', away_since = null,
    break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'breakMinutes', '')::int, break_minutes))),
    paid_break_minutes = greatest(0, least(720, coalesce(nullif(p ->> 'paidBreakMinutes', '')::int, paid_break_minutes))),
    note = coalesce(left(nullif(btrim(p ->> 'note'), ''), 500), note),
    schedule_id = case when p ? 'scheduleId' then nullif(p ->> 'scheduleId', '')::uuid else schedule_id end,
    out_lat = round(nullif(p ->> 'lat', '')::numeric, 6), out_lng = round(nullif(p ->> 'lng', '')::numeric, 6),
    out_accuracy_m = case when nullif(p ->> 'lat', '') is not null then round(nullif(p ->> 'accuracyM', '')::numeric)::int end,
    review_flag = case when v_out - e.clock_in >= interval '16 hours' then 'long_shift' else review_flag end,
    updated_at = now()
  where id = e.id returning * into e;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_clock_out(jsonb) from public, anon;
grant execute on function public.pm_clock_out(jsonb) to authenticated;

-- Internal: apply a changed or added entry with an overlap check and a full before/after log. No permission check
-- here (callers check). Returns the entry.
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

-- Managers add or fix an entry (now with location, work type and paid breaks). Same rules as before.
create or replace function public.pm_time_entry_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_id uuid := nullif(p ->> 'id', '')::uuid; v_reason text := left(nullif(btrim(p ->> 'reason'), ''), 300);
begin
  if v_id is not null then
    select * into e from public.pm_time_entries where id = v_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    select * into r from public.pm_resources where id = e.resource_id;
  else
    select * into r from public.pm_resources where id = nullif(p ->> 'resourceId', '')::uuid;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  if r.kind <> 'staff' or not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_time_approver(r.company_id, r.owner_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_id is not null then
    if e.status = 'approved' then raise exception 'approved_locked' using errcode = '22023'; end if;
    if v_reason is null then raise exception 'reason_required' using errcode = '22023'; end if;
    -- Editing a still-open entry closes it: the edit supplies the clock-out.
    e := public.pm_time_apply(r, v_id, p, 'edited', v_reason, case when e.status = 'rejected' or e.status = 'open' then 'pending' else e.status end);
  else
    e := public.pm_time_apply(r, null, p, 'added', v_reason, 'pending');
  end if;
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_time_entry_save(jsonb) from public, anon;
grant execute on function public.pm_time_entry_save(jsonb) to authenticated;

-- 6. Settings + locations RPCs ----------------------------------------------------------------------------------
-- Everything the Time tracking page needs: settings, setup checklist, locations, employees and their status.
create or replace function public.pm_gps_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end;
  s public.pm_gps_settings; v_today date;
begin
  if not public.pm_time_approver(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := public.pm_gps_settings_for(v_c, v_o);
  v_today := (now() at time zone s.timezone)::date;
  return jsonb_build_object(
    'canAdmin', public.pm_time_admin(v_c, v_o),
    'canSupervise', public.pm_time_supervisor(v_c, v_o),
    'isOwner', v_c is null or public.team_is_company_owner(v_c),
    'companyId', v_c,
    'settings', public.pm_gps_settings_json(s),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'name', l.name, 'address', l.address, 'scheduleId', l.schedule_id,
        'lat', l.lat, 'lng', l.lng, 'radiusM', l.radius_m, 'pinSource', l.pin_source, 'pinAccuracyM', l.pin_accuracy_m, 'everyone', l.everyone,
        'confirmedAt', l.confirmed_at, 'status', l.status, 'ready', public.pm_work_location_ready(l),
        'assigned', coalesce((select jsonb_agg(jsonb_build_object('resourceId', a.resource_id, 'startsOn', a.starts_on, 'endsOn', a.ends_on)) from public.pm_work_location_assignments a where a.location_id = l.id), '[]'::jsonb),
        'scheduledToday', case when l.schedule_id is null then '[]'::jsonb else coalesce((select jsonb_agg(distinct r.id) from public.pm_resources r
            where r.kind = 'staff' and r.company_id is not distinct from v_c and r.owner_id is not distinct from v_o and public.pm_gps_assigned(r.id, l.id, v_today)
              and not exists (select 1 from public.pm_work_location_assignments a where a.location_id = l.id and a.resource_id = r.id)), '[]'::jsonb) end
      ) order by l.status, case l.kind when 'business' then 0 when 'other' then 1 else 2 end, lower(l.name))
      from public.pm_work_locations l where l.company_id is not distinct from v_c and l.owner_id is not distinct from v_o), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'status', r.status, 'linked', r.linked_user_id is not null,
        'payType', coalesce(p.pay_type, 'hourly'), 'flsa', h.flsa_status, 'enrolled', coalesce(e.enrolled, false), 'w2ConfirmedAt', e.w2_confirmed_at,
        'consentAt', case when e.consent_withdrawn_at is null then e.consent_at end, 'consentVersion', e.consent_version, 'consentWithdrawnAt', e.consent_withdrawn_at,
        'permission', coalesce(e.permission, 'unknown'), 'permissionAt', e.permission_at, 'appMode', e.app_mode, 'lastSeenAt', e.last_seen_at,
        'active', public.pm_gps_active(r.id),
        'open', (select jsonb_build_object('id', x.id, 'clockIn', x.clock_in, 'locationId', x.location_id, 'source', x.source, 'awaySince', x.away_since)
                   from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open')
      ) order by r.kind <> 'staff', r.status, lower(r.name))
      from public.pm_resources r
      left join public.pm_employee_profiles p on p.resource_id = r.id
      left join public.pm_employee_hr h on h.resource_id = r.id and public.pm_hr_can(r.company_id, r.owner_id)
      left join public.pm_gps_enrollments e on e.resource_id = r.id
      where r.company_id is not distinct from v_c and r.owner_id is not distinct from v_o and r.kind in ('staff', 'subcontractor')), '[]'::jsonb),
    'supervisors', case when v_c is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id,
        'name', coalesce(nullif(btrim(m.display_name), ''), split_part(coalesce(m.email, ''), '@', 1)), 'role', t.role) order by lower(coalesce(m.display_name, m.email)))
      from public.company_members m left join public.pm_time_supervisors t on t.company_id = m.company_id and t.user_id = m.user_id
      where m.company_id = v_c and m.status = 'active' and m.user_id <> (select c.owner_user_id from public.companies c where c.id = v_c)), '[]'::jsonb) end,
    'candidates', jsonb_build_object(
      'business', (select nullif(btrim(bp.address), '') from public.business_profiles bp
                    where bp.user_id = coalesce(v_o, (select c.owner_user_id from public.companies c where c.id = v_c))),
      'projects', coalesce((select jsonb_agg(jsonb_build_object('scheduleId', ps.id, 'name', ps.name, 'address', nullif(btrim(es.project_address), ''), 'status', ps.status) order by ps.updated_at desc)
        from public.project_schedules ps join public.estimates es on es.id = ps.estimate_id
        where ps.status in ('draft', 'active') and ((v_c is not null and ps.company_id = v_c) or (v_c is null and ps.company_id is null and ps.user_id = v_o))
          and not exists (select 1 from public.pm_work_locations l where l.schedule_id = ps.id and l.status = 'active')), '[]'::jsonb)));
end $$;
revoke execute on function public.pm_gps_admin_overview() from public, anon;
grant execute on function public.pm_gps_admin_overview() to authenticated;

-- Save settings. Switching GPS time tracking ON needs a confirmed work location and the admin's confirmation
-- that employees were told how it works (p.disclosureAck = true, or already recorded).
create or replace function public.pm_gps_settings_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end;
  s public.pm_gps_settings; v_days integer[]; v_enable boolean; v_ack timestamptz; v_extra text; v_ver integer;
begin
  if not public.pm_time_admin(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := public.pm_gps_settings_for(v_c, v_o);
  v_enable := coalesce((p ->> 'enabled')::boolean, s.enabled);
  v_ack := case when (p ->> 'disclosureAck')::boolean then now() when (p ->> 'disclosureAck')::boolean = false then null else s.disclosure_ack_at end;
  v_extra := case when p ? 'disclosureExtra' then left(nullif(btrim(p ->> 'disclosureExtra'), ''), 2000) else s.disclosure_extra end;
  -- Changing what employees are told asks every employee to read and accept it again.
  v_ver := s.disclosure_version + case when v_extra is distinct from s.disclosure_extra and s.id is not null then 1 else 0 end;
  if v_enable and v_ack is null then raise exception 'disclosure_required' using errcode = '22023'; end if;
  if v_enable and not exists (select 1 from public.pm_work_locations l where l.company_id is not distinct from v_c and l.owner_id is not distinct from v_o and public.pm_work_location_ready(l)) then
    raise exception 'location_required' using errcode = '22023';
  end if;
  if p ? 'workDays' then
    select coalesce(array_agg(distinct d::int order by d::int), '{}') into v_days from jsonb_array_elements_text(p -> 'workDays') d;
  else v_days := s.work_days; end if;
  if coalesce(nullif(p ->> 'timezone', ''), s.timezone) not in (select name from pg_timezone_names) then raise exception 'bad_timezone' using errcode = '22023'; end if;
  insert into public.pm_gps_settings as x (company_id, owner_id, enabled, disclosure_ack_at, disclosure_ack_by, disclosure_version, disclosure_extra, default_radius_m,
      entry_dwell_min, exit_grace_min, entry_action, exit_action, start_rule, work_days, work_start, work_end, early_min, travel_window_min, max_accuracy_m,
      overtime_rule, timezone, retention_days, updated_by, updated_at)
  values (v_c, v_o, v_enable, v_ack, case when v_ack is distinct from s.disclosure_ack_at and v_ack is not null then auth.uid() else s.disclosure_ack_by end, v_ver, v_extra,
      coalesce(nullif(p ->> 'defaultRadiusM', '')::int, s.default_radius_m), coalesce(nullif(p ->> 'entryDwellMin', '')::int, s.entry_dwell_min),
      coalesce(nullif(p ->> 'exitGraceMin', '')::int, s.exit_grace_min), coalesce(nullif(p ->> 'entryAction', ''), s.entry_action),
      coalesce(nullif(p ->> 'exitAction', ''), s.exit_action), coalesce(nullif(p ->> 'startRule', ''), s.start_rule), v_days,
      coalesce(nullif(p ->> 'workStart', '')::time, s.work_start), coalesce(nullif(p ->> 'workEnd', '')::time, s.work_end),
      coalesce(nullif(p ->> 'earlyMin', '')::int, s.early_min), coalesce(nullif(p ->> 'travelWindowMin', '')::int, s.travel_window_min),
      coalesce(nullif(p ->> 'maxAccuracyM', '')::int, s.max_accuracy_m), coalesce(nullif(p ->> 'overtimeRule', ''), s.overtime_rule),
      coalesce(nullif(p ->> 'timezone', ''), s.timezone), coalesce(nullif(p ->> 'retentionDays', '')::int, s.retention_days), auth.uid(), now())
  on conflict (coalesce(company_id, owner_id)) do update set enabled = excluded.enabled, disclosure_ack_at = excluded.disclosure_ack_at,
      disclosure_ack_by = excluded.disclosure_ack_by, disclosure_version = excluded.disclosure_version, disclosure_extra = excluded.disclosure_extra,
      default_radius_m = excluded.default_radius_m, entry_dwell_min = excluded.entry_dwell_min, exit_grace_min = excluded.exit_grace_min,
      entry_action = excluded.entry_action, exit_action = excluded.exit_action, start_rule = excluded.start_rule, work_days = excluded.work_days,
      work_start = excluded.work_start, work_end = excluded.work_end, early_min = excluded.early_min, travel_window_min = excluded.travel_window_min,
      max_accuracy_m = excluded.max_accuracy_m, overtime_rule = excluded.overtime_rule, timezone = excluded.timezone, retention_days = excluded.retention_days,
      updated_by = auth.uid(), updated_at = now()
  returning * into s;
  perform public.pm_gps_log(v_c, v_o, 'settings.save', s.id, (public.pm_gps_settings_json(s) - 'disclosureExtra' - 'updatedAt' - 'saved'));
  return public.pm_gps_settings_json(s);
end $$;
revoke execute on function public.pm_gps_settings_save(jsonb) from public, anon;
grant execute on function public.pm_gps_settings_save(jsonb) to authenticated;

-- Create or update a work location. p {id?, kind, name, address?, scheduleId?, lat?, lng?, radiusM?, pinSource?, pinAccuracyM?, everyone?, confirm?}
-- A new or moved pin, or a changed radius, is unconfirmed until p.confirm = true.
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

create or replace function public.pm_work_location_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.pm_work_locations;
begin
  if p_status not in ('active', 'archived') then raise exception 'bad_status' using errcode = '22023'; end if;
  select * into l from public.pm_work_locations where id = p_id for update;
  if not found or not public.pm_time_admin(l.company_id, l.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.pm_work_locations set status = p_status, updated_at = now() where id = p_id;
  perform public.pm_gps_log(l.company_id, l.owner_id, 'location.' || p_status, p_id, '{}'::jsonb);
end $$;
revoke execute on function public.pm_work_location_set_status(uuid, text) from public, anon;
grant execute on function public.pm_work_location_set_status(uuid, text) to authenticated;

-- Replace who is assigned to a location. Only active Staff in the same scope.
create or replace function public.pm_work_location_assign(p_id uuid, p_resource_ids uuid[], p_everyone boolean default null) returns integer
language plpgsql security definer set search_path = public as $$
declare l public.pm_work_locations; v_n integer;
begin
  select * into l from public.pm_work_locations where id = p_id for update;
  if not found or not public.pm_time_admin(l.company_id, l.owner_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if cardinality(coalesce(p_resource_ids, '{}')) > 500 then raise exception 'bad_items' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_resource_ids, '{}')) x where not exists (select 1 from public.pm_resources r where r.id = x and r.kind = 'staff'
               and r.company_id is not distinct from l.company_id and r.owner_id is not distinct from l.owner_id)) then
    raise exception 'staff_only' using errcode = '22023';
  end if;
  delete from public.pm_work_location_assignments a where a.location_id = p_id and a.resource_id <> all (coalesce(p_resource_ids, '{}'));
  insert into public.pm_work_location_assignments (location_id, resource_id, assigned_by)
  select p_id, x, auth.uid() from unnest(coalesce(p_resource_ids, '{}')) x on conflict do nothing;
  if p_everyone is not null then update public.pm_work_locations set everyone = p_everyone, updated_at = now() where id = p_id; end if;
  select count(*) into v_n from public.pm_work_location_assignments where location_id = p_id;
  perform public.pm_gps_log(l.company_id, l.owner_id, 'location.assign', p_id, jsonb_build_object('count', v_n, 'everyone', p_everyone));
  return v_n;
end $$;
revoke execute on function public.pm_work_location_assign(uuid, uuid[], boolean) from public, anon;
grant execute on function public.pm_work_location_assign(uuid, uuid[], boolean) to authenticated;

-- Enroll / un-enroll an employee. p {enrolled?, w2Confirmed?}. Subcontractors and crews are refused; enrolling
-- needs the admin to confirm the person is a W-2 employee whose hours are tracked.
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

-- 7. Employee side -----------------------------------------------------------------------------------------------
-- The caller's own staff entry in the current scope.
create or replace function public.pm_gps_my_resource(p_resource_id uuid) returns public.pm_resources
language plpgsql stable security definer set search_path = public as $$
declare r public.pm_resources;
begin
  select * into r from public.pm_resources x where x.id = p_resource_id and x.linked_user_id = auth.uid() and x.kind = 'staff'
    and public.team_in_my_scope(x.company_id, x.owner_id);
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  return r;
end $$;
revoke execute on function public.pm_gps_my_resource(uuid) from public, anon, authenticated;

-- Accept (or withdraw) the location disclosure. Only the employee themself.
create or replace function public.pm_gps_consent(p_resource_id uuid, p_agree boolean, p_version integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_gps_my_resource(p_resource_id); e public.pm_gps_enrollments; s public.pm_gps_settings;
begin
  s := public.pm_gps_settings_for(r.company_id, r.owner_id);
  select * into e from public.pm_gps_enrollments where resource_id = r.id for update;
  if not found or not e.enrolled then raise exception 'not_enrolled' using errcode = '22023'; end if;
  if p_agree then
    if p_version is distinct from s.disclosure_version then raise exception 'stale_disclosure' using errcode = '22023'; end if;
    update public.pm_gps_enrollments set consent_version = p_version, consent_at = now(), consent_withdrawn_at = null, updated_at = now() where resource_id = r.id;
  else
    update public.pm_gps_enrollments set consent_withdrawn_at = now(), updated_at = now() where resource_id = r.id;
  end if;
  perform public.pm_gps_log(r.company_id, r.owner_id, case when p_agree then 'consent.given' else 'consent.withdrawn' end, r.id, jsonb_build_object('version', p_version));
  return jsonb_build_object('active', public.pm_gps_active(r.id));
end $$;
revoke execute on function public.pm_gps_consent(uuid, boolean, integer) from public, anon;
grant execute on function public.pm_gps_consent(uuid, boolean, integer) to authenticated;

-- The device reports its location permission and app mode (no location).
create or replace function public.pm_gps_device_status(p_resource_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_gps_my_resource(p_resource_id); e public.pm_gps_enrollments; v_perm text := coalesce(nullif(p ->> 'permission', ''), 'unknown');
begin
  if v_perm not in ('unknown', 'granted', 'prompt', 'denied', 'unavailable') then raise exception 'bad_permission' using errcode = '22023'; end if;
  if nullif(p ->> 'appMode', '') is not null and p ->> 'appMode' not in ('browser', 'pwa', 'native_ios', 'native_android') then raise exception 'bad_mode' using errcode = '22023'; end if;
  select * into e from public.pm_gps_enrollments where resource_id = r.id for update;
  if not found then return; end if;
  update public.pm_gps_enrollments set permission = v_perm, permission_at = case when permission is distinct from v_perm then now() else permission_at end,
    app_mode = coalesce(nullif(p ->> 'appMode', ''), app_mode), device = left(nullif(btrim(p ->> 'device'), ''), 60), last_seen_at = now(), updated_at = now()
  where resource_id = r.id;
  if e.permission is distinct from v_perm then
    perform public.pm_gps_log(r.company_id, r.owner_id, 'permission.change', r.id, jsonb_build_object('from', e.permission, 'to', v_perm));
  end if;
end $$;
revoke execute on function public.pm_gps_device_status(uuid, jsonb) from public, anon;
grant execute on function public.pm_gps_device_status(uuid, jsonb) to authenticated;

-- Everything the employee's clock screen needs. Locations (with their pins) only when GPS is active for them,
-- and only the ones they're assigned to today.
create or replace function public.pm_gps_my_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end; s public.pm_gps_settings; v_today date;
begin
  s := public.pm_gps_settings_for(v_c, v_o);
  v_today := (now() at time zone s.timezone)::date;
  return jsonb_build_object(
    'companyName', coalesce((select c.name from public.companies c where c.id = v_c), (select nullif(bp.company_name, '') from public.business_profiles bp where bp.user_id = v_o)),
    'settings', jsonb_build_object('enabled', s.enabled, 'disclosureVersion', s.disclosure_version, 'disclosureExtra', s.disclosure_extra,
      'entryDwellMin', s.entry_dwell_min, 'exitGraceMin', s.exit_grace_min, 'entryAction', s.entry_action, 'exitAction', s.exit_action,
      'maxAccuracyM', s.max_accuracy_m, 'retentionDays', s.retention_days, 'timezone', s.timezone, 'overtimeRule', s.overtime_rule),
    'me', coalesce((select jsonb_agg(jsonb_build_object('resourceId', r.id, 'name', r.name,
        'enrolled', coalesce(e.enrolled, false), 'consentAt', case when e.consent_withdrawn_at is null then e.consent_at end, 'consentVersion', e.consent_version,
        'permission', coalesce(e.permission, 'unknown'), 'active', public.pm_gps_active(r.id),
        'open', (select public.pm_time_entry_json(x) from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open'),
        'pendingCorrections', (select count(*) from public.pm_time_corrections k where k.resource_id = r.id and k.status = 'pending'),
        'locations', case when public.pm_gps_active(r.id) then coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind,
              'lat', l.lat, 'lng', l.lng, 'radiusM', l.radius_m, 'scheduleId', l.schedule_id) order by lower(l.name))
            from public.pm_work_locations l where l.company_id is not distinct from v_c and l.owner_id is not distinct from v_o
              and public.pm_work_location_ready(l) and public.pm_gps_assigned(r.id, l.id, v_today)), '[]'::jsonb) else '[]'::jsonb end,
        'choices', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind, 'scheduleId', l.schedule_id) order by lower(l.name))
            from public.pm_work_locations l where l.company_id is not distinct from v_c and l.owner_id is not distinct from v_o and l.status = 'active'), '[]'::jsonb)
      ) order by lower(r.name))
      from public.pm_resources r left join public.pm_gps_enrollments e on e.resource_id = r.id
      where r.linked_user_id = auth.uid() and r.kind = 'staff' and r.status = 'active'
        and r.company_id is not distinct from v_c and r.owner_id is not distinct from v_o), '[]'::jsonb));
end $$;
revoke execute on function public.pm_gps_my_status() from public, anon;
grant execute on function public.pm_gps_my_status() to authenticated;

-- Is a moment inside the company's work window (or a day this person is scheduled on this project)?
create or replace function public.pm_gps_in_window(s public.pm_gps_settings, p_resource uuid, l public.pm_work_locations, p_at timestamptz) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := p_at at time zone s.timezone; v_min integer; v_start integer; v_end integer;
begin
  if s.start_rule = 'any_time' then return true; end if;
  if l.schedule_id is not null and exists (select 1 from public.schedule_tasks t where t.schedule_id = l.schedule_id and t.status <> 'complete'
        and v_local::date between t.planned_start and t.planned_end
        and (t.resource_id = p_resource or t.resource_id in (select c.crew_id from public.pm_crew_members c where c.member_id = p_resource)))
     and extract(hour from v_local) between 4 and 21 then
    return true;
  end if;
  if not (extract(isodow from v_local)::int = any (s.work_days)) then return false; end if;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_start := greatest(0, extract(hour from s.work_start)::int * 60 + extract(minute from s.work_start)::int - s.early_min);
  v_end := extract(hour from s.work_end)::int * 60 + extract(minute from s.work_end)::int;
  return v_min between v_start and v_end;
end $$;
revoke execute on function public.pm_gps_in_window(public.pm_gps_settings, uuid, public.pm_work_locations, timestamptz) from public, anon, authenticated;

-- Geofence event from the employee's own device (browser while open today; a native app later, same contract).
-- p {resourceId, locationId, kind: enter|dwell|exit|exit_confirmed, occurredAt?, accuracyM, distanceM, source, clientEventId?, confirmed?}
--   enter / exit           : first accurate reading inside / confidently outside the geofence (recorded only)
--   dwell                  : still inside after the company's dwell time -> clock in (or transfer), or ask
--   exit_confirmed         : still outside after the grace period -> ask, or clock out (company setting)
--   confirmed = true       : the employee tapped "Start my shift" on a prompt
-- Returns {outcome, message, prompt, entry}. Nothing is stored unless GPS time tracking is active for the person.
create or replace function public.pm_gps_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.pm_resources; s public.pm_gps_settings; l public.pm_work_locations; o public.pm_time_entries; e public.pm_time_entries; prev public.pm_time_entries;
  v_kind text := p ->> 'kind'; v_src text := coalesce(nullif(p ->> 'source', ''), 'browser');
  v_at timestamptz := coalesce(nullif(p ->> 'occurredAt', '')::timestamptz, now());
  v_acc integer := round(nullif(p ->> 'accuracyM', '')::numeric)::int; v_dist integer := round(nullif(p ->> 'distanceM', '')::numeric)::int;
  v_client text := left(nullif(btrim(p ->> 'clientEventId'), ''), 80); v_confirmed boolean := coalesce((p ->> 'confirmed')::boolean, false);
  v_outcome text := 'noted'; v_detail text; v_entry uuid; v_msg text; v_prompt text; v_arrival timestamptz; v_depart timestamptz; v_close timestamptz;
  v_shift uuid; v_prev_loc text; v_existing public.pm_geofence_events; v_day date;
begin
  r := public.pm_gps_my_resource(nullif(p ->> 'resourceId', '')::uuid);
  if v_kind not in ('enter', 'dwell', 'exit', 'exit_confirmed') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if v_src not in ('browser', 'pwa', 'native_ios', 'native_android') then raise exception 'bad_source' using errcode = '22023'; end if;
  if v_acc is null or v_dist is null or v_acc < 0 or v_dist < 0 then raise exception 'bad_reading' using errcode = '22023'; end if;
  if not public.pm_gps_active(r.id) then return jsonb_build_object('outcome', 'disabled'); end if;
  -- Native apps may deliver queued events late; anything older than a day or in the future is refused.
  if v_at > now() + interval '2 minutes' or v_at < now() - interval '24 hours' then raise exception 'bad_time' using errcode = '22023'; end if;
  v_at := least(v_at, now());
  if v_client is not null then
    select * into v_existing from public.pm_geofence_events where resource_id = r.id and client_event_id = v_client;
    if found then return jsonb_build_object('outcome', v_existing.outcome, 'duplicate', true, 'entry', (select public.pm_time_entry_json(x) from public.pm_time_entries x where x.id = v_existing.entry_id)); end if;
  end if;
  s := public.pm_gps_settings_for(r.company_id, r.owner_id);
  select * into l from public.pm_work_locations x where x.id = nullif(p ->> 'locationId', '')::uuid
    and x.company_id is not distinct from r.company_id and x.owner_id is not distinct from r.owner_id;
  if not found or not public.pm_work_location_ready(l) then raise exception 'bad_location' using errcode = '22023'; end if;
  v_day := (v_at at time zone s.timezone)::date;
  -- Retention: geofence events older than the company's retention period are removed.
  delete from public.pm_geofence_events g where g.company_id is not distinct from r.company_id and g.owner_id is not distinct from r.owner_id
    and g.recorded_at < now() - make_interval(days => s.retention_days);

  select * into o from public.pm_time_entries x where x.resource_id = r.id and x.status = 'open' for update;

  if v_kind in ('enter', 'dwell') and (v_acc > s.max_accuracy_m or v_dist > l.radius_m) then
    v_outcome := 'ignored_low_accuracy';
  elsif v_kind in ('exit', 'exit_confirmed') and (v_acc > s.max_accuracy_m * 2 or v_dist - v_acc <= l.radius_m) then
    -- Not confidently outside: never treat a weak signal as leaving.
    v_outcome := 'ignored_low_accuracy';
  elsif not public.pm_gps_assigned(r.id, l.id, v_day) then
    v_outcome := 'ignored_not_assigned';
  elsif v_kind = 'enter' then
    if o.id is not null and o.location_id = l.id and o.away_since is not null then
      update public.pm_time_entries set away_since = null, updated_at = now() where id = o.id returning * into o;
      v_outcome := 'returned'; v_entry := o.id; v_msg := 'Back at ' || l.name || '. Still clocked in.';
    end if;
  elsif v_kind = 'exit' then
    if o.id is not null and o.location_id = l.id then v_entry := o.id; end if;
  elsif v_kind = 'dwell' then
    -- The arrival this stay belongs to: the latest "enter" here with no "exit" after it.
    select g.occurred_at into v_arrival from public.pm_geofence_events g
     where g.resource_id = r.id and g.location_id = l.id and g.kind = 'enter' and g.outcome not in ('ignored_low_accuracy', 'ignored_not_assigned')
       and g.occurred_at <= v_at and g.occurred_at > v_at - interval '16 hours'
       and not exists (select 1 from public.pm_geofence_events x where x.resource_id = r.id and x.location_id = l.id and x.kind = 'exit'
                         and x.outcome <> 'ignored_low_accuracy' and x.occurred_at > g.occurred_at and x.occurred_at <= v_at)
     order by g.occurred_at desc limit 1;
    if v_arrival is null or (not v_confirmed and v_at - v_arrival < make_interval(mins => s.entry_dwell_min) - interval '15 seconds') then
      v_outcome := 'ignored_no_arrival';
    elsif o.id is not null and o.location_id = l.id then
      v_outcome := 'ignored_duplicate'; v_entry := o.id;
      if o.away_since is not null then update public.pm_time_entries set away_since = null, updated_at = now() where id = o.id; v_outcome := 'returned'; end if;
    elsif o.id is not null and o.location_id is null then
      -- Clocked in by hand without a work location: leave that shift alone.
      v_outcome := 'ignored_duplicate'; v_entry := o.id; v_detail := 'manual_open';
    elsif o.id is not null then
      -- Moving from one assigned site to another: close the first at the time they left, keep the drive as paid
      -- travel time (flagged for review), and start the new site at arrival. One shift reference throughout.
      select g.occurred_at into v_depart from public.pm_geofence_events g
       where g.resource_id = r.id and g.location_id = o.location_id and g.kind = 'exit' and g.outcome <> 'ignored_low_accuracy'
         and g.occurred_at >= o.clock_in and g.occurred_at <= v_arrival order by g.occurred_at limit 1;
      v_close := greatest(o.clock_in + interval '1 second', least(coalesce(o.away_since, v_depart, v_arrival), v_arrival));
      v_shift := coalesce(o.shift_id, o.id);
      select name into v_prev_loc from public.pm_work_locations where id = o.location_id;
      update public.pm_time_entries set clock_out = v_close, status = 'pending', away_since = null, shift_id = v_shift, updated_at = now() where id = o.id;
      if v_arrival - v_close >= interval '1 minute' then
        if v_arrival - v_close <= make_interval(mins => s.travel_window_min) then
          insert into public.pm_time_entries (company_id, owner_id, resource_id, clock_in, clock_out, status, source, work_type, shift_id, review_flag, note, created_by)
          values (r.company_id, r.owner_id, r.id, v_close, v_arrival, 'pending', 'travel', 'travel', v_shift, 'travel',
                  left('Travel ' || coalesce(v_prev_loc, 'site') || ' → ' || l.name, 500), auth.uid());
        else
          v_detail := 'travel_gap';
        end if;
      end if;
      insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, location_id, clock_in, status, source, work_type, shift_id, review_flag, created_by)
      values (r.company_id, r.owner_id, r.id, l.schedule_id, l.id, v_arrival, 'open', 'gps', 'regular', v_shift, case when v_detail = 'travel_gap' then 'travel_gap' end, auth.uid())
      returning * into e;
      v_outcome := 'transferred'; v_entry := e.id; v_msg := 'Clocked in — ' || l.name;
    else
      -- Not clocked in. Continue a shift that was clocked out automatically at another site a little earlier.
      select * into prev from public.pm_time_entries x where x.resource_id = r.id and x.status <> 'rejected' and x.clock_out is not null
       order by x.clock_out desc limit 1;
      if not v_confirmed and (s.entry_action = 'ask' or not public.pm_gps_in_window(s, r.id, l, v_arrival)) then
        v_outcome := 'asked';
        v_prompt := 'start_shift';
        v_msg := 'You''re at ' || l.name || '. Start your shift?';
      else
        v_arrival := greatest(case when v_confirmed then v_at else v_arrival end, coalesce(prev.clock_out, '-infinity'::timestamptz));
        if prev.id is not null and prev.review_flag = 'auto_clock_out' and prev.location_id is distinct from l.id
           and v_arrival - prev.clock_out <= make_interval(mins => s.travel_window_min) and not v_confirmed then
          v_shift := coalesce(prev.shift_id, prev.id);
          update public.pm_time_entries set shift_id = v_shift where id = prev.id and shift_id is null;
          if v_arrival - prev.clock_out >= interval '1 minute' then
            select name into v_prev_loc from public.pm_work_locations where id = prev.location_id;
            insert into public.pm_time_entries (company_id, owner_id, resource_id, clock_in, clock_out, status, source, work_type, shift_id, review_flag, note, created_by)
            values (r.company_id, r.owner_id, r.id, prev.clock_out, v_arrival, 'pending', 'travel', 'travel', v_shift, 'travel',
                    left('Travel ' || coalesce(v_prev_loc, 'site') || ' → ' || l.name, 500), auth.uid());
          end if;
        end if;
        insert into public.pm_time_entries (company_id, owner_id, resource_id, schedule_id, location_id, clock_in, status, source, work_type, shift_id, created_by)
        values (r.company_id, r.owner_id, r.id, l.schedule_id, l.id, v_arrival, 'open', case when v_confirmed then 'gps_confirmed' else 'gps' end, 'regular', v_shift, auth.uid())
        returning * into e;
        v_outcome := case when v_confirmed then 'confirmed' else 'clocked_in' end; v_entry := e.id; v_msg := 'Clocked in — ' || l.name;
      end if;
    end if;
  elsif v_kind = 'exit_confirmed' then
    select g.occurred_at into v_depart from public.pm_geofence_events g
     where g.resource_id = r.id and g.location_id = l.id and g.kind = 'exit' and g.outcome not in ('ignored_low_accuracy', 'ignored_not_assigned')
       and g.occurred_at <= v_at and g.occurred_at > v_at - interval '16 hours'
       and not exists (select 1 from public.pm_geofence_events x where x.resource_id = r.id and x.location_id = l.id and x.kind = 'enter'
                         and x.outcome not in ('ignored_low_accuracy') and x.occurred_at > g.occurred_at and x.occurred_at <= v_at)
     order by g.occurred_at desc limit 1;
    if o.id is null or o.location_id is distinct from l.id then
      v_outcome := 'noted';
    elsif v_depart is null or v_at - v_depart < make_interval(mins => s.exit_grace_min) - interval '15 seconds' then
      v_outcome := 'ignored_no_arrival'; v_entry := o.id;
    elsif s.exit_action = 'auto' then
      update public.pm_time_entries set clock_out = greatest(o.clock_in + interval '1 second', least(v_depart, o.clock_in + interval '24 hours')), status = 'pending',
        away_since = null, review_flag = 'auto_clock_out', updated_at = now()
      where id = o.id returning * into e;
      v_outcome := 'clocked_out'; v_entry := e.id; v_msg := 'Clocked out — ' || l.name;
    else
      update public.pm_time_entries set away_since = coalesce(away_since, v_depart), updated_at = now() where id = o.id returning * into e;
      v_outcome := 'asked'; v_entry := e.id; v_prompt := 'left_site';
      v_msg := 'You left ' || l.name || '. Still working?';
    end if;
  end if;

  insert into public.pm_geofence_events (company_id, owner_id, resource_id, location_id, kind, occurred_at, accuracy_m, distance_m, source, outcome, entry_id, client_event_id, detail)
  values (r.company_id, r.owner_id, r.id, l.id, v_kind, v_at, v_acc, v_dist, v_src, v_outcome, v_entry, v_client, v_detail);
  update public.pm_gps_enrollments set last_seen_at = now(), permission = 'granted',
    app_mode = case when v_src in ('native_ios', 'native_android', 'pwa', 'browser') then v_src else app_mode end where resource_id = r.id;
  return jsonb_build_object('outcome', v_outcome, 'message', v_msg, 'prompt', v_prompt, 'locationName', l.name,
    'entry', (select public.pm_time_entry_json(x) from public.pm_time_entries x where x.id = v_entry));
end $$;
revoke execute on function public.pm_gps_event(jsonb) from public, anon;
grant execute on function public.pm_gps_event(jsonb) to authenticated;

-- The employee answers "You left the site. Still working?": still working (paid offsite / supplier / travel), or
-- clock out at the time they left.
create or replace function public.pm_gps_away_resolve(p_entry_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_out timestamptz;
begin
  select * into e from public.pm_time_entries where id = p_entry_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  r := public.pm_gps_my_resource(e.resource_id);
  if p_action not in ('working', 'clock_out') then raise exception 'bad_action' using errcode = '22023'; end if;
  if e.status <> 'open' then raise exception 'not_open' using errcode = '22023'; end if;
  if p_action = 'working' then
    update public.pm_time_entries set away_since = null,
      note = left(concat_ws(' · ', note, 'Worked offsite from ' || to_char(coalesce(e.away_since, now()) at time zone (public.pm_gps_settings_for(r.company_id, r.owner_id)).timezone, 'HH12:MI AM')
                            || coalesce(': ' || nullif(btrim(p_note), ''), '')), 500),
      updated_at = now()
    where id = e.id returning * into e;
  else
    v_out := greatest(e.clock_in + interval '1 second', least(coalesce(e.away_since, now()), e.clock_in + interval '24 hours'));
    update public.pm_time_entries set clock_out = v_out, status = 'pending', away_since = null, updated_at = now() where id = e.id returning * into e;
  end if;
  insert into public.pm_geofence_events (company_id, owner_id, resource_id, location_id, kind, occurred_at, source, outcome, entry_id, detail)
  values (r.company_id, r.owner_id, r.id, e.location_id, 'resolve', now(), 'browser', case when p_action = 'working' then 'confirmed' else 'clocked_out' end, e.id, p_action);
  return public.pm_time_entry_json(e);
end $$;
revoke execute on function public.pm_gps_away_resolve(uuid, text, text) from public, anon;
grant execute on function public.pm_gps_away_resolve(uuid, text, text) to authenticated;

-- 8. Corrections + sign-off ---------------------------------------------------------------------------------------
create table if not exists public.pm_time_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  entry_id uuid references public.pm_time_entries (id) on delete set null,
  kind text not null check (kind in ('fix', 'missing')),
  clock_in timestamptz not null,
  clock_out timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 720),
  paid_break_minutes integer not null default 0 check (paid_break_minutes between 0 and 720),
  schedule_id uuid references public.project_schedules (id) on delete set null,
  location_id uuid references public.pm_work_locations (id) on delete set null,
  work_type text not null default 'regular' check (work_type in ('regular', 'travel', 'offsite')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  constraint pm_time_corrections_scope check ((company_id is null) <> (owner_id is null)),
  constraint pm_time_corrections_order check (clock_out > clock_in and clock_out - clock_in <= interval '24 hours'),
  constraint pm_time_corrections_fix check ((kind = 'fix') = (entry_id is not null) or status <> 'pending')
);
create index if not exists pm_time_corrections_scope_idx on public.pm_time_corrections (coalesce(company_id, owner_id), status, requested_at desc);
create index if not exists pm_time_corrections_resource_idx on public.pm_time_corrections (resource_id, requested_at desc);
alter table public.pm_time_corrections enable row level security;
revoke all on public.pm_time_corrections from anon, authenticated;
drop policy if exists pm_time_corrections_select on public.pm_time_corrections;
create policy pm_time_corrections_select on public.pm_time_corrections for select to authenticated
  using (public.pm_time_approver(company_id, owner_id) or exists (select 1 from public.pm_resources r where r.id = resource_id and r.linked_user_id = auth.uid()));
grant select on public.pm_time_corrections to authenticated;

create or replace function public.pm_time_correction_json(k public.pm_time_corrections) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', k.id, 'resourceId', k.resource_id, 'entryId', k.entry_id, 'kind', k.kind, 'clockIn', k.clock_in, 'clockOut', k.clock_out,
    'breakMinutes', k.break_minutes, 'paidBreakMinutes', k.paid_break_minutes, 'scheduleId', k.schedule_id, 'locationId', k.location_id, 'workType', k.work_type,
    'reason', k.reason, 'status', k.status, 'requestedAt', k.requested_at, 'decidedAt', k.decided_at, 'decisionNote', k.decision_note,
    'current', (select public.pm_time_entry_json(e) from public.pm_time_entries e where e.id = k.entry_id))
$$;
revoke execute on function public.pm_time_correction_json(public.pm_time_corrections) from public, anon;
grant execute on function public.pm_time_correction_json(public.pm_time_corrections) to authenticated;

-- The employee asks for a fix to one of their entries, or for time that's missing.
-- p {resourceId, entryId?, clockIn, clockOut, breakMinutes?, paidBreakMinutes?, scheduleId?, locationId?, workType?, reason}
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

create or replace function public.pm_time_correction_withdraw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.pm_time_corrections;
begin
  select * into k from public.pm_time_corrections where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.pm_gps_my_resource(k.resource_id);
  if k.status <> 'pending' then raise exception 'not_pending' using errcode = '22023'; end if;
  update public.pm_time_corrections set status = 'withdrawn', decided_at = now() where id = p_id;
end $$;
revoke execute on function public.pm_time_correction_withdraw(uuid) from public, anon;
grant execute on function public.pm_time_correction_withdraw(uuid) to authenticated;

-- Approve (applies the change through the change log and approves the resulting hours) or deny (needs a note).
-- People don't decide their own requests unless they own the company.
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

-- Approvers see every request in scope; employees see their own.
create or replace function public.pm_time_corrections_list(p_status text default 'pending') returns jsonb
language sql stable security definer set search_path = public as $$
  with scope as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o)
  select coalesce(jsonb_agg(public.pm_time_correction_json(k) order by k.requested_at desc), '[]'::jsonb)
  from (select k.* from public.pm_time_corrections k join public.pm_resources r on r.id = k.resource_id, scope
         where k.company_id is not distinct from scope.c and k.owner_id is not distinct from scope.o
           and (p_status is null or p_status = 'all' or k.status = p_status)
           and (public.pm_time_approver(scope.c, scope.o) or r.linked_user_id = auth.uid())
         order by k.requested_at desc limit 300) k
$$;
revoke execute on function public.pm_time_corrections_list(text) from public, anon;
grant execute on function public.pm_time_corrections_list(text) to authenticated;

create table if not exists public.pm_timesheet_signoffs (
  resource_id uuid not null references public.pm_resources (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  signed_at timestamptz not null default now(),
  hours numeric(8, 2),
  primary key (resource_id, week_start)
);
alter table public.pm_timesheet_signoffs enable row level security;
revoke all on public.pm_timesheet_signoffs from anon, authenticated;
drop policy if exists pm_timesheet_signoffs_select on public.pm_timesheet_signoffs;
create policy pm_timesheet_signoffs_select on public.pm_timesheet_signoffs for select to authenticated using (public.pm_time_readable(resource_id));
grant select on public.pm_timesheet_signoffs to authenticated;

-- The employee confirms their week (Monday start). Re-confirming updates the hours they confirmed.
create or replace function public.pm_timesheet_signoff(p_resource_id uuid, p_week date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pm_resources := public.pm_gps_my_resource(p_resource_id); v_hours numeric; s public.pm_gps_settings;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'bad_week' using errcode = '22023'; end if;
  s := public.pm_gps_settings_for(r.company_id, r.owner_id);
  if exists (select 1 from public.pm_time_entries e where e.resource_id = r.id and e.status = 'open'
               and (e.clock_in at time zone s.timezone)::date between p_week and p_week + 6) then raise exception 'still_open' using errcode = '22023'; end if;
  select round(coalesce(sum(greatest(extract(epoch from (e.clock_out - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)), 0)::numeric, 2) into v_hours
    from public.pm_time_entries e where e.resource_id = r.id and e.status <> 'rejected' and e.clock_out is not null
     and (e.clock_in at time zone s.timezone)::date between p_week and p_week + 6;
  insert into public.pm_timesheet_signoffs (resource_id, week_start, hours) values (r.id, p_week, v_hours)
  on conflict (resource_id, week_start) do update set signed_at = now(), hours = excluded.hours;
  return jsonb_build_object('week', p_week, 'hours', v_hours, 'signedAt', now());
end $$;
revoke execute on function public.pm_timesheet_signoff(uuid, date) from public, anon;
grant execute on function public.pm_timesheet_signoff(uuid, date) to authenticated;

-- Timesheet now also returns location names, sign-offs, FLSA status (approvers) and the overtime rule.
create or replace function public.pm_timesheet(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with scope as (select public.my_company_id() as c, case when public.my_company_id() is null then auth.uid() end as o),
  mgr as (select public.pm_time_approver(scope.c, scope.o) as m, public.pm_team_manageable(scope.c, scope.o) as rates_ok from scope),
  ents as (
    select e as ent, e.clock_in, e.schedule_id, e.resource_id, e.location_id from public.pm_time_entries e join public.pm_resources r on r.id = e.resource_id, scope
     where e.company_id is not distinct from scope.c and e.owner_id is not distinct from scope.o
       and e.clock_in < p_to and coalesce(e.clock_out, now()) >= p_from
       and ((select m from mgr) or r.linked_user_id = auth.uid())
     order by e.clock_in desc limit 5000)
  select jsonb_build_object(
    'canManage', (select m from mgr),
    'entries', coalesce((select jsonb_agg(public.pm_time_entry_json(ents.ent) order by ents.clock_in desc) from ents), '[]'::jsonb),
    'projects', coalesce((select jsonb_object_agg(s.id, s.name) from public.project_schedules s where s.id in (select schedule_id from ents)), '{}'::jsonb),
    'locations', coalesce((select jsonb_object_agg(l.id, l.name) from public.pm_work_locations l where l.id in (select location_id from ents)), '{}'::jsonb),
    'rates', case when (select rates_ok from mgr) then coalesce((select jsonb_object_agg(p.resource_id, p.hourly_cost) from public.pm_employee_profiles p
                 where p.hourly_cost is not null and p.resource_id in (select resource_id from ents)), '{}'::jsonb) else '{}'::jsonb end,
    'exempt', case when (select m from mgr) then coalesce((select jsonb_agg(h.resource_id) from public.pm_employee_hr h
                 where h.flsa_status = 'exempt' and h.resource_id in (select resource_id from ents)), '[]'::jsonb) else '[]'::jsonb end,
    'signoffs', coalesce((select jsonb_agg(jsonb_build_object('resourceId', so.resource_id, 'week', so.week_start, 'signedAt', so.signed_at, 'hours', so.hours))
                 from public.pm_timesheet_signoffs so where so.resource_id in (select resource_id from ents)
                   and so.week_start between (p_from - interval '7 days')::date and p_to::date), '[]'::jsonb),
    'overtimeRule', (public.pm_gps_settings_for((select c from scope), (select o from scope))).overtime_rule,
    'timezone', (public.pm_gps_settings_for((select c from scope), (select o from scope))).timezone)
$$;
revoke execute on function public.pm_timesheet(timestamptz, timestamptz) from public, anon;
grant execute on function public.pm_timesheet(timestamptz, timestamptz) to authenticated;

-- Approvers can now approve hours too (time supervisors as well as team managers).
create or replace function public.pm_time_entries_decide(p_ids uuid[], p_action text, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.pm_time_entries; r public.pm_resources; v_n integer := 0; v_before jsonb;
begin
  if p_action not in ('approve', 'reject', 'reopen') then raise exception 'bad_action' using errcode = '22023'; end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then raise exception 'bad_items' using errcode = '22023'; end if;
  if p_action = 'reject' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  for e in select * from public.pm_time_entries where id = any (p_ids) order by clock_in for update loop
    select * into r from public.pm_resources where id = e.resource_id;
    if not public.team_in_my_scope(r.company_id, r.owner_id) or not public.pm_time_approver(r.company_id, r.owner_id) then
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

-- 9. Exceptions + event log (supervisors) --------------------------------------------------------------------------
create or replace function public.pm_gps_exceptions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := public.my_company_id(); v_o uuid := case when public.my_company_id() is null then auth.uid() end;
begin
  if not public.pm_time_supervisor(v_c, v_o) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(public.pm_time_entry_json(e) order by e.clock_in desc) from (
        select * from public.pm_time_entries e
         where e.company_id is not distinct from v_c and e.owner_id is not distinct from v_o
           and ((e.status = 'open' and (e.away_since is not null or e.clock_in < now() - interval '12 hours'))
                or (e.status = 'pending' and e.review_flag is not null))
         order by e.clock_in desc limit 200) e), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('resourceId', r.id, 'name', r.name, 'permission', g.permission, 'permissionAt', g.permission_at,
        'lowAccuracy7d', (select count(*) from public.pm_geofence_events x where x.resource_id = r.id and x.outcome = 'ignored_low_accuracy' and x.recorded_at > now() - interval '7 days'),
        'consent', g.consent_at is not null and g.consent_withdrawn_at is null))
      from public.pm_gps_enrollments g join public.pm_resources r on r.id = g.resource_id
      where g.company_id is not distinct from v_c and g.owner_id is not distinct from v_o and g.enrolled
        and (g.permission in ('denied', 'unavailable') or g.consent_at is null or g.consent_withdrawn_at is not null
             or exists (select 1 from public.pm_geofence_events x where x.resource_id = r.id and x.outcome = 'ignored_low_accuracy' and x.recorded_at > now() - interval '7 days'))), '[]'::jsonb),
    'pendingCorrections', (select count(*) from public.pm_time_corrections k where k.company_id is not distinct from v_c and k.owner_id is not distinct from v_o and k.status = 'pending'));
end $$;
revoke execute on function public.pm_gps_exceptions() from public, anon;
grant execute on function public.pm_gps_exceptions() to authenticated;

-- One person's geofence events (supervisors, or the person themself). Distance and accuracy only: no coordinates.
create or replace function public.pm_gps_events_list(p_resource_id uuid, p_days integer default 14) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'occurredAt', g.occurred_at, 'accuracyM', g.accuracy_m, 'distanceM', g.distance_m,
           'source', g.source, 'outcome', g.outcome, 'entryId', g.entry_id, 'location', l.name, 'detail', g.detail) order by g.occurred_at desc), '[]'::jsonb)
  from (select * from public.pm_geofence_events g where g.resource_id = p_resource_id and g.occurred_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 365))
        order by g.occurred_at desc limit 500) g
  left join public.pm_work_locations l on l.id = g.location_id
  join public.pm_resources r on r.id = g.resource_id
  where public.team_in_my_scope(r.company_id, r.owner_id) and (public.pm_time_supervisor(r.company_id, r.owner_id) or r.linked_user_id = auth.uid())
$$;
revoke execute on function public.pm_gps_events_list(uuid, integer) from public, anon;
grant execute on function public.pm_gps_events_list(uuid, integer) to authenticated;

-- 10. Project labor: estimated vs actual ---------------------------------------------------------------------------
-- Estimated hours come from the estimate's labor lines measured in hours; estimated labor cost from all labor lines
-- (quantity x unit cost, before markup). Read-only: the estimating engine is untouched. Cost figures only for people
-- who may see pay rates (team managers, time approvers who manage the team, the owner).
create or replace function public.pm_project_labor(p_schedule_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.project_schedules; v_cost_ok boolean; v_est_hours numeric; v_est_cost numeric; v_unit_hours boolean;
begin
  select * into s from public.project_schedules where id = p_schedule_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not ((s.company_id is null and s.user_id = auth.uid()) or (s.company_id is not null and public.team_in_my_scope(s.company_id, null)
          and (public.has_company_permission(s.company_id, 'view_schedules') or s.project_manager_id = auth.uid()))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_cost_ok := case when s.company_id is null then true else public.pm_team_manageable(s.company_id, null) or public.team_is_company_owner(s.company_id) end;
  select sum(i.quantity) filter (where lower(btrim(i.unit)) in ('hr', 'hrs', 'hour', 'hours', 'h', 'man hour', 'man hours', 'man-hour', 'man-hours', 'labor hour', 'labor hours', 'manhour', 'manhours')),
         sum(i.quantity * i.unit_cost)
    into v_est_hours, v_est_cost
    from public.estimate_items i where i.estimate_id = s.estimate_id and i.cost_type = 'labor';
  return (
    with a as (
      select e.resource_id, e.status, e.work_type,
             greatest(extract(epoch from (coalesce(e.clock_out, now()) - e.clock_in)) / 3600.0 - e.break_minutes / 60.0, 0)::numeric as h
        from public.pm_time_entries e where e.schedule_id = p_schedule_id and e.status <> 'rejected'),
    c as (select a.*, p.hourly_cost from a left join public.pm_employee_profiles p on p.resource_id = a.resource_id)
    select jsonb_build_object(
      'scheduleId', p_schedule_id, 'canSeeCost', v_cost_ok,
      'estimatedHours', round(v_est_hours, 2), 'estimatedCost', case when v_cost_ok then round(v_est_cost, 2) end,
      'actualHours', round(coalesce((select sum(h) from c), 0), 2),
      'approvedHours', round(coalesce((select sum(h) from c where status = 'approved'), 0), 2),
      'openHours', round(coalesce((select sum(h) from c where status = 'open'), 0), 2),
      'actualCost', case when v_cost_ok then round(coalesce((select sum(h * hourly_cost) from c where status = 'approved'), 0), 2) end,
      'allocatedCost', case when v_cost_ok then round(coalesce((select sum(h * hourly_cost) from c), 0), 2) end,
      'uncostedHours', round(coalesce((select sum(h) from c where hourly_cost is null), 0), 2),
      'people', (select count(distinct resource_id) from c)));
end $$;
revoke execute on function public.pm_project_labor(uuid) from public, anon;
grant execute on function public.pm_project_labor(uuid) to authenticated;
