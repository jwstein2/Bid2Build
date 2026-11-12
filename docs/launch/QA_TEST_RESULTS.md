# QA test results

Run 2026-11-12 in the cloud container on branch `claude/project-thread-6xa3uh` (main @ 7fd9ffa + this
branch's changes). Node 22, Next.js 16.4.6, Postgres 16 for DB tests.

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | 0 errors, 5 warnings (pre-existing a11y/nav warnings). Was 3 errors on main (dev script), fixed. |
| Types | `npm run typecheck` | Pass |
| Unit + integration | `npm test` | **216 passed**, 0 failed (18 files, includes DB suites when Postgres is up) |
| Database (RLS, quota, market, AI log, growth) | `npm run test:db` | **60 passed**, 0 failed (5 files). Main alone: 54 passed. |
| Production build, local context | `npm run build` | Pass, 86 static pages |
| Production build, simulated Netlify **deploy-preview** with production flags forced on | `CONTEXT=deploy-preview … npm run build` | Pass; see "Domain portability" |
| Production build, simulated Netlify **production** on built2bid.org | `CONTEXT=production NEXT_PUBLIC_SITE_URL=https://built2bid.org …` | Pass; see "Domain portability" |
| Browser smoke test (anonymous bid flow) | `node scripts/e2e-smoke.mjs` | **28/28 pass** (14 desktop 1440×900, 14 mobile 390×844). Failed on main because PR #4 added a step; script fixed. |

## Browser smoke test checks (desktop and mobile)

home hero headline · primary CTA opens trade selection · first visit opens Company step · Company
step marked done · line item `10 × $40 at 25% markup = $500.00` · Next reaches Scope & exclusions ·
Next reaches Proposal · Back returns to Scope · Back returns to Estimate · draft survives refresh ·
preview shows the contractor's company · preview shows the customer · anonymous download asks for a
free account (no credit used) · no uncaught page errors.

## Domain portability (built from this branch)

| Check | Preview build (`deploy-preview-9--built2bid.netlify.app`, with `NEXT_PUBLIC_SITE_URL=https://built2bid.org` and `NEXT_PUBLIC_ALLOW_INDEXING=true` deliberately set) | Production build (`built2bid.org`, indexing on) |
|---|---|---|
| robots.txt | `Disallow: /` | `Allow: /` with private paths disallowed, `Sitemap: https://built2bid.org/sitemap.xml` |
| `X-Robots-Tag` header | `noindex, nofollow` | absent |
| `<meta name="robots">` | `noindex, nofollow` | absent |
| Canonical | `https://deploy-preview-9--built2bid.netlify.app` | `https://built2bid.org/pricing` on /pricing |
| Sitemap URLs | preview host | 46 URLs on `https://built2bid.org` |
| HSTS | `max-age=31536000` | `max-age=31536000` |

## Endpoint behavior (local production server)

| Request | Expected | Result |
|---|---|---|
| `POST /api/webhooks/instantly` without `INSTANTLY_WEBHOOK_SECRET` configured | 503 | 503 |
| `POST /api/stripe/webhook` without Stripe configured | 503 | 503 |
| `POST /api/stripe/checkout` with `Origin: https://evil.example` | 403 | 403 |
| `GET /admin/sales` anonymous | 404 (admin area not disclosed) | 404 |
| `GET /bids/roofing?utm_source=instantly&utm_campaign=roofers-q1&ic=abc` | sets first-touch `b2b_attr` cookie (HttpOnly, SameSite=Lax, 90 days) | set |

## Database permission checks on PRODUCTION (read-only SQL, 2026-11-12)

`has_table_privilege` / `has_function_privilege` for `anon` and `authenticated` on every public table
and function, plus RLS flag and policy count. Results in PRODUCT_READINESS_AUDIT.md §12. No table is
writable by `anon`; internal tables have no grants; privileged functions are service-role only.
Supabase security advisor: 20 INFO (intended no-policy internal tables), 2 WARN (intended
`is_admin`, `quota_status`), 1 WARN leaked-password protection.

## Regression coverage by area

| Area | Covered by | Result |
|---|---|---|
| Trade estimators / templates | `tests/templates.test.ts`, e2e | Pass |
| Calculation and pricing accuracy, markup and margin | `tests/engine.test.ts`, `tests/pricing.test.ts`, e2e | Pass. **No formula was changed.** |
| Material / labor item types and treatments | `tests/engine.test.ts`, `tests/builder-state.test.ts` | Pass |
| Company profile | `tests/db/isolation.test.ts` | Pass |
| Drafts, saving, editing, versions | `tests/db/isolation.test.ts`, `tests/snapshot.test.ts`, e2e | Pass |
| Proposal preview, visibility toggles | `tests/proposal.test.ts`, e2e | Pass |
| Scope generation, exclusions | `tests/proposal-text.test.tsx`, `tests/db/proposal-text.test.ts` | Pass |
| PDF export | `tests/pdf.test.tsx` | Pass (renderer); live export with Supabase not run from here |
| Authentication | Live owner sign-in 2026-11-12 (project record); `tests/security.test.ts` (redirect safety) | Pass |
| User permissions / isolation | `tests/db/isolation.test.ts`, production grant check | Pass |
| Billing logic | `tests/billing.test.ts` (status mapping, out-of-order events) | Pass; **live Stripe never exercised (no keys)** |
| Credits (current monthly model) | `tests/db/quota.test.ts` incl. concurrency | Pass. **User entitlements were not changed.** |
| Credits (specified starter + monthly model) | PR #3 `tests/db/credits.test.ts`, `tests/db/export-flow.test.ts` | Not run here (PR #3 unmerged) |
| Admin tools | `tests/db/market.test.ts`, `tests/db/proposal-text.test.ts` | Pass |
| Pricing intelligence | `tests/market.test.ts`, `tests/db/market.test.ts` | Pass |
| Growth funnel (new) | `tests/growth.test.ts` (10), `tests/db/growth.test.ts` (6, includes rollback) | Pass |

## Not tested, and why

| Not tested | Reason | Needed to close |
|---|---|---|
| The live sites `built2bid.netlify.app`, `deploy-preview-4--…` | Container network blocks `*.netlify.app`; Netlify connector needs sign-in | Owner authorizes the Netlify connector, or a session on the owner's machine runs `scripts/e2e-smoke.mjs https://built2bid.netlify.app` |
| Signed-in export against production Supabase | No test account credentials; Supabase REST blocked from container | Owner runs one real export after deploy |
| Stripe checkout, renewal, cancel, failed payment, refund, webhook replay | No Stripe account/keys | Stripe test keys, then the test plan in PRODUCTION_LAUNCH_CHECKLIST.md §Billing |
| Production email deliverability from built2bid.org | Sender not configured yet | Workspace SMTP + SPF/DKIM/DMARC, then send-test to Gmail/Outlook |
| Instantly API calls and webhook deliveries | No Instantly workspace | INSTANTLY_INTEGRATION_PLAN.md §Test plan |
