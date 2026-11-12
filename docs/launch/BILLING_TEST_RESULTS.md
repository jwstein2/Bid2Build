# Billing test results (Stripe test mode)

Run 2026-11-12 against production (`https://built2bid.netlify.app`) with the Stripe sandbox "Built2Bid L.L.C. sandbox".
Subscriptions were driven through the Stripe API with test clocks; entitlement was read from Supabase (`subscriptions`, `has_unlimited()`).

## Stripe objects (test mode)
- Product "Built2Bid Unlimited": `price_1Ub230EFnzA3Z12ajQ2CmdgY` ($19.99/month), `price_1Ub231EFnzA3Z12amVIBs81w` ($149/year)
- Webhook `we_1Ub23EEFnzA3Z12avT446xZO` → `/api/stripe/webhook`, the 8 events in docs/SETUP.md
- Customer Portal config `bpc_1Ub25FEFnzA3Z12a9kuxnoZM` (default): cancel at period end, monthly↔annual switch, card update, invoices

## Results
| Test | Result |
|---|---|
| Signed event with wrong/missing signature | ✅ 400 |
| New monthly and annual subscriptions → `active`, Unlimited on | ✅ |
| Webhook replay of a processed event | ✅ "duplicate", no change |
| Renewal (test clock +1 month) → `invoice.paid`, period end moved a month | ✅ |
| Monthly → annual switch (portal-equivalent update) → plan `annual` | ✅ |
| Cancel at period end → flag set, access kept; after period end → `canceled`, access removed | ✅ |
| Failed renewal (card 4000 0000 0000 0341) → `past_due`, access kept; after retries (≈day 20) → `canceled`, access removed | ✅ |
| Refund + immediate cancel → `canceled`, access removed | ✅ |
| Hosted Checkout in a browser by the owner (card 4242, success redirect, `checkout.session.completed`, plan shows Unlimited Monthly) | ✅ |

## Bug found and fixed
Two events for a brand-new customer arriving together raced on `billing_customers.stripe_customer_id`; one returned 500 until Stripe retried.
Fixed in `supabase/migrations/20261112001100_billing_customer_race.sql` (self-healed via retry in the meantime, no data loss).

## Setup problems found (fixed by owner)
- Netlify visitor access (team login) blocked every request, including Stripe's webhook → turned off; indexing stays disabled.
- `STRIPE_SECRET_KEY` was empty and `STRIPE_WEBHOOK_SECRET` mismatched after the .env import → re-entered and redeployed.

## Test data left behind
Auth users `11111111-b2b0-4000-8000-00000000000{1,2}` (`stripe-test-*@built2bid.test`) and their canceled test subscriptions.
