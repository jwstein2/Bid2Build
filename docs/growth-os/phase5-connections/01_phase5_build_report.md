# Growth OS Phase 5: Connections Center — build report

Built 2026-11-28 on branch `claude/project-thread-wbf7oo` (stacked on the Phase 4 branch, PR #266). **Staging and local
tests only. Production (app database `asiiqmegvajtuspeumio`, Netlify, built2bid.org) was not touched.** No account,
OAuth app, platform application, purchase or message was created or sent.

Phase gate: Phase 4's last critical test (an unattended staging tick) has not run because the staging Edge Function
secret `GROWTH_DB_PASSWORD` is still unset. James authorized starting Phase 5 on 2026-11-28 ("Go ahead and start stage 5"):
this is the documented exception.

Labels: **[verified]** checked in code, tests or the staging database today; **[platform-doc 2026-11-28]** read on the
official docs page today; **[platform-doc]** from docs as known, re-check at go-live; **[estimate]**.

## 1. What was implemented

| Piece | Where | What it does |
|---|---|---|
| Connector registry | `growth-os/connectors/registry.ts` (→ generated `20270302001100_growth_connectors_seed.sql`) | 14 connectors, 46 operations. Per operation: scopes, privileged flag, phase, baseline status. Per connector: existing connection, review/verification, rate limits, cost, refresh model, docs, plain-language manual steps, Vault secret names |
| Database layer | `growth-os/supabase/migrations/20270302001000_growth_os_connections.sql` | `growth.connectors`, `growth.connector_operations`, five-state `growth.connections`, `growth.connection_checks` (history), `growth.oauth_states`; status views with the 26 h freshness rule and per-operation rollup; audited `growth_api` functions |
| Status guards | same | Only `growth_api.record_check`, called by the worker login after a real API call, can write `verified_operational` (trigger + grants). A simulated row can never be live (CHECK constraint). Privileged operations need the owner's recorded approval of every scope, even if the platform granted it |
| OAuth flow | `growth-os/oauth/index.ts` (Edge Function `growth-oauth`), `growth-os/connectors/oauth.ts` | Operator mints a one-time link (`oauth_begin`, 10 min, only its SHA-256 stored); `/start` redirects to the platform's own consent screen (PKCE for Google); `/callback` exchanges the code server-side (Meta/Instagram long-lived exchange), stores the token in Vault, runs the first health check. No token ever reaches a browser, log or audit row |
| Manual credentials | `growth_api.attach_manual_secret` | For Stripe restricted key, GA4 service account, Meta system-user token, Buffer key: James pastes the value into Vault himself; Growth OS only checks the secret exists, then tests it |
| Token refresh | worker task `connector.refresh` (hourly) | Refreshes tokens expiring within 24 h (Google, LinkedIn, TikTok rotating refresh tokens, Instagram, Meta re-exchange). Three failures → status awaiting authorization, connector paused, owner alert on the page. A new credential lifts the pause |
| Health checks + diagnostics | worker task `connector.health` (daily + "Check now"), `growth-os/connectors/health.ts` | One cheap read per connection; reads real granted scopes (Meta `/me/permissions`, Google tokeninfo, LinkedIn introspection, Stripe per-resource probes); confirms the token reaches the registered account; maps errors to plain-language fixes; records rate-limit headers |
| Admin page | `/admin/growth/connections` (`src/app/admin/growth/connections/`) | Owner-only (existing admin guard + authenticator step). Status per connector and per operation, missing scopes, last checks, manual steps, audit trail. Actions: register, connect, approve privileged scopes, attach secret, check now, resume, revoke, record platform application status. Without the Growth OS database it shows registry baselines with a banner: never live |
| Tests | `tests/growth-os/connectors/*.test.ts` (one per connector), `tests/db/growth-os-connections.test.ts`, `tests/growth-os/connections-view.test.ts` | See section 2 |
| Staging check | `growth-os/supabase/staging/05_connections_checks.sql` | Guard checks run on the staging project |

## 2. What was tested and the results

| Test | Result |
|---|---|
| 14 per-integration contract suites + registry suite (recorded fixtures, no network) | **86/86 pass** [verified] |
| Database suite on real Postgres: grants, guards, OAuth states, Vault storage, refresh + pause, Stripe diagnostics, Supabase live read, audit, rollback + re-apply | **24/24 pass** [verified] |
| Phase 4 foundation suite (regression) | **26/26 pass** [verified] |
| Page view model | **3/3 pass**; admin/radar suites 181/181 pass after nav changes [verified] |
| `tsc --noEmit`, ESLint on changed files | clean [verified] |
| `/code-review` (medium) | 10 findings (7 important), **all fixed** in commit 74e4828 |
| `/security-review` | no findings at confidence ≥ 8; one defense-in-depth tightening applied (worker-only OAuth steps revoked from the service role) |
| Staging apply (`built2bid-growth-staging`) | Migration + seed applied. 14 connectors / 46 operations; `service_role` cannot call `record_check`; `anon`/`authenticated` cannot call any new function [verified] |
| Staging guard checks (`05_connections_checks.sql`) | **4/4 pass**: manual verified refused, operator record_check refused, OAuth on a manual connector refused, overview lists 14 [verified] |
| Live smoke per connection | **Not run**: no connection is authorized yet (needs James, section 4) |

Current staging statuses [verified 2026-11-28]: awaiting authorization: Meta Business, Facebook Page, Instagram,
YouTube, Google Workspace, Built2Bid Supabase, GA4/GSC, Stripe, Buffer. Awaiting platform approval: TikTok ads,
TikTok content, Google Ads, LinkedIn. Unsupported: video tools (OpusClip, Streamlabs). Nothing is shown as live.

## 3. Files and systems changed

- Repo (branch only): files listed above, plus `growth-os/worker/index.ts` (registers the connector handlers),
  `growth-os/worker/db.ts` (shared login helper), `tsconfig.json` (`allowImportingTsExtensions`, excludes the Deno
  entry), `src/components/admin/nav.ts` + `admin-shell.tsx` (nav link, dark theme), `src/lib/admin/integrations.ts`
  (one detail string points to the new page).
- Staging Supabase: Phase 5 migration + registry seed applied through the SQL editor. Growth OS remains STOPPED.
- Not changed: production database, production Vault, Netlify env vars, the website, any platform account.
- Not deployed yet: Edge Function `growth-oauth` (it needs `GROWTH_DB_PASSWORD` to boot and an OAuth client to be useful).

## 4. Permissions or credentials still required (James does these himself; Claude never sees the values)

| # | Step | Unlocks |
|---|---|---|
| 1 | Staging: copy Vault `growth_worker_db_password` into Edge Function secret `GROWTH_DB_PASSWORD` (also closes Phase 4) | Supabase connector verified; worker + `growth-oauth` can run |
| 2 | Stripe: create restricted key "Growth OS read" (Read: Customers, Subscriptions, Invoices, Charges, Balance transactions); paste into staging Vault as `growth_stripe_restricted_key` (test key fine for staging) | First manual-secret connection (D3 order) |
| 3 | GA4: the Google login that owns G-2KJ9K3FX07 adds a Growth OS service account as Viewer; paste its JSON key as `growth_ga4_gtm_service_account` | GA4 + Search Console |
| 4 | Google Cloud OAuth client (Web), callback `https://nkpnfpxrvukfqwgbbwrs.supabase.co/functions/v1/growth-oauth/callback`; paste id/secret as `growth_google_client_id` / `_secret` | YouTube, Google Workspace, Google Ads (and the A5 refresh test) |
| 5 | Meta: create the "Built2Bid Growth OS" app (D2) or a read-only system user token | Meta Business, Facebook Page, Instagram |
| 6 | Read and submit the drafted applications (TikTok, LinkedIn ×2); apply for Google Ads Explorer access | The four "awaiting platform approval" connectors |
| 7 | Production rollout of the page (env `GROWTH_SUPABASE_URL`, `GROWTH_SUPABASE_SERVICE_ROLE_KEY`, expose `growth_api` in the staging project's API settings) | The page shows live statuses instead of baselines. Needs James's explicit OK (Netlify env change) |

## 5. Known risks and unresolved issues

- **Not proven live.** No real platform call has been made; adapters are tested against recorded fixtures built
  from documentation. Each adapter is confirmed only by its first live health check.
- Facts to confirm at go-live [platform-doc]: Meta Graph version (`v23.0` set), Google Ads API version (`v22` set)
  and whether a developer-token header is still needed after the 2026-09-09 sunset, `LinkedIn-Version` (`202510`),
  the Instagram insights scope name, TikTok Business endpoints/permission names, and Buffer's public API endpoint.
- Instagram publishing limit docs conflict (100 vs 50 posts/24 h); use the API's own limit endpoint.
- Google OAuth apps in Testing mode issue refresh tokens that expire after 7 days; verification needed for a stable refresh.
- LinkedIn refresh tokens only for approved partners: until then the connection needs a manual reconnect every 60 days.
- The `growth.status_writer` flag can be set by the database owner (postgres) in the SQL editor; the owner can bypass
  any database rule, so this is accepted.
- Revoke deletes the stored token; access must also be removed in each platform's settings (stated on the page).
- Phase 4's unattended tick is still untested (same blocker as step 1).

## 6. Operating cost implications

All platform APIs used are free at this volume [platform-doc]. Worker load: one health check per connection per day plus
hourly refresh scans: a few hundred Edge Function calls a month, inside the existing staging plan (~$10/month,
unchanged) [estimate]. No AI model calls. No paid tools, assessments or ad spend. A Google OAuth security assessment
is avoided by not offering Gmail scopes.

## 7. Acceptance criteria

| # | Criterion | Critical | Result |
|---|---|---|---|
| A1 | Every integration appears with exactly one of the five statuses, per operation | Yes | **Pass** (DB test + staging: 14/14 connectors, 46 operations) |
| A2 | A simulated or stale connection never shows as verified | Yes | **Pass** (CHECK constraint, trigger, freshness view, UI fallback; tests + staging check) |
| A3 | Admin-only connect; privileged scopes need a separate recorded owner approval | Yes | **Pass** (grants, `is_operator`, approval hash; tests) |
| A4 | No password/recovery/MFA code through Claude or Built2Bid; tokens only in Vault, never in browser/logs | Yes | **Pass** (design + test that scans overview, audit, checks and run logs for token patterns) |
| A5 | Token refresh works for at least one OAuth connection on staging; failure pauses + alerts | Yes | **Partial**: passes on local Postgres with recorded Google responses; **not yet on staging** (needs steps 1 and 4) |
| A6 | Health check + diagnostics show granted vs required scopes and a plain-language fix | Yes | **Pass** (tests; Stripe missing-permission message) |
| A7 | Connect / approve / refresh / revoke audited | Yes | **Pass** (DB test lists 12 audited actions) |
| A8 | One suite per integration, all passing; live smoke where authorized | Yes (contract/DB) | **Pass** for contract + DB (14 suites); live smoke: none authorized yet |
| A9 | Manual authorization instructions on each card | No | **Pass** (every connector; test forbids asking for passwords or codes) |
| A10 | Production untouched until James approves rollout | Yes | **Pass** |

Critical result: 8 pass, A5 partial (staging half blocked on James's steps 1 and 4), A8 live smoke pending
authorizations. Recommendation: treat Phase 5 as build-complete; close A5 on staging as soon as step 1 and one
Google OAuth client exist, before Phase 6 relies on any connection.
