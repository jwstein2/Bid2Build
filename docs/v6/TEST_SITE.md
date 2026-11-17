# Test site setup (V6-22)

Goal: a place to click through the whole lifecycle (sign up, bid, sign, pay, staff roles) without live charges or real customer email.

## Recommended setup
1. **Stripe sandbox keys in preview contexts only.** In Stripe (sandbox "Built2Bid L.L.C. sandbox"), open https://dashboard.stripe.com/test/apikeys and copy the test secret key. In Netlify, open https://app.netlify.com/projects/built2bid/configuration/env, edit `STRIPE_SECRET_KEY` and set a different value for **Deploy Previews** and **Branch deploys** (keep Production as it is). Do the same for `STRIPE_WEBHOOK_SECRET` and the `STRIPE_PRICE_*` variables, using the sandbox price IDs. Paste keys in the Netlify dashboard only, never in chat.
2. **Keep the live-charge guard.** `STRIPE_ALLOW_LIVE=true` stays on Production only, so a preview can never charge a live card even if a live key slips in.
3. **Use Stripe test cards** (4242 4242 4242 4242, any future date, any CVC) on a pull request's Deploy Preview.
4. **Customer email stays in test mode.** Customer comms already send only to james@built2bid.org in test mode; keep it on for previews.

## Limits
- Deploy Previews share the production Supabase database. Use clearly fake accounts (`…@built2bid.test`) and delete them after a run; for persona walks, keep using the mock Supabase scripts in `scripts/v6/` and `scripts/ux-audit/`.
- A fully separate staging database (a Supabase branch) costs extra on Pro and needs its own migrations; recommend only if preview testing proves insufficient.
