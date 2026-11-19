-- Sales Hub V8.4 P2: internal sales calendar, availability, time off and out-of-office, client
-- self-scheduling (Win the Job / Run the Job / Grow the Business), and the Google Calendar connection.
--
-- Architecture choice: built-in scheduling on our own database, with Google Calendar as an optional
-- free/busy source and invite sender. No Calendly or other paid provider: one system, no per-seat
-- cost, and out-of-office periods block slots in the same query that builds them.
--
-- Safeguards:
--   * Reps control their own availability. Private event descriptions and time-off notes never leave
--     the rep's own functions; the public booking page sees only open slots.
--   * Double booking is prevented inside the database: each booking takes a per-rep lock and re-checks
--     the slot against events, bookings, time off and (when connected) Google busy times.
--   * Time off never cancels existing meetings. It blocks new slots and lists the meetings and tasks
--     that may need attention; the rep reschedules, or an admin reassigns (attribution stays).
--   * Customer emails and Google invites are off until the owner turns them on in the environment.

-- ---------------------------------------------------------------------------------------------------
-- 1. Per-rep calendar settings and booking link
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_valid_tz(p text) returns boolean
language sql stable set search_path = public as $$ select exists (select 1 from pg_timezone_names where name = p) $$;

create table if not exists public.sales_rep_calendar (
  rep_id uuid primary key references public.sales_reps (id) on delete cascade,
  time_zone text not null default 'America/Chicago',
  booking_slug text unique check (booking_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  booking_enabled boolean not null default false,
  session_minutes integer not null default 30 check (session_minutes in (15, 30, 45, 60)),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 60),
  min_notice_hours integer not null default 12 check (min_notice_hours between 0 and 168),
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 90),
  -- Weekly hours in the rep's time zone: [{"d":1,"s":"09:00","e":"17:00"}], d = ISO weekday (1 = Monday).
  rules jsonb not null default '[{"d":1,"s":"09:00","e":"17:00"},{"d":2,"s":"09:00","e":"17:00"},{"d":3,"s":"09:00","e":"17:00"},{"d":4,"s":"09:00","e":"17:00"},{"d":5,"s":"09:00","e":"17:00"}]'::jsonb,
  meeting_link text check (meeting_link is null or (meeting_link ~ '^https://' and char_length(meeting_link) <= 300)),
  updated_at timestamptz not null default now()
);
alter table public.sales_rep_calendar enable row level security;
revoke all on public.sales_rep_calendar from public, anon, authenticated;
grant all on public.sales_rep_calendar to service_role;

create or replace function public.sales_rules_valid(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 21 and not exists (
    select 1 from jsonb_array_elements(p) r
    where jsonb_typeof(r) <> 'object' or (r ->> 'd') !~ '^[1-7]$'
       or (r ->> 's') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (r ->> 'e') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
       or (r ->> 's') >= (r ->> 'e'))
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Calendar events, time off, bookings
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.sales_calendar_events (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  kind text not null check (kind in ('call', 'follow_up', 'onboarding', 'meeting', 'personal', 'focus')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  lead_id uuid references public.sales_leads (id) on delete set null,
  google_event_id text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '14 days')
);
create index if not exists sales_calendar_events_rep on public.sales_calendar_events (rep_id, starts_at);
alter table public.sales_calendar_events enable row level security;
revoke all on public.sales_calendar_events from public, anon, authenticated;
grant all on public.sales_calendar_events to service_role;

create table if not exists public.sales_time_off (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default true,
  note text check (char_length(note) <= 500),
  customer_message text not null check (char_length(customer_message) between 1 and 2000),
  backup_contact text not null default 'support@built2bid.org' check (char_length(backup_contact) <= 200),
  status text not null default 'active' check (status in ('active', 'canceled')),
  google_event_id text,
  responder_status text not null default 'off' check (responder_status in ('off', 'set', 'failed', 'not_connected')),
  responder_error text check (char_length(responder_error) <= 300),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '120 days')
);
create index if not exists sales_time_off_rep on public.sales_time_off (rep_id, starts_at) where status = 'active';
alter table public.sales_time_off enable row level security;
revoke all on public.sales_time_off from public, anon, authenticated;
grant all on public.sales_time_off to service_role;

