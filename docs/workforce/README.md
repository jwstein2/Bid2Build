# V7.3 Contractors & Workforce (PM Hub)

Projects → **Contractors & Workforce** (`/projects/workforce`): search "Electrician", see Red's Electric and its
electricians, which projects they're on and when, and assign them to another job, all on one page. It extends the
existing PM Hub data. There is still one directory and one assignment record.

Also in this change: the **Pricing data** sidebar item is retired. `/settings/pricing` permanently redirects to
Saved Items & Pricing (`/dashboard/items`). No pricing table, provider catalog, price import, supplier pricing or
Saved Items code was removed.

## 1. Existing-system audit (what was already there)

| Area | Where | Notes |
|---|---|---|
| PM Hub | `/projects` (Overview, Calendar, Timeline, Workload, My Work), `/projects/[id]` (Gantt) | Reads `project_schedules` + `schedule_tasks` through `pm_workspace`. Every date change goes through revision-checked `schedule_save`. |
| Directory | `pm_resources` (V4.2): `kind` staff / subcontractor / crew, company- or solo-owned, `linked_user_id` (staff ↔ company member), `trades[]`, `capacity`, `unavailable[]`; `pm_crew_members` | Subcontractors never get a login. Read needs "View project schedules"; writes go through RPCs and need schedule create/edit rights. |
| Assignments | `schedule_tasks.resource_id` + `assignment_status` (tentative / requested / confirmed / declined), section → task inheritance | Written by `schedule_assign` (PM Hub task drawer, Schedule Now step 8). This is the authoritative assignment. |
| Conflicts | `findResourceConflicts` / `workloadRows` in `src/lib/projects/workspace.ts` | Workload view. Client-side only before V7.3. |
| Team records | `/projects/team/*`: `pm_employee_profiles`, `pm_time_entries`, `pm_suppliers`, `pm_sub_tax_profiles`, `pm_sub_documents` | Keyed by `pm_resources.id`. Owned by the QuickBooks/HR thread (PR #142). Not changed here. |
| Team & Access | `/company/users`, `company_members`, V6.7 capabilities (`src/lib/access/*`) | Licensed Built2Bid users and seats. The directory never writes here. |
| Customers / companies | `companies`, `customers`, `estimates` | Projects show the customer from the schedule snapshot. |
| Permissions | `has_company_permission`, `schedule_permissions(id)` (edit / progress / dependencies / publish / pdf), RLS on `project_schedules` via `estimates` | Reused unchanged. |

**Internal users and external subs are kept apart.** A staff entry can link to an existing active company member
(that member already holds a seat). Subcontracting companies, their workers and individual subs are plain directory
rows with no auth user, no `company_members` row and no seat. The database test checks that adding them changes
none of `auth.users`, `company_members` or `subscriptions.seat_quantity`.

## 2. Architecture

```
pm_resources (one directory) ──< schedule_tasks.resource_id (one assignment) >── project_schedules (PM Hub projects)
      │ parent_id (worker → company)                 │ trigger
      └ pm_crew_members (crew → people)               └──> pm_assignment_events (audit, realtime)
```

* **Directory page** loads `pm_workforce()`, which returns entries and their assignments. It is SECURITY INVOKER,
  so project RLS decides what each person sees.
* **Assign** calls `pm_assign_resource(p)`. That writes the same `schedule_tasks` columns `schedule_assign` writes,
  bumps the schedule revision once and logs a revision row, so the Gantt, Workload, My Work and customer reports
  show it at once.
* **PM Hub → directory.** Every assignment change on `schedule_tasks`, from any screen, is logged by a trigger into
  `pm_assignment_events`. The directory listens to that table over Supabase Realtime (with RLS) and also refreshes
  when the tab regains focus.
* **Directory → PM Hub.** The project page reads the task rows directly. It has a new "Assigned contractors &
  workforce" panel with "Assign people", which opens the directory's assign flow with that project already chosen.

## 3. Database (`supabase/migrations/20270102005000_workforce_directory.sql`)

Additive and safe to run more than once. Rollback: `docs/workforce/rollback_20270102005000.sql`. The rollback keeps
every entry and assignment, and turns cancelled into declined.

* `pm_resources` + `parent_id` (worker → subcontracting company: same directory, one level, never an individual's
  workers), `entity` (`company` / `individual`, subs only), `crew_size`, `capacity_declared`, `specialties[]`.
  Existing subs keep `entity = null` and are listed with companies. Capacity typed before V7.3 (crews, or more
  than 1) counts as stated.
* `schedule_tasks` + `assignment_notes`, `assignment_hours`, `assignment_start_time`, `assignment_end_time`;
  `assignment_status` also allows `cancelled`.
* `pm_assignment_events`: append-only, readable by whoever can read the project. Each row has the action, status,
  source (`pm_hub` / `directory`), the override reason with the conflicts it overrode, the actor and the time.
* RPCs: `pm_workforce()`, `pm_assign_targets()`, `pm_assign_resource(p)`, `pm_resource_history(id)`,
  `pm_can_override(schedule)`. `pm_resource_save` now accepts the new fields and keeps them when an old client
  leaves them out. `pm_team` returns them too. `pm_resource_conflicts(...)` is internal: it can't be called by
  `authenticated`.

## 4. UI components (`src/components/workforce/`)

* `workforce-page.tsx`: the Directory / Assignments switch, search, trade / availability / sort filters, section
  tabs (All, Subcontracting companies, Individual subcontractors, Employees, Crews) with counts, cards, empty states.
* `card.tsx`: name, relationship, primary and extra trades, active / upcoming counts, workers or crew size, next
  scheduled work, availability chip, conflict flag, call / email, Assign to project.
* `profile.tsx`: details, trades, specialties, capacity, contact (private for employees unless you're a manager),
  team (company ↔ workers, crew ↔ members), assigned / upcoming / completed projects, notes, activity history.
* `assign-dialog.tsx`: who (add more people: a company's workers first) → project search → section or task per
  person (matching trade first) → status, times, hours, notes → server conflict review → confirm → View in PM Hub.
* `form.tsx`: add or edit a company, individual, worker at a company, employee or crew.
* `project-crew.tsx`: the panel on the project page.

## 5. PM Hub integration

* Sidebar: **Contractors & Workforce** sits right under Projects. It shows only when project scheduling is on, and
  V6.7 access hides it with the same "Team, subs & suppliers" capability.
* `/projects` header: a Contractors & Workforce button next to Team & Subcontractors. No PM Hub tab was removed,
  renamed or replaced.
* `/projects/[id]`: the "Assigned contractors & workforce" panel, with links to each profile and Assign people.
* Team & Subcontractors (`/projects/team`) is unchanged and edits the same rows.

## 6. Security and authorization

* Tenant isolation: every RPC scopes to `my_company_id()` (or the solo owner). `pm_workforce` and
  `pm_assign_targets` are SECURITY INVOKER, so `project_schedules` RLS applies. Another company's entry is
  refused as `bad_resource`, and another company's project as `forbidden`.
* Roles: reading needs "View project schedules". Adding or editing entries needs schedule create/edit. Assigning
  needs schedule `edit` on that project. **Overriding a conflict needs edit-all-schedules (or the solo owner) plus
  a reason**, and both are written to `pm_assignment_events`.
* Privacy: employee phone and email go only to team managers and the employee. Sub company contacts are business
  details and are shown to readers. Internal notes go to managers only.
* No invitations, logins or seats are created. Nothing is emailed or texted.
* API routes: `POST /api/workforce/assign` (same-origin, rate-limited, zod-validated), `GET /api/workforce/targets`,
  `GET /api/workforce/history`. `/api/team` accepts the new optional fields.

## 7. Conflict detection

The same rules run on the server (`pm_resource_conflicts`, run on every assign and on every review) and in the
browser (`conflictsFor`, for cards and profiles).

* **Person** (employee, individual sub, worker at a company): a conflict is a live assignment on a *different*
  project with overlapping dates. When both assignments have times of day that don't overlap, they can share the
  day. A person booked through a crew counts too. Each overlapping pair is reported once, and a section with
  inherited tasks counts as one booking.
* **Crew**: concurrent projects at or over its capacity (default 1), plus each member's own bookings elsewhere.
* **Company**: concurrent jobs for the company and its workers. This is a possible overbooking only when a
  capacity was stated. Without one, it shows "Capacity unknown · N jobs", which is information only and never
  blocks.
* Days marked unavailable are flagged. Cancelled, declined and completed work never conflicts.
* A conflict blocks the write until a manager adds a reason. Nothing is ever moved, rescheduled or deleted.
* Duplicate prevention: the same assignment clicked twice is a no-op. The same person twice on one project at the
  same time needs an explicit yes. Two people can't take the same task in one go (one assignee per task; use a
  crew for a group). Replacing someone already assigned needs a tick.

## 8. Onboarding walkthrough

* **Guided tour** `contractors-workforce` (`src/lib/guide/tours.ts`): offered on the first visit to the page, and
  replayable any time from the Guide button. Steps: search by trade → inspect a card → Assign to project (editors
  only) → conflicts and the Assignments list → Add (editors only). It uses the page's `data-guide` hooks.
* **Page guide** `projects.workforce` (Feature walkthrough) covers the same ground as a static list.
* **Demo rows** (`src/lib/demo/dataset.ts` + `supabase/migrations/20270102006000_workforce_demo.sql`): Red's
  Electric (sample) with four workers, Fresh Coat Painting Co. (stated capacity 2), Flatwork Crew A with two members,
  Foundation Crew B, several projects, and one deliberate double booking (Marco Diaz) so the conflict view has
  something to show. Demo data lives in the separate demo tenant, so normal RLS keeps it isolated.

## 9. Tests

* `tests/db/workforce.test.ts` (real Postgres, 9 tests): company ↔ worker rules, assign writes the PM Hub row
  with inheritance and one revision, duplicate no-op, stale revision, person conflict + override rights + audit,
  times of day, cancelled, unavailable days, company capacity unknown → stated, crew members, same-project yes,
  PM Hub changes audited, cross-company isolation, staff contact privacy, no seats or logins, rollback + re-apply.
* `tests/workforce.test.ts` (16 tests): search stemming ("electrician" ↔ "electrical"), search by company,
  specialty, customer, project and status, sections, trade filter, sorting, bookings via workers and crews,
  lifecycle, availability, conflicts (pairs once, times, cancelled, capacity), assign-flow guards.
* `scripts/workforce/walk.mjs` (browser, mock backend): navigation and redirect, directory, search, filters,
  profile, assign with no conflict, PM Hub project panel, conflict override with reason, history, Assignments,
  add worker, 390 / 320 px, dark, view-only.

## 10. Deployment

1. Run `20270102005000_workforce_directory.sql` in the Supabase SQL Editor (a copy is in project files under
   `workforce/`). It's safe to run twice.
2. Then run `20270102006000_workforce_demo.sql` (updates the demo loader so demo accounts get the workforce rows).
3. Merge. Until the SQL runs, `/projects/workforce` shows a "being set up" notice, and everything else works as before.
4. Check the page as an owner, a member with view-only schedule access, and a solo account.

## 11. Known limitations

* One assignee per section or task (the existing model). Several people on one trade means a crew, or separate tasks.
* Assignment dates come from the project schedule. To change dates, open the project. Times of day, hours and notes
  are per assignment.
* Only projects with a schedule (won and scheduled) can be assigned to.
* The server conflict check uses calendar dates, not each project's working-day calendar, so an overlap that falls
  only on a weekend can still show.
* Team & Subcontractors (`/projects/team`) keeps its own list view of the same rows. Folding it into this page
  would change an existing PM Hub tab, so that's left for James to decide.
