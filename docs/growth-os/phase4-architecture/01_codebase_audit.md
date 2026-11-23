# Growth OS Phase 4, Part A: Codebase and platform audit

Status: **read-only audit**, run 2026-11-23 under an exception James authorized (Phase 4 audit may run
before Phase 1 sign-off; nothing may be built). No code, migrations, infrastructure, settings or data
were changed. Measurement and tracking (GTM, GA4, Meta Pixel/CAPI, Stripe and attribution) belong to the
Phase 3 audit, so they appear here only where they overlap with the system architecture.

Labels used below:
- **[Verified]**: read in the repo at `main@39104b5`, or seen in production through read-only SQL and
  metadata calls on 2026-11-23.
- **[Inferred]**: a conclusion drawn from code or docs and not run end to end.
- **[Assumption]**: not checked. It needs confirmation.

This repo is public. Secrets, addresses, email addresses and per-person data are left out on purpose.
Row counts are rounded.

---

## 1. Summary

1. **Built2Bid already has most of the parts of a growth stack, inside the customer app.** It has two
   CRMs, eight scheduled email or outreach automations, a durable email outbox, consent and suppression
   lists, an AI spend guard, admin audit logging and capability-based roles. All of them run inside the
   customer-facing Next.js deploy and share its service-role key. [Verified]
2. **A Growth-OS-style job runner already exists in production, and its source is not in the repo.**
   It is a `marketing` schema with 9 tables, the `mkt-scheduler` Supabase Edge Function and 5 `pg_cron`
   jobs. Together they form a social-post publishing queue for Buffer and the Meta Graph API, with leases,
   idempotency, reconcile, health checks, an approval state and a pause switch. It is currently
   **paused**, in `review` mode, with 0 content items. The Buffer channel shows `needs_reauth`. Health runs
   fire every 15 minutes (about 820 runs since 2026-11-20, mostly channel-health alerts). It was applied
   straight to production (the migrations `marketing_schema` and `marketing_fk_indexes` are dated
   2026-11-19). [Verified] This is the strongest pattern to build on, and it should be brought into the
   repo before anything replaces it.
3. **There is no staging database.** Production, deploy previews and branch deploys all use the one
   Supabase project, and it holds live customer data (`docs/launch/ENVIRONMENT_VARIABLE_INVENTORY.md`,
   `docs/monitoring/PROTECT_LIVE_SITE.md`). There are no Supabase branches. Tests run against a throwaway
   local Postgres with Supabase stubs (`scripts/test-db.sh`). [Verified]
4. **The production database also hosts an unrelated application** (schema `hbb`: 24 tables, the
   `hbb-api` Edge Function and an hourly `pg_cron` job). Built2Bid and that app share the database,
   backups, the service-role key and the cron runtime. [Verified] This is a boundary risk to note, and
   the Growth OS design must not widen it.
5. **Migration history does not match the repo.** `supabase_migrations` lists 15 entries. The repo has
   about 150 migration files, applied by pasting them into the SQL editor (which records no history).
   Schema drift cannot be detected automatically today. [Verified]
6. **Contact-suppression data lives in at least six places** (see §3.6). Any Growth OS agent that
   contacts people needs one combined eligibility check first. [Verified]
7. **One outbound automation is live.** Creator outreach has sending turned on, a 10-per-day cap and
   about 40 emails sent. The other automations are built but switched off (§3.4). Growth OS must not
   message anyone that system already covers. [Verified]

---

## 2. Platform inventory

