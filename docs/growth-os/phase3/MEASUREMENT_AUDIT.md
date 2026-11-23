# Growth OS Phase 3: measurement infrastructure audit (read-only)

Date: 2026-11-23 · Scope: the audit part of Phase 3 only, run early under an exception James approved.
Implementation waits for Phase 3 approval.

**Method.** Read the code on `main` (commit `39104b5`), ran the existing unit tests for growth,
attribution, referrals, sales, affiliates and reconciliation, and ran **aggregate-only** read queries
against production Supabase (counts, schema and constraints, no rows with personal data). Read the live
Stripe webhook endpoint configuration (read-only). Changed nothing in code, database, Stripe, Netlify or
any ad platform.

**Labels used below.** **Verified** = seen in code, tests or live data. **Unverified** = should be true
from code but not confirmed live. **Assumption** = my reading, needs confirmation.

---

## 1. Summary

Built2Bid already has much more measurement than a typical early SaaS. Phase 3 should **extend it, not
replace it**. The main parts exist and are tested: first-touch UTM capture, server-side funnel events
with deduplication, a signed and idempotent Stripe webhook, renewal and cancellation events, Meta CAPI
built behind consent (switched off), separate sales rep / affiliate / customer referral attribution with
one commission owner per customer, commission reconciliation against Stripe invoices, and an owner
dashboard with channel, campaign, creative, trade, CAC, payback and churn.

The gaps that matter for the Phase 3 acceptance test are:

1. **No last-touch** and no record of touches before signup. Only one first-touch cookie exists.
2. **No anonymous visitor id.** Pre-signup browsing (landing views, signup started) goes only to GA4, so
   it can't be joined to the account in first-party data. The `analytics_events.anon_id` column exists
   but nothing writes it.
3. **Revenue in marketing reports is list-price MRR**, not money Stripe actually collected. Refunds and
   chargebacks reduce commissions (reconciliation) but not marketing revenue.
4. **Marketing attribution and commission ownership aren't shown side by side.** A customer can be
   "Google Ads" in marketing reports and also earn a rep or affiliate commission, and CAC leaves out
   commissions and referral rewards.
5. **No monthly cohort retention table** and no contribution LTV (net of commissions, refunds, Stripe fees).
6. **No tracking-health monitoring** (signups missing attribution, event volume drops, CAPI failures).
7. **Live tag state is unverified.** I couldn't load built2bid.org from this environment, and Netlify
   env var values weren't readable, so it's unconfirmed whether GA4 is actually firing in production.
8. **Real data volume is tiny** (13 accounts in `leads`, 0 with UTM data, 0 marketing spend rows), so all
   Phase 3 testing must use synthetic data, as the prompt requires.

---

## 2. Component by component

### 2.1 Website tags: GTM, GA4, Meta Pixel

| Item | State | Evidence |
|---|---|---|
| Google Tag Manager | **Not used** (verified). GA4 loads directly through gtag.js. | No `GTM-` id anywhere; `src/components/analytics/google-analytics.tsx` |
| GA4 tag | **Built** (verified in code). Loads only on production, indexable deploys with `NEXT_PUBLIC_GA_MEASUREMENT_ID` set, never on token pages (`/sign/`, `/auth/`, `/admin`, ...), never in demo mode, and not after a visitor opts out on `/privacy#analytics`. **Live status unverified.** | `src/lib/seo/analytics.ts`, `src/app/layout.tsx:54` |
| GA4 events | Browser events via `track()`: `landing_view`, `signup_started`, `sign_up`, `proposal_previewed`, `pdf_exported`, `begin_checkout`, `bid_activated`, OTP funnel, calculators, CTAs, offers. Values are cleaned so no personal data goes out. | `src/lib/analytics/track.ts` |
| GA4 server events (Measurement Protocol) | **Missing.** Paid subscriptions, renewals and cancellations never reach GA4 or Google Ads. | `docs/growth/META_GA4_SETUP.md` lists this as a later step |
| Meta Pixel | **Built, off** (verified). Renders only when `NEXT_PUBLIC_META_PIXEL_ID` is set, loads only after the visitor clicks Allow, honours Global Privacy Control. | `src/components/analytics/meta-pixel.tsx` |
| Meta Conversions API | **Built, off** (verified). Queue table `ad_conversions` exists in production with **0 rows**. Sends CompleteRegistration, ActivatedContractor, Subscribe with the same `event_id` as the Pixel so Meta deduplicates. Hashed email and account id only. Retry cron every 10 min. | `src/lib/growth/conversions.ts`, `netlify/functions/conversions-cron.mts` |