create table if not exists public.sales_bookings (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.sales_reps (id),
  -- The rep whose link was used. Reassignment changes rep_id only, never this or commission attribution.
  original_rep_id uuid not null references public.sales_reps (id),
  session text not null check (session in ('win', 'run', 'grow')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 120),
  customer_email text not null check (customer_email = lower(btrim(customer_email)) and char_length(customer_email) between 3 and 320 and position('@' in customer_email) > 1),
  customer_company text check (char_length(customer_company) <= 200),
  customer_plan text,
  notes text check (char_length(notes) <= 1000),
  status text not null default 'booked' check (status in ('booked', 'canceled')),
  manage_token_hash text unique,
  canceled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  rescheduled_from uuid references public.sales_bookings (id),
  reassigned_by uuid references auth.users (id) on delete set null,
  reassigned_at timestamptz,
  google_event_id text,
  confirmation_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists sales_bookings_rep on public.sales_bookings (rep_id, starts_at) where status = 'booked';
alter table public.sales_bookings enable row level security;
revoke all on public.sales_bookings from public, anon, authenticated;
grant all on public.sales_bookings to service_role;

create table if not exists public.sales_google_connections (
  rep_id uuid primary key references public.sales_reps (id) on delete cascade,
  google_email text,
  refresh_token_sealed text not null,
  scopes text[] not null default '{}',
  calendar_id text not null default 'primary',
  status text not null default 'connected' check (status in ('connected', 'revoked', 'error')),
  last_error text check (char_length(last_error) <= 300),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);
alter table public.sales_google_connections enable row level security;
revoke all on public.sales_google_connections from public, anon, authenticated;
grant all on public.sales_google_connections to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 3. Open slots: weekly hours in the rep's zone, minus notice, events, bookings, time off and any extra
--    busy intervals the caller passes (Google free/busy). Times are timestamptz; DST is handled by
--    converting each local day + time with AT TIME ZONE.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_rep_busy(p_rep uuid, p_start timestamptz, p_end timestamptz, p_buffer integer, p_extra jsonb, p_ignore_booking uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sales_calendar_events e where e.rep_id = p_rep
                   and tstzrange(e.starts_at, e.ends_at) && tstzrange(p_start - make_interval(mins => p_buffer), p_end + make_interval(mins => p_buffer)))
      or exists (select 1 from public.sales_bookings b where b.rep_id = p_rep and b.status = 'booked' and b.id is distinct from p_ignore_booking
                   and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_start - make_interval(mins => p_buffer), p_end + make_interval(mins => p_buffer)))
      or exists (select 1 from public.sales_time_off t where t.rep_id = p_rep and t.status = 'active'
                   and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start, p_end))
      or exists (select 1 from jsonb_array_elements(coalesce(p_extra, '[]'::jsonb)) x
                   where tstzrange((x ->> 'start')::timestamptz, (x ->> 'end')::timestamptz) && tstzrange(p_start, p_end))
$$;

