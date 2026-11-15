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
