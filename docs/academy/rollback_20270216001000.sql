-- Rollback for 20270216001000_academy_release_schedule.sql (Academy weekly release schedule).
-- Lessons the job already wrote stay; delete them from Manage Academy if you don't want them.
drop function if exists public.academy_schedule_releases(date);
drop index if exists public.academy_courses_release;
alter table public.academy_courses drop column if exists release_on;
alter table public.academy_settings drop constraint if exists academy_settings_release_per_week_check;
alter table public.academy_settings drop constraint if exists academy_settings_release_weekday_check;
alter table public.academy_settings drop column if exists auto_release;
alter table public.academy_settings drop column if exists release_per_week;
alter table public.academy_settings drop column if exists release_weekday;