create or replace function public.sales_booking_slots(p_slug text, p_now timestamptz default now(), p_extra_busy jsonb default '[]'::jsonb)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  with s as (
    select c.* from public.sales_rep_calendar c join public.sales_reps r on r.id = c.rep_id and r.status = 'active'
    where c.booking_slug = lower(p_slug) and c.booking_enabled
  ), days as (
    select s.*, d::date as day from s,
      generate_series((p_now at time zone s.time_zone)::date, (p_now at time zone s.time_zone)::date + s.max_days_ahead, interval '1 day') d
  ), win as (
    select days.rep_id, days.session_minutes, days.buffer_minutes, days.min_notice_hours,
      (days.day + (r ->> 's')::time) at time zone days.time_zone as ws,
      case when r ->> 'e' = '24:00' then (days.day + 1)::timestamp at time zone days.time_zone else (days.day + (r ->> 'e')::time) at time zone days.time_zone end as we
    from days, jsonb_array_elements(days.rules) r where (r ->> 'd')::int = extract(isodow from days.day)
  ), slots as (
    select w.rep_id, w.buffer_minutes, w.min_notice_hours, g as st, g + make_interval(mins => w.session_minutes) as en
    from win w, generate_series(w.ws, w.we - make_interval(mins => w.session_minutes), make_interval(mins => w.session_minutes)) g
  )
  select st, en from slots
  where st >= p_now + make_interval(hours => min_notice_hours)
    and not public.sales_rep_busy(rep_id, st, en, buffer_minutes, p_extra_busy)
  order by st
$$;

-- What the public booking page may know: first name, session length, zone, whether it's open.
create or replace function public.sales_booking_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rep_id', c.rep_id, 'first_name', split_part(btrim(r.full_name), ' ', 1), 'time_zone', c.time_zone,
    'session_minutes', c.session_minutes, 'enabled', c.booking_enabled)
  from public.sales_rep_calendar c join public.sales_reps r on r.id = c.rep_id and r.status = 'active'
  where c.booking_slug = lower(p_slug)
$$;

create or replace function public.sales_booking_create(
  p_slug text, p_session text, p_start timestamptz, p_name text, p_email text, p_company text, p_notes text,
  p_token_hash text, p_extra_busy jsonb default '[]'::jsonb, p_now timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.sales_rep_calendar; r public.sales_reps; v_end timestamptz; v_email text := lower(btrim(coalesce(p_email, ''))); b public.sales_bookings; v_plan text;
begin
  select * into c from public.sales_rep_calendar where booking_slug = lower(p_slug) and booking_enabled;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.sales_reps where id = c.rep_id and status = 'active';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_session not in ('win', 'run', 'grow') then raise exception 'invalid_session' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or coalesce(btrim(p_name), '') = '' then raise exception 'invalid_contact' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_booking:' || c.rep_id::text));
  if (select count(*) from public.sales_bookings where customer_email = v_email and status = 'booked' and starts_at > p_now) >= 3 then
    raise exception 'too_many_bookings' using errcode = '22023';
  end if;
  if not exists (select 1 from public.sales_booking_slots(p_slug, p_now, p_extra_busy) s where s.starts_at = p_start) then
    raise exception 'slot_taken' using errcode = '22023';
  end if;
  v_end := p_start + make_interval(mins => c.session_minutes);
  select a.plan into v_plan from auth.users u join public.sales_attributions a on a.user_id = u.id where lower(u.email) = v_email limit 1;
  insert into public.sales_bookings (rep_id, original_rep_id, session, starts_at, ends_at, customer_name, customer_email, customer_company, customer_plan, notes, manage_token_hash)
  values (c.rep_id, c.rep_id, p_session, p_start, v_end, left(btrim(p_name), 120), v_email, nullif(left(btrim(coalesce(p_company, '')), 200), ''),
          v_plan, nullif(left(btrim(coalesce(p_notes, '')), 1000), ''), p_token_hash)
  returning * into b;
  return jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'session', b.session, 'plan', b.customer_plan,
    'rep_id', r.id, 'rep_name', r.full_name, 'rep_email', r.email, 'time_zone', c.time_zone, 'meeting_link', c.meeting_link);
end $$;

