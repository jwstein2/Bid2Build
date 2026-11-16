# Projects Workspace V4.1

One workspace for every scheduled job: Overview, Calendar, Timeline, Workload, My Work and Project Detail.
Every view reads the same `project_schedules` / `schedule_tasks` rows. Every date change goes through the
existing revision-checked `schedule_save` route (`PATCH /api/schedules/[id]`), so there is one source of truth.

## Database (migration `20261118001000_projects_workspace.sql`)
- `project_schedules`: `sales_rep_id` (backfilled from the estimate creator), `project_manager_id` (never automatic),
  `actual_finish`, `closed_at`, `closed_by`, `closeout_note`.
- `project_activity`: append-only log written by triggers (schedule saves, task started/completed/delayed,
  customer updates) and by the people/closeout RPCs. Readable by whoever can read the project (RLS). No direct writes.
- RPCs: `schedule_set_people`, `schedule_closeout`, `schedule_reopen` (need schedule edit permission),
  `pm_people`, `pm_workspace(from, to)` (SECURITY INVOKER, so RLS decides what comes back), `project_activity_feed`.

## Rollout
1. Run the migration in the Supabase SQL Editor. It's safe to run more than once.
2. Merge the PR. Until the SQL is applied, `/projects` falls back to the previous list.
3. Spot-check `/projects` as an owner, a company member with view-only access, and a solo account.

## Rollback
1. Revert the PR and deploy.
2. Run `rollback_20261118001000.sql`. It drops the activity log and the new columns. Schedules, tasks, revisions
   and publications are not touched. `tests/db/projects-workspace.test.ts` checks the rollback and the re-apply.

## Tests
- `tests/projects-workspace.test.ts`: filters, metrics, conflicts, My Work buckets.
- `tests/db/projects-workspace.test.ts`: access, people rules, activity, closeout, rollback (real Postgres).
- `scripts/projects/walk.mjs`: browser walk against the mock Supabase (desktop, 390px, 320px, dark, black).

# Team & Subcontractors V4.2

Projects → Team & Subcontractors (`/projects/team`): a directory of staff, subcontractors and crews, and
"who's doing the work" on every section and task.

## Database (migration `20261118002000_team_assignments.sql`, needs V4.1 first)
- `pm_resources` (company or solo account; staff may link to an active company member; subcontractors never
  get a login) and `pm_crew_members`. Read with "View project schedules"; changed only through RPCs by people
  who can create/edit schedules.
- `schedule_tasks`: `resource_id`, `assignment_status` (tentative / requested / confirmed / declined),
  `assignment_inherited`, `assignment_confirmed_at/by`. Assigning a section fills tasks with no assignment of
  their own; task overrides survive a section reassignment. Typing a different Gantt "Assigned to" name
  replaces a directory assignment.
- `project_schedules.report_assignees`: hidden / names (default) / names_contacts for customer updates.
- RPCs: `pm_team`, `pm_resource_save`, `pm_resource_set_status`, `schedule_assign` (revision-checked, one
  revision per call), `schedule_set_report_assignees`, `pm_task_assignments`.

## Screens
- Directory page with search, filters, archive/restore, copy phone/email, call/email links (your own apps).
- Schedule Now step 8 "Assign who's doing the work": trade- and section-name suggestions, quick add.
- Task drawer "Who's doing this?": status, busy-elsewhere hint, quick add, draft notice (mailto / copy).
- Workload uses crews, members and capacity; My Work includes linked staff and their crews.
- Customer update composer: "Who's doing the work" setting. Contact details only when chosen.
- Nothing is ever sent automatically.

## Rollback
Revert the PR, then run `rollback_20261118002000.sql` (checked in `tests/db/team-assignments.test.ts`).
Task "Assigned to" text is kept.
