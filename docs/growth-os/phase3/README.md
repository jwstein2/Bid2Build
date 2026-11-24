# Growth OS Phase 3: marketing measurement infrastructure

Status (2026-11-24): **built, tested on synthetic data, and passed on the staging Supabase project. Not on production.**
James approved the build in the project thread ("Continue with recommended") after the read-only audit
([MEASUREMENT_AUDIT.md](MEASUREMENT_AUDIT.md)). This is a documented exception to phase order: Phases 1 and 2 are still in review.

Related: [ATTRIBUTION_RULES.md](ATTRIBUTION_RULES.md) (how marketing, sales rep, affiliate and referral credit coexist),
[UTM_CONVENTION.md](UTM_CONVENTION.md), rollback [rollback_20270228001000.sql](rollback_20270228001000.sql).

## 1. Implemented

Built on what already existed (first-touch cookie, `leads`, `analytics_events` with event-id dedupe, the signed Stripe
webhook, `billing_invoice_facts`, the Sales Hub and Affiliate Hub ledgers). Nothing was replaced.

| Requirement | How |
|---|---|
| Journey: impression → click → landing → signup → first bid → proposal → activated → paid → retained | Click and landing come from touches (tags, click-id type, landing path). Steps come from existing server events plus net revenue. Impressions need ad platform APIs (Phase 5/9), so they aren't recorded. |
| Conversions by source, campaign, trade, landing page, creative, segment | `breakdown()`, plus a dashboard switch for dimension and model |
| Consistent UTM conventions | `utm-convention.ts` validator and URL builder, a data quality check, and [UTM_CONVENTION.md](UTM_CONVENTION.md) |
| First-touch and last-touch reporting | New `marketing_touches` (every tagged visit). The touch cookie keeps the first touch and the latest five. Last touch is taken before signup and before first payment. |
| Anonymous → authenticated linking where permitted | First-party `b2b_vid` visitor id, linked at sign-in by `mkt_link_visitor` (first account wins, so a shared browser never credits the wrong account). Never set with Global Privacy Control, after the analytics opt-out, or while `MARKETING_TOUCHES` is off (the default). |
| Conversion deduplication | Existing unique `event_id`. Touches get a sha256 `dedupe_key`. Revenue is one row per Stripe invoice id. Webhook replays are tested. |
| Stripe payment reconciliation | `mkt_revenue_facts` view over `billing_invoice_facts` (pre-tax, refunds in proportion, lost chargebacks at zero, live USD only). The dashboard uses net revenue instead of list-price MRR. |
| Cancellation and renewal tracking | New `subscription_cancel_scheduled` event (cancel at period end), plus existing `subscription_renewed` / `subscription_canceled`. Idempotent backfill of `subscription_canceled` for the 4 pre-Nov-17 cancellations, from `subscriptions.ended_at`. |
| Cohort retention | `cohortRetention()`: by first paid month, % still paying at the end of each month |
| CAC, contribution LTV, payback | `unitEconomics()`: CAC includes year-1 commissions and referral rewards. Contribution is net of Stripe fees (estimate) and later commissions. LTV is gated at 20+ paying customers and an observed churn. |
| Data quality monitoring | `dataQuality()`: 11 checks (duplicate invoices, paid without event, unmatched revenue, ended without cancel event, unattributed signups, events without id, two commission owners, commission without revenue, no recent touches, unknown-channel touches, UTM violations) |
| Consent and privacy | Switch off by default. GPC and the analytics opt-out are honoured: the cookies are never set, existing ones are deleted on the next visit, and sign-in won't link them. No email, IP or click-id value is stored. Service-role-only tables with RLS on. Admin-only page. Privacy and cookie policy text drafted (November 24, 2026 revision). |
| Preserve sales rep / affiliate attribution, no double counting | Read-only use of the hub tables. One revenue owner per account (partner first). First/last-touch views carry no revenue. Commissions and rewards are costs. See [ATTRIBUTION_RULES.md](ATTRIBUTION_RULES.md). |
| Dashboard, tested with synthetic data | `/admin/marketing/journey` (Marketing → "Customer journey →", and Tools menu). `?synthetic=1` shows 8 made-up accounts that cover every case. |
| Fix found in audit | Android app referrers: `com.google.android.gm` (Gmail app) was being read as Google **organic search** because the web search rule matched `google.*`. It's now classified as referral (as in GA4). The Google app counts as organic search and social apps as social. |

