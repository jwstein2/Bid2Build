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