Recommendation: keep direct gtag.js; GTM isn't needed and would add a second place where tags can
change without code review. Confirm the live GA4 id with a browser check (one minute for James, or me
through the built-in browser).

### 2.2 Consent and privacy

- **Ad measurement (Meta):** opt-in banner, first-party cookie `b2b_ad_consent`, mirrored to Auth user
  metadata so the server only queues CAPI events for accounts that allowed it. GPC = deny. Verified.
- **GA4:** opt-out only (on the privacy page), not gated by the banner. There's no Google Consent Mode v2.
  That's generally acceptable for US-only traffic, but Consent Mode is needed before EU/UK traffic or
  Google Ads remarketing. (Assumption: Built2Bid targets US contractors only.)
- Privacy and cookie pages already mention the Meta Pixel / Conversions API (verified by file search).
  Attorney review was recommended in the existing docs and I couldn't confirm it happened.
- URLs and cookies never carry email addresses; attribution cookie stores only tags, referrer host,
  click-id **type** (not value), device type. Verified.

### 2.3 Visitor and signup attribution

| Item | State |
|---|---|
| First-touch capture | **Works** (verified). `src/proxy.ts` sets `b2b_attr` (90 days, httpOnly) from UTM / `ic` / `ref` params, ad click id type, or an outside referrer host. Never overwritten. |
| Stored on the account | **Works.** `syncSignedInUser` copies it to `public.leads` (utm_*, landing_path, referrer_host, click_id_type, device_type, first_touch_at) on first signed-in page load. |
| Last-touch | **Missing.** Nothing records the most recent campaign before signup or before payment. |
| Touch history | **Missing.** Visits before signup aren't stored first-party. |
| Anonymous to authenticated linking | **Missing.** No visitor id cookie; `analytics_events.anon_id` exists in the schema but is unused; the GA4 `client_id` isn't stored with the account. |
| Click id values | Only the type is kept. Needed later for offline conversion upload to Google/Meta (Phase 9), with consent. |
| Live data | 13 leads, all linked to accounts; **0 with any UTM tag**; 11 `direct`, 2 with Android app referrers. |

Data quality bug found (verified in live data and code): Android app referrers arrive as package names
(`com.google.android.gm` = Gmail app, `com.google.android.googlequicksearchbox` = Google app). They're
stored as `source` and classified as generic **referral**, when they should be email and organic search.

### 2.4 Product funnel events (first-party)

Table `public.analytics_events`, service role only. Each business event has a unique `event_id`, so
retries, refreshes and webhook redelivery store it once (verified: unique constraint + upsert with
`ignoreDuplicates`). Demo/practice sessions record nothing.

| Phase 3 journey step | Existing event | Live count |
|---|---|---|
| Impression | none (needs ad platform APIs, Phase 5/9) | |
| Click | none first-party (click id type only) | |
| Landing page | `landing_path` on the lead; `landing_view` in GA4 only | |
| Free signup | `account_created` | 13 |
| First bid created | `first_bid_started`, `bid_created` (3+ meaningful items) | 5 / 12 |
| Proposal sent | `proposal_sent` (signing link created); also `export_succeeded` | 5 / 22 |
| Activated user | `bid_activated` (within 7 days of signup) | 3 |
| Paid subscription | `subscribed` (Stripe `checkout.session.completed`) | 2 |
| Retained customer | `subscription_renewed` (paid `subscription_cycle` invoice) | 0 |
| Cancellation | `subscription_canceled` (`customer.subscription.deleted`) | 0 |

Notes:
- 30 events have no `event_id`; they predate the dedupe migration (legacy rows). Verified.
- Live Stripe recorded 4 `customer.subscription.deleted` events (Nov 12–13), all before the cancel event
  existed (migration Nov 17), so they never became `subscription_canceled`. There's no backfill.
