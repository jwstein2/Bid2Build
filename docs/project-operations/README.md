# Project Operations V4.3 + Enterprise Bid Style V4.4

Built into the existing systems (bids, e-signatures, Projects workspace, Team directory, Saved Items,
Enterprise permissions). Nothing was replaced. Every permission is checked in the database (RLS or a
SECURITY DEFINER function); the API routes only add validation and friendly messages.

## What each change does

| # | Change | Where | Database |
|---|---|---|---|
| 1 | Task review notices at planned end or 100%: Confirm Complete, Update Progress, Adjust Schedule, Review Later. Never auto-completes, never goes to the homeowner, uses the project time zone, one notice per task/reason. | Bell in the app header; deep link opens the task | `user_notifications`, `pm_sync_task_reviews`, `my_notifications`, `notification_act` (001000) |
| 2 | Newly Approved → Needs PM Review → Ready to Schedule → Scheduled. Review drawer shows proposal, scope, financials (permissioned), notes, customer, trades, attachments. Reviewer and time recorded. Scheduling refuses unreviewed jobs. | Dashboard, Projects (`#review`), Bids; wizard checkbox | `project_reviews`, `project_review_queue`, `project_mark_reviewed` (001000) |
| 3 | Publishing the active schedule moves the bid to Scheduled, from every entry point (DB trigger). A draft never does. In Progress / Completed are preserved. | Schedule editor "Publish as active schedule", wizard "Save & publish" | trigger `project_schedules_sync_stage` |
| 4 | Dashboard breadcrumb / home control, always the contractor dashboard. | Project detail, wizard, builder, company bid detail, signed proposal, company style, saved customers | — |
| 5 | Live schedule change confirmation: previous and proposed dates, downstream tasks, once per drag; logged; no customer email. API refuses unconfirmed live date changes (409). | Schedule editor | `schedule_save` confirm flag (001000) |
| 6 | Version history (signed versions immutable, re-signatures labeled) + change orders as separate e-signed documents. Contract summary: Original + Approved additions − Approved deductions = Current; pending shown apart. | Builder (Create Change Order next to the proposal controls), Project → Documents | `change_orders`, `change_order_versions`, `change_order_signatures`, `change_order_signing`, `project_proposal_history` (002000) |
| 7 | Trade scope workspace from the approved version; assignee from the Team directory; internal / subcontractor / customer notes kept separate; subcontractor sharing with field selection, preview, versioned updates, revoke. | Project → Trade scope; public `/scope/[token]` | `project_scope_sections`, `project_scope_revisions`, `scope_shares`, `scope_share_versions` (002000) |
| 8 | Photos: mobile multi-upload, caption, date, scope section, labels, optional AI label suggestions (Haiku, off until configured, disclosed), private storage in Built2Bid only. | Project → Photos; Saved customers → Photos | `project_photos`, bucket `project-photos` (003000) — see PHOTOS.md |
| 9 | Subcontractor quotes start on estimate lines (indicator + internal panel), original vs revised, carried into scope; "Update Internal Project Cost" or "Prepare Change Order". Prices never change automatically. Internal Estimate Report (screen + PDF) adds Original vs Subcontractor Bid financials. | Builder line items, Project → Internal costs, Internal report | `subcontractor_quotes`, `subcontractor_quote_revisions`, `project_cost_adjustments` (002000) |
| 10 | Enterprise invite: the new member's business profile starts from the company's (blank fields only, logo copied); they keep their own email. | `/company/join` | — (service role after the DB accepts the invite) |
| V4.4 | Company Settings → Proposal & Bid Style: template, colors, layout, details, grouping; "Allow Team Members to Customize Bid Style" (off by default for new companies); per-element locks; history. Owner has final say (policy permission is owner-only/owner-granted). Bid editor shows the managed notice and Reset to Company Default. Resolution: platform > locks > company > bid (only where allowed) > defaults. Generated versions freeze the resolved style; style never touches prices. | `/company/proposal-style`, Proposal step | `company_proposal_styles`, history, `proposal_style_policy`, `company_proposal_style_save`, `proposal_style_reset` (004000) |

Saved Items (amendment): the form follows trade/category → quantity and unit → unit cost → tax →
markup or bill at cost → save. Frequently used items (counted from the contractor's own estimate rows)
lead the library and the builder picker. Items are copied into estimates, so editing a saved item never
rewrites a finalized estimate (unchanged rule, now tested).

## Rollout
1. In the Supabase SQL Editor run, in order: `20261119001000_project_operations.sql`,
   `20261119002000_project_documents.sql`, `20261119003000_project_photos.sql`,
   `20261119004000_proposal_style_policy.sql`. Each is safe to run more than once.
2. Merge and deploy. Before the SQL runs, each new screen says it turns on after the update; existing
   screens keep working.
3. Optional: `PHOTO_AI_LABELS=on` (needs `ANTHROPIC_API_KEY`; model `PHOTO_AI_MODEL`, default Haiku).
4. Existing companies keep their current proposal behavior until the owner saves a company style.

## Rollback
Revert the PR, then run the rollbacks in reverse order (004000 → 001000). Rollbacks drop only the new
tables/functions; estimates, versions, signatures and schedules are untouched.

## Out of scope (not built)
QuickBooks/accounting, Drive/OneDrive, automatic customer notices, automatic financial updates,
modifying signed proposals, new billing.

## Tests
- `tests/project-operations.test.ts`: style resolver (hierarchy, locks, branding, totals unchanged), contract math, quote comparison, labels, job status, profile inheritance, frequent items, scope share fields, live schedule changes.
- `tests/db/project-operations.test.ts`: real Postgres: permissions, notices idempotency, review queue, change orders (hash computed in DB, internal notes not selectable, immutability), scope sharing, quotes, photos, style policy.
- `tests/schedule-route.test.ts`: draft vs publish, review required before scheduling.
- `scripts/project-operations/walk.mjs`: browser walk against the mock Supabase (21 checks, desktop + 390px).
