# Attribution rules: marketing, sales reps, affiliates and referrals

Growth OS Phase 3. Code: `src/lib/growth/journey.ts`. Tests: `tests/growth-journey.test.ts`, `tests/db/marketing-journey.test.ts`.

## The four records an account can have

| Record | Where | Set when | Changes money? |
|---|---|---|---|
| First touch | `marketing_touches` (earliest), else `leads` first-touch fields | First tagged visit | No |
| Last touch | `marketing_touches`, latest at or before the conversion | Every tagged visit | No |
| Commission owner | `sales_attributions` (sales rep) or `affiliate_referrals` (affiliate), one per account, enforced in the database | Signup through `/s/<code>` or `/a/<code>` (earliest visit wins), or owner assignment | Yes, through the existing Sales Hub / Affiliate Hub ledgers only |
| Referred by | `referrals` (customer "refer a contractor") | Signup with `?ref=` | Yes, one free month to the referrer, through the existing referral code |

Phase 3 reads these records. It never writes commission, referral or payout data, and it doesn't change how commissions are calculated.

## Revenue owner (one per account)

1. If the account has a commission owner, that program owns its revenue (`sales_rep` or `affiliate`).
2. Otherwise the owner is the channel of the **last marketing touch before the first payment**, else the last before signup, else the first touch (lead record), else `direct` / `unknown`.

Revenue is summed **only by owner**. Every account has exactly one owner, so the owner column always adds up to total net revenue. Paid invoices not linked to an account show as "Not matched" and are flagged in data quality.

First-touch and last-touch views show **counts only** (signups, bids, paid and so on). They are influence views. Adding first-touch revenue to last-touch or owner revenue would double count, so the dashboard never shows revenue there.

## Revenue

Revenue means net Stripe revenue per paid live invoice (`mkt_revenue_facts`): the pre-tax amount paid, minus refunds in proportion, and zero after a lost chargeback. Each Stripe invoice id appears once (it's the primary key of `billing_invoice_facts`, and the report de-duplicates again). Complimentary access is never revenue. List-price MRR stays on the existing pages for what it measures (current run rate).

## Costs, never revenue

- **Year-1 (sale month) commission** and the **referral reward** count toward that account's acquisition cost (CAC).
- **Later-year commissions** reduce contribution.
- **Contribution** = net revenue − Stripe fees (estimate: 2.9% + 30¢ per invoice) − commissions after year 1.
- **CAC** by owner = (ad and tool spend for that channel + year-1 commissions + referral rewards) ÷ new paying customers.
- **Payback** = CAC ÷ average monthly contribution.
- **Contribution LTV** = average monthly contribution ÷ monthly customer churn. It's shown only once there are at least 20 paying customers and at least one cancellation.

## Example (from the acceptance test)

A visitor clicks a Google ad, later comes from a Facebook group, signs up, then clicks an outreach email and subscribes:
- First touch: Google Ads. Last touch at signup: Organic Social. Last touch before payment: Email Outreach.
- Revenue owner: Email Outreach, which gets all of the net revenue ($19.99 + $19.99 − $5.00 refund = $34.98).

A second visitor clicks a Google ad, then signs up through a sales rep's link:
- First touch: Google Ads (influence count only). Revenue owner: the sales rep (commission).
- Google Ads gets **no** revenue for this customer. Its commission is a cost, not revenue.

## Precedence questions this settles

- **Sales rep vs affiliate:** unchanged. The database keeps one, and the earlier visit wins.
- **Partner vs marketing:** the partner owns the revenue. Marketing gets influence credit (counts) only.
- **Customer referral and a partner on the same account:** both can apply (a free month and a commission). Both count as costs. Neither counts as revenue.
