# Protecting the live site (Nov 2026)

What protects built2bid.org today, what this change adds, and the owner steps that are left.
Companion docs: [MONITORING.md](MONITORING.md) (uptime + Sentry setup).

## Status at a glance

| Area | State | Notes |
| --- | --- | --- |
| Error alerts (Sentry) | **Live** | DSN is in the production bundle; errors only, no PII. Handled errors (checkout, webhook, crons) are forwarded too. |
| Uptime (Better Stack) | **Live** for the home page | Confirm the second monitor on `/api/health` exists (step 1). |
| Health endpoint | **Live** | `GET /api/health` answers 200 when the app and Supabase Auth respond, 503 otherwise. |
| Cron failure alerts | **Code ready** | Every scheduled job pings `CRON_HEARTBEAT_<NAME>` on success. No heartbeat URLs are set yet. |
| Database backups | **On (Supabase Pro)** | Daily, 7 days kept, restorable from the dashboard. Not yet confirmed by eye; no restore drill yet. |
| Backup monitoring | **New in this change** | Daily check + status on Tech Stack & Costs. Needs a token that can read backups. |
| Uploaded files | **Not backed up** | Supabase backups cover the database only, not Storage files (see below). |
| Stripe test key for previews | **Not set** | Previews have the LIVE key, which the live-key guard blocks, so preview checkout can't be tested. This change makes a test key safe to add. |
| Sign-in email from built2bid.org | **Live** | Supabase custom SMTP via Resend, sender `login@built2bid.org`; SPF, DKIM and DMARC pass (verified 2026-11-17). |

## What this change adds

### 1. Daily backup check

- `src/lib/monitoring/backups.ts` reads `GET https://api.supabase.com/v1/projects/{ref}/database/backups` with
  `SUPABASE_MANAGEMENT_TOKEN` (GET only) and works out how old the newest completed backup is.
- `POST /api/cron/backup-check` (Bearer `MONITOR_CRON_SECRET`, falling back to the existing
  `TAX_BANKING_CRON_SECRET`, so no new secret is required) runs it:
  - newest backup under 36 hours old and no failures in 7 days: `200 {"state":"ok"}`;
  - older, missing or failed: logs `monitor.backups` with `logError`, which **opens a Sentry issue** (email), and answers 503;
  - no token: `200 {"state":"not_connected"}`, nothing else happens.
- `netlify/functions/backup-check-cron.mts` calls it every day at 13:41 UTC (about 7:41 AM Central). When the check
  passes it pings `CRON_HEARTBEAT_BACKUP_CHECK`, so a Better Stack heartbeat also alerts if the job stops running.
- **Tech Stack & Costs** (`/admin/costs`, Supabase panel) shows "Database backups: Newest Nh ago", or why it can't read them.

### 2. Stripe test-mode safety for previews

All Netlify contexts (production, deploy previews, branch deploys) use the **same Supabase database**.
`billing_customers` stores one Stripe customer per user, so a real account that tried checkout on a preview with
a test key would get a test-mode customer id that live checkout can't use afterwards.

- `src/lib/billing/test-mode.ts`: on any deployed copy with a `sk_test_`/`rk_test_` key, checkout (Individual and
  Team) is refused with a friendly 403 unless the signed-in email ends in `@built2bid.test` or is listed in
  `STRIPE_TEST_CHECKOUT_EMAILS` (comma-separated). Local development and unit tests are not restricted.
  Live keys are unaffected (`assertModeAllowed` still gates them).
- The Stripe webhook ignores an event whose `livemode` doesn't match the configured key, so a test event can never
  change live data (or the reverse) if a signing secret is ever mixed up.

Test subscriptions still land in the shared database. Mark test accounts **Internal** on `/admin/customers` so they
stay out of revenue reports.

## Owner steps

Netlify environment variables live at https://app.netlify.com/projects/built2bid/configuration/env.
A changed variable takes effect on the next deploy.

### Step 1. Uptime: confirm both monitors and add the backup heartbeat (Better Stack, free)

1. Open https://uptime.betterstack.com/team/monitors and check there are two monitors:
   `https://built2bid.org/` and `https://built2bid.org/api/health`. If the second is missing, click
   **Create monitor**, URL `https://built2bid.org/api/health`, alert by e-mail, **Create monitor**.
2. Open https://uptime.betterstack.com/team/heartbeats, click **Create heartbeat**: name `Daily backup check`,
   expect a heartbeat **every 1 day**, grace period **2 hours**, alert by e-mail. Copy its URL.
3. In Netlify add `CRON_HEARTBEAT_BACKUP_CHECK` = that URL, **Production** only.
4. Optional, same way (free plan has 10 heartbeats): `CRON_HEARTBEAT_COMMS`, `CRON_HEARTBEAT_LIFECYCLE`,
   `CRON_HEARTBEAT_PAYOUTS`, `CRON_HEARTBEAT_TAX_RATES` (hourly jobs: period 1 hour, grace 30 minutes).

### Step 2. Backups: confirm they exist and let the check read them