-- The customer's own booking, found by the secret link in their confirmation.
create or replace function public.sales_booking_by_token(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'session', b.session, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'customer_name', b.customer_name, 'customer_email', b.customer_email, 'plan', b.customer_plan, 'rep_first_name', split_part(btrim(r.full_name), ' ', 1),
    'slug', c.booking_slug, 'time_zone', c.time_zone, 'meeting_link', c.meeting_link, 'google_event_id', b.google_event_id, 'rep_id', b.rep_id)
  from public.sales_bookings b join public.sales_reps r on r.id = b.rep_id left join public.sales_rep_calendar c on c.rep_id = b.rep_id
  where b.manage_token_hash = p_token_hash
$$;

create or replace function public.sales_booking_cancel(p_token_hash text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.sales_bookings;
begin
  update public.sales_bookings set status = 'canceled', canceled_at = now(), cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  where manage_token_hash = p_token_hash and status = 'booked' and starts_at > now() returning * into b;
  if not found then raise exception 'not_cancelable' using errcode = '22023'; end if;
  return jsonb_build_object('id', b.id, 'rep_id', b.rep_id, 'google_event_id', b.google_event_id);
end $$;

-- Move a booking to another open slot. The old one is canceled and the link moves to the new one, in one
-- transaction: if the new slot is taken, nothing changes.
create or replace function public.sales_booking_reschedule(p_token_hash text, p_start timestamptz, p_extra_busy jsonb default '[]'::jsonb, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.sales_bookings; c public.sales_rep_calendar; n public.sales_bookings;
begin
  select * into b from public.sales_bookings where manage_token_hash = p_token_hash and status = 'booked' and starts_at > p_now for update;
  if not found then raise exception 'not_cancelable' using errcode = '22023'; end if;
  select * into c from public.sales_rep_calendar where rep_id = b.rep_id;
  if not found or not c.booking_enabled then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_booking:' || b.rep_id::text));
  update public.sales_bookings set status = 'canceled', canceled_at = now(), cancel_reason = 'rescheduled', manage_token_hash = null where id = b.id;
  if not exists (select 1 from public.sales_booking_slots(c.booking_slug, p_now, p_extra_busy) s where s.starts_at = p_start) then
    raise exception 'slot_taken' using errcode = '22023';
  end if;
  insert into public.sales_bookings (rep_id, original_rep_id, session, starts_at, ends_at, customer_name, customer_email, customer_company, customer_plan, notes, manage_token_hash, rescheduled_from)
  values (b.rep_id, b.original_rep_id, b.session, p_start, p_start + make_interval(mins => c.session_minutes), b.customer_name, b.customer_email, b.customer_company,
          b.customer_plan, b.notes, p_token_hash, b.id)
  returning * into n;
  return jsonb_build_object('id', n.id, 'old_id', b.id, 'old_google_event_id', b.google_event_id, 'starts_at', n.starts_at, 'ends_at', n.ends_at, 'rep_id', n.rep_id);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. The rep's own calendar
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sales_me_rep() returns public.sales_reps
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps;
begin
  select * into rep from public.sales_reps where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_sales_staff' using errcode = '42501'; end if;
  return rep;
end $$;

create or replace function public.sales_my_calendar(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep(); c public.sales_rep_calendar;
begin
  if p_to <= p_from or p_to > p_from + interval '62 days' then raise exception 'invalid_range' using errcode = '22023'; end if;
  select * into c from public.sales_rep_calendar where rep_id = rep.id;
  return jsonb_build_object(
    'settings', jsonb_build_object('time_zone', coalesce(c.time_zone, 'America/Chicago'), 'booking_slug', c.booking_slug, 'booking_enabled', coalesce(c.booking_enabled, false),
      'session_minutes', coalesce(c.session_minutes, 30), 'buffer_minutes', coalesce(c.buffer_minutes, 0), 'min_notice_hours', coalesce(c.min_notice_hours, 12),
      'max_days_ahead', coalesce(c.max_days_ahead, 30), 'meeting_link', c.meeting_link,
      'rules', coalesce(c.rules, '[{"d":1,"s":"09:00","e":"17:00"},{"d":2,"s":"09:00","e":"17:00"},{"d":3,"s":"09:00","e":"17:00"},{"d":4,"s":"09:00","e":"17:00"},{"d":5,"s":"09:00","e":"17:00"}]'::jsonb)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
        'ends_at', e.ends_at, 'all_day', e.all_day, 'lead_id', e.lead_id, 'lead', l.company_name) order by e.starts_at)
      from public.sales_calendar_events e left join public.sales_leads l on l.id = e.lead_id
      where e.rep_id = rep.id and e.starts_at < p_to and e.ends_at > p_from), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'session', b.session, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
        'customer_name', b.customer_name, 'customer_email', b.customer_email, 'customer_company', b.customer_company, 'plan', b.customer_plan, 'notes', b.notes,
        'reassigned', b.original_rep_id <> b.rep_id) order by b.starts_at)
      from public.sales_bookings b where b.rep_id = rep.id and b.status = 'booked' and b.starts_at < p_to and b.ends_at > p_from), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'lead_id', t.lead_id, 'lead', l.company_name) order by t.due_at)
      from public.sales_tasks t join public.sales_leads l on l.id = t.lead_id
      where t.rep_id = rep.id and t.done_at is null and t.due_at >= p_from and t.due_at < p_to), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'starts_at', t.starts_at, 'ends_at', t.ends_at, 'all_day', t.all_day, 'note', t.note,
        'customer_message', t.customer_message, 'backup_contact', t.backup_contact, 'responder_status', t.responder_status) order by t.starts_at)
      from public.sales_time_off t where t.rep_id = rep.id and t.status = 'active' and t.ends_at > least(p_from, now())), '[]'::jsonb),
    'google', (select jsonb_build_object('connected', g.status = 'connected', 'status', g.status, 'email', g.google_email, 'scopes', g.scopes, 'last_error', g.last_error)
      from public.sales_google_connections g where g.rep_id = rep.id));
