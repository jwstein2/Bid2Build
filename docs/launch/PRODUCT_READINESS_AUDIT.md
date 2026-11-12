# Product readiness audit

Inspected 2026-11-12. Evidence column says how each claim was checked. "Tested locally" means a
production build run in the cloud container (`npm run build && next start`) with a headless browser;
the container cannot reach `*.netlify.app`, `supabase.co` REST, or Netlify's API, so the live site was
not exercised directly. Database facts come from read-only SQL on Supabase project
`asiiqmegvajtuspeumio` via the Supabase connector.

Legend: **READY** verified functional and deployable · **PARTIAL** implemented, missing tests or a
component · **BLOCKED** needs an external account, credential or owner decision · **NOT IMPLEMENTED**.

## Snapshot

* Stack: Next.js 16.4.6 (App Router, `src/proxy.ts`), React 19.3, Tailwind 4, Supabase (Postgres 17,
  us-east-1), Stripe SDK 23, @react-pdf/renderer, Anthropic SDK. Hosted on Netlify (site `built2bid`).
* Production data today: **1 account, 1 estimate, 0 subscriptions, 0 Stripe customers, 0 Stripe events**.
* Merged PRs: #1 MVP, #2 rebrand, #4 scope/exclusions + AI, #5 market intelligence, #6 sign-in links.
  **Open: PR #3 (starter + monthly credits), draft, not merged, migration not applied.**
* This audit's branch adds: domain portability, preview noindex, HSTS, growth funnel + Instantly hooks,
  admin Sales page, headline change (see PR).

## 1. Features fully working

| Feature | Status | Evidence | Where |
|---|---|---|---|
| Trade catalog (36 trades), trade landing pages | READY | Build prerenders 36 `/bids/[trade]` pages; e2e opens trade picker | `src/lib/trades/catalog.ts`, `src/app/(marketing)/bids/` |
| Anonymous builder (company → project → estimate → scope → proposal) | READY | e2e 14/14 desktop + 14/14 mobile | `src/components/builder/` |
| Calculation engine: quantities, unit cost, markup vs margin, tax, fixed adjustments, Decimal money | READY | `tests/engine.test.ts`, e2e `10 × $40 @ 25% = $500.00` | `src/lib/estimate/engine.ts` |
| Local draft autosave | READY | e2e "draft survives a page refresh" | `src/lib/drafts/local.ts` |
| Proposal preview, customer-visibility toggles (hide costs/markup/notes) | READY | `tests/proposal.test.ts`; e2e preview shows company and customer | `src/lib/proposal/build.ts` |
| PDF rendering | READY (renderer) | `tests/pdf.test.tsx` parses the generated PDF | `src/lib/pdf/` |
| Scope of Work + Exclusions (rules, and AI when key set) | READY | `tests/proposal-text.test.tsx`, `tests/db/proposal-text.test.ts`; AI call logged live in `ai_generations` 2026-11-12 | `src/lib/ai/`, `/api/ai/proposal-text` |
| Passwordless sign-in (link + 6-digit code, cross-device) | READY (live) | Owner signed in on production 2026-11-12 | `src/app/auth/*`, `dialogs.tsx` |
| Save / edit / version history of bids (signed in) | READY (DB) | `save_estimate` RLS tests in `tests/db/isolation.test.ts` | `/api/estimates/*` |
| Finalize + export with atomic quota and idempotent re-download | READY (current model) | `tests/db/quota.test.ts` incl. concurrency | `record_export()` in `20261112000200_functions.sql` |
| Company profile, logo upload (sniffed, SVG sanitized, re-encoded) | READY | `tests/security.test.ts` | `/api/logo`, `src/lib/security/upload.ts` |
| Website branding import with SSRF protection | READY | `tests/security.test.ts` | `src/lib/security/ssrf.ts` |
| Admin area (overview, templates, flags, logs, audit, market intelligence, AI report) | READY | Admin-only (404 otherwise, verified locally: `/admin/sales` anon → 404); audit-logged writes | `src/app/admin/` |
| Market pricing intelligence (opt-in consent, aggregates) | READY | `tests/db/market.test.ts`, `tests/market.test.ts`; 10 tables present, no anon/authenticated grants | `market` schema |
| Account data export and deletion | READY (code) | Routes exist with auth + same-origin | `/api/account/export`, `/api/account/delete` |
| Row-level security and grants | READY | SQL check of every public table (see section 12) | migrations 0100–0400 |
| SEO basics: titles, descriptions, canonical tags, sitemap, robots, JSON-LD (SoftwareApplication, BreadcrumbList), OG/Twitter images, favicon, manifest | READY | Production-context build: canonical `https://built2bid.org/pricing`, 46 sitemap URLs on built2bid.org | `src/app/layout.tsx`, `sitemap.ts`, `robots.ts` |
| Preview environments kept out of search | READY (this branch) | Preview-context build with indexing forced on still serves `Disallow: /`, `X-Robots-Tag: noindex`, meta robots noindex | `src/lib/config/deploy.ts`, `next.config.ts` |
| Privacy and Terms pages | READY as drafts | Pages exist; **not attorney reviewed** | `src/app/(marketing)/privacy`, `/terms` |

