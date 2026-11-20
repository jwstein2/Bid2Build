# V8.3 Workforce & HR integration (customer companies' own workers)

Part 1 of the "HR integration" spec. It builds on V8.2 GPS time tracking (`20270208001000`, live) and adds one
migration, `supabase/migrations/20270210001000_worker_hub.sql` (rollback: `docs/worker-hub/rollback_20270210001000.sql`).
It is for contractor companies' own workers, not Built2Bid staff.

## One employee record (no duplicate identities)

| Linked data | Where it lives |
| --- | --- |
| Identity, contact, login | `pm_resources` (kind `staff`, `linked_user_id`) |
| Classification (W-2 / 1099 / owner / other) | **new** `pm_employee_profiles.classification`; only W-2 can use GPS time |
| Role, permissions | Team & Access (`company_members`, supervisors, HR access) |
| Compensation, payroll info | `pm_employee_hr` (pay rate, unit, frequency, FLSA), W-4 / direct deposit (V8 HR records) |
| Work locations | `pm_work_locations` (+ new `work_category` for non-project places) |
| Project assignments | `schedule_tasks.resource_id`, `pm_crew_members` |
| Weekly / future schedule | project assignments + **new** `pm_work_shifts` (internal work) + approved `pm_pto_entries` |
| Timekeeping, GPS events | `pm_time_entries` (+ new `work_category`), `pm_geofence_events` |
| Adjustments, disputes | `pm_time_corrections` (+ new `work_category`, `issue`), `pm_time_entry_changes` |
| Documents, history | HR files, `pm_gps_audit` |

Each company's rows are isolated by `company_id` / `owner_id` with RLS and scope checks in every function.

## What people see

- **Workers: My work (`/clock`)** — on a project / internal work / off duty, today's jobs, scheduled, actual and
  remaining hours, next shifts, pending fixes, a weekly calendar with scheduled vs actual per day, hours by project
  and internal category, and an assignment detail (location, times, responsibilities, map link). The time clock is
  below it, with "What you're working on" so paid time never needs a project.
- **Admins: Time tracking** — new tabs **Schedules** (internal shifts next to project assignments), **Labor report**
  (scheduled vs actual by job, paid overhead by category, cost only for owners / team managers, CSV) and
  **Projected pay** (HR access only). The Employees tab sets classification.

## Work categories

`project`, `shop`, `office`, `training`, `admin`, `travel` (paid travel), `other_paid`, `unpaid`. Defaults: a project
entry is `project`, travel is `travel`, otherwise the location's category, otherwise `other_paid`. Unpaid time is
recorded but never paid, costed or counted toward overtime.

## Projected pay

- Company switch (off), show-to-workers (off), per-worker on/off and show/hide, week or pay period, pay schedule
  (weekly / biweekly / semimonthly / monthly), overtime rule (or the time-tracking rule), OT and double-time
  multipliers, per-category differentials and per-worker extra hourly rates.
- `pm_pay_inputs` is the only way pay data leaves the database. Workers get `{available:false}` with **no amounts**
  unless the company turned it on for them. The math runs on the server (`src/lib/workforce/hub/pay.ts`).
- Three separate numbers: scheduled projection, actual-so-far estimate, and final (only from a payroll provider;
  none is connected, so it always says so). Every view shows "Estimated gross pay — not a guaranteed paycheck."
- Hourly: FLSA regular rate (straight-time pay / hours) for overtime, California daily rules, exempt = no OT,
  paid time off at base rate. Salaried: annual / periods per year.

## Not done (honest limits)

- No payroll provider is connected (none was approved), so "final" pay is never shown.
- Night and weekend differentials are saved but not estimated.
- GPS background limits from V8.2 still apply (web app works while open on screen).

## Tests

- DB: `tests/db/worker-hub.test.ts` (classification, shifts, schedule, categories, corrections, pay hidden, switches,
  labor report, worker week, rollback).
- Unit: `tests/worker-hub.test.ts` (pay periods, hourly / OT / CA / exempt / salary, weekly compare, duty state).
- Browser walk: `scripts/worker-hub/setup-db.mjs` + `scripts/worker-hub/walk.mjs` (synthetic data only).
