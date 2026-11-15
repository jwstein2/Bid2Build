# Owner command center: integrations

Every integration is optional. When one is not configured, the page says **Not connected** and shows nothing estimated in its place. Status for each is on **Admin → Operations → Integrations**, read from this deploy's environment (values are never shown).

| Integration | What it powers | How it connects | Cost |
| --- | --- | --- | --- |
| Supabase | Everything (accounts, bids, subscriptions snapshot, grants, leads) | Existing service-role key | Existing |
| Stripe | Revenue reconciliation: active / past-due counts and payments received | Existing `STRIPE_SECRET_KEY`, **read-only list calls** (subscriptions, invoices). No writes, no new permissions. | None |
| Built2Bid first-party attribution | Channels, campaigns, landing page, device | Existing `b2b_attr` first-touch cookie → `leads` table. Migration 20261115002000 adds referrer host, click-id type and device. | None |
| GA4 Data API | Website sessions, visitor → signup | Service account (below) + `GA4_PROPERTY_ID` | Free |
| Search Console API | Organic clicks, impressions, queries | Service account (below) + `SEARCH_CONSOLE_SITE` | Free |
| Resend | Founder welcome email queue health | Existing `RESEND_API_KEY`, `FOUNDER_EMAIL_ENABLED` | Existing |
| Sentry | Uncaught errors | Existing DSN | Existing |
| Google Ads / Meta / YouTube ads | Spend and CAC | **Not connected.** Enter monthly spend by hand on Marketing. The dashboard never creates, changes or activates campaigns. | None |
| Supabase Auth SMTP | Sign-in code delivery | Not readable by the app; Operations links to the Supabase Auth logs. | None |

No new npm dependencies. Google calls use a signed service-account JWT built with Node's `crypto`, server-side only, with timeouts; the browser never sees the key.

## Connecting GA4 and Search Console (optional, about 10 minutes)

1. **Create a service account.** Google Cloud Console → [IAM & Admin → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) → Create service account (no roles needed) → Keys → Add key → JSON. Keep the file private.
2. **Enable the APIs** on the same Cloud project: [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com) and [Google Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com).
3. **GA4 access.** [Google Analytics](https://analytics.google.com/) → Admin → Property access management → add the service account's email as **Viewer**. Copy the numeric **Property ID** from Admin → Property details.
4. **Search Console access.** [Search Console](https://search.google.com/search-console/users) → Settings → Users and permissions → Add user → the service account email, permission **Restricted**.
5. **Netlify environment variables** (Production): [Site configuration → Environment variables](https://app.netlify.com/sites/built2bid/configuration/env)
   - `GA4_PROPERTY_ID` = the numeric property id
   - `SEARCH_CONSOLE_SITE` = `sc-domain:built2bid.org`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = the full JSON key file contents (mark as secret; paste it in Netlify directly, never in chat)
6. Redeploy. Operations → Integrations should show both as OK. GA4 data can lag 24–48 hours.

Scopes requested: `analytics.readonly` and `webmasters.readonly` only.

## Tech Stack & Costs: provider monitors (V3)

| Monitor | Status | How it works / what it would need |
| --- | --- | --- |
| Supabase database size, file storage, auth users | **Live** after migration 20261115003000 | `admin_platform_usage()` reads aggregates from the database itself (service role only). |
| Supabase project status, API request counts | Live once `SUPABASE_MANAGEMENT_TOKEN` is set | Management API, GET only. Egress is not exposed by the API. |
| Stripe fees, refunds, checkout outcomes | **Live** | Existing secret key, read-only list calls (balance transactions, invoices, checkout sessions). |
| Anthropic API (in-app AI) | **Live** | Built2Bid's own `ai_generations` log (tokens and cost per request). |
| Anthropic API (whole account) | Live once `ANTHROPIC_ADMIN_KEY` is set | Usage and Cost Analytics API, this month's cost by model. API billing only; a Claude subscription is separate. |
| Netlify plan, build minutes | Live once `NETLIFY_API_TOKEN` is set | Netlify API, GET only (`/accounts`, `/{account}/builds/status`). Bandwidth and credits are not in the public API. Optional `NETLIFY_ACCOUNT_ID` if the token sees several teams. |
| Google Ads, Meta Ads | Setup state only | No API calls yet. Both need provider review first (Google Ads developer token; Meta app with `ads_read`). The page lists which settings exist. |
| Google Cloud / Places | Not in use | Places autofill is off until a key is set. |
| Resend, Instantly, Apollo, Apify | Not connected | Resend's sending key cannot read usage; no Built2Bid Apollo/Apify account was found. |

Approved by the owner on 2026-11-15. Every monitor is server-side, read-only, and shows **Not connected** until its variable is set. Tokens are read only on the server; errors show the HTTP status, never the token.

### Adding the tokens (Netlify → Production, mark each as secret)

[Site configuration → Environment variables](https://app.netlify.com/projects/built2bid/configuration/env), then redeploy.

| Variable | Where to create it | Permission to choose |
| --- | --- | --- |
| `NETLIFY_API_TOKEN` | [Netlify → User settings → Applications → Personal access tokens](https://app.netlify.com/user/applications#personal-access-tokens) | Netlify tokens are account-wide; set an expiry date. |
| `SUPABASE_MANAGEMENT_TOKEN` | [Supabase → Account → Access tokens](https://supabase.com/dashboard/account/tokens) | A scoped token limited to project asiiqmegvajtuspeumio with read-only analytics/project access, if your account offers scoped tokens; otherwise a classic token. |
| `ANTHROPIC_ADMIN_KEY` | [Claude Console → Settings → Admin keys](https://console.anthropic.com/settings/admin-keys) | Admin keys are organization-wide; only the cost report is read. |