## 2. Partially implemented

| Feature | Status | Gap | Where |
|---|---|---|---|
| **Free plan credits as specified** (3 starter, 1 monthly from month two, monthly first, per bid) | PARTIAL | Production enforces the OLD model: 3 finalized exports per **calendar month**, and every new finalized **version** of an edited bid uses another one. The specified model is built and tested in **PR #3** but not merged; its migration `20261112000500_two_balance_credits.sql` is not applied. PR #3 conflicts with merged PR #4 in `builder.tsx`. Marketing copy says "3 free bids a month", which matches today's behavior and must change with PR #3. | PR #3, `record_export()`, `src/lib/site.ts` `plans` |
| Stripe subscriptions | PARTIAL / BLOCKED | Code complete and unit-tested (checkout, portal, signature-verified idempotent webhook, out-of-order safe, live-mode gate) but **no Stripe keys or prices exist**, so checkout returns 503 "Billing is not configured yet". Never run end to end. | `/api/stripe/*`, `src/lib/billing/` |
| Failed payments | PARTIAL | `invoice.payment_failed` refreshes the subscription; `past_due` keeps Unlimited during Stripe's retry window, `unpaid`/`canceled` remove it. No dunning email from the app (Stripe can send its own). | `has_unlimited()` |
| Refunds | PARTIAL | No `charge.refunded` handling. Refund + cancel in Stripe ends access via `customer.subscription.deleted`; a refund without cancel leaves access on. | webhook route |
| Abandoned checkout recovery | NOT IMPLEMENTED | Stripe Checkout supports `after_expiration.recovery` and promotional consent; not enabled. | `/api/stripe/checkout` |
| Funnel analytics | PARTIAL | `analytics_events` only receives `export_succeeded`, `checkout_started`, `subscribed`, and `account_created` (callback flow only; this branch also records it for the implicit flow). `landing_view`, `trade_selected`, `builder_started`, `preview_opened`, `quota_reached` are listed on the admin page but **never emitted**. No GA4/Plausible, no Search Console. | `src/app/admin/page.tsx` |
| Campaign attribution + lead identity | PARTIAL (this branch) | Code ready and tested; needs migration `20261112001000_growth_funnel.sql` applied. Silently inactive until then. | `src/lib/growth/` |
| Instantly integration | PARTIAL / BLOCKED (this branch) | Webhook receiver, suppression and block-list client written from the official docs; **untested** without a workspace; off by default. | `/api/webhooks/instantly`, `src/lib/growth/instantly.ts` |
| Admin Sales dashboard | PARTIAL (this branch) | Works once the growth migration is applied; shows an install hint until then. CAC only when spend is entered in `marketing_costs`. | `/admin/sales` |
| Rate limiting | PARTIAL | In-memory per serverless instance, so limits are approximate on Netlify. | `src/lib/http/api.ts` |
| Transactional email | PARTIAL | Only Supabase Auth emails (sign-in), sent through the owner's personal Gmail SMTP (30/hour). | Supabase dashboard |
| Mobile layouts | PARTIAL | Marketing + builder pass mobile e2e; dashboard line-item cards and dashboard sort/actions have known backlog items. | `docs/ux-audit/AUDIT-FINDINGS.md` §7 |

## 3. Planned but not implemented

* Onboarding, activation, upgrade, retention emails (no email provider in the app).
* Referral program.
* Email capture form for non-signups (newsletter / lead magnet).
* Error monitoring (no Sentry or equivalent; errors are JSON lines in Netlify function logs).
* Uptime monitoring and alerting.
* Licensed material pricing feeds (providers are stubbed and disabled by design; no fake prices).
* Team accounts / multiple users per company (single-user permissions only).
* Content Security Policy (only `X-Frame-Options: DENY` and other basic headers).

## 4. Broken or incomplete

