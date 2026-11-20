# Sales Hub V8: commission policy and P0 stage 1

Owner decisions (James, 2026-11-19) and how the ledger enforces them. Migration
`20270110001000_sales_v8_foundation.sql`, rollback in `supabase/rollback/`.

## The rules (policy version 2)

| # | Rule | Where it's enforced |
|---|------|---------------------|
| 1 | A sale pays one month of the customer's plan at the **monthly list price**, before tax (annual customers count at $19.99, not $199 ÷ 12). | `annual_basis = monthly_list`, `src/lib/sales/basis.ts` |
| 2 | **30-day hold.** Commission waits 30 days after the payment. A refund inside the window cancels it; a refund after that never takes money back. | `refund_policy = hold_30_no_clawback`, `sales_close_month` |
| 3 | Earned commission is paid on the **next month-end statement** after owner approval. | `sales_close_month`, statements |
| 4 | All eligible recurring items count (plan, seats, add-ons). | `value_scope = all_items` |
| 5 | **3 payments total**: the sale month plus two anniversaries. **Superseded 2026-11-20: 10 payments (sale month + 9 anniversaries), see TEN_YEAR_TERM.md.** | `commission_years = 3` (now 10) |
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

## Team goals, milestone boxes, quests (migration 20270111001000)

**Team goal** (every Sales Hub dashboard: rep portal and owner Overview). Counts verified paid sales,
meaning new customers whose first payment landed this month (Central time). Automatic target = 3-month
average + 10%, at least +1 sale, never below the owner's floor (default 5). The owner can set a month's
target with a note or go back to automatic. The board shows progress, days left, per-rep share needed,
pace and the rep's own sales.

**Milestone gift boxes** (James, 2026-11-19), a progressive curve:

| Box | Pays |
|-----|------|
| 10 accounts | flat $25 + "First 10" badge |
| 25 accounts | flat $75 + "25 Club" badge |
| 50 | 3% |
| 100, 150, 200 | 4% |
| 250 and every 50 after | 5% |

* Percentage boxes pay that rate on collected revenue (before tax, net of refunds) from the rep's
  customers that are **still active**, paid since the previous percentage box (the first one covers
  everything since the first sale). Minimum $150. Nothing is counted twice.
* Lifetime accounts count toward milestones even if they cancel later, except first-month cancels and
  fully refunded customers.
* Each box waits out the same 30-day refund hold, then its amount is fixed. The amount reaches the
  browser only when the rep clicks the box. The owner approves it on the Commissions tab, and it becomes
  a `bonus` line on the next month-end statement. Fixed formula, no random cash.
* Rules live on the Policy tab and are part of the versioned policy.
* Revenue is recorded from each paid invoice from now on (`sales_revenue`). Invoices paid before this
  migration aren't in it, so a box for older accounts would undercount revenue (the $150 minimum still
  applies). No rep has sales yet, so nothing needs backfilling today.

**Quests and rank** (no cash). Daily and weekly quests (follow-ups, calls, tasks, demos, paid accounts)
earn XP. Monthly XP sets a Bronze, Silver, Gold, Platinum or Diamond rank that resets on the 1st. Volume
XP is capped, and emails never count.

**Rep onboarding:** `/sales/how-you-get-paid` walks through each stage and shows an illustrative
account-300 example.
