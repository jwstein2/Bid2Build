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

## Production approval checklist (this PR)

1. Run `20261116002000_sales_pipeline.sql` in the Supabase SQL Editor.
2. Review the Netlify deploy preview of this PR.
3. Say "merge" and it goes live (Netlify auto-deploys `main`). No env vars, no Stripe changes.