end $$;

create or replace function public.sales_my_calendar_settings_save(
  p_time_zone text, p_booking_slug text, p_booking_enabled boolean, p_session_minutes integer, p_buffer_minutes integer,
  p_min_notice_hours integer, p_max_days_ahead integer, p_rules jsonb, p_meeting_link text
) returns void
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep();
begin
  if not public.sales_valid_tz(p_time_zone) then raise exception 'invalid_time_zone' using errcode = '22023'; end if;
  if not public.sales_rules_valid(coalesce(p_rules, '[]'::jsonb)) then raise exception 'invalid_hours' using errcode = '22023'; end if;
  if p_booking_enabled and coalesce(p_booking_slug, '') = '' then raise exception 'slug_required' using errcode = '22023'; end if;
  begin
    insert into public.sales_rep_calendar as t (rep_id, time_zone, booking_slug, booking_enabled, session_minutes, buffer_minutes, min_notice_hours, max_days_ahead, rules, meeting_link, updated_at)
    values (rep.id, p_time_zone, nullif(lower(btrim(p_booking_slug)), ''), coalesce(p_booking_enabled, false), p_session_minutes, p_buffer_minutes, p_min_notice_hours,
            p_max_days_ahead, p_rules, nullif(btrim(p_meeting_link), ''), now())
    on conflict (rep_id) do update set time_zone = excluded.time_zone, booking_slug = excluded.booking_slug, booking_enabled = excluded.booking_enabled,
      session_minutes = excluded.session_minutes, buffer_minutes = excluded.buffer_minutes, min_notice_hours = excluded.min_notice_hours,
      max_days_ahead = excluded.max_days_ahead, rules = excluded.rules, meeting_link = excluded.meeting_link, updated_at = now();
  exception when unique_violation then raise exception 'slug_taken' using errcode = '23505';
  end;
end $$;