- `subscribed` is recorded only from Checkout. Today every subscription starts through Checkout (no
  `subscriptions.create` in code), so that's correct for now but fragile if sales-assisted or admin-created
  subscriptions are added.
- Pre-signup events (`landing_view`, `signup_started`, `checkout_started` partly) aren't joined to the
  visitor in first-party data.

### 2.5 Stripe subscription data

- Webhook `src/app/api/stripe/webhook/route.ts`: signature-verified, live/test mode guard, each event id
  stored once in `stripe_events`, out-of-order safe, re-fetches the subscription. Verified.
- Live endpoint subscribes to: checkout completed, subscription created/updated/deleted/paused/resumed,
  invoice paid / payment failed, charge refunded, dispute created/closed. Verified via Stripe API.
  **Not subscribed:** `invoice.voided`, `invoice.marked_uncollectible` (code handles them; optional).
- Live: 35 Stripe events, **0 unprocessed or errored**. 1 subscription row (canceled).
  Assumption: earlier test subscriptions disappeared with their test accounts (`user_id ... on delete cascade`).
- `billing_invoice_facts` (Stripe invoice evidence, added Nov 22) has 1 row; older invoices aren't
  backfilled, though the daily reconciliation run checks the last 40 days.
- Marketing dashboard revenue = **list-price MRR** from `subscriptions` (documented limit in
  `src/lib/admin/definitions.ts`). Not net of discounts, tax, refunds, disputes or Stripe fees.

### 2.6 Sales rep, affiliate and customer referral attribution (must be preserved)

Three separate programs, each with its own link, cookie and code space (verified in code and docs):

| Program | Link | Cookie | Owner record | Money |
|---|---|---|---|---|
| Sales rep | `/s/<CODE>` → redirects with `utm_source=sales_rep` | `b2b_rep` (90 d, first link wins) | `sales_attributions`, one per account | Commission from paid invoices only |
| Affiliate | `/a/<CODE>` → `utm_source=affiliate` | `b2b_aff` (90 d) | affiliate attribution, one per account | Annual commissions, 30-day hold |
| Customer referral | `?ref=<code>` | `b2b_ref` (90 d) | referral record | One free month to the referrer |

- **One commission owner per customer:** sales or affiliate, whichever cookie visit was earlier, under
  a shared advisory lock in the database (`attributionOrder`, `sales_record_attribution`,
  `affiliate_record_attribution`). Verified in code; the DB tests that cover it were not run here.
- Rep attribution window in production settings is **90 days** (verified); `docs/sales-portal/README.md`
  still says default 30. Doc drift only.
- Commission reconciliation (Nov 22) gates payouts on a verified paid Stripe invoice. Verified.
- Live: 0 rows in `sales_attributions`, `affiliate_referrals`, `affiliate_clicks` and `affiliate_commissions`.

**Coexistence issue to design in Phase 3:** marketing first-touch and commission ownership are
independent today. Because `b2b_attr` is never overwritten, a visitor who first came from a Google ad
and later used a rep's link shows as **Google Ads** in marketing reports while the rep earns the
commission. No money is double-paid (commissions come only from the sales/affiliate ledgers), but:
- channel revenue and the commission ledger both "claim" the same customer, so summing channel revenue
  plus partner revenue would double count;
- CAC ignores commissions and referral free months, so it's understated for those customers;
- a customer referral and a rep/affiliate link can both apply to one account (reward + commission).
  Assumption: allowed by policy, but it should be explicit.

Proposed rule (for approval in Phase 3): every account gets exactly one **revenue owner** for reporting
(the commission owner if there is one, else the marketing last-touch channel), plus first-touch and
last-touch marketing **influence** fields that are never summed into revenue. Commissions and referral
rewards are counted as acquisition cost of the account that triggered them.

### 2.7 Internal sales CRM

`/sales/leads` (migration `20270107002000_sales_crm.sql`): pipeline stages (new → paying / lost), activity
log, tasks, one rep per business (domain / phone / name+ZIP dedupe), auto-link to the account when the
lead signs up through the rep's link, auto-move to Paying on first payment, owner import and bulk assign,
weekly lead import agent, do-not-contact suppression list. Separate from the marketing `leads` table
(prospecting + lifecycle stages, Instantly block list). Verified in code and docs.

