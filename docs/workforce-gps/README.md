# V8.2 Customer workforce: automatic GPS time tracking

This is for the **W-2 employees of contractor companies that subscribe to Built2Bid**. It is not for Built2Bid LLC's
own staff or sales reps. The internal staff and payout system is separate.

It lives at **Company Dashboard → Contractors & Workforce → Time tracking** (`/projects/workforce/time-tracking`).
Employees use **Time clock** (`/clock`).

## What it reuses (no parallel employee database)

| Need | Existing feature reused |
| --- | --- |
| Employees | `pm_resources` (kind `staff`, `linked_user_id`), `pm_employee_profiles.hourly_cost`, `pm_employee_hr.flsa_status` |
| Time | `pm_time_entries` and `pm_time_entry_changes` (history), `pm_clock_in` / `pm_clock_out`, the approval flow, timesheet CSV |
| Jobsites | `project_schedules` plus `estimates.project_address`; the business address comes from `business_profiles.address` |
| Assignments | `schedule_tasks.resource_id` and `pm_crew_members` (people on a project's tasks count around the task dates) |
| Access | Team & Access (`team_in_my_scope`, `pm_team_manageable`, `has_company_permission`, `pm_hr_can`) |
| Estimated labor | `estimate_items` with `cost_type = 'labor'`, read only. The estimating engine is unchanged. |

New tables: `pm_gps_settings`, `pm_work_locations`, `pm_work_location_assignments`, `pm_gps_enrollments`,
`pm_geofence_events`, `pm_time_corrections`, `pm_timesheet_signoffs`, `pm_time_supervisors` and `pm_gps_audit`.
All of them have RLS and are written only through SECURITY DEFINER functions that check the company.

## Rules enforced in the database

- **Off by default.** It can't be switched on until at least one location has a confirmed pin and the admin confirms
  employees were told.
- **W-2 only.** Only `staff` that an admin has explicitly confirmed as W-2 can be enrolled. Subcontractors, crews,
  1099s and vendors are refused (`staff_only`). Having an account is never treated as W-2 status (`w2_required`).
- **The employee's own consent** is needed before anything is stored. Changing the notice text asks everyone to
  accept again.
- **Radius** is 30–322 m (0.2 mi maximum), 322 m by default. Below 100 m the screen warns about phone GPS accuracy.
- **Clock-in** requires an `enter` and then a `dwell` (1–30 min, default 3) at an assigned location. Readings
  with weak accuracy are ignored. Duplicates and drive-bys are blocked. The time is counted from arrival.
  The message is "Clocked in — [Worksite]".
- **Clock-out** requires `exit` followed by `exit_confirmed` after the grace period (2–60 min, default 10).
  - The employer picks **ask** (the default) or **auto**.
  - Auto clocks out at the departure time and flags the entry for review.
  - The message is "Clocked out — [Worksite]".
  - Compensable time is never deleted, and original punch times are kept.
- **Moving between jobsites** splits the day into one shift (`shift_id`): the site A entry, a travel entry inside
  the travel window, then the site B entry. Shifts never overlap.
- **No automatic lunch deduction.** Only breaks the employee enters come off. Paid breaks are tracked separately.
  GPS never reduces pay.
- **Overtime rules:** federal weekly over 40, California daily (8/12) and 7th day, Colorado 12/40, Alaska 8/40,
  Nevada 8/40, or none. FLSA-exempt employees are never split.
- **Privacy.**
  - Events store only distance to the site and GPS accuracy. No coordinates, so no trail.
  - Events are kept for 30–365 days (default 90) and purged after that.
  - Every admin change is written to `pm_gps_audit`.
  - There is no live map or surveillance view.
- **Wages** (cost) are visible only to people with cost permission.

## What works where (honest limits)

Phone browsers and Home Screen web apps (PWAs) **stop running JavaScript when the app isn't on screen**. Built2Bid
has no service worker, and even with one, iOS and Android don't give web pages background location.

| Phone state | Automatic GPS time | Status |
| --- | --- | --- |
| Built2Bid open on screen (browser or Home Screen app) | Works: automatic clock-in/out at assigned sites | Walk-tested in Chromium with a simulated location. Still needs checking on real iPhone and Android phones. |
| Minimized, screen locked, or another app in front | Does not run. Events resume when Built2Bid is opened again. Nothing that happened while it was closed is invented. | Platform limit |
| App closed | Does not work in a web app | Needs the native app |
| Built2Bid Android app | Background arrive/leave using the same rules and records, app closed | **Built** (`android/`, see [docs/android](../android/README.md)). Google only: James decided 2026-11-21 there is no iPhone app. Waiting on the Google Play account (D-U-N-S) and a real-phone test. |

The fallback always works: the manual **Clock in / Clock out** buttons, plus "Add missing time" and "Request a fix"
(both go to a manager for approval with history kept). "Keep screen on" uses the Wake Lock API where the phone
supports it.

## Native app plan (Android built in `android/`; iOS notes kept for reference only, not planned)

- **iOS:** Core Location region monitoring (`CLCircularRegion`).
  - Needs "Always" location permission plus the usage strings `NSLocationAlwaysAndWhenInUseUsageDescription` and
    `NSLocationWhenInUseUsageDescription`.
  - Limited to 20 monitored regions per app, so monitor today's assigned sites only and refresh at the start of
    the day.
  - Region events are reliable at roughly 100 m or more. Smaller radii fire late or not at all.
  - App Store review needs the background-location justification.
- **Android:** Google Play services `GeofencingClient`.
  - Needs `ACCESS_FINE_LOCATION`, plus `ACCESS_BACKGROUND_LOCATION` requested separately.
  - Limited to 100 geofences per app.
  - Recommended radius is 100–150 m. Expect alerts to be 2–3 minutes late, and longer in Doze.
  - Ask the user to exempt the app from battery optimization where an OEM kills it.
  - Play Console requires the background-location declaration and a video.
- **Shell:** Capacitor around the existing web app, with a native geofence plugin. Only the event bridge is native,
  so the screens, rules and records stay the same.
- **Event contract:** already live at `POST /api/workforce/gps/me` with
  `{ action: "event", resourceId, locationId, kind: enter|dwell|exit|exit_confirmed, occurredAt, accuracyM,
  distanceM, source: native_ios|native_android, clientEventId }`.
  - `clientEventId` makes retries idempotent.
  - `occurredAt` may be up to 24 h old, so queued offline events still count.
  - The device should send `dwell` / `exit_confirmed` itself after the company's dwell and grace times, using the
    values from `GET /api/workforce/gps/me` → `status.settings`.
- **No paid map services.** Address lookup uses the free U.S. Census geocoder. Google Maps geocoding stays off
  (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is unset) until James approves it.

## Test map (15 spec scenarios)

The DB tests are `tests/db/gps-timekeeping.test.ts`, the unit tests are `tests/gps-timekeeping.test.ts`, and the
browser walk is `scripts/workforce-gps/walk.mjs`. All of them use synthetic companies only.

| # | Scenario (spec numbering) | Where |
| --- | --- | --- |
| 1 | Arrive at headquarters: clock in after the dwell, from arrival, once | DB "1.", walk |
| 2 | Arrive at an assigned jobsite | DB "2 + 5." |
| 3 | Leave: ask first, or auto clock-out at departure with a review flag | DB "3.", walk (ask) |
| 4 | Drive past a site: no clock-in; unassigned site ignored | DB "4.", unit tracker |
| 5 | Move between two jobsites: one shift, travel time kept | DB "2 + 5.", unit tracker |
| 6 | Inaccurate GPS never clocks in or out | DB "6.", unit `place` |
| 7 | Location denied: exception for the admin, manual clock still works | DB "7." |
| 8 | Employee asks for a correction | DB "8 + 9." |
| 9 | Manager approves it; original punch kept | DB "8 + 9." |
| 10 | Subcontractors stay out | DB "10.", walk |
| 11 | Tenant isolation (Company B sees nothing of A) | DB "11." |
| 12 | Project labor: estimated vs actual; wages hidden | DB "12.", walk (project panel) |
| 13 | Overtime by jurisdiction / exempt | unit `splitWeek` / `overtimeByWeek` |
| 14 | App closed / native background | Android app real-phone plan in docs/android/README.md |
| 15 | GPS never removes recorded time; retention only purges old events | DB "15.", rollback test |

Also covered: off by default, location confirmation, W-2-only enrollment, consent before anything is stored,
outside-hours prompt, and retry-safe event ids.

## SQL

Run `supabase/migrations/20270208001000_gps_timekeeping.sql` in the Supabase SQL Editor. The rollback is
`docs/workforce-gps/rollback_20270208001000.sql`: it removes only the new objects and restores the six redefined
functions. Time entries are kept, and GPS/travel sources are mapped back to `clock`.