| Component | What exists | Evidence |
|---|---|---|
| App | Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript, Tailwind 4, zod, decimal.js | `package.json`, `docs/ARCHITECTURE.md` [Verified] |
| Hosting | Netlify site `built2bid` (plan `nf_team_dev`), production at built2bid.org. Previews and branch deploys get their own URLs but **share production env/DB** unless a variable is scoped per context | Netlify API, `netlify.toml` [Verified] |
| Database | Supabase Postgres 17, project `asiiqmegvajtuspeumio`. Schemas: `public` (~407 tables), `market` (10), `marketing` (9), `hbb` (24), `private`, `vault` | read-only catalog queries [Verified] |
| Extensions in use | `pg_cron`, `pg_net`, `supabase_vault`, `pgcrypto`, `pg_trgm`, `uuid-ossp`, `pg_stat_statements`. `pgmq` is available but **not installed** | `list_extensions` [Verified] |
| Edge Functions | `mkt-scheduler` (marketing queue), `hbb-api` (unrelated app). Both `verify_jwt=false` and protected by a shared secret header | `list_edge_functions` [Verified] |
| Scheduling | **Three separate schedulers**: (a) 16 Netlify Scheduled Functions that POST to `/api/cron/*` with a Bearer secret; (b) `pg_cron` (7 jobs: 5 `mkt-*`, 1 location retention, 1 `hbb`); (c) a GitHub Actions cron (`pricing-articles.yml`, Mon/Thu, commits AI-drafted articles to `main`) | `netlify/functions/*.mts`, `cron.job`, `.github/workflows` [Verified] |
| Email | Resend HTTP API for every app-sent email (founder welcome, lifecycle, sales nurture, creator outreach, trial, comms, invites). Supabase Auth mail goes through Google Workspace SMTP. Delivery webhooks arrive at `/api/webhooks/resend` (Svix-signed) and are stored in `email_delivery_events` | `src/lib/email`, `src/lib/comms/svix.ts` [Verified] |
| AI | Anthropic SDK; `ai_generations` cost log; `src/lib/ai/guard.ts` (kill switch, per-user daily limit, daily and monthly company USD ceilings, double-submit lock) | [Verified] |
| Monitoring | Sentry, Better Stack heartbeats (`CRON_HEARTBEAT_<NAME>` pinged by each cron), backup check cron | `docs/monitoring/MONITORING.md` [Verified] |
| CI | CodeQL, npm audit, dependency review, feature-registry check, Android build. **No staging deploy and no DB migration pipeline** | `.github/workflows` [Verified] |
| Tests | Vitest, 211 entries in `tests/` plus `tests/db` (Postgres RLS, quota and billing tests) | [Verified] |

---

## 3. Systems by area

### 3.1 CRM and sales systems

There are **two CRMs with different purposes**. Neither one is wrong, but Growth OS needs to know which
is which.

| | Contractor funnel CRM | Sales Hub CRM |
|---|---|---|
| Tables | `public.leads` (one row per email, first-touch UTM, stage, suppression), `public.lead_events` | `sales_leads`, `sales_activities`, `sales_lead_assignments`, `sales_lead_batches`, `sales_lead_import_rows`, `sales_lead_recycles`, `sales_lead_regions`, `sales_lead_sources`, `sales_tasks`, `sales_bookings`, `sales_calendar_events` and others (~70 `sales_*` tables in total) |
| Stages | `prospect → contacted → engaged → replied → interested → signed_up → activated → paid → churned` (forward-only) | Disposition per activity; assignment and recycle states |
| Who writes | Server code at signup and sign-in (`syncSignedInUser`, `src/lib/growth/leads.ts`), the Stripe webhook (paid/churned), the Instantly webhook | Sales reps and admins in `/sales`, the weekly lead-import agent (`POST /api/sales/leads/import`), the daily `sales-close` cron |
| Size (prod) | ~13 leads, ~16 events, all `signed_up` / `churned`, with no UTM data | ~50 sales leads, ~70 activities and assignments, 3 reps, 15 regions |
| Docs | `docs/launch/INTEGRATION_ARCHITECTURE.md` §7, `docs/growth/README.md` | `docs/sales-portal/*.md` (V8.x) |

Notes:
- `INTEGRATION_ARCHITECTURE.md` says outright: "If a separate CRM is added later, sync from these
  tables; do not make the CRM the source of truth for entitlements." Growth OS should follow that rule.
  [Verified]
