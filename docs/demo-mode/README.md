# Demo Mode, Practice Mode and the Guided Experience engine (V7.1)

## What it is

- **Demo Mode** is for the platform owner only. It opens a fully populated sample contracting company in a separate workspace, so the owner can demo Built2Bid without touching real data.
- **Practice Mode** is on for every signed-in user (emergency switch `PRACTICE_MODE=off`). Since 2026-11-21 it gives each person the same full sample company as the owner demo, under the name "Practice Builders (sample)": 24 months of history, current and scheduled work, Financials and a simulated bank (see below). An older practice workspace starts fresh the next time it is opened.
- **Guided Experience engine** covers the tours (first bid, Project Command Center / PM Hub, Enterprise owner/manager/staff, demo walkthrough), smart offers, tour progress, the bottom-left **Built2Bid Guide**, help search, optional Ask Built2Bid, and the owner overview at `/admin/onboarding`.

## How isolation works

A demo is a **separate tenant**, not a flag on real data.

| Layer | What enforces it |
| --- | --- |
| Identity | Each owner gets one demo login per kind (`owner_demo`, `practice`), with a reserved email (`@example.com` or `@demo.built2bid.org`). The server writes the claim `app_metadata.b2b_demo = {kind, owner, workspace}`, and users cannot edit `app_metadata`. |
| Who may enter | `/api/demo/enter` checks `public.is_admin(user.id)` (the existing admin-roles table, keyed on the immutable user id, never a display name) for `owner_demo`. `demo_provision()` checks again in SQL. |
| Data | The demo login owns its own Enterprise company, so the ordinary RLS policies keep demo and real rows apart in both directions (`tests/db/demo-mode.test.ts`). Nothing is ever copied, merged or migrated between them. |
| Session switch | Entering stashes the real refresh token in an httpOnly cookie and signs the browser in as the demo login (admin magic-link token, verified server-side). Exit signs the demo session out and restores the real one, checking the restored user id equals `claim.owner`. A full page load follows, so no cached real data stays in memory. |
| Outbound side effects | The proxy answers `403 demo_blocked` for checkout, billing, the portal, seats, invitations, signature requests, outbound customer messages, financial emails, bank links, website import, account deletion and consent changes (`DEMO_BLOCKED` in `src/lib/demo/session.ts`). Database triggers back this up: a demo tenant can't queue messages (`comm_messages` scheduled/approved/sending), insert into `email_outbox`, create `signing_requests` or `subscriptions`. |
| Metrics | Demo logins are labelled `demo` in `admin_account_labels`, which the owner reports already exclude. Finalizing a demo bid records no market observation, export event or activation. Client analytics (`track()`) does nothing on demo pages, and guide events are stored with `workspace = demo/practice`. |
| Customer portals | Sample customers use reserved example domains, and signature requests and messages are blocked, so no portal link is ever created for them. |

## Sample company

`src/lib/demo/dataset.ts` (deterministic per workspace; version `DEMO_SEED_VERSION`):

- 150 customers, 125 estimates (90 have become projects), 45 scheduled jobs, 65 invoices with matching payments, 8 employees, 12 subcontractors and 338 communications (history only, never sent).
- Trades covered: concrete, decks, roofing, siding, kitchens, bathrooms, painting, drywall, electrical, general contracting, and pressure and soft washing.
- Status mix: draft, ready for review, approved, sent, pending, won, lost, scheduled, in progress, delayed (behind schedule), completed and invoiced, and completed and paid.
- All names, streets and towns are invented. Emails use `example.com/net/org` and phones use `555-01xx`. Prices are illustrative.

Seeding writes through the real RPCs (`save_estimate`, `set_estimate_stage`, `schedule_*`, `fin_*`) as the demo login, so the sample data obeys the same rules as real data. It runs in resumable numbered steps (`demo_apply`, about 6 seconds per request) so it fits within function time limits. The browser shows a progress bar while it runs. Locally the full seed applies in about 5 seconds (`scripts/demo/try-seed.mts`).

## Reset

Reset (from the DEMO MODE banner, with an inline confirmation) never deletes anything. Financial records are append-only by design. Reset **retires** the current demo login: it removes the claim, bans the login, ends any grant and records it in `demo_retired_logins`. It then provisions a fresh demo login and seeds it from the current dataset version. Retired rows stay invisible to every real account. If seeding fails, the workspace is marked `failed` with the error, and the next Enter re-provisions it. The real account is never involved.

