# First-bid activation (growth PR 1)

## What contractors see

- **No bids yet:** the dashboard opens with "Welcome to Built2Bid. Let's get your first estimate
  started." and one question, *What type of work are you bidding?* Eleven trade chips (decks, general
  contracting, painting, roofing, concrete, kitchens, bathrooms, flooring, electrical, siding, drywall)
  open `/start/<trade>`, which drops them into the existing builder (Company → Customer & project →
  Estimate → Scope → Proposal → Preview & download). Nothing is asked up front.
- **Has a bid, hasn't delivered one:** a small, dismissible "Get your first bid out the door"
  checklist: company name, first project, 3+ priced line items, proposal previewed, downloaded or sent.
  Each step is computed on the server from what the account actually did; the next step has one link.
  Hiding it is stored on the account (Auth `user_metadata.b2b_checklist_dismissed_at`), so it never comes back.
- **Existing customers** who already delivered a bid and have a company name see nothing new.
- The welcome video/tour is unchanged and still replayable from Help.

Code: `src/lib/growth/activation.ts`, `src/components/growth/`, `src/app/(app)/dashboard/page.tsx`,
`src/app/api/account/checklist/route.ts`.

## Definitions

| Metric | Rule | Status |
|---|---|---|
| Activated business | Finalized (exported) at least one bid, any time | **Unchanged**; KPI relabeled "Activated (finalized a bid)" |
| 7-day activation | Within 7 days of signup: saved an estimate with ≥ 3 meaningful line items, OR finalized a bid, OR sent one for signature | New, shown beside it |

Meaningful line item: named, quantity > 0, unit cost > 0; example rows never count. Test, internal and
demo accounts are excluded by default (owner toggle adds them back). "Matured cohort" divides only by
accounts whose 7-day window has closed.

History: estimates saved before the `bid_created` event existed use their last-updated time as the
"reached 3 items" time, which can only under-count early activation.

## Tests

- `tests/growth-activation.test.ts` (rules, checklist)
- `tests/db/growth-activation.test.ts` (migration: event names, idempotency, report function, RLS)
- `scripts/growth/activation-walk.mjs` (browser, desktop + 390px: new / partial / existing / dismiss)
