-- Rollback for 20261118001000_projects_workspace.sql (Projects Workspace V4.1).
-- Run only if V4.1 must be removed. Deploy the previous app version FIRST, because the new
-- /projects page calls pm_workspace(). Schedules, tasks, revisions and publications are untouched.
-- This drops the activity log and the salesperson / PM / closeout columns (their data is lost).
-- Completed projects keep status = 'completed'; set them back to 'active' by hand if needed.

begin;
drop function if exists public.project_activity_feed(uuid);
drop function if exists public.pm_workspace(date, date);
drop function if exists public.pm_people();
drop function if exists public.schedule_reopen(uuid, integer);
drop function if exists public.schedule_closeout(uuid, integer, date, text);
drop function if exists public.schedule_set_people(uuid, uuid, uuid);

do $$ begin
  if to_regclass('public.schedule_publications') is not null then
    drop trigger if exists project_activity_publication on public.schedule_publications;
  end if;
end $$;
drop trigger if exists project_activity_task on public.schedule_tasks;
drop trigger if exists project_activity_revision on public.schedule_revisions;
drop function if exists public.project_activity_from_publication();
drop function if exists public.project_activity_from_task();
drop function if exists public.project_activity_from_revision();
drop table if exists public.project_activity;

drop trigger if exists project_schedules_default_rep on public.project_schedules;
drop function if exists public.project_schedules_default_rep();
drop index if exists public.schedule_tasks_dates_idx;
drop index if exists public.project_schedules_rep_idx;
drop index if exists public.project_schedules_pm_idx;

alter table public.project_schedules drop constraint if exists project_schedules_closeout_note_len;
alter table public.project_schedules
  drop column if exists closeout_note,
  drop column if exists closed_by,
  drop column if exists closed_at,
  drop column if exists actual_finish,
  drop column if exists project_manager_id,
  drop column if exists sales_rep_id;
commit;