## Guided tours

- Tours are data, defined in `src/lib/guide/tours.ts`. Targets are `data-guide` ids, and pages are `data-guide-page` keys from `src/lib/features/page-guides.ts`. The spotlight card is the existing accessible `FeatureTour` (keyboard, focus return, phone docking, missing-target skip). No third-party tour library is added. Joyride, Shepherd and Driver.js were considered and rejected, because the existing engine already does what they would and adds no weight.
- Multi-page tours run one page at a time. Between pages a "Continue on …" card offers a link, or inside the builder a hint, and the tour resumes on the next page (per-tab session storage). The tour never navigates or clicks on its own.
- Offer rules are in `src/lib/guide/rules.ts`: no offer while anything else is open or the person is typing, at most one per page load, none in Demo Mode, Skip is permanent, Maybe later lasts 7 days, at most 3 offers, and the first-bid journey waits for the existing welcome popup.
- Progress lives in `guide_progress` (person, tour, version, status, last step, timestamps, workspace, role) and is written only through `guide_record()`. Events live in `guide_events`: first-party, with no page content, and search text is never stored.
- To add a tour, add an entry to `TOURS`. `tests/guide-engine.test.ts` checks that pages and targets exist.

## Optional AI help

`/api/guide/ask` is off unless `GUIDE_AI=on` and the Anthropic key is configured. It answers only from the matching verified help notes (page walkthrough steps and tours), uses the default Haiku model, is limited to 15 questions per person per day and 5 per minute, respects the shared monthly AI budget, caches identical questions for 6 hours, and logs to `ai_generations` (kind `guide_help`). Help search works without it.

## Settings

| Variable | Default | Effect |
| --- | --- | --- |
| `PRACTICE_MODE` | off | `on` shows "Practice with sample data" in the Guide and Account settings. |
| `GUIDE_AI` | off | `on` shows Ask Built2Bid in the Guide (needs `ANTHROPIC_API_KEY`). |

## Database

Migration `supabase/migrations/20270102001000_demo_mode_guide.sql` is additive and safe to run twice. Rollback: `docs/demo-mode/rollback_20270102001000.sql`.


## 24-month history and the simulated bank (2026-11-21, migration 20270219003000)

- **History.** 72 completed, invoiced and collected jobs spread through the last 24 months along a northern building-season curve (busy summers, quiet winters), plus the current pipeline, jobs underway (some delayed), scheduled future jobs and open bids. Some invoices are overdue.
- **Exceptions.** Every 7th started job overruns (finished ones end in a loss after rework). Change orders: two approved, one waiting on the customer, one declined. One customer overpays and gets a $250 refund check. Quarterly owner draws are excluded from the books with a reason.
- **Simulated bank.** "Maple Hollow Community Bank (SIMULATED)", "Business Checking (SIMULATED)" ••0000. It is provider `mock` with `sandbox = true`: there are no credentials, no stored token, no API calls, no syncing (`next_sync_at` is null) and no money movement. The app refuses Refresh and Reconnect for it (`simulated_bank`). Every bank line ends in "(SIMULATED)".
- **Bank feed.** Deposits mirror recorded payments (same `SIM-` reference). Job costs come from each estimate's own cost lines (supplies at the start, subcontractors at the end). Labour runs through biweekly payroll, and overhead, utilities, fuel and quarterly estimated tax fill in the rest. Each month is its own feed with a month-end balance. The opening balance keeps the running balance above $8,000.
- **Reconciled.** Every month end at least 20 days back is reconciled to the cent with nothing unmatched. The last 7 days of lines are left unmatched so the user has something to practise on. A forward cash plan (payroll, rent, insurance, truck loan, the next estimated tax payment) feeds the V9 cash forecast. Forecast events are dated in the future only.
- **Isolation.** All of it is written by `demo_apply` as the demo login through the app's own RPCs, inside the demo company. Normal RLS keeps it away from the practising user's real account.
- **Deviation from the spec.** The spec asks for one shared fixture. Instead, the deterministic fixture is written once per practice workspace, so each person can make reversible edits without touching anyone else's. A workspace is roughly 10,000 rows, counting audit history.
