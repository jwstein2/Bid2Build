# Sales Hub: ten-year recurring commission term

Requested by James, 2026-11-20 (Part 2 of the HR / 10-year commissions / Affiliate Hub spec). Migration
`supabase/migrations/20270209001000_sales_ten_year_term.sql`, rollback `docs/sales-portal/rollback_20270209001000.sql`.

## What changed

| Before | After |
| --- | --- |
| `commission_years = 3` (sale month + 2 anniversaries) | `commission_years = 10` (sale month + 9 anniversaries) |
| Term read from the global policy at every payment | Term recorded per customer at first payment (`sales_attributions.commission_term_years`); a later policy change never shortens a term already started |
| No per-customer timeline | `/sales/portfolio`: book summary + 10-year timeline per customer |
| — | Versioned rep amendment (`/sales/amendments`, draft pending counsel) with immutable, text-hashed acceptances; owner sees who accepted under Admin Sales Hub → Policy |

The change is a new commission policy version (note: "Ten-year recurring term"). Every line created before keeps
its version.

## What did not change (verified by tests)

- One month of qualifying subscription value per eligible year. Never paid up front, never 12 monthly payments.
- Monthly-anniversary rule: a commission for year N is created by a paid invoice in the anniversary month; no payment
  in that month makes the year "ineligible" at month-end close (the next year can still qualify).
- Basis: monthly list price basis, every recurring item, before tax. Upgrades and downgrades take effect at the next
  anniversary (`$50 -> $70` means the next anniversary pays `$70`).
- 30-day hold, no clawback after the hold, first-month cancellation, month-end statements, approval and payouts.
- Attribution (90-day window, first rep wins, owner reassignment rules), milestone bonuses (V3), accelerators (off),
  employee vs contractor handling, and what happens after a rep leaves.
- The term starts at the first qualifying paid invoice (`first_paid_month`) and never restarts after an upgrade,
  billing-cycle change, cancellation or reactivation.

## Migration safety

- The migration creates no commission lines and no payouts. Production had 0 attributions on 2026-11-19, and the
  program started in 2026, so no customer has passed year 3 yet: no reconciliation of past years is needed.
- Existing paid attributions (if any by the time it runs) are given the 10-year term; unpaid ones get the term in
  force at their first payment.
- Re-running is a no-op (only moves a 3-year policy; per-customer backfill only fills empty values).

## Open items for James / counsel

1. Amendment text is a DRAFT pending attorney review (marked in the app). Mark it counsel-approved in the database
   (`admin_sales_amendment_legal`) after review; a text change means a new version.
2. The 10-year term applies whether or not a rep has clicked "accept" (it only benefits the rep). Counsel to confirm
   that's fine, or whether acceptance should be a condition.
3. Annual-plan customers who switch their renewal date away from the original anniversary month can miss an
   anniversary under the existing monthly-anniversary rule. That rule was kept as approved; the Affiliate program
   uses a "paid-through coverage" rule instead (see `docs/affiliates/`). Decide whether Sales should match.

## New reps (2026-11-22)

Migration `20270225001000_sales_amendments_existing_reps_only.sql` (rollback `docs/sales-portal/rollback_20270225001000.sql`):
an amendment is only offered to reps whose record existed before the amendment was issued. Reps added later already
join under the ten-year term, so they don't see the "Your commission term is now 10 years" banner, the amendment isn't
listed on `/sales/amendments`, they can't accept it, and the owner's Policy tab doesn't count them as pending.
Acceptances already recorded are unchanged.