## 2. Tested

| Suite | Result |
|---|---|
| `tests/growth-journey.test.ts` (new, unit: cookies, consent gates, UTM rules, Android referrers, journey, breakdowns, revenue once, cohorts, CAC/LTV, data quality) | 16 / 16 pass |
| `tests/db/marketing-journey.test.ts` (new, **acceptance**, real Postgres with every migration applied; real proxy, sign-in sync, event recorder and Stripe webhook route with a fake Stripe client) | 7 / 7 pass (incl. opting out later clears the cookies) |
| Related DB suites (growth, growth-activation, ad-conversions, referrals, commission-reconciliation, sales-portal, affiliate-hub, lifecycle-emails, sales-v84-recognition, demo-mode, enterprise-billing) | 93 / 93 pass |
| Full unit suite (`vitest run`, excluding DB) | 2,447 / 2,448 pass. The one failure, `tests/theme.test.ts` (placeholder colour token), also fails on `main` and is unrelated. |
| `tsc --noEmit`, eslint on changed files | Clean |
| Staging Supabase (`staging/run_on_staging.sql` in the SQL editor of built2bid-growth-staging): migration applied, re-run, rolled back, re-applied; touch dedupe, visitor linking (first account wins), revenue view (live paid only, refunds pro rata, lost dispute = $0, net $34.98), new event name and dedupe, service-role-only grants, RLS, synthetic rows removed | 13 / 13 pass |
| `next build` + browser walk of `/admin/marketing/journey?synthetic=1` (desktop 1440 and phone 390, against the local mock Supabase) | 14 / 14 checks pass, no page errors, no horizontal scroll |

The DB suite (full list in `tests/db/`) wasn't run end to end; the suites touching these tables were.

**Acceptance scenario (`tests/db/marketing-journey.test.ts`):**
1. Visitor clicks a Google ad (with a click id, value never stored), refreshes (same visit), comes back from a Facebook group, then makes an internal click (not a touch).
2. Signs up on day 4. Lead and touches are synced, and the second page load writes nothing.
3. Clicks an outreach email on day 5 (last touch before payment).
4. First bid, proposal sent and activation are each recorded twice and stored once.
5. Webhook: checkout completed, invoice paid, the same event redelivered (`duplicate`), the same invoice under a new event id (still one row), renewal invoice, $5 partial refund, scheduled cancellation, cancellation.
6. A second visitor clicks a Google ad, then signs up through a sales rep's link and subscribes.
7. Report: visitor 1 has first touch Google Ads, signup last touch Organic Social, payment last touch Email Outreach, and owner Email Outreach. All steps are reached, with 1 renewal, canceled, and net $34.98. Visitor 2 is owned by the sales rep. Total $54.97 = owners' sum, 3 invoices. The first-touch view shows Google with 2 signups and no revenue. Data quality is all green.
8. Every webhook event is replayed: all are `duplicate`, and the report is unchanged.
9. The migration re-runs cleanly (no duplicate backfill), and rollback then re-apply works.

## 3. Files and systems changed