- Sales Hub writes go through `SECURITY DEFINER` functions that check capabilities again in SQL (for
  example `sales_lead_ingest` and `admin_*`). These functions are the natural **approved write surface**
  for Growth OS CRM updates. [Verified, code read]
- A third, smaller CRM covers creator partnerships (`creator_prospects`, `creator_outreach_*`), and an
  affiliate prospect list (`affiliate_prospects`) also exists.

### 3.2 Lead assignment

- **Round-robin, least recently assigned** (`rr-lra-1`) under an advisory lock. Eligibility checks that
  the rep is active, signed in, selling, not paused, has no offboarding or time off, and matches the
  territory (states) and trades. Leads with no eligible rep wait in `no_eligible_rep` until the daily
  close job shares them out. Rep-sourced leads stay with that rep. A trigger writes assignment history
  with the method, reason and actor. Reassignment warnings must be confirmed.
  (`docs/sales-portal/V8_6_LEADS.md`, `20270121001000_sales_v86_leads.sql`) [Verified, docs + SQL]
- **Recycling** of stale leads, with disputes (`V8_7_RECYCLING.md`). [Verified, docs]
- Attribution (who earns commission) is kept separate from ownership (who works the lead). Reassigning a
  lead never moves commission. [Verified, docs]
- Growth OS should **never assign leads itself**. It should call the existing allocation path or create
  an approval request for an admin.

### 3.3 Lead acquisition inputs

| Source | Mechanism | State |
|---|---|---|
| Weekly lead import | An external scheduled Claude agent GETs the owner's target, finds licensed contractors and POSTs them to `/api/sales/leads/import` (Bearer `SALES_LEAD_IMPORT_SECRET`). Leads arrive unassigned, each with a Haiku sales brief | Built; depends on an agent running outside the app [Verified, code] |
| CSV or paste import | Admin and rep UI through `sales_lead_ingest` (dedupe by domain, email and phone; possible duplicates held for review) | Built [Verified] |
| Instantly | Inbound webhook `/api/webhooks/instantly` (shared-secret header) into `leads`/`lead_events`; outbound block-list sync behind `INSTANTLY_SYNC_ENABLED` | Built, connection unknown [Assumption] |
| Facebook "comment BID" trial | Meta webhook or ManyChat into `trial_campaign_*` (0 contacts) | Built, ad paused [Verified] |
| Opportunity Radar | `radar_*` tables, admin-only public-bid discovery | Built [Verified, code] |
| Rep links `/s/<code>`, referrals, affiliates, creator gifts | First-touch cookies plus SQL attribution | Built [Verified] |

### 3.4 Follow-up and outbound automations

Every automation follows the same reliable pattern: a Netlify cron POSTs to `/api/cron/<name>` with a
shared Bearer secret, a runner selects the due rows, sends through Resend and records the result. Each
one is **off unless an env var and/or an admin setting turns it on**.