| Item | Severity | Fix |
|---|---|---|
| `scripts/e2e-smoke.mjs` failed after PR #4 added the Scope step | Low (test only) | Fixed on this branch |
| `npm run lint` failed on `scripts/ux-screenshots.cjs` (3 errors) | Low | Fixed on this branch (dev script ignored) |
| Support email shows `support@example.com` unless `NEXT_PUBLIC_SUPPORT_EMAIL` is set | **High before launch** | Set the env var in Netlify (could not confirm current value: Netlify connector not authorized) |
| Funnel events listed on admin overview never fire | Medium | Instrument or remove (see Partial) |
| Credit model differs from the stated business rules | **High** | Rebase, review and merge PR #3 + apply 0500 |

## 5. Dependencies and environment variables

See ENVIRONMENT_VARIABLE_INVENTORY.md. Runtime dependencies are pinned in `package-lock.json`; Node 22 on Netlify.

## 6. Hardcoded URLs and callback addresses

Scan of `src/` for `http(s)://`, `netlify.app`, `localhost`: **no hardcoded deployment URLs**.
* All absolute URLs derive from `site.url` (`src/lib/site.ts`): Stripe `success_url`, `cancel_url`, portal `return_url`, canonical tags, sitemap, robots.
* Sign-in `emailRedirectTo` uses the browser's own origin (`window.location.origin + /auth/callback`), so it follows whichever domain the user is on; each domain must be in Supabase's Redirect URLs.
* Auth route redirects use the request origin.
* `localhost:3000` remains only as the local-development fallback.
* Placeholders: `support@example.com` (env default), `office@example.com` in the homepage sample proposal (intentional demo content).

## 7. Database schema and migrations

| Migration | In repo | Applied to production |
|---|---|---|
| 0100 core_schema, 0200 functions, 0300 storage, 0400 hardening | yes | yes (in migration history) |
| 0600 proposal_text_ai | yes | yes (history) |
| 0900 market_intelligence | yes | yes, via SQL Editor (not in migration history) |
| 0500 two_balance_credits | **PR #3 only** | **no** |
| 1000 growth_funnel | this branch | **no** (paste in SQL Editor; rollback script in `supabase/rollback/`) |

31 public tables + `market` schema (10 tables). Storage buckets `logos` (2 MB, images) and `documents` (20 MB, PDF), both private.

## 8. Authentication

Supabase Auth, passwordless email (implicit-flow links + OTP code). Site URL `https://built2bid.netlify.app`; redirect URLs `/auth/callback`, `/auth/confirm` (per project notes; the dashboard is not readable from here). Custom SMTP = owner's Gmail with an app password, 30 emails/hour. No OAuth providers. Advisor: leaked-password protection off (low relevance: no passwords are used).

## 9. Payments and webhooks

Stripe, test mode intended first. Endpoint `POST /api/stripe/webhook`, events: `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid`, `invoice.payment_failed`. **BLOCKED: no keys, prices, webhook endpoint or portal configuration exist yet.** Prices per business plan: $19.99/month and $149/year (`npm run stripe:setup` creates them idempotently).

## 10. Email and notifications

Supabase Auth email only. No app-sent email. No in-app notifications.

## 11. Analytics and tracking

Internal `analytics_events` (partial, see §2). This branch adds first-touch attribution and the growth funnel. No third-party analytics, no Search Console, no conversion pixels.

## 12. Security and access controls (verified by SQL on production)

* RLS enabled on every public table. `anon` can read only `feature_flags`, `trade_categories`, `trade_templates`. Internal tables (`admin_roles`, `audit_logs`, `stripe_events`, `analytics_events`, logs, AI usage, pricing) have no grants to `anon` or `authenticated`.
* Users can read but not write `subscriptions`, `billing_customers`, `estimate_versions`, `usage_counters`, `usage_events`.
* `record_export`, `apply_subscription_update`, `admin_metrics`, all `market_*` functions: not executable by `anon` or `authenticated`.
* Advisor warnings: `is_admin(uuid)` and `quota_status()` are executable by signed-in users by design (`is_admin` lets any signed-in user ask whether a given user id is an admin: low-risk information disclosure; consider restricting to `auth.uid()`).
* Secrets only in server env; no secret is referenced from client code (`NEXT_PUBLIC_*` hold only URL, publishable key, brand values).

## 13. Deployment and rollback

Netlify builds `main` → production; pull requests → deploy previews. Rollback = publish a previous deploy in Netlify (instant) or `git revert`. Database: migrations are additive; only the growth migration ships a down script. Backups: depends on the Supabase plan (free plan has no downloadable daily backups). See ROLLBACK_AND_RECOVERY_PLAN.md.