Repo only (branch `claude/project-thread-7onr0b`, PR #265). **No production database, Stripe, Netlify or ad-platform change.**

- `supabase/migrations/20270228001000_marketing_measurement.sql` (new), `docs/growth-os/phase3/rollback_20270228001000.sql`
- `src/lib/growth/touches.ts`, `touches-server.ts`, `journey.ts`, `journey-server.ts`, `journey-synthetic.ts`, `utm-convention.ts` (new)
- `src/proxy.ts` (touch cookies, cleared on opt-out; first-touch behaviour unchanged), `src/app/(app)/layout.tsx` (sync touches after the page is sent)
- `src/app/api/stripe/webhook/route.ts` (scheduled-cancellation event), `src/lib/growth/events.ts` (event name)
- `src/lib/admin/channels.ts` (Android referrers), `src/app/admin/marketing/journey/page.tsx` (new), links in `src/app/admin/marketing/page.tsx` and `src/components/admin/nav.ts`
- Legal: `src/app/(marketing)/privacy/page.tsx`, `src/app/(marketing)/cookies/page.tsx`, `src/lib/legal/registry.ts` (November 24, 2026 revision)
- Tests: `tests/growth-journey.test.ts`, `tests/db/marketing-journey.test.ts`. Docs in this folder.

Schema boundary agreed with the Phase 4 thread: these objects live in `public`, with no `growth*` names. Growth OS reads them through its own views.

## 4. Permissions and credentials still needed (owner steps, in order)

1. **Staging: done 2026-11-24.** `staging/run_on_staging.sql` (stand-ins + migration, re-run, rollback, re-apply + 13 checks) passed on built2bid-growth-staging in the SQL editor. The migration stays applied there.
2. **Privacy text: drafted on this branch.** The Privacy Policy ("Visit measurement" item, GPC sentence) and Cookie Policy (`b2b_vid` 13 months, `b2b_touch` 90 days, a "Your choices" paragraph) carry a November 24, 2026 revision in `src/lib/legal/registry.ts`. Merging publishes it, so merge with step 4 and change the date if that day differs. Pages sync to Google Drive after deploy. Attorney review is recommended.
3. **Production SQL:** run `20270228001000_marketing_measurement.sql` in the Supabase SQL editor. It's safe to re-run, and the rollback script is in this folder.
4. **Netlify env:** set `MARKETING_TOUCHES=on` (production) and redeploy. Until then, first touch comes from the lead record and everything else works.
5. Optional: add `invoice.voided` and `invoice.marked_uncollectible` to the Stripe webhook endpoint (the code already handles them).
6. Later (Phase 5/9): ad-platform read access for impressions and spend (today spend is entered by hand on the Marketing page), a GA4 Measurement Protocol secret, and Google Consent Mode v2 before any EU/UK traffic or remarketing.

## 5. Risks and unresolved items

- **Live GA4 firing is still unverified** (from the audit). A one-minute browser check is needed.
- **Tiny real data** (13 accounts, 0 with tags). Every rate is a small sample until traffic grows; the dashboard says so.
- Touches only exist after the switch is turned on. Older accounts fall back to the lead record's first touch.
- A shared browser credits touches to the first account that signed in on it. This is deliberate and conservative.
- The Stripe fee is an estimate (2.9% + 30¢), not the actual balance-transaction fee.
- Commissions use the hub tables as they stand; bonuses, accelerators and rewards are rep pay, not per-customer cost, so they're excluded from CAC.
- The rollback deletes touch history (by design) and `subscription_cancel_scheduled` rows.
- Phase order exception: Phases 1 and 2 haven't been signed off yet.

## 6. Operating cost

$0 new. A few small tables and one view in the existing Supabase project (about one row per tagged visit), one extra indexed read per signed-in page load when the switch is on (after the response is sent), and no new services or API calls. No AI calls.

## 7. Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Test visitor followed through simulated signup, bid, subscription and cancellation | **Pass** (`tests/db/marketing-journey.test.ts`) |
| 2 | Correct attribution: first touch, last touch, revenue owner; sales rep preserved | **Pass** |
| 3 | No duplicate revenue reporting (redelivery, same invoice twice, full replay) | **Pass** |
| 4 | Conversions by source, campaign, trade, landing page, creative, segment | **Pass** (unit + dashboard) |
| 5 | UTM convention defined and checked | **Pass** |
| 6 | Anonymous → authenticated linking, only where permitted | **Pass** (GPC, opt-out and switch tested) |
| 7 | Stripe reconciliation: net of refunds and lost disputes | **Pass** |
| 8 | Cancellation (scheduled + ended) and renewal tracking | **Pass** |
| 9 | Cohort retention, CAC, contribution LTV, payback | **Pass** (synthetic). LTV is withheld until 20+ paying customers, by design. |
| 10 | Data quality monitoring | **Pass** (11 checks, tested for green and red) |
| 11 | Sales rep / affiliate attribution untouched; no double-counted commissions or revenue | **Pass** (read-only; commissions are costs) |
| 12 | Dashboard tested with synthetic data before production use | **Pass** (browser walk, desktop and phone) |
| 13 | Staging test against a real Supabase project | **Pass** (database layer, 2026-11-24, built2bid-growth-staging): migration applied, re-run, rolled back and re-applied; 13/13 checks on synthetic rows, which were then removed. Staging has stand-ins for the app tables, and no staging website, so the app code paths were tested locally (row 1). |
| 14 | Live in production | **Not done, by design**: waits for owner steps 2–4 |
