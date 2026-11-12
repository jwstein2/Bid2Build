# Account setup checklist

Prioritized for the owner. Legend: 🔐 human login · 🪪 identity/business verification · 💳 billing setup ·
✋ explicit authorization needed (DNS, production, payments, outreach).
Status: **Complete** (verified), **Incomplete**, **Unverified** (reported done, not checked from here).
Costs are approximate list prices as of late 2026; confirm on each vendor's pricing page.

**Rule for every platform: use business-owned logins (Google Workspace addresses such as
`admin@built2bid.org`), turn on 2-factor authentication, and keep secrets in Netlify environment
variables only, never in chat, docs or Git.** Do not create duplicate accounts: reuse the ones below.

## Order of work

| # | Platform | Action | Flags | Status |
|---|---|---|---|---|
| 1 | Google Workspace | Create `admin@`, `support@`, `no-reply@` (or `hello@`); enable 2SV | 🔐 💳 | Unverified (owner reports configured) |
| 2 | Netlify | Sign in; authorize the Netlify connector for Claude; add a Workspace admin as Owner; confirm domain spelling | 🔐 ✋ | Partial |
| 3 | GitHub | Make `main` the default branch; add a business owner/admin | 🔐 | Incomplete |
| 4 | Supabase | Add Workspace admin as org Owner; decide on Pro plan (backups); add redirect URLs; switch SMTP | 🔐 💳 ✋ | Partial |
| 5 | Rotate leaked secrets | New Anthropic key; revoke personal Gmail app password | 🔐 | Incomplete |
| 6 | Stripe | Create account with business email; verify business; test keys first | 🔐 🪪 💳 ✋ | Not started |
| 7 | Google Search Console | Domain property via DNS TXT | 🔐 ✋ | Not started |
| 8 | Analytics | Choose Plausible or GA4 (decision) | 🔐 💳 | Not started |
| 9 | Error monitoring | Sentry (free tier) | 🔐 | Not started |
| 10 | Transactional/lifecycle email | Choose provider (Resend recommended) | 🔐 | Not started |
| 11 | Outreach domains + mailboxes | Buy 2–3 look-alike domains, mailboxes | 🔐 💳 ✋ | Not started |
| 12 | Instantly | Create workspace with business email; connect outreach mailboxes; warm up | 🔐 💳 ✋ | Not started |
| 13 | Uptime monitoring | Better Stack / UptimeRobot free | 🔐 | Not started |
| 14 | Legal | Attorney review of Privacy/Terms; postal address for outreach | 🔐 💳 | Not started |

---

## 1. Google Workspace — workspace.google.com
* **Account:** existing (owner set it up on built2bid.org).
* **Steps:** Admin console → Users: `admin@built2bid.org` (super admin), `support@` (or a group), `no-reply@` (sending mailbox for sign-in email). Security → 2-Step Verification enforced. Apps → Gmail → Authenticate email → generate DKIM, publish TXT, Start authentication. Add SPF and DMARC (DOMAIN_MIGRATION_CHECKLIST.md §3).
* **Ownership:** business super-admin account, recovery phone/email held by the owner.
* **Permissions:** super admin for DNS/DKIM; the `no-reply@` user needs an app password for SMTP (requires 2SV on that user).
* **Env vars:** `NEXT_PUBLIC_SUPPORT_EMAIL`. SMTP credentials go in the Supabase dashboard, not Netlify.
* **Depends on:** Netlify DNS for MX/SPF/DKIM/DMARC records.
* **Status:** Unverified (MX/DKIM not checked from here).
* **Cost:** Business Starter about $7–8.40 per user/month; aliases and groups are free.

## 2. Netlify — app.netlify.com
* **Account:** existing; site `built2bid` (id `5669aacb-977e-47d7-96a3-b665e3b0d99b`), domain bought here.
* **Steps:** Team settings → Members: invite `admin@built2bid.org` as Owner (so the business, not a personal login, controls hosting and the domain). Domains: confirm `built2bid.org`, auto-renew, registrant details. Authorize Claude's Netlify connector in claude.ai connector settings (lets Claude read deploys/env names and set non-secret variables). Environment variables per ENVIRONMENT_VARIABLE_INVENTORY.md. Domain attach and DNS per DOMAIN_MIGRATION_CHECKLIST.md (✋).
* **Permissions:** Owner for domains/billing; Developer is enough for env vars and deploys.
* **Env vars:** all of them live here.
* **Status:** Partial — site deploys from `main`; domain purchased; not attached; connector not authorized in this session.
* **Cost:** Free plan works for current traffic; Pro about $19/member/month if build minutes, team seats or analytics are needed. Domain renewal about $15–20/year.

## 3. GitHub — github.com/jwstein2/bid2build
* **Account:** existing personal account `jwstein2`. Optional: create a GitHub organization (e.g. `built2bid`) and transfer the repo later; Netlify and the Claude GitHub App must then be re-authorized for the org.
* **Steps:** Settings → General → Default branch → **main** (currently a `claude/…` branch per project notes). Settings → Branches: protect `main` (require PR). Note: Netlify reports the repo as public; make it private unless that is intended (Settings → Danger zone → Change visibility).
* **Permissions:** Claude GitHub App installed on the repo (contents + pull requests).
* **Status:** Incomplete (default branch, visibility decision).
* **Cost:** free.

