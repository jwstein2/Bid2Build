-- Rollback for 20261118002000_team_assignments.sql (Team & Subcontractors V4.2).
-- Deploy the previous app version first. Drops the directory and assignment fields (their data is lost).
-- Task "Assigned to" text stays, so schedules still show who was assigned.

begin;
drop function if exists public.pm_task_assignments(date, date);
drop function if exists public.schedule_set_report_assignees(uuid, text);
drop function if exists public.schedule_assign(uuid, integer, jsonb, text);
drop function if exists public.pm_resource_set_status(uuid, text);
drop function if exists public.pm_resource_save(jsonb);
drop function if exists public.pm_team();
drop trigger if exists schedule_tasks_assignee_text on public.schedule_tasks;
drop function if exists public.schedule_tasks_assignee_text();

alter table public.project_schedules drop constraint if exists project_schedules_report_assignees;
alter table public.project_schedules drop column if exists report_assignees;
alter table public.schedule_tasks drop constraint if exists schedule_tasks_assignment_status;
drop index if exists public.schedule_tasks_resource_idx;
alter table public.schedule_tasks
  drop column if exists assignment_confirmed_by,
  drop column if exists assignment_confirmed_at,
  drop column if exists assignment_inherited,
  drop column if exists assignment_status,
  drop column if exists resource_id;

drop table if exists public.pm_crew_members;
drop table if exists public.pm_resources;
drop function if exists public.pm_team_manageable(uuid, uuid);
drop function if exists public.pm_resource_readable(uuid, uuid);
commit;
