-- Contractor Academy: weekly release schedule.
--   * academy_courses.release_on: the day an "upcoming" course goes live (shown publicly as "Coming <date>").
--   * academy_settings.auto_release / release_per_week / release_weekday: the drip (default 2 courses every Monday).
--   * academy_schedule_releases(p_start): (re)packs every upcoming course into consecutive release days from
--     p_start, keeping the current order, so deleting a course closes its gap. Service role only.
-- The hourly job (netlify/functions/academy-cron.mts -> /api/cron/academy) writes each course's lessons with Haiku
-- up to 14 days ahead (lessons stay hidden until the course is published) and publishes courses on their date.
-- Rollback: docs/academy/rollback_20270216001000.sql

alter table public.academy_courses add column if not exists release_on date;
create index if not exists academy_courses_release on public.academy_courses (release_on) where status = 'upcoming';

alter table public.academy_settings add column if not exists auto_release boolean not null default true;
alter table public.academy_settings add column if not exists release_per_week integer not null default 2;
alter table public.academy_settings add column if not exists release_weekday integer not null default 1;
do $$ begin
  alter table public.academy_settings add constraint academy_settings_release_per_week_check check (release_per_week between 1 and 14);
exception when duplicate_object then null; end $$;
do $$ begin
  -- ISO day of week: 1 = Monday ... 7 = Sunday.
  alter table public.academy_settings add constraint academy_settings_release_weekday_check check (release_weekday between 1 and 7);
exception when duplicate_object then null; end $$;

create or replace function public.academy_schedule_releases(p_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  per_week integer;
  weekday integer;
  first_day date;
  n integer;
begin
  select coalesce(s.release_per_week, 2), coalesce(s.release_weekday, 1) into per_week, weekday from public.academy_settings s where s.id;
  per_week := coalesce(per_week, 2);
  weekday := coalesce(weekday, 1);
  -- First release weekday on or after p_start.
  first_day := p_start + ((weekday - extract(isodow from p_start)::integer + 7) % 7);
  with ordered as (
    select c.id, row_number() over (
      order by c.release_on nulls last, c.sort_order, coalesce(t.sort_order, 0), c.trade_slug nulls first, c.slug
    ) as rn
    from public.academy_courses c
    left join public.academy_trades t on t.slug = c.trade_slug
    where c.status = 'upcoming'
  )
  update public.academy_courses c
     set release_on = first_day + (((o.rn - 1) / per_week) * 7)::integer
    from ordered o
   where o.id = c.id and c.release_on is distinct from first_day + (((o.rn - 1) / per_week) * 7)::integer;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.academy_schedule_releases(date) from public, anon, authenticated;
grant execute on function public.academy_schedule_releases(date) to service_role;

-- First schedule: two courses every Monday starting Monday 2026-11-30, in catalog order (all "Start" courses first,
-- then Sales, Estimating, and so on, trade by trade). Only fills courses that don't have a date yet.
do $$
begin
  if exists (select 1 from public.academy_courses where status = 'upcoming' and release_on is null)
     and not exists (select 1 from public.academy_courses where status = 'upcoming' and release_on is not null) then
    perform public.academy_schedule_releases(date '2026-11-30');
  end if;
end $$;