## 4. Supabase — supabase.com/dashboard, project `asiiqmegvajtuspeumio`
* **Account:** existing org (personal email). Invite `admin@built2bid.org` as Owner.
* **Steps:** Authentication → URL Configuration (redirect URLs, Site URL at switch); Authentication → SMTP (Workspace sender); apply `20261112000500_two_balance_credits.sql` (after PR #3 merge) and `20261112001000_growth_funnel.sql` in SQL Editor; Settings → Billing: **Pro plan recommended before launch** for daily backups (Free has no downloadable backups) and no project pausing.
* **Permissions:** Owner/Admin for billing and auth settings.
* **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
* **Status:** Complete for the current app (auth working, 6 migrations applied); Incomplete for launch (SMTP sender, credits migration, backups, separate preview database).
* **Cost:** Free now; Pro about $25/month per org (+ compute add-ons if needed).

## 5. Rotate secrets that were pasted in chat (do this now)
* Anthropic Console → API keys: create a new key, set it in Netlify `ANTHROPIC_API_KEY` (secret, Production), redeploy, **delete the old key**.
* Personal Google account → Security → App passwords: **revoke** the Gmail app password used for Supabase SMTP once the Workspace sender is in place (or immediately, replacing it with a new one).
* **Status:** Incomplete. **Cost:** none (Anthropic usage observed at about $0.006 per draft; budget cap `AI_MONTHLY_BUDGET_USD`).

## 6. Stripe — dashboard.stripe.com
* **Account:** new. Sign up with `admin@built2bid.org`. 🪪 Business verification (legal name, EIN or SSN, address, bank account) is needed for live payouts, not for test mode.
* **Steps (test mode first):** Developers → API keys: copy the **test** secret key into Netlify `STRIPE_SECRET_KEY` (secret). Run `STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup` (or ask Claude to run it with the key provided through Netlify, not chat) to create the product and $19.99/$149 prices → `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`. Webhook endpoint `https://built2bid.org/api/stripe/webhook` (8 events) → `STRIPE_WEBHOOK_SECRET`. Customer portal: enable cancel + plan switch. Settings → Emails: enable failed-payment and receipt emails. Public business details: website, support email, statement descriptor `BUILT2BID`. ✋ Live: only after the test plan passes, swap to live keys and set `STRIPE_ALLOW_LIVE=true`.
* **Status:** Not started (BLOCKED).
* **Cost:** no monthly fee; about 2.9% + 30¢ per successful US card charge; Billing fee about 0.7% of recurring volume (check current Stripe Billing pricing).

## 7. Google Search Console — search.google.com/search-console
* **Account:** sign in with `admin@built2bid.org`. Domain property `built2bid.org`, verify via TXT in Netlify DNS (✋). Submit sitemap after indexing is enabled.
* **Status:** Not started. **Cost:** free.

## 8. Analytics (decision)
* **Options:** Plausible (privacy-friendly, no cookie banner, about $9/month) or GA4 (free, needs a consent approach for some regions). Not integrated in code yet; Claude can add it once chosen (`NEXT_PUBLIC_ANALYTICS_*` variable, script only on production).
* **Status:** Not started.

## 9. Error monitoring — sentry.io
* **Account:** new, free Developer plan (5k errors/month). Provides `SENTRY_DSN` (public) and an auth token for source maps (secret). Not integrated yet.
* **Status:** Not started. **Cost:** free tier.

## 10. Lifecycle/transactional email provider (decision)
* **Recommendation:** Resend (free up to about 3,000 emails/month), sending from `mail.built2bid.org` with its own SPF/DKIM records (✋ DNS). Optional MailerLite for opt-in nurture sequences (connector available).
* **Env vars (future):** `RESEND_API_KEY` (secret), `EMAIL_FROM`.
* **Status:** Not started.

## 11. Outreach domains and mailboxes
* **Account:** buy through Netlify or another registrar; mailboxes in a separate Google Workspace (or add as secondary domains if allowed). Never send cold email from built2bid.org.
* **Status:** Not started. **Cost:** about $10–15/domain/year + about $7–8/mailbox/month.

## 12. Instantly — instantly.ai
* **Account:** new workspace, sign up with `admin@built2bid.org`. Connect outreach mailboxes, enable warmup ≥ 14 days. API v2 key (scopes `leads:create`, `block_list_entries:create`) → Netlify secret `INSTANTLY_API_KEY`; webhook per INSTANTLY_INTEGRATION_PLAN.md with `INSTANTLY_WEBHOOK_SECRET`; `INSTANTLY_SYNC_ENABLED=true`.
* **Depends on:** growth migration applied; outreach domains warmed; Stripe live for customer suppression.
* **Status:** Not started. ✋ No campaign sends without explicit owner approval. **Cost:** paid plans from roughly $37/month (check current plans; API/webhooks may need a higher tier).

## 13. Uptime monitoring
* Better Stack or UptimeRobot free: monitor `https://built2bid.org/` and `/api/quota` (expect 200/401), alert to `admin@`. **Cost:** free tier.

## 14. Legal
* Attorney review of `/privacy` and `/terms` (mention lead suppression records, AI drafting, market data opt-in). A business postal address (or registered PO box/virtual mailbox) for CAN-SPAM footers. Optional trademark search for "Built2Bid".