create or replace function public.sales_my_event_save(
  p_id uuid, p_kind text, p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean, p_lead_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep(); v uuid;
begin
  if p_lead_id is not null and not exists (select 1 from public.sales_leads where id = p_lead_id and assigned_rep = rep.id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_id is null then
    insert into public.sales_calendar_events (rep_id, kind, title, description, starts_at, ends_at, all_day, lead_id)
    values (rep.id, p_kind, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_starts_at, p_ends_at, coalesce(p_all_day, false), p_lead_id)
    returning id into v;
  else
    update public.sales_calendar_events set kind = p_kind, title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''),
      starts_at = p_starts_at, ends_at = p_ends_at, all_day = coalesce(p_all_day, false), lead_id = p_lead_id
    where id = p_id and rep_id = rep.id returning id into v;
    if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return v;
end $$;

create or replace function public.sales_my_event_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep();
begin
  delete from public.sales_calendar_events where id = p_id and rep_id = rep.id;
end $$;

-- Saving time off returns what may need attention: meetings and open tasks inside the absence.
-- Existing meetings are never canceled here.
create or replace function public.sales_my_time_off_save(
  p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean, p_note text, p_customer_message text, p_backup_contact text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep(); v public.sales_time_off;
begin
  if p_id is null then
    insert into public.sales_time_off (rep_id, starts_at, ends_at, all_day, note, customer_message, backup_contact)
    values (rep.id, p_starts_at, p_ends_at, coalesce(p_all_day, true), nullif(btrim(coalesce(p_note, '')), ''), btrim(p_customer_message),
            coalesce(nullif(btrim(coalesce(p_backup_contact, '')), ''), 'support@built2bid.org'))
    returning * into v;
  else
    update public.sales_time_off set starts_at = p_starts_at, ends_at = p_ends_at, all_day = coalesce(p_all_day, true), note = nullif(btrim(coalesce(p_note, '')), ''),
      customer_message = btrim(p_customer_message), backup_contact = coalesce(nullif(btrim(coalesce(p_backup_contact, '')), ''), 'support@built2bid.org')
    where id = p_id and rep_id = rep.id and status = 'active' returning * into v;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', v.id, 'google_event_id', v.google_event_id,
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'customer_name', b.customer_name, 'session', b.session) order by b.starts_at)
      from public.sales_bookings b where b.rep_id = rep.id and b.status = 'booked' and tstzrange(b.starts_at, b.ends_at) && tstzrange(v.starts_at, v.ends_at)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'starts_at', e.starts_at, 'title', e.title) order by e.starts_at)
      from public.sales_calendar_events e where e.rep_id = rep.id and e.kind <> 'personal' and tstzrange(e.starts_at, e.ends_at) && tstzrange(v.starts_at, v.ends_at)), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at) order by t.due_at)
      from public.sales_tasks t where t.rep_id = rep.id and t.done_at is null and t.due_at >= v.starts_at and t.due_at < v.ends_at), '[]'::jsonb));
end $$;

create or replace function public.sales_my_time_off_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep(); v public.sales_time_off;
begin
  update public.sales_time_off set status = 'canceled' where id = p_id and rep_id = rep.id and status = 'active' returning * into v;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v.id, 'google_event_id', v.google_event_id, 'responder_status', v.responder_status);
end $$;

create or replace function public.sales_my_booking_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rep public.sales_reps := public.sales_me_rep(); b public.sales_bookings;
begin
  update public.sales_bookings set status = 'canceled', canceled_at = now(), cancel_reason = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 300), ''), 'canceled by rep')
  where id = p_id and rep_id = rep.id and status = 'booked' returning * into b;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', b.id, 'customer_email', b.customer_email, 'customer_name', b.customer_name, 'starts_at', b.starts_at, 'google_event_id', b.google_event_id);
end $$;

