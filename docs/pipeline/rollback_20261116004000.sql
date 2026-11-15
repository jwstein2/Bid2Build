-- Rollback for 20261116004000_project_schedules.sql (V4 Phases 6-7).
-- WARNING: deletes every project schedule, task, dependency and revision. Export first if any exist:
--   select * from public.project_schedules; select * from public.schedule_tasks;
-- Run in the Supabase SQL Editor only after turning NEXT_PUBLIC_PROJECT_SCHEDULING off.
begin;
drop function if exists public.schedule_list();
drop function if exists public.schedule_get(uuid);
drop function if exists public.schedule_save(uuid, integer, jsonb);
drop function if exists public.schedule_create(uuid, boolean, jsonb);
drop function if exists public.schedule_source_ok(jsonb, uuid, uuid);
drop function if exists public.schedule_estimate_snapshot(uuid);
drop function if exists public.estimate_is_accepted(uuid);
drop function if exists public.schedule_can_edit(uuid);
drop function if exists public.can_schedule_estimate(uuid);
drop table if exists public.schedule_revisions;
drop table if exists public.schedule_dependencies;
drop table if exists public.schedule_tasks;
drop table if exists public.project_schedules;
commit;
