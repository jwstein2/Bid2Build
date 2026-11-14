# Enterprise Stripe setup and activation

Enterprise checkout stays **off** until every step below is done. The server checks the live Stripe
prices against `src/lib/enterprise/pricing.ts` before it opens any checkout, and it refuses if they
differ in any way.

## 1. Prices (one product, two monthly prices)

Product: **Built2Bid Enterprise**

| Price | Stripe setup | Env var |
|---|---|---|
| Base | Recurring, monthly, flat **$49.99** | `STRIPE_PRICE_ENTERPRISE_BASE` |
| Additional users | Recurring, monthly, **Graduated** tiers: 1–2 at $19.99, 3–7 at $17.99, 8+ at $15.99, $0 flat fee on every tier | `STRIPE_PRICE_ENTERPRISE_SEAT` |

The quantity of the additional-user price is always `total licensed users − 3`. The three included
users are never charged, and earlier tiers are never discounted retroactively. Expected totals:
3 → $49.99, 4 → $69.98, 5 → $89.97, 6 → $107.96, 10 → $179.92, 25 → $419.77, 50 → $819.52,
100 → $1,619.02, 200 → $3,218.02 (`tests/enterprise-pricing.test.ts`).

## 2. Netlify environment

* `STRIPE_PRICE_ENTERPRISE_BASE` and `STRIPE_PRICE_ENTERPRISE_SEAT` (price ids, not secret).
* `ENTERPRISE_CHECKOUT_LIVE=true` turns Enterprise checkout on with a live key. Set it only after
  the owner approves activation. It is separate from `STRIPE_ALLOW_LIVE`, so Unlimited keeps working
  while Enterprise stays off. With a test key (`sk_test_`), Enterprise turns on as soon as both prices
  are set.

## 3. Webhook

Use the existing endpoint `https://built2bid.org/api/stripe/webhook` with the events it already has.
No new events are needed: Enterprise uses `checkout.session.completed`,
`customer.subscription.*`, `invoice.paid` and `invoice.payment_failed`.

## 4. Database

Run `supabase/migrations/20261114006000_enterprise_billing.sql` (adds the company and seat arguments to
`apply_subscription_update` and adds `company_billing_summary()`).

## When does a seat become billable?

Only when a billing administrator buys it on **Billing & Licenses**, after seeing the new monthly
price and Stripe's exact prorated charge. Inviting someone never buys a seat. An invitation can only
use a seat the company already pays for, and pending invitations hold that seat. Removing licenses can
never go below active users plus pending invitations. Adding seats is invoiced immediately; if the
card is declined, no seats are added. Removing seats credits the next invoice.

## Test-mode checks to run once prices exist

New checkout at 3 and at 5 users; invoice equals the price table; add a seat (proration preview equals
the invoice); remove a seat (credit); declined card (`4000 0000 0000 0341`) leaves seats unchanged and
shows the past-due banner; cancel in the portal (access ends at period end, company data kept); webhook
replays are idempotent.