Gap: the two "leads" tables use different stage names and aren't joined in reporting, so sales-sourced
pipeline doesn't appear in the marketing funnel.

### 2.8 Owner dashboard and unit economics

`/admin/marketing` and the Business Scorecard already show: channel / campaign / landing / creative /
trade / device / plan filters, cohort funnel (signup → first bid → finalized → paid), 7-day activation,
blended and channel CAC (first-touch, manual spend in `marketing_costs`), CAC payback, churn (customer and
revenue), LTV (only once ≥ 20 payers and 6 months of revenue), LTV:CAC. Verified in
`src/lib/admin/model.ts`, `finance.ts`, `definitions.ts`.

Gaps: no monthly cohort retention grid; LTV is gross-margin based, not contribution (doesn't subtract
commissions, refunds, Stripe fees, referral months); spend is manual and empty (0 rows); no
first-vs-last-touch toggle; sample sizes are flagged as small, which is good.

### 2.9 Monitoring and data quality

Existing: Sentry (errors), Better Stack (uptime), admin "issues" list (failed payments, Stripe webhook
errors, unprocessed events, failed emails/PDFs, checkouts with no completion). Verified.

Missing for marketing data: share of new signups with attribution, daily event volume vs baseline,
events missing `event_id`, CAPI queue failures, Stripe subscriptions with no matching `subscribed` event,
paid accounts with no lead row, channel classification of unknown sources.

---

## 3. Existing tests (run 2026-11-23)

`npx vitest run` on 8 files (growth, growth-activation, growth-conversions, growth-reports, referrals,
sales-portal, affiliate-portfolio, commission-reconciliation): **8 files, 76 tests, all passed.**
DB tests (`tests/db/*`, real Postgres) were not run; they need a local Postgres.

## 4. Proposed Phase 3 build (for approval, not started)

Additive, behind flags, synthetic-data tests first:
1. Visitor id cookie (first-party, consent-aware) + `marketing_touches` table (first and last touch,
   all tagged visits) linked to the account at signup; fill `anon_id`.
2. Last-touch on signup and on payment; first/last toggle in reports.
3. Revenue facts from Stripe invoices (net of refunds/disputes) instead of list-price MRR, joined to
   `billing_invoice_facts`; one revenue owner per account (rule in 2.6).
4. Monthly cohort retention, contribution LTV, CAC including commissions and referral rewards, payback.
5. Tracking-health checks added to the existing admin issues list.
6. Fix Android app referrer classification; UTM convention doc + validator reused from `utm-links.ts`.
7. Optional, needs credentials: GA4 Measurement Protocol for paid/renewal/cancel; Consent Mode v2.
8. Synthetic end-to-end test: visitor → signup → bid → subscription → cancellation, asserting attribution
   and that revenue is counted once.

## 5. Phase-end checklist

1. **Implemented:** this audit document only. No code, data or config changes.
2. **Tested:** existing unit tests, 76/76 passed. Live checks were aggregate read-only queries.
3. **Files/systems changed:** `docs/growth-os/phase3/MEASUREMENT_AUDIT.md` (new). Nothing else.
4. **Permissions still needed:** GA4 property read access (or a browser check) to confirm the live tag;
   later, a GA4 Measurement Protocol API secret and Meta dataset/CAPI token if those are switched on.
5. **Risks / unresolved:** live GA4 status unverified; very small real data set; no backfill for
   pre-Nov-17 cancellations; attribution/commission reporting rule needs James's decision.
6. **Operating cost:** none from this audit. The proposed build uses existing Supabase/Netlify; no new
   paid tools.
7. **Acceptance criteria for the audit part:**

| Criterion | Result |
|---|---|
| Website, GTM, GA4, Meta Pixel audited | Pass (live GA4 firing unverified) |
| Server-side events and signup analytics audited | Pass |
| Referral, affiliate and sales rep attribution audited | Pass |
| Stripe subscription data audited | Pass |
| Internal sales CRM audited | Pass |
| What works vs incomplete documented | Pass |
| No production changes, no PII queried | Pass |
| Full Phase 3 acceptance test (synthetic visitor through cancellation) | Not started; waits for Phase 3 approval |
