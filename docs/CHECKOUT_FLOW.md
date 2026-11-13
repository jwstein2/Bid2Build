# Subscription checkout flow

## The bug that was fixed

Signed-out visitors who clicked **Choose Monthly** or **Choose Annual** were sent to
`/login?next=/pricing?upgrade=<plan>`. After the email code was verified the login page did return them to
`/pricing?upgrade=monthly`, but nothing on the pricing page read the `upgrade` parameter. The page just
rendered again, so the contractor had to click the plan a second time. Sign-in from the email link had the
same problem because it returned to the same URL.

## How it works now

```
Pricing page ─ Choose Monthly / Choose Annual
   │  saveIntent(plan)          localStorage "b2b.checkoutIntent" {plan, id, createdAt, status, email}
   ├─ signed in ──────────────► POST /api/stripe/checkout {plan, attempt} ─► Stripe Checkout
   └─ signed out ─► verification modal ("You're almost there!", plan summary, monthly/annual switch)
                      │  email code ─► verifyOtp ─► same POST ─► Stripe Checkout (no second click)
                      └─ email link ─► /auth/callback?next=/pricing?resume=<plan> ─► page resumes automatically
Stripe ─ success ─► /settings/billing?checkout=success&plan=… (confirming state until Stripe confirms)
       └ cancel ──► /pricing?checkout=cancelled&plan=… (banner: selection saved, "Continue to secure checkout")
```

- **Client sends only a plan id.** The server maps `monthly`/`annual` to `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL`
  and checks the Stripe price's amount, currency and interval against `src/lib/billing/plans.ts` before opening
  Checkout. A mismatch refuses checkout and logs `pricing_mismatch`, so the page can never advertise one price
  while Stripe charges another.
- **No duplicate subscriptions.** The endpoint refuses if `has_unlimited` is true or if Stripe shows any
  active/trialing/past_due/unpaid/paused subscription (and records it, which covers a delayed webhook). It keeps at most one open
  Checkout session per customer: it reuses an open session for the same plan, expires sessions for the other plan,
  and after creating a session, concurrent requests all keep the same one (oldest wins). Session creation also
  uses a Stripe idempotency key per client attempt.
- **Client-side duplicate guard.** One request per tab at a time, plus a short cross-tab lock in localStorage.
  One-shot URL params (`resume`, `checkout=cancelled`) are stripped once read, so Back and refresh never trigger
  a second automatic redirect.
- **Entitlements stay webhook-driven.** The success page only reconciles from Stripe's own subscription state
  and polls for up to about 30 seconds. Unlimited never turns on because of the redirect alone.

## Recovery paths

| Situation | What the contractor sees |
|---|---|
| Wrong or expired code | "That code is incorrect or has expired…", plan kept, **Resend code** (60 s cooldown) |
| Refresh while verifying | Modal reopens at the code step with the same plan and email |
| Closes the modal | Banner: "Your Unlimited Monthly selection is saved." + **Continue to secure checkout** |
| Network failure / Stripe error | "Checkout didn't open" with the plan, error, **Continue to secure checkout** |
| Already subscribed | Sent to Subscription settings with "You already have Unlimited, so we didn't start a new checkout" |
| Cancels at Stripe | "Checkout was cancelled. You have not been charged." + saved plan + Continue (no auto-redirect) |
| Back button from Stripe | "You haven't finished checking out." + Continue (no auto-redirect) |
| Selection older than 1 hour | "Your earlier plan selection expired." + Continue / choose again |
| Two tabs or duplicate callbacks | One checkout request; the other tab is told checkout is opening elsewhere |
| Signed in as a different email than verified | Shows both emails; Continue as current account or Sign out |
| Webhook delayed | "Confirming your Unlimited Annual payment…" auto-refresh, still Free until Stripe confirms |

## Pricing copy

All prices come from `src/lib/billing/plans.ts` (the `plans.*` labels in `src/lib/site.ts` derive from it).
Live Stripe prices were read on 2026-11-13: monthly 1999 USD cents / month, annual 14900 USD cents / year,
both on the same product.

- Monthly: **$19.99/month**, "Billed monthly. Cancel anytime."
- Annual: **$149/year**, "Billed annually", "Equivalent to $12.42/month. Save approximately 38% compared with monthly billing."
  (149 / 12 = 12.4167 → $12.42; (12 × 19.99 − 149) / (12 × 19.99) = 37.9% → about 38%.)

## Tests

- `tests/checkout-flow.test.ts`: price math, Stripe price verification, intent storage/expiry/tampering, cross-tab lock, session reuse/convergence.
- `tests/checkout-route.test.ts`: the endpoint against a fake Stripe (plan → price mapping, ignored client prices, auth, existing subscribers incl. delayed webhook, session reuse, plan switch, price mismatch).
- `scripts/checkout-e2e/run.mjs`: 19 browser scenarios incl. 320/375/390/430 px. Run against `next start` built with the mock Supabase (`scripts/ux-audit/mock-supabase.mjs`, which accepts code `123456`). Stripe is intercepted in the browser and never contacted.
