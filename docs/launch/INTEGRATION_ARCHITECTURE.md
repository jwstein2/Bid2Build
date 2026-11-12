# Integration architecture

```
 Browser ──HTTPS──▶ Netlify (Next.js on built2bid.org)
   │  public: NEXT_PUBLIC_* only            │ server routes hold all secrets
   │                                        ├──▶ Supabase Auth  (passwordless email)
   │  Supabase JS (publishable key, RLS) ──▶├──▶ Supabase Postgres (RLS; service role in server only)
   │                                        ├──▶ Supabase Storage (private logos, PDFs; signed URLs)
   │                                        ├──▶ Stripe API (Checkout, Portal)   ◀── Stripe webhooks (signed)
   │                                        ├──▶ Anthropic API (scope/exclusions drafting, optional)
   │                                        └──▶ Instantly API v2 (block list)  ◀── Instantly webhooks (secret header)
 Supabase Auth ──SMTP──▶ Google Workspace (no-reply@built2bid.org) ──▶ user inbox
```

Trust boundaries: the browser never receives a secret; every state-changing API route checks
`auth.getUser()` server-side, same-origin, input schema (zod) and a rate limit; entitlements change only
inside `SECURITY DEFINER` SQL functions called by the server or from signature-verified webhooks.

## 1. Contractor signup

1. Visitor builds a bid anonymously (stored in the browser).
2. On first save/download: email → `signInWithOtp` (link + 6-digit code). `emailRedirectTo` = current origin + `/auth/callback`.
3. Link → `/auth/callback` (PKCE code) or `/auth/finish` (implicit fragment) → session cookie.
4. Trigger `handle_new_user` creates `profiles` row. Marketing opt-in only if ticked.
5. First signed-in page: `syncSignedInUser()` links/creates the lead with first-touch attribution and records `account_created` (needs growth migration).

Requires: Supabase Redirect URLs for each domain; working SMTP.

## 2. Free credits: 3 starter + 1 monthly from month two (PR #3, not merged)

Server-side and atomic in Postgres (`20261112000500_two_balance_credits.sql`):
* `credit_accounts` (one per user, `cycle_anchor` = signup time), `credit_ledger` (append-only), `starter_credit_claims` (email hash, so delete-and-re-signup does not re-grant).
* Starter: 3, granted once when the email is verified, never expire.
* Monthly: cycle n starts at signup + n months (UTC); from cycle 1 (month two) one credit, max 1, expires at cycle end, no rollover.
* Spend order: monthly first, then starter. Charged once per bid, when its **first** finalized version is created. Edits, re-finalizing, re-downloads and drafts are free.
* Hard guarantees by unique indexes: one starter grant per user, one charge per bid, one monthly spend per cycle; row lock serializes concurrent exports.
* Unlimited subscribers: logged as `unlimited_bid`, no balance change.

**Today production runs the older model** (`record_export`: 3 finalized versions per calendar month). Action: rebase PR #3 on main (conflict only in `builder.tsx` step list), review, merge, then paste migration 0500 in the SQL Editor. It is additive and leaves `record_export` in place for the old code until the new deploy is live.

## 3. Unlimited subscription purchase

1. `/pricing` → `POST /api/stripe/checkout {plan}` (auth, verified email, same-origin, rate limit, refuses if already Unlimited).
2. Stripe customer created idempotently (`customer-<user_id>`), stored in `billing_customers`.
3. Checkout Session (subscription mode, `client_reference_id` = user id, `metadata.user_id`), success → `/settings/billing?checkout=success`, cancel → `/pricing?checkout=cancelled` (both from `site.url`).
4. Stripe → `POST /api/stripe/webhook` (raw-body signature check) → dedupe in `stripe_events` → re-fetch subscription → `apply_subscription_update()` (ignores older events) → `subscriptions`.
5. `has_unlimited()` = status active/trialing/past_due and period not ended.
6. Portal: `POST /api/stripe/portal` for cards, invoices, plan switch, cancel.

Prices: $19.99/month, $149/year (`npm run stripe:setup`). Live keys refused unless `STRIPE_ALLOW_LIVE=true`.

