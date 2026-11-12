# Production launch checklist

Do not announce or enable indexing until every **Release gate** is checked. Outreach has its own gate
in INSTANTLY_INTEGRATION_PLAN.md.

## Release gates (status 2026-11-12)

| # | Gate | Status | What closes it |
|---|---|---|---|
| 1 | All critical estimate workflows pass | ✅ PASS locally (216 unit/integration, 60 DB, 28 browser checks) | Re-run smoke against the live domain after the switch |
| 2 | Bid and PDF generation work | 🟡 PARTIAL: renderer tested; signed-in export against production not run from here | Owner exports one real bid on production |
| 3 | Authentication is secure | 🟡 PARTIAL: passwordless, server-verified, RLS; sender is a personal Gmail | Workspace sender + domain auth; rotate Gmail app password |
| 4 | Credit balances behave correctly | ❌ Production runs the old monthly-export model; specified model is in unmerged PR #3 | Rebase + merge PR #3, apply migration 0500, run its tests |
| 5 | Subscription checkout works end to end | ❌ BLOCKED: no Stripe account | Stripe test keys + billing test plan below |
| 6 | Production email delivery verified | ❌ BLOCKED: built2bid.org sender not configured | DNS email auth + Supabase SMTP + inbox tests |
| 7 | Database permissions tested | ✅ PASS (production grants/RLS checked by SQL; isolation tests) | — |
| 8 | Mobile layouts usable | 🟡 PARTIAL: marketing + builder pass at 390px; dashboard backlog items | Fix `docs/ux-audit/AUDIT-FINDINGS.md` §7 items or accept |
| 9 | Monitoring and rollback operational | ❌ Rollback documented; no error/uptime monitoring; no backups on current plan | Sentry + uptime monitor + Supabase Pro or manual dump drill |
| 10 | Production domain and HTTPS verified | ❌ Domain bought, not attached (needs owner approval) | DOMAIN_MIGRATION_CHECKLIST.md §4 + Verify |

## Before launch

### Code and data
- [ ] Merge this branch's PR (domain portability, growth funnel code, headline).
- [ ] Rebase, review and merge PR #3 (credits); apply `20261112000500_two_balance_credits.sql`; update marketing copy ("3 free bids a month" → starter + monthly wording; PR #3 does this).
- [ ] Apply `20261112001000_growth_funnel.sql` in the SQL Editor; run Supabase advisors.
- [ ] Decide preview data isolation: either remove `SUPABASE_SECRET_KEY` from the Deploy-preview context (previews become anonymous-only) or create a second Supabase project for previews (org currently at its free-project limit).
- [ ] GitHub default branch = `main`; branch protection on.

### Configuration
- [ ] `NEXT_PUBLIC_SUPPORT_EMAIL` set to a Workspace address.
- [ ] `NEXT_PUBLIC_SITE_URL` scoped to Production; = `https://built2bid.org` after attach.
- [ ] Rotate `ANTHROPIC_API_KEY`; revoke personal Gmail app password.
- [ ] Supabase redirect URLs include built2bid.org; Site URL switched.

### Billing test plan (Stripe test mode)
- [ ] Monthly checkout with card `4242 4242 4242 4242` → `/settings/billing?checkout=success`, plan shows Unlimited, `subscriptions` row `active`.
- [ ] Annual checkout (second test user).
- [ ] Webhook replay from Stripe dashboard → response "duplicate", no double effects.
- [ ] Renewal: Stripe test clock advance one period → `invoice.paid`, period end moves.
- [ ] Failed payment: card `4000 0000 0000 0341` on renewal → `past_due`, access kept; after retries → `unpaid`/`canceled`, access removed.
- [ ] Cancel in portal (at period end) → access until period end, then removed.
- [ ] Monthly → annual switch in portal → plan updates.
- [ ] Refund + cancel in dashboard → access removed.
- [ ] Free user exhausts credits → upgrade dialog → checkout.

### Email
- [ ] SPF, DKIM, DMARC pass (send to a Gmail account, "Show original").
- [ ] Sign-in email from built2bid.org lands in inbox on Gmail and Outlook.
- [ ] Stripe customer emails enabled (receipts, failed payments).

### Site
- [ ] Privacy and Terms reviewed by counsel; contact email correct.
- [ ] No invented testimonials, metrics or win-rate claims anywhere (current copy checked: none).
- [ ] OG image and favicon render (share a link in a chat app to preview).

### Monitoring
- [ ] Uptime monitor on `/`.
- [ ] Sentry (or equivalent) integrated and a test error received.
- [ ] Backup: Supabase Pro daily backups, or a manual dump + restore drill done.

## Launch day
- [ ] Netlify: built2bid.org primary, HTTPS green, redirects verified (DOMAIN_MIGRATION_CHECKLIST.md §Verify).
- [ ] `NEXT_PUBLIC_ALLOW_INDEXING=true` (Production) → redeploy → robots.txt shows `Allow: /`.
- [ ] Search Console: submit sitemap.
- [ ] Run `node scripts/e2e-smoke.mjs https://built2bid.org` (from a machine that can reach it).
- [ ] Create a fresh account, build, export, upgrade (live mode only after `STRIPE_ALLOW_LIVE=true` was approved), cancel, refund yourself.
- [ ] Watch Netlify function logs and Stripe webhook deliveries for the first hours.

## After launch (first two weeks)
- [ ] Daily: Stripe webhook failures, Supabase advisors, error tracker.
- [ ] DMARC reports clean → move to `p=quarantine`.
- [ ] Instrument the missing funnel events (`landing_view`, `trade_selected`, `builder_started`, `preview_opened`, `quota_reached`) or remove them from the admin page.
- [ ] Shared rate-limit store if traffic grows.