| Automation | Cron | Switch | Prod state (2026-11-23) |
|---|---|---|---|
| Creator outreach (first touch + follow-up) | every 15 min | `creator_outreach_settings.sending_enabled`, daily cap 10, business hours | **Live**: about 40 sent [Verified] |
| Lifecycle emails A–E (onboarding) | daily | `LIFECYCLE_EMAIL_MODE` off/test/live | Some sent (about 8 rows in `email_outbox`) [Verified] |
| Founder welcome (first paid) | on the Stripe webhook plus retries | `FOUNDER_EMAIL_ENABLED` | 1 skipped [Verified] |
| Sales Hub nurture / follow-ups | every 15 min | `sales_nurture_settings` (enabled=false, send_mode=off, templates not approved) + `SALES_NURTURE_DISABLED` | Off [Verified] |
| Trial campaign (Facebook) | every 15 min | trial config | Off / 0 contacts [Verified] |
| Customer communications (contractors' own customers) | every 15 min | `COMM_EMAIL_MODE`, per-company terms, owner emergency stop | A **customer feature**, not marketing. Out of Growth OS scope [Verified] |
| Meta CAPI conversions | every 10 min | `META_CAPI_ENABLED` | 0 queued (Phase 3 scope) [Verified] |
| Affiliates, payouts, sales close, reconcile | daily | various | Operations, not acquisition |

`/api/cron/email-outbox` (founder-welcome retries) has **no scheduler**, and `docs/email/FOUNDER_EMAIL.md`
calls scheduling it optional. [Verified]

### 3.5 Campaign integrations and content tools

| Tool | What it does | State |
|---|---|---|
| `marketing` schema + `mkt-scheduler` | Social publishing queue (Buffer / Meta Page). See §1.2 and §5 | Deployed, paused, Buffer needs reauth, **source not in repo** |
| Pricing articles (GitHub Actions) | Twice a week: Claude Haiku drafts a pricing guide, quality checks run, then it **commits to `main`** and Netlify deploys | Active, depending on whether the workflow is enabled [Inferred] |
| Trade landing pages, `/learn`, `/tools`, calculators | Static and SEO content in the app | Live |
| Industry news, Academy, Academy KB | AI-summarized content with crons and budgets (`NEWS_AI_MONTHLY_BUDGET_USD`) | Customer-facing features |
| Ad briefs | `docs/growth/ADS.md`: concepts, QC checklist, $600/month plan, approval gate. Copy guardrails are tested (no speed, profit or % claims) | Planning only; nothing launched |
| Manual ad spend | `/admin/marketing` with `marketing_costs` (0 rows) | Built |
| Google Ads / Meta Ads APIs | **Not connected**. Setup-state display only | — |
| Connectors available to Claude sessions (not to the app) | MailerLite, n8n, Netlify, Supabase, Stripe, Google Drive | Not audited here (Phase 5) |

### 3.6 Email services, consent and suppression

- **Provider**: Resend for everything the app sends. Keys are server-side only. The Resend webhook is
  Svix-verified. Delivery events are stored. Sales email deliverability checks live in
  `20270204001000_sales_email_deliverability.sql` and `sales_bad_emails`. [Verified]
- **Marketing consent**: `profiles.marketing_opt_in` plus the append-only `marketing_consent_events`
  (`20261123001000_email_consent_and_delivery.sql`). [Verified]
- **Suppression is split across** `leads.suppressed_at` / `unsubscribed_at`, `comm_suppressions`,
  `sales_suppressions`, `sales_bad_emails`, `creator_outreach_suppressions`, the opt-in and consent
  events, and the Instantly block list. Each automation checks only its own lists, plus some shared ones.
  [Verified, tables; Inferred, cross-checks] Growth OS needs one read function, "may we contact this
  address for purpose X", that combines all of them (see Part B §4.9).

### 3.7 Analytics (architecture overlap with Phase 3 only)

- `analytics_events`: service-role only, deduplicated by `event_id`, recorded only after the
  transaction succeeds. About 85 rows (account_created, first_bid_started, bid_created, bid_activated,
  preview_opened, export_succeeded, proposal_sent, checkout_started, subscribed). This is **the
  customer-acquisition event stream Growth OS should read**. [Verified]
- `usage_events`, `ad_conversions` (Meta CAPI queue), `admin_*` reporting functions, `/admin/marketing`
  funnel. GA4 and Search Console are read through a service account when configured. The details belong
  to Phase 3.

### 3.8 Administrator permissions

| Role | Source of truth | Gate |
|---|---|---|
| Platform owner / admin | `admin_roles` (1 row) → `is_admin()` | `requireAdmin()`: verified email, 404 for non-admins, optional `ADMIN_REQUIRE_TWO_STEP=true` → aal2. Every admin write goes through `audit()` into `audit_logs` and **aborts if the audit write fails** [Verified] |
| Sales rep / manager / Sales Administrator | `sales_reps.role` + `sales_capabilities()` (REP / ADMIN / OWNER caps) | Checked again in every `admin_*` SQL function [Verified] |
| Internal staff (payouts, HR) | `staff_members`, `staff_roles` (3 / 4 rows) | [Verified] |
| Customer company roles | `company_members` + permission arrays; Financials `fin_has_permission` | Customer side; **grants nothing internal** [Verified] |
| Creators, affiliates | Their own portals and `SECURITY DEFINER` access | [Verified] |

`marketing.owners` has **0 rows**, so `marketing.owner_review()` and `owner_set_paused()` cannot be
called by any signed-in user today. Only a service-role or SQL session can approve or pause. [Verified]

### 3.9 Existing reliability and safety building blocks worth reusing

| Pattern | Where | Reuse for |
|---|---|---|
| Lease / claim with `pg_advisory_xact_lock`, `recover_stale`, idempotency key per attempt, "look before resend" | `marketing.claim_due`, `recover_stale`, `record_submit` | Job queue |
| Vault-held provider secrets read per request (rotation needs no redeploy) | `mkt-scheduler/index.ts` | Secrets |
| Singleton settings row with pause, mode (`review`), daily caps, `auto_allowed` | `marketing.settings` | Emergency stop and autonomy tiers |
| Status-change audit trigger | `marketing.tg_content_audit` | Execution logs |
| Run log with ok/summary, retention cleanup cron | `marketing.runs`, `mkt-cleanup` | Run history |
| AI preflight and budget guard | `src/lib/ai/guard.ts`, `budget.ts` | Cost controls |
| Durable rate limits (Postgres counter) | `20261120001000_durable_rate_limits.sql` | Per-provider rate limits |
| AES-256-GCM sealed OAuth refresh tokens | `src/lib/tax-banking/bank/token-crypto.ts` (Google calendar for reps, QuickBooks, Plaid) | Alternative to Vault |
| Admin audit-or-abort | `src/lib/admin/server.ts` | Approvals |
| Timing-safe cron auth, heartbeats | `netlify/functions/*`, `/api/cron/*` | Scheduler auth |
| Down migrations kept in `supabase/rollback/` | repo convention | Rollback |

---

## 4. Risks found (pre-existing, not caused by this audit)

| # | Risk | Severity | Note |
|---|---|---|---|
| R1 | Previews and branch deploys share the production DB, so anything deployed from a branch can touch live data | High | Documented by the repo itself. Growth OS must not inherit it |
| R2 | `mkt-scheduler` and the `marketing` schema exist only in production (no source or migration in the repo) | High | No review, no tests in CI, no rebuild path. Bring it into the repo before Phase 7 |
| R3 | Unrelated app (`hbb`) shares the production database, service-role key and cron | Medium | A bug or credential leak in either app affects both. Consider moving it out (James's call) |
| R4 | Migration history covers 15 of ~150 migrations, so drift can't be detected | Medium | Growth OS migrations should go through the CLI with history |
| R5 | One Bearer secret (`EMAIL_OUTBOX_SECRET`) authorizes most `/api/cron/*` routes | Medium | A leak would let anyone trigger every cron early. Growth OS gets its own secret |
| R6 | Suppression split across 6+ tables | Medium | Risk of contacting someone who opted out through another channel |
| R7 | The weekly lead import depends on an outside agent holding a long-lived secret | Low–Med | Growth OS can own this schedule |
| R8 | Pricing-article workflow commits AI output straight to `main` | Low–Med | Guarded by checks, but no human approval |
| R9 | `marketing` health cron has alerted about 90 times on one channel that needs reauth | Low | Noise. Reconnect Buffer or disable the channel |
| R10 | Supabase advisor: 28 `SECURITY DEFINER` functions executable by `anon` (Academy and legal helpers, likely intended), 38 functions with a mutable `search_path` (mostly `hbb`), `pg_net` in `public` | Low (review) | Not Growth OS scope; listed so nothing is missed |