-- Marks set by the server after Google calls (service role only).
create or replace function public.sales_calendar_mark(p_kind text, p_id uuid, p_google_event_id text, p_responder_status text default null, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'booking' then update public.sales_bookings set google_event_id = p_google_event_id where id = p_id;
  elsif p_kind = 'time_off' then update public.sales_time_off set google_event_id = coalesce(p_google_event_id, google_event_id),
      responder_status = coalesce(p_responder_status, responder_status), responder_error = left(p_error, 300) where id = p_id;
  elsif p_kind = 'event' then update public.sales_calendar_events set google_event_id = p_google_event_id where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Admin: upcoming bookings (no private calendar details) and approved reassignment
-- ---------------------------------------------------------------------------------------------------
create or replace function public.admin_sales_bookings(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'rep_id', b.rep_id, 'rep', r.full_name, 'original_rep', o.full_name, 'session', b.session,
      'starts_at', b.starts_at, 'customer_name', b.customer_name, 'customer_company', b.customer_company, 'reassigned_at', b.reassigned_at,
      'rep_away', exists (select 1 from public.sales_time_off t where t.rep_id = b.rep_id and t.status = 'active' and tstzrange(t.starts_at, t.ends_at) && tstzrange(b.starts_at, b.ends_at)))
      order by b.starts_at)
    from public.sales_bookings b join public.sales_reps r on r.id = b.rep_id join public.sales_reps o on o.id = b.original_rep_id
    where b.status = 'booked' and b.starts_at > now() - interval '1 day' and b.starts_at < now() + interval '60 days'), '[]'::jsonb);
end $$;

create or replace function public.admin_sales_booking_reassign(p_caller uuid, p_booking uuid, p_rep uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.sales_bookings; c public.sales_rep_calendar;
begin
  perform public.sales_require_cap(p_caller, 'reassign_leads');
  select * into b from public.sales_bookings where id = p_booking and status = 'booked' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.sales_reps where id = p_rep and status = 'active' and (role <> 'admin' or sells)) then raise exception 'rep_not_found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_booking:' || p_rep::text));
  select * into c from public.sales_rep_calendar where rep_id = p_rep;
  if public.sales_rep_busy(p_rep, b.starts_at, b.ends_at, coalesce(c.buffer_minutes, 0), '[]'::jsonb, b.id) then raise exception 'rep_busy' using errcode = '22023'; end if;
  update public.sales_bookings set rep_id = p_rep, reassigned_by = p_caller, reassigned_at = now() where id = b.id;
  perform public.sales_audit(p_caller, 'sales.booking_reassigned', 'sales_bookings', b.id::text,
    jsonb_build_object('from_rep', b.rep_id, 'to_rep', p_rep, 'original_rep', b.original_rep_id));
  return jsonb_build_object('id', b.id, 'from_rep', b.rep_id, 'to_rep', p_rep, 'google_event_id', b.google_event_id);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_rep_busy(uuid, timestamptz, timestamptz, integer, jsonb, uuid)', 'public.sales_booking_slots(text, timestamptz, jsonb)',
    'public.sales_booking_page(text)', 'public.sales_booking_create(text, text, timestamptz, text, text, text, text, text, jsonb, timestamptz)',
    'public.sales_booking_by_token(text)', 'public.sales_booking_cancel(text, text)', 'public.sales_booking_reschedule(text, timestamptz, jsonb, timestamptz)',
    'public.sales_calendar_mark(text, uuid, text, text, text)', 'public.admin_sales_bookings(uuid)', 'public.admin_sales_booking_reassign(uuid, uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.sales_me_rep()', 'public.sales_my_calendar(timestamptz, timestamptz)',
    'public.sales_my_calendar_settings_save(text, text, boolean, integer, integer, integer, integer, jsonb, text)',
    'public.sales_my_event_save(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid)', 'public.sales_my_event_delete(uuid)',
    'public.sales_my_time_off_save(uuid, timestamptz, timestamptz, boolean, text, text, text)', 'public.sales_my_time_off_cancel(uuid)',
    'public.sales_my_booking_cancel(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
