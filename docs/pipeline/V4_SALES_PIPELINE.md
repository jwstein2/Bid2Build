# Built2Bid V4: sales pipeline, internal reports and project scheduling

V4 ships in phases, one reviewable PR per phase. Phases 1–2 (audit, sales pipeline, analytics, sales pay calculator) shipped in PR #45. Phase 3 (Internal Estimate Report) is described below.
Nothing here changes billing, Stripe, subscriptions, credits, proposals, e-signature evidence or customer-facing documents.

## Phase 1: baseline UX audit

Screenshots are from a **local production build against the mock Supabase with labeled fixture data** (`scripts/pipeline/baseline.mjs`, `scripts/ux-audit/mock-supabase.mjs`).
No production account was used. They are not production screenshots.

Findings on the existing Bids dashboard (before):

| Issue | Where | Fix in this PR |
|---|---|---|
| Bids list sits at the bottom, under credits, premium tiles and referral cards | Dashboard | Bids workspace moved directly under the header and signed-bids banner |
| Seven equal-weight icon buttons on every row; no "what next" | Bid row | One context-aware next action per card; full action set kept in Table view |
| Status is confusing: a row can say **Draft** and **Awaiting Signature** at once | Bid row | Board column derived from stage + signing; "Signing link out" badge separate |
| No sales stage after Finalized (Sent / Won / Lost were Enterprise-only) | Dashboard | Pipeline for every contractor, using the existing `pipeline_stage` |
| No bid values per stage, no pipeline or won totals, no win rate | Dashboard | Column counts/totals + 5 summary metrics |
| Drafts / Finalized tiles duplicate the list and say nothing about sales | Dashboard | Replaced by pipeline metrics |
| Two filter rows on desktop; signature and status filters overlap | Bid list | Pipeline has one search + labeled date filter; Table keeps its filters |
| Empty columns give no guidance | n/a | Each empty stage explains what belongs there |
| Mobile: 7 icon buttons wrap under each bid | Mobile | Stacked, collapsible stages; one action + ⋮ Move to per card |

Still open (later phases): estimate builder has two "Send via My Email" and "Create Signing Link" entry points on the proposal step; premium features are only discoverable from sidebar diamonds (Phase 4); no project scheduling (Phases 5–9).

## Phase 2: how the pipeline works

**Four facts, kept separate** (`src/lib/pipeline/board.ts`):

- `estimates.pipeline_stage`: what the contractor says (draft, ready_for_review, approved, sent, pending, won, scheduled, in_progress, completed, lost)
- document status: draft / finalized / archived (unchanged)
- signing status: derived from `signing_requests` / `signatures` (never written by the pipeline)
- `estimates.won_at`: manual approval date, or the e-signature time

**Board columns**: Draft, Ready to Send, Sent, Awaiting Signature, Approved / Won, then a second "Jobs & outcomes" row: Scheduled, In Progress, Completed, Lost / Declined.
Grouping into two rows keeps the selling stages on one screen; Lost is a separate outcome.

Placement rules: a real signature puts a bid at Won or later; an active signing link puts it at Awaiting or later; signals only ever move a bid forward. A finalized bid still at `draft` shows as Ready to Send.

**Transition rules** (UI in `checkMove`, enforced in SQL `set_estimate_stage`):

- E-signed bids can't move back before Won (`bid_signed`); Lost stays possible for a cancelled job, and the signature is kept.
- Scheduled / In Progress / Completed need a won or signed bid (`not_won`).
- With a signing link out, the bid can't move back until the link is revoked.
- Moves to Won ask for an approval date (not in the future) and optional note, recorded as **Approved manually**. This never creates or implies a signature.
- Lost asks for a reason; reopening a won bid asks for confirmation.
- Every move is written to `estimate_stage_history`; Undo is a second move, so both stay in history.

**Numbers**:

- Bid value = signed total when signed, otherwise latest finalized version total. Never-exported drafts have no price ("not priced yet") and never count as revenue.
- Active pipeline = Ready + Sent + Awaiting values. Open bids = Draft through Awaiting. Won value = Won + job stages. Each bid sits in exactly one column, so nothing is counted twice.
- Win rate = won ÷ (won + lost), shown only once 5 bids are decided; otherwise "x of y decided".
- Board date filter applies to an explicitly labeled date: last activity or created. The board always shows current stage.
- Analytics count **dated events in the period**: created, first sent (move to Sent/Awaiting or first signing link), outcome (the bid's latest decision, won by e-signature or manual move, or lost). Moving a won job to Scheduled/Completed is not a second win. Bids won before stage history existed use the backfilled `won_at`. Stage history starts 2026-11-14 (shown on the page).

**Sales pay calculator** (Analytics tab, optional): percent of sale (pre-tax), percent of gross profit (sale − version cost, never negative), percent of a commissionable base (sale minus an excluded %), or flat fee, plus optional base pay. Settings live in `sales_pay_settings` with RLS to the owner only (teammates and company owners can't read them). It never changes a bid. Labeled as a planning estimate, not payroll.

**Enterprise**: shares the same stages. `company_pipeline_summary` now counts job stages as won; the Command Center gains three stage bars.

## Phase 3: Internal Estimate Report

- **Where:** "Internal report" button in the estimate builder header (signed-in, cloud bids). Locked users see a diamond and the standard premium upgrade card.
- **Who:** the existing Unlimited/premium entitlement (`library_access()`), checked on the server for every request. Company bids also need both `view_costs` and `view_margin`. Anyone else gets 401/402/403/404; nothing is rendered.
- **What:** direct cost, selling price, gross profit, gross margin and markup (kept distinct), per line and per section; direct cost by type (only types that exist on the bid); project adjustment, tax, rounding, customer total; pass-through and discount notes; engine warnings. Numbers come only from `computeEstimate`, so they match the builder exactly.
- **Privacy:** the PDF is generated on demand, never stored, served `private, no-store` with `noindex`, carries a red "INTERNAL - CONFIDENTIAL" banner and an `INTERNAL_..._cost-report.pdf` filename. Send via My Email starts with an empty recipient, always shows a confidentiality warning, and requires a confirmation checkbox when the recipient is outside the business email domain. Tests assert the customer proposal data and PDF contain none of the costs or profit.
- **Code:** `src/lib/reports/internal-estimate.ts`, `src/lib/reports/access.ts`, `src/lib/pdf/internal-report-pdf.tsx`, `src/app/api/estimates/[id]/internal-report/route.ts`, `src/components/builder/internal-report.tsx`.
- **Tests:** `tests/internal-report.test.tsx`, `tests/internal-report-route.test.ts`, `scripts/internal-report/walk.mjs` (mock Supabase; free mode and `MOCK_UNLIMITED=1`).
- **Migration:** none.

## Phase 4: feature registry, unlocked-features modal, walkthrough, What's New

- **Registry:** `src/lib/features/registry.ts` lists every feature with id, name, entitlement, route, walkthrough target (`data-feature`), description, upgrade pitch, walkthrough copy and release version. `PREMIUM_FEATURES` (locks and upgrade copy) is derived from it. Release notes are written by hand there; nothing is generated from code changes. Features marked `unreleased` are never shown.
- **CI:** `.github/workflows/feature-registry.yml` runs `tests/feature-registry.test.ts` on every PR: complete metadata, valid releases, premium locks registered, every `data-feature` registered, every walkthrough target present, premium sidebar links registered.
- **Your New Features Are Ready:** opens once when the account's server-checked access (`library_access()`) includes premium features it hasn't been told about. After checkout it re-checks for ~24s while the webhook lands. Explore Features, Maybe Later and Close all acknowledge, so it doesn't reopen. Long-time paying customers are told only about premium features from the latest release (today: Internal Estimate Report).
- **Walkthrough:** highlights the real control when it's on screen (Try it clicks it), otherwise explains where it is with Open Feature. Next, Back, Skip, Finish, Escape. Never forced. Start it from the modal, the dashboard notice, What's New, or Help > Feature walkthrough.
- **What's New:** `/whats-new` lists releases from the registry with Included / All plans / Unlimited + Upgrade per feature. The dashboard shows a dismissible notice for the latest release, limited to features the account can use; accounts created after the release don't see it.
- **Contextual help:** `?` next to the Bids view tabs shows the registry description.
- **Storage:** per account in Supabase auth `user_metadata.b2b_features` (acknowledged ids, last notice version, walkthrough outcome), via `/api/features`. It never grants access. **No migration.**
- **Tests:** `tests/feature-registry.test.ts`, `tests/features-route.test.ts`, `scripts/features/walk.mjs` (mock Supabase).

## Phase 5: project scheduling add-on, entitlements and billing (test mode)

- **Pricing:** Standard Unlimited can add project scheduling for **$4.99/month** (one editor). Enterprise includes **one editor**; each extra editor is **$1.99/month**. Editors are separate from licensed users (seat counts never change). Free accounts have no access.
- **Complimentary access:** complimentary Unlimited does not include scheduling; complimentary Enterprise includes one editor. The owner can change either per grant in Admin > Complimentary > Scheduling (`complimentary_grants.pm_editors`, null = plan default).
- **Preview before any charge:** both purchase flows call Stripe `invoices.createPreview` first and show the new charge, billing interval, effective date, prorated amount today and the next invoice total. Nothing is charged until the user confirms. Prices are checked against Stripe (amount, currency, recurring monthly) before every charge.
- **Removal policy:** removing the Standard add-on takes effect at the end of the paid period with no refund; editing stays on until then (`pm_addon_until`). Removing extra Enterprise editors takes effect immediately with a prorated credit; you can't go below the number of assigned editors, and if the limit drops the earliest-assigned editors keep editing.
- **Downgrade keeps data:** losing the entitlement makes schedules read-only. Nothing is deleted.
- **Assignment:** company admins (manage users or billing) assign editors on Company > Billing. Only active members count; every change is audit-logged.
- **Source of truth:** Stripe subscription items mirror into `subscriptions.pm_addon / pm_addon_until / pm_extra_editors` via the webhook (`apply_pm_update`, service role only, ignores older events). `pm_entitlement(uid)` and `my_pm_access()` decide access; `can_edit_schedules()` is what Phases 6-7 will check.
- **Hidden in production:** everything is behind `NEXT_PUBLIC_PROJECT_SCHEDULING=on` (off in production until the scheduler ships in Phases 6-7). With a live Stripe key, purchases also need `PM_BILLING_LIVE=true`. The registry entry `project_scheduling` is `unreleased`, so no modal, notice or tour mentions it.
- **Env vars (when going live):** `STRIPE_PRICE_PM_ADDON` ($4.99/mo), `STRIPE_PRICE_PM_EDITOR` ($1.99/mo), optional `STRIPE_PRICE_PM_ADDON_ANNUAL` (annual Unlimited customers see "coming soon" without it).
- **Code:** `src/lib/pm/billing.ts`, `src/lib/pm/server.ts`, `src/app/api/billing/pm-addon/route.ts`, `src/app/api/company/pm-editors/route.ts` and `/assign`, `src/components/billing/pm-addon.tsx`, `src/components/company/pm-editors.tsx`.
- **Migration:** `supabase/migrations/20261116003000_pm_entitlements.sql`. Rollback: `docs/pipeline/rollback_20261116003000.sql`. The app works before the SQL runs (cards stay hidden; webhook mirroring only runs when PM prices are configured).
- **Tests:** `tests/pm-billing.test.ts` (16, Stripe mocked), `tests/db/pm-entitlements.test.ts` (11 on real Postgres), `scripts/pm/walk.mjs` (14 browser checks, mock Supabase).

## Phases 6-7: Schedule Now, Gantt scheduling, progress and delays

- **Where:** a new **Projects** item under Bids in the sidebar (`/projects`), Schedule Now on the Won pipeline card, in the bid header (accepted bids only; "Open schedule" when one exists), and on the signed proposal page. One schedule per bid: Schedule Now on a scheduled bid opens the existing schedule.
- **Wizard (8 steps):** confirm the source estimate, choose sections (only the estimate's own, grouped by trade on multi-trade bids), start date + working days + holidays + business time zone, working days per section, dependencies (with the project start / after a section, wait days, allowed overlap), optional target date, review timeline, save as **draft**. The customer is never notified. Unaccepted bids need an explicit "provisional" choice and stay labelled Provisional.
- **Target dates:** if the plan misses the target, the conflict is explained in working days with choices: use only the overlaps the contractor allowed, start earlier (never a past date), move the target, or change durations. Durations are never compressed.
- **Snapshot:** saving freezes the estimate's sections and line items (names, quantities, units, section trade, latest version id; never costs or prices). Later bid edits never rewrite the schedule.
- **Gantt:** day/week/month zoom, sticky labels, section grouping with expand/collapse, drag to move, drag either edge to change dates, overlaps, dependency arrows, planned bar with % complete fill, actual-dates line, today line, target line, status colors plus text labels. Keyboard: arrow keys move a bar a day, Shift+arrows change its finish, Enter opens the editor. Phones get a List view with Edit / Schedule items / Shift section buttons (no dragging needed).
- **Line items:** a section's "Schedule individual items" lists its estimate line items; chosen ones become tasks linked to the line item (unique per schedule, so repeats are refused). Each has dates, status, % complete, optional assignee and notes.
- **Editing:** manual start/finish/duration, group shift (section + its items), split a task into two parts, dependency editing (loops refused), undo, conflict warnings (dependency broken, non-working day, item outside its section, past planned finish, target missed). The scheduler warns but never fixes anything by itself.
- **Delays:** extending a task that others depend on opens a preview with four choices: keep later tasks unchanged, move dependent tasks, shift the rest of the section, recalculate the project finish. Each shows exactly which tasks move and the new finish before anything is saved. Unrelated tasks never move. Every save records a revision with each task's old and new dates (History).
- **Progress:** planned vs actual dates kept separately; status Not started / In progress / Complete / Delayed / On hold. Complete requires an actual finish and means 100%; reaching a planned date never marks anything complete and 100% never changes planned dates. Project progress is duration-weighted by default (or explicit task weights), counts sections through their line items, and has a drilldown. "Time elapsed" is shown separately and labelled as time, not progress.
- **Access (server-side):** viewing follows the bid's existing visibility, so a downgraded account keeps read-only access and no data is deleted. Creating/editing needs `pm_entitlement().can_edit` and, for company bids, an assigned editor seat in that company who can see the bid. All writes go through `schedule_create` / `schedule_save` with an optimistic revision check; the API re-validates dates, durations (recomputed from the calendar), completion rules, dependency loops and section membership.
- **Hidden in production:** everything stays behind `NEXT_PUBLIC_PROJECT_SCHEDULING=on`; `project_scheduling` is still `unreleased` in the feature registry.
- **Code:** `src/lib/schedule/` (calendar, engine, progress, payload, server), `src/app/api/schedules/`, `src/app/(app)/projects/`, `src/components/schedule/`.
- **Migration:** `supabase/migrations/20261116004000_project_schedules.sql`. Rollback: `docs/pipeline/rollback_20261116004000.sql` (deletes schedules; export first).
- **Tests:** `tests/schedule-engine.test.ts` (29), `tests/schedule-route.test.ts` (9), `tests/db/project-schedules.test.ts` (10 on real Postgres), `scripts/schedule/walk.mjs` (38 browser checks, desktop/390/320, mock Supabase).

## Phase 8: customer schedule updates

- **Internal vs published:** schedule edits never reach the customer. From the schedule page, **Preview customer update** (editors only) opens `/projects/[id]/update`: options on the left, the exact customer view on the right (Options / Preview tabs on phones). **Publish update** needs a ticked "I reviewed this preview" box, and any option change clears it. Publishing sends nothing; dragging a bar never emails anyone.
- **Preview options:** overall progress, timeline, completed sections, current work, upcoming work, scheduled line items, scope summaries (per section, editable, prefilled with line item names only), optional progress notes, company logo and color. Defaults hide line items, scope and notes.
- **Never in a customer update:** prices, unit costs, margins, profit, quantities, task weights, assignees, private task notes. The report is built only by `buildCustomerReport` in `src/lib/schedule/report.ts`, on the server, from the saved schedule; the browser can't send report content.
- **Report:** contractor company and contact, customer, project, report date, overall % complete (work-based), completed / current / upcoming sections with scheduled dates, recorded completion dates, revised forecast completion with the previous forecast when it moved, approved notes, scope where enabled. Completion is shown only once recorded (Complete needs an actual finish). A section that slipped since the last published update says so ("Finish moved later: was Nov 18, now Nov 21.").
- **Delivery (contractor stays in control):** Download / Preview PDF, **Send via My Email** (Gmail, Outlook or the email app open with a filled-in draft; on phones the PDF goes through the share sheet), and an optional **secure link** (`/updates/<token>`, 256-bit token, only its SHA-256 stored, 30 days, one per update, can be turned off). Built2Bid never emails the customer and never records an email as delivered: history says "Email draft opened (you send it)". Link opens are counted.
- **History:** each publication is a numbered, write-once snapshot (trigger `schedule_publications_freeze`) with date, publisher, the customer-visible content, options, delivery actions and link status. Later edits never change an old update, and an old link keeps showing its own frozen copy. View-only members see the history but can't publish or share.
- **Access (server-side):** publish, link, revoke and delivery go through `schedule_publish`, `schedule_publication_link`, `schedule_publication_revoke_link` and `schedule_publication_delivery`, all checking `schedule_can_edit()`. Publishing also checks the schedule revision, so a schedule changed after the preview must be reviewed again. Company publications are written to the company audit log.
- **Migration:** `supabase/migrations/20261116005000_schedule_publications.sql`. Rollback: `docs/pipeline/rollback_20261116005000.sql` (deletes published updates and turns off their links).
- **Tests:** `tests/schedule-report.test.tsx` (8, including PDF text), `tests/schedule-updates-route.test.ts` (5), `tests/db/schedule-publications.test.ts` (4 on real Postgres), `scripts/schedule/updates-walk.mjs` (37 browser checks, desktop/390/320, mock Supabase).

## Phase 9: Enterprise PM permissions and seat reassignment

- **13 new company permissions**, in the existing role / grant / revoke model (Users & Permissions shows them grouped: Bids; Costs and internal reports; Project scheduling; Administration):
  view schedules, create schedule from estimate, edit assigned schedules, edit all company schedules, manage dependencies, update progress, publish customer updates, download schedule PDF, view / download / send internal reports, manage scheduling editor seats, manage paid scheduling add-ons.
- **Defaults**: managers get all schedule and internal-report permissions; estimators can view, create, edit their own (assigned) schedules, manage dependencies, update progress and download the schedule PDF; viewers can view schedules and download the PDF. Publishing customer updates and sending internal financial documents are opt-in grants. Seat and add-on permissions are owner-only grants (like billing and user administration), so nobody can escalate.
- **Seat + permission**: every schedule write needs an assigned editor seat AND the permission. A company admin can't edit just by being an admin. Progress and publishing can be granted alone (a field lead who only reports progress; an office manager who only publishes); dates/tasks and dependencies need edit scope.
- **Enforced server-side** in `schedule_save` (classifies each change as edit / progress / dependencies and raises `forbidden_edit`, `forbidden_progress`, `forbidden_dependencies`), the publication RPCs (`schedule_can_publish`), RLS (`view_schedules` for company schedules), and repeated in the API (PATCH schedule, preview/publish, schedule PDF, internal report `?download=1` and `&purpose=send`). The UI hides what you can't do; it isn't the gate.
- **No one loses access**: members who had user administration or billing grants get the seat permission; billing grants get the add-on permission; estimators/viewers who could open internal reports (costs + margin) keep view/download/send.
- **Seat card** (Users & Permissions for seat managers, Billing for the owner): assigned user, seat type (included / paid / complimentary / not covered), billing status, effective date and last change. **Reassign** moves one seat in a single step (`company_pm_reassign`): it keeps its place and kind, so nothing is bought or billed twice and `pm_extra_editors` is untouched. **Remove** warns first with how many schedules the person can edit and says nothing is deleted. Buying seats needs "Manage paid scheduling add-ons".
- Migration `20261116006000_pm_permissions.sql` (re-runnable), rollback `docs/pipeline/rollback_20261116006000.sql`. Before the SQL runs the app falls back to the Phase 8 rule (seat = full edit).
- Tests: `tests/db/pm-permissions.test.ts` (6, real Postgres: SQL/TS mirror, admin without seat, progress-only, dependencies, publish, view_schedules revoked, reassign keeps count/rank/subscription, owner-only grants), `tests/pm-permissions.test.ts`, `tests/pm-reassign-route.test.ts`, route tests for schedule save, updates and internal reports; `scripts/schedule/permissions-walk.mjs` 30 browser checks with screenshots.

## Phase 10: owner analytics and final regression

- **Revenue → By product** splits list-price MRR into core subscriptions, the $4.99/mo scheduling add-on and $1.99/mo Enterprise editors beyond the included one, plus total recurring revenue. The headline MRR now includes add-ons, and the total always equals it. Each Stripe subscription is one row whose items are counted once, so nothing is double counted. Annual plans count $149 ÷ 12. A removed add-on stops counting right away (it's no longer billed) and is listed as "ending at period end", then counted as ended when `pm_addon_until` passes. Proration, credits, discounts and tax stay out of MRR; collected cash still comes from Stripe. There's no yearly add-on price yet, so add-ons on annual plans show at the monthly rate (labelled).
- **Usage → Premium features**: accounts using the pipeline, bids by stage, internal reports generated, premium report adoption, scheduled projects, customer updates published, scheduling subscriptions and Enterprise editor seats.
  These are counts only. No bid values, estimate amounts or customer details are read, and nothing goes to third-party analytics. Rows are scoped to genuine accounts by the same rule as every other owner page, and "Include test data" adds them back the same way.
- **Report log**: the Internal Estimate Report route writes one row per preview, download or email attachment to `report_generations` (who, action, when). It is server-only: RLS is on with no policies, and users can't read or write it.
- Migration `20261116007000_report_generations.sql` (re-runnable), rollback `docs/pipeline/rollback_20261116007000.sql`. Every new owner query is optional, so the dashboard works before the SQL runs; report counts start once it has.
- Tests: `tests/admin-product.test.ts` (split, totals equal headline, no double counting, ending/ended add-ons, adoption counts, test-data scoping), `tests/db/report-generations.test.ts`, internal report route logging, and `scripts/admin-cc/analytics-walk.mjs` (desktop + 390 px).

### Final regression (brief section 43)

| # | Requirement | Evidence |
|---|---|---|
| 1–9 | Bids pipeline: access, stages, drag-and-drop, mobile ⋮, signatures can't be faked, e-sign authoritative, date filters, no double counting, sales pay doesn't alter bids | `tests/pipeline.test.ts`, `tests/db/sales-pipeline.test.ts`, `tests/db/esign.test.ts`, `scripts/pipeline/walk.mjs` |
| 10–13 | Internal reports: free refused, paid allowed, never in customer PDFs, Enterprise permissions server-side | `tests/internal-report-route.test.ts`, `tests/internal-report.test.tsx`, `tests/pdf.test.tsx`, `scripts/internal-report/walk.mjs` (free + paid) |
| 14–16 | Onboarding / walkthrough / feature registry | `tests/feature-registry.test.ts`, `tests/features-route.test.ts`, `tests/onboarding.test.ts`, `scripts/features/walk.mjs` |
| 17–22 | PM billing: $4.99, 1 included editor, $1.99 extra, licenses still enforced, confirmation, data kept when disabled | `tests/pm-billing.test.ts`, `tests/db/pm-entitlements.test.ts`, `scripts/pm/walk.mjs` |
| 23–30 | Scheduling: approved bids, source references, overlap, line items, drag dates, dependencies, % ≠ elapsed time, delays | `tests/schedule-engine.test.ts`, `tests/schedule-route.test.ts`, `tests/db/project-schedules.test.ts`, `scripts/schedule/walk.mjs` |
| 31–34 | Customer updates: private costs hidden, scope toggles, preview before publish, frozen snapshots | `tests/schedule-report.test.tsx`, `tests/schedule-updates-route.test.ts`, `tests/db/schedule-publications.test.ts`, `scripts/schedule/updates-walk.mjs` |
| 35–37 | View-only can't edit, no cross-company access, reassignment doesn't double bill | `tests/db/pm-permissions.test.ts`, `tests/db/isolation.test.ts`, `tests/pm-reassign-route.test.ts`, `scripts/schedule/permissions-walk.mjs` |
| 38–39 | Complimentary access, Stripe and checkout | `tests/complimentary-access.test.ts`, `tests/db/complimentary-access.test.ts`, `tests/checkout-*.test.ts`, `tests/billing*.test.ts`, `tests/stripe-live-guard.test.ts` |
| 40 | No production deploy or billing change without approval | Every PR merged only after James's SQL + "merge"; scheduling flag still off; no live Stripe prices created |

## Migration and rollback

- Migration: `supabase/migrations/20261116002000_sales_pipeline.sql` (idempotent, tested twice in a row).
  Adds job stages to the stage check, `estimates.won_at` (backfilled for current Won bids), `estimate_stage_history.effective_at`,
  replaces `set_estimate_stage` with a 4-argument version (same permissions, plus transition rules), updates the Command Center summary, adds `sales_pay_settings`.
- **Deploy order**: the app works before the SQL runs (falls back to old columns and shows a "database update pending" note; moves to new stages return a friendly error). Run the SQL, then merge.
- Rollback: `docs/pipeline/rollback_20261116002000.sql`, then re-run `20261114008000_enterprise_pipeline.sql`.

## Tests run for this PR

- `tests/pipeline.test.ts`: 26 unit tests (columns, signature can't be fabricated, illegal moves, next action, no double counting, date ranges, historical analytics, sales pay doesn't alter bids).
- `tests/db/sales-pipeline.test.ts`: 7 tests on real Postgres (job stages need won, won date kept, manual Won creates no signature, signed bids can't go back, direct writes blocked, cross-user blocked, pay settings private, migration re-runnable). Existing `tests/db/enterprise-pipeline.test.ts` and `esign.test.ts` pass.
- `scripts/pipeline/walk.mjs`: 29 browser checks desktop/390/320 (drag-and-drop, Undo, Approved Manually dialog, disabled illegal menu items, refused drop, Schedule Now, keyboard Move To, Lost reason, analytics by period, sales pay, Table view, no horizontal scroll, mobile ⋮ move).
- Full suite: 72 files / 867 tests, typecheck, lint (0 errors), production build.

## Later phases (separate PRs)

| Phase | Scope | Owner approval needed |
|---|---|---|
| 3 | Internal Estimate Report (preview / PDF / Send via My Email), server-side entitlement + Enterprise permission, PDF privacy tests | none (uses existing Unlimited entitlement) |
| 4 | Versioned feature registry, "Your New Features Are Ready" modal, walkthrough, What's New, CI metadata check | none |
| 5 | PM add-on entitlements + Stripe billing in **test mode**: Standard $4.99/mo (1 editor), Enterprise 1 included editor + $1.99/mo per extra editor, previews of charge/proration | **Create 2 live Stripe prices** ($4.99/mo PM add-on, $1.99/mo PM editor seat; annual variants if wanted) and choose removal policy (recommend: end of billing period) |
| 6–7 | Schedule Now wizard, Gantt (no paid dependency), line-item tasks, dependencies, progress, delays with preview | none |
| 8 | Customer update preview, PDF, Send via My Email, secure share link, publication snapshots | none |
| 9 | Enterprise PM permissions and seat assignment | none |
| 10 | Owner analytics: pipeline adoption, PM MRR split, regression run | none |

## Production approval checklist (Phase 10 PR)

1. Run `20261116007000_report_generations.sql` in the Supabase SQL Editor (Phase 9 SQL already applied).
2. Say "merge". Your owner dashboard gains Revenue → By product and Usage → Premium features; customers see nothing new (the scheduling flag stays off).
3. To launch scheduling later: approve the live Stripe prices from Phase 5, set the price env vars and `PM_BILLING_LIVE=true`, mark `project_scheduling` released in the registry, then set `NEXT_PUBLIC_PROJECT_SCHEDULING=on` and redeploy.
