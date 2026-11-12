# Rollback and recovery plan

## 1. Bad deploy (most common)

* **Instant:** Netlify → site `built2bid` → Deploys → pick the last good deploy → **Publish deploy**. This serves the old build immediately; it does not touch the database. Then lock publishing (Deploys → "Stop auto publishing") until the fix lands, and unlock after.
* **In Git:** `git revert <merge commit>` on `main` via a PR; Netlify redeploys. Never force-push `main`.
* Environment-variable changes need a redeploy to take effect and to undo; note the previous value (names only in tickets, values stay in Netlify) before changing.

## 2. Database migrations

* All migrations so far are **additive** (new tables, functions, policies). Rolling back the app does not require rolling back the schema: old code ignores new tables.
* `20261112001000_growth_funnel.sql` has a tested down script: `supabase/rollback/20261112001000_growth_funnel_down.sql`. **Export `public.leads` first**: it contains the do-not-contact list.
* `20261112000500_two_balance_credits.sql` (PR #3) is additive and leaves `record_export()` working, so the old app keeps running if the new deploy is rolled back. Write its down script before merging if a rollback path is required (drop `credit_*` tables and functions).
* Before any migration on production: take a backup (below), apply in the SQL Editor inside a transaction where possible (`begin; … commit;`), then run the advisors.
* Never run `supabase/tests/00_stub_supabase.sql` on a real project.

## 3. Domain switch

* If built2bid.org misbehaves after being set as primary: Netlify → Domain management → set `built2bid.netlify.app` back as primary (or remove built2bid.org), set `NEXT_PUBLIC_SITE_URL` back (or delete it so production uses Netlify's `URL`), redeploy, revert Supabase **Site URL**. Redirect URLs for both domains stay listed, so sign-in keeps working during the change.
* DNS records added for email (SPF/DKIM/DMARC) are independent of the website and can stay.
* Stripe webhook: keep a second endpoint on the old URL during the first week if desired (each has its own signing secret; only one can be in `STRIPE_WEBHOOK_SECRET`, so prefer switching once and checking delivery logs).

## 4. Backups and restore

| Plan | What Supabase provides |
|---|---|
| Free (likely current) | No downloadable daily backups. **Take manual dumps.** |
| Pro (recommended before launch) | Daily backups kept 7 days, restorable from the dashboard; Point-in-Time Recovery available as an add-on |

Manual dump (owner's machine, Supabase CLI or `pg_dump`, connection string from Settings → Database, never committed):
`pg_dump "$SUPABASE_DB_URL" --schema=public --schema=market --schema=storage --no-owner -Fc -f built2bid-YYYYMMDD.dump`
Store dumps encrypted (e.g. a private Google Drive folder in the business Workspace). Storage objects (logos, PDFs) are not in a schema dump: PDFs can be regenerated from `estimate_versions` snapshots; logos are small and re-uploadable.

Restore drill (do once before launch): create a scratch project, `pg_restore` the dump, point a local build at it, sign in, open a bid.

## 5. Secrets compromise

Rotate in the vendor dashboard → update Netlify variable → redeploy → revoke old secret. Order of priority: `SUPABASE_SECRET_KEY` (full DB access), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `INSTANTLY_*`, SMTP app password. Review Supabase auth logs and Stripe events for misuse.

## 6. Billing incidents

* Webhook failures: Stripe retries for up to 3 days; failures are stored in `stripe_events.error`. Fix, then use Stripe → Webhooks → resend; processing is idempotent.
* Admin reconcile: `reconcileUser()` in `src/lib/billing/apply.ts` pulls a user's truth from Stripe.
* Emergency stop of payments: unset `STRIPE_SECRET_KEY` (checkout shows "Billing is not configured yet"; existing subscriptions keep their stored state).

## 7. Outreach incidents

Pause all Instantly campaigns (Instantly UI) first; then investigate. Set `INSTANTLY_SYNC_ENABLED=false` to stop the app calling Instantly; the webhook keeps recording opt-outs as long as `INSTANTLY_WEBHOOK_SECRET` is set (keep it set: opt-outs must not be lost).

## 8. Monitoring that triggers this plan (to set up)

Uptime monitor on `/` (alert to `admin@`), Sentry error alerts (not yet integrated), Stripe webhook failure emails (Stripe sends these to the account email), Supabase usage alerts.