## 4. Professional proposal generation

Builder state → `POST /api/estimates/save` (`save_estimate`, RLS) → `POST /api/estimates/[id]/export`: recompute totals server-side, build the customer-safe proposal (costs/markup never included), render PDF, **then** `record_export()` (credit/quota + idempotent version), upload to private `documents/<user_id>/`, return a short-lived signed URL. PDF failures never consume a credit. Optional AI drafting of scope/exclusions via `/api/ai/proposal-text` (no prices or customer contact data sent to the model).

## 5. Customer onboarding email

NOT IMPLEMENTED. Proposed: `src/lib/email/` server module with a provider adapter (Resend/Postmark/SMTP), templates for the welcome and activation emails in CUSTOMER_ACQUISITION_FUNNEL.md, an `email_sends` table with a unique `(user_id, template)` key to prevent duplicates, and a daily scheduled function (Netlify Scheduled Functions) for time-based nudges. Marketing emails only when `profiles.marketing_opt_in` is true; every marketing email carries an unsubscribe link that clears it.

## 6. Instantly lead acquisition

See INSTANTLY_INTEGRATION_PLAN.md. Inbound: Instantly webhooks → `/api/webhooks/instantly` (shared-secret header) → `leads` / `lead_events`. Outbound: block-list customers and opt-outs. Prospect import and campaign sends stay manual in Instantly.

## 7. CRM pipeline tracking

`public.leads` is the pipeline: stages `prospect → contacted → engaged → replied → interested → signed_up → activated → paid → churned` (forward-only, except paid↔churned). `lead_events` is the timeline. `/admin/sales` is the board. If a separate CRM (HubSpot, Pipedrive) is added later, sync from these tables; do not make the CRM the source of truth for entitlements.

## 8. Subscription lifecycle events

| Stripe event | App effect |
|---|---|
| `checkout.session.completed` | link customer, apply subscription, `analytics_events.subscribed`, lead `paid` + suppressed + Instantly block list |
| `customer.subscription.created/updated/paused/resumed` | apply latest state |
| `customer.subscription.deleted` | access ends; lead `churned` |
| `invoice.paid` | renewal recorded via subscription refresh |
| `invoice.payment_failed` | `past_due` (access kept during Stripe retries); enable Stripe's failed-payment emails |
| refunds | not handled automatically; cancel the subscription in Stripe when refunding |

## 9. Retention and upgrade messaging

In-app today: credit/quota card on dashboard and the upgrade dialog when the free allowance is used. Email: see §5 (not built). Rules: no more than one promotional email a week; stop all promotion on opt-out; never message after account deletion.

## OAuth permissions and API scopes (least privilege)

| Integration | Credential | Scope needed |
|---|---|---|
| Supabase | publishable key (browser), secret key (server) | — (RLS + server authorization) |
| Stripe | secret key | Standard key; a restricted key works if it allows Customers write, Checkout Sessions write, Subscriptions read, Billing Portal write, Webhook endpoints not needed |
| Anthropic | API key | Messages |
| Instantly | API v2 key | `leads:create`, `block_list_entries:create` (+ `webhooks:all` only if managing webhooks by API) |
| Google Workspace SMTP | app password of the sending mailbox | Gmail SMTP |
| GitHub (Claude) | Claude GitHub App on `jwstein2/bid2build` | contents, pull requests |
| Netlify (Claude) | Netlify connector OAuth | site read, env vars, deploys |

## Endpoints to register with providers

| Provider | URL |
|---|---|
| Stripe webhook | `https://built2bid.org/api/stripe/webhook` |
| Instantly webhook | `https://built2bid.org/api/webhooks/instantly` (header `x-built2bid-webhook-secret`) |
| Supabase redirect URLs | `https://built2bid.org/auth/callback`, `https://built2bid.org/auth/confirm` (+ netlify.app during transition, preview glob, localhost) |
| Stripe Checkout returns | generated from `site.url`: `/settings/billing?checkout=success`, `/pricing?checkout=cancelled`, portal return `/settings/billing` |
