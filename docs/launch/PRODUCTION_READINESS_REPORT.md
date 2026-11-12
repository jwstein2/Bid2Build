# Production readiness report

**Date:** 2026-11-12 · **Scope:** repository `jwstein2/bid2build` (main @ 7fd9ffa + branch
`claude/project-thread-6xa3uh`), Supabase `asiiqmegvajtuspeumio`, Netlify site `built2bid`.

## Verdict

**Built2Bid cannot go live on built2bid.org today.** The estimating and proposal product itself is in
good shape (every automated and browser test passes, database permissions are sound), but 5 of the 10
release gates are open, and three of those need the owner: payments do not exist yet, the free-credit
rules in production are not the ones the business specified, and the domain, email sender and
monitoring are not set up.

Realistic path: a **soft launch (free plan only, no indexing) is possible within a day** of the owner
attaching the domain, setting the Workspace email sender and merging the credits PR. **Paid launch**
follows once Stripe is created and its test plan passes. **Outreach** is a separate, later gate (domains
plus 2–3 weeks of mailbox warmup).

## Release gates

| # | Gate | Result |
|---|---|---|
| 1 | Critical estimate workflows | **PASS** (local production build) |
| 2 | Bid and PDF generation | PARTIAL: needs one signed-in export on production |
| 3 | Authentication secure | PARTIAL: sound design; personal Gmail sender must move to Workspace |
| 4 | Credit balances correct | **FAIL**: old monthly model live; spec in unmerged PR #3 |
| 5 | Subscription checkout end to end | **BLOCKED**: no Stripe account |
| 6 | Production email delivery | **BLOCKED**: built2bid.org sender not configured |
| 7 | Database permissions | **PASS** (verified on production) |
| 8 | Mobile usable | PARTIAL: marketing + builder pass; dashboard backlog |
| 9 | Monitoring and rollback | **FAIL**: rollback documented; no monitoring or backups |
| 10 | Domain + HTTPS | **BLOCKED**: domain bought, attach needs owner approval |

Outreach gate (INSTANTLY_INTEGRATION_PLAN.md): **not started**.

## Classification summary

| READY | PARTIAL | BLOCKED | NOT IMPLEMENTED |
|---|---|---|---|
| Builder (36 trades), calculation engine, drafts, preview + visibility toggles, PDF renderer, scope/exclusions + AI, sign-in, saving/versions, company profile + logo, website import, admin tools, market intelligence, RLS/grants, SEO basics, preview noindex, domain-portable URLs | Credits per spec (PR #3), Stripe code (untested live), failed-payment/refund handling, funnel analytics, attribution + lead identity (needs migration), Instantly hooks (untested), Sales dashboard (needs migration), rate limiting, transactional email, mobile dashboard | Stripe account/keys, Workspace SMTP + DNS email auth, domain attach, Instantly workspace, Netlify connector access, Supabase backups plan | Lifecycle emails, abandoned-checkout recovery, referral program, email capture, error + uptime monitoring, third-party analytics, CSP, team accounts |

Details with file paths: PRODUCT_READINESS_AUDIT.md. Test evidence: QA_TEST_RESULTS.md.

## What this branch changed (all reversible, no data touched)

* Per-context URLs: previews always use their own URL; production uses `NEXT_PUBLIC_SITE_URL` then Netlify `URL` (`src/lib/config/deploy.ts`, `next.config.ts`, `src/lib/site.ts`).
* Previews can never be indexed (robots, meta, `X-Robots-Tag`), even if production flags are set for all contexts. HSTS on deploys.
* Homepage headline: "Win More Bids. Look More Professional. Get Back to Building." (subhead: turn rough estimates into organized, customer-ready proposals).
* Growth funnel: first-touch attribution cookie, lead identity at sign-in (also fixes the missing `account_created` event for the current sign-in flow), Instantly webhook receiver + block-list client (off until keys), customer suppression and churn from Stripe events, admin Sales page, migration + tested rollback script (not applied).
* Fixed: e2e smoke test (stale since PR #4), lint failure on a dev script.
* No change to calculation formulas, entitlements, existing tables or user data.

## Owner: accounts to create or sign into, in order

1. **Google Workspace** (sign in): create `admin@`, `support@`, `no-reply@built2bid.org`; 2-step verification; generate DKIM.
2. **Netlify** (sign in): authorize Claude's Netlify connector; invite `admin@built2bid.org` as Owner; confirm the domain spelling; set `NEXT_PUBLIC_SUPPORT_EMAIL`; approve the DNS records for email (SPF/DKIM/DMARC).
3. **Anthropic Console + personal Google account** (sign in): rotate the AI key and revoke the Gmail app password that were pasted in chat.
4. **Supabase** (sign in): add redirect URLs, switch SMTP to `no-reply@built2bid.org`, paste the two migrations when asked, decide on Pro ($25/mo) for backups.
5. **GitHub** (sign in): default branch → `main`; decide public vs private.
6. **Stripe** (create, business email; identity verification for live): put **test** keys in Netlify.
7. **Approve the domain attach** in Netlify (production change).
8. **Google Search Console** (sign in with admin@): verify via DNS TXT.
9. **Sentry** and an **uptime monitor** (create, free tiers); choose **analytics** (Plausible or GA4) and a **lifecycle email** provider (Resend recommended).
10. **Outreach domains** (buy 2–3) and **Instantly** (create workspace), then warm up.

## What Claude can configure afterwards

* After step 2 (connector authorized): read deploy status and env var names, set non-secret env vars, trigger deploys, verify the live site.
* After step 4: verify auth settings and migrations with SQL; run advisors.
* After step 6: run `npm run stripe:setup` to create the $19.99/$149 prices (key read from the environment, never chat), configure the portal and webhook documentation, run the full billing test plan in test mode.
* After step 7: verify HTTPS, redirects, canonical tags, robots and sitemap on built2bid.org; run the browser smoke test against production.
* After step 9: integrate Sentry, analytics (production only) and lifecycle emails with opt-in rules.
* After step 10: run the Instantly webhook test plan with the owner's own addresses; prepare (not send) the first campaign for approval.
* Any time: rebase and finish PR #3 (credits), instrument missing funnel events, mobile dashboard fixes, referral program, abandoned-checkout recovery.

## Remaining work for the full acquisition-to-paying-customer system

1. Stripe live (checkout, renewals, failed payments, cancellations verified).
2. Credits per spec (PR #3) so the free → paid upgrade moment matches the business model.
3. Growth migration applied; Instantly connected and webhook-tested.
4. Lifecycle email: welcome, first-proposal nudge, credits-low/upgrade, abandoned checkout, win-back, all with opt-in and unsubscribe.
5. Funnel instrumentation (landing → builder → preview → export → checkout) and analytics/Search Console.
6. Suppression sync: remove signed-up users from active cold campaigns (customers are already block-listed on payment).
7. Referral codes + Stripe coupon.
8. Marketing spend entered in `marketing_costs` to make cost-per-signup meaningful; ROI only once revenue is collected.
