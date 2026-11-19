# Sales Hub V8: commission policy and P0 stage 1

Owner decisions (James, 2026-11-19) and how the ledger enforces them. Migration
`20270110001000_sales_v8_foundation.sql`, rollback in `supabase/rollback/`.

## The rules (policy version 2)

| # | Rule | Where it's enforced |
|---|------|---------------------|
| 1 | A sale pays one month of the customer's plan at the **monthly list price**, before tax (annual customers count at $19.99, not $149 ÷ 12). | `annual_basis = monthly_list`, `src/lib/sales/basis.ts` |
| 2 | **30-day hold.** Commission waits 30 days after the payment. A refund inside the window cancels it; a refund after that never takes money back. | `refund_policy = hold_30_no_clawback`, `sales_close_month` |
| 3 | Earned commission is paid on the **next month-end statement** after owner approval. | `sales_close_month`, statements |
| 4 | All eligible recurring items count (plan, seats, add-ons). | `value_scope = all_items` |
| 5 | **3 payments total**: the sale month plus two anniversaries. | `commission_years = 3` |
| 6 | Upgrades are picked up at the next anniversary (the anniversary uses the then-current monthly value). | anniversary job |
| 7 | An anniversary pays only if the customer is still active and paid that month. | `no_paid_invoice_in_anniversary_month` |
| 8 | A rep's link counts for accounts created within **90 days** of the visit. | `attribution_window_days = 90`, 90-day cookie |
| 9 | Rep tools are paid for by the company. The $20 rep fee stays off. | no fee code exists |
| + | **First-month cancel (addendum):** if the customer cancels within a month of first paying, the rep is not paid for that sale, even without a refund. Lines already approved or paid are flagged for review, never taken back. | `sales_customer_canceled`, Stripe webhook + status trigger |

Version 1 keeps the old rules (month-end clawback, 30-day window). Every change made on the Policy tab
writes a new version with an optional note, and every commission line records the version it was
created under, so changing the rules never rewrites past lines.

## Rep invitations

* The owner clicks **Create invite link** on Sales team. The link (`/sales/invite/<token>`) is shown once,
  works for 14 days, and creating a new one revokes the old one. Only a SHA-256 hash is stored.
* Nothing is emailed: the owner sends the link themselves. Real invites stay the owner's call.
* The invite page shows a welcome, a masked email hint, and the email-code sign-in. Joining still
  requires signing in with the invited, verified email (`sales_me`), which marks the invite accepted.
* Expired, revoked, used and unknown links each get a plain explanation.
* A signed-out visit to any private `/sales` page now goes to `/sales/login?next=…` and returns there
  after sign-in (`src/lib/sales/next.ts`, only `/sales` paths allowed).

## Still disabled

Live payouts, withholding, tax filing, outbound campaigns, the $20 rep fee, and real invites
(the owner creates and sends them by hand).
