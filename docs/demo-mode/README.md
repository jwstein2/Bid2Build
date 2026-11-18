# Demo Mode, Practice Mode and the Guided Experience engine (V7.1)

## What it is

- **Demo Mode** is for the platform owner only. It opens a fully populated sample contracting company in a separate workspace, so the owner can demo Built2Bid without touching real data.
- **Practice Mode** is optional and off unless `PRACTICE_MODE=on`. It gives any signed-in contractor a small sample workspace (3 bids) to practise in.
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