1. Open https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/database/backups/scheduled.
   You should see one backup per day for the last 7 days. If the list is empty, contact Supabase support.
2. After this change deploys, open https://built2bid.org/admin/costs#monitors. If the Supabase panel says
   "Token can't read backups", create a new token at https://supabase.com/dashboard/account/tokens with read access
   to the project (including database backups), then in Netlify replace the value of `SUPABASE_MANAGEMENT_TOKEN`
   (Production, keep it marked secret) and trigger a deploy.

### Step 3. Restore drill (once now, then every 3 months)

A backup only counts once a restore has worked. Supabase's **Restore to a new project** copies a backup into a
separate project, so production is never touched.

- Cost: the temporary project is billed by the hour for its compute (cents for a one-hour test on the smallest
  size). Delete it straight after. Needs the owner's OK each time.
- Steps: https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/database/backups/restore-to-new-project
  → pick yesterday's backup → smallest compute → create. When it is ready, run the row-count query below in both
  projects' SQL Editors and compare. Counts in the copy should match production as of the backup time.
  Then delete the temporary project (Project settings → General → Delete project).

```sql
select 'auth.users' t, count(*) from auth.users
union all select 'profiles', count(*) from public.profiles
union all select 'estimates', count(*) from public.estimates
union all select 'subscriptions', count(*) from public.subscriptions
union all select 'billing_customers', count(*) from public.billing_customers
union all select 'storage.objects', count(*) from storage.objects
order by 1;
```

Point-in-time recovery (restore to any second) is a paid add-on (about $100/month for 7 days, plus a Small compute
add-on). Not needed at current size; revisit when daily data loss would matter.

### Step 4. Off-site copy (recommended, monthly)

Supabase deletes a project's backups when the project is deleted, and backups don't include uploaded files
(logos, project photos, HR and financial documents). A monthly copy kept outside Supabase covers both:
`supabase db dump` for the database plus a download of the Storage buckets, run from the owner's computer and
saved to a private drive. Never commit a dump to this repository (it is public).

### Step 5. Stripe test key for previews

1. In Stripe, switch to the **Built2Bid L.L.C. sandbox** (account picker, top left) → Developers → API keys →
   create a secret key (or a restricted key with the same permissions as the live one). Copy it.
2. In Netlify edit `STRIPE_SECRET_KEY` → **Use different values for each deploy context**: set **Deploy Previews**,
   **Branch deploys** and **Local development** to the sandbox key. Leave **Production** unchanged.
3. Add `STRIPE_TEST_CHECKOUT_EMAILS` for Deploy Previews + Branch deploys: the test sign-in email(s) allowed to
   check out there (a `+test` alias of your own address works and receives sign-in codes).
4. `STRIPE_PRICE_ENTERPRISE_BASE` and `STRIPE_PRICE_ENTERPRISE_SEAT` are set for **All** contexts with live price
   ids. Change them to Production only (and optionally add sandbox prices for previews), otherwise Team checkout on
   a preview fails with "No such price".
5. Check the sandbox prices match the plan table ($19.99/month, $199/year). The previews use the sandbox prices
   already in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`; if the annual one is still $149, checkout answers
   "pricing mismatch". Create a $199/year price in the sandbox and update the preview value.
6. Webhook (needed for the plan to switch on after a test checkout): preview URLs change per PR, so either
   - point a sandbox webhook at the preview you are testing (`https://deploy-preview-N--built2bid.netlify.app/api/stripe/webhook`), or
   - turn on branch deploys for a `staging` branch and point a permanent sandbox webhook at
     `https://staging--built2bid.netlify.app/api/stripe/webhook`.
   Use the same events as the live webhook, then put that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET` for
   Deploy Previews + Branch deploys.
7. Test with card `4242 4242 4242 4242`, any future date, any CVC.

### Step 6. Email from built2bid.org: what's left

Sign-in codes already come from `login@built2bid.org` through Resend with SPF, DKIM and DMARC passing. Remaining:

- **DMARC to quarantine** around Dec 1–15, 2026 once the aggregate reports at dmarc@ show only Google and Resend:
  change the `_dmarc` TXT to `v=DMARC1; p=quarantine; rua=mailto:dmarc@built2bid.org; adkim=r; aspf=r`. DNS change:
  owner only.
- **Resend free quota** (100/day, 3,000/month) is shared by sign-in codes, founder, lifecycle and customer emails.
  If daily volume nears 100, sign-in codes start failing; Resend Pro is $20/month.
- **Revoke the old Gmail app password** (no longer used for SMTP): https://myaccount.google.com/apppasswords.

## Security note: deploy previews get production secrets

The repository is public, and the deploy-preview context has the production `SUPABASE_SECRET_KEY`, the live Stripe
key and the live webhook secret. Netlify's **Sensitive variable policy** decides whether a pull request from a fork
can build with those values. Check it at Project configuration → Build & deploy → Continuous deployment →
Sensitive variable policy, and keep it on **Require approval** (or make the repository private).
