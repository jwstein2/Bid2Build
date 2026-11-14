# Environment variable inventory

Names and purposes only. **No values belong in this file, in Git, or in chat.** Set values in
Netlify: *Site configuration → Environment variables*, marking server-only ones as **secret**.

`NEXT_PUBLIC_*` variables are inlined into browser JavaScript at build time: they are public by
design and must never hold a secret. Everything else is read only on the server.

Netlify **contexts**: *Production* (main branch, the live domain), *Deploy previews* (pull requests),
*Branch deploys*, *Local development*. Changing a variable requires a new deploy to take effect.

Source of truth in code: `src/lib/site.ts`, `src/lib/config/deploy.ts`, `src/lib/env.ts`,
`src/lib/ai/provider.ts`, `src/lib/growth/instantly.ts`, `src/app/api/webhooks/instantly/route.ts`.
Template: `.env.example`.

## Set automatically by Netlify (do not create)

| Name | Purpose |
|---|---|
| `CONTEXT` | `production`, `deploy-preview`, `branch-deploy`. Drives URL resolution and indexing. |
| `URL` | Site's primary URL. Becomes `https://built2bid.org` once that is the primary domain. |
| `DEPLOY_PRIME_URL` | This deploy's own URL. Previews always use it, so they never link to production. |
| `NEXT_PUBLIC_DEPLOY_CONTEXT` | Derived in `next.config.ts` from `CONTEXT`. Not set by hand. |

## Brand and URLs

| Name | Scope | Contexts | Required | Purpose |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | **Production only** | Recommended | Canonical URL (`https://built2bid.org` after the domain switch). Used for canonical tags, sitemap, Stripe success/cancel/portal return URLs. Previews ignore it. Unset in production = Netlify `URL`. |
| `NEXT_PUBLIC_SITE_NAME` | public | All | No (default `Built2Bid`) | Product name in titles, emails, PDFs. |
| `NEXT_PUBLIC_SITE_DOMAIN` | public | All | No | Display domain. Defaults to the host of the site URL. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | public | All | **Yes before launch** | Shown in footer, homepage FAQ, Privacy, Terms. Default is the placeholder `support@example.com`. Set to a Google Workspace address (e.g. support@built2bid.org). |
| `NEXT_PUBLIC_SMS_SIGNIN` | public | All (try Deploy Preview first) | No (default off) | `on` makes texted codes the primary sign-in. Set only after Twilio Verify is configured in Supabase. See docs/auth/SMS_SIGN_IN.md. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | public | All | Recommended with SMS | Cloudflare Turnstile site key for the bot check on code requests. The secret goes in Supabase Attack Protection, not Netlify. |
| `NEXT_PUBLIC_ALLOW_INDEXING` | public | Production only | Launch decision | `true` lets search engines index production. Has no effect on previews (always noindex). |

## Supabase

| Name | Scope | Contexts | Required | Purpose |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | All | Yes | Project API URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | All | Yes | Publishable (anon) key; safe in the browser because RLS enforces access. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as a legacy fallback. |
| `SUPABASE_SECRET_KEY` | **secret** | Production (+ previews only if they must save) | Yes | Service-role key. Bypasses RLS; used only in server routes after authorization. `SUPABASE_SERVICE_ROLE_KEY` accepted as fallback. |

Note: there is one Supabase project today, shared by production and previews. A preview deploy
with these keys talks to production data. See PRODUCTION_LAUNCH_CHECKLIST.md item "separate preview data".

## Stripe

| Name | Scope | Contexts | Required | Purpose |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | **secret** | Production (test key on previews) | Yes for billing | `sk_test_…` until launch approval, then `sk_live_…`. |
| `STRIPE_WEBHOOK_SECRET` | **secret** | Production | Yes for billing | Signing secret of the endpoint `https://<domain>/api/stripe/webhook`. One per endpoint, so it changes when the domain changes if you create a new endpoint. |
| `STRIPE_PRICE_MONTHLY` | server | All | Yes for billing | Price id for $19.99/month. |
| `STRIPE_PRICE_ANNUAL` | server | All | Yes for billing | Price id for $149/year. |
| `STRIPE_ALLOW_LIVE` | server | Production only | Launch decision | Must be `true` or live keys are refused (`src/lib/billing/stripe.ts`). |

## AI writing (Scope of Work, Exclusions)

| Name | Scope | Contexts | Required | Purpose |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | **secret** | Production | No | Enables AI drafting; without it, built-in rules draft. **Rotate: it was pasted in chat on 2026-11-12.** |
| `AI_MODEL` | server | All | No | Default `claude-opus-5-5`. |
| `AI_DAILY_LIMIT_PER_USER` | server | All | No | Default 40. |
| `AI_MONTHLY_BUDGET_USD` | server | All | No | Default 25; above it drafting falls back to rules. |
| `AI_TEXT_GENERATION` | server | All | No | `off` pauses AI without removing the key. |

## Google Maps address autocomplete (optional)

| Variable | Exposure | Contexts | Required | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | public (browser key) | All | No | Turns on address suggestions in Company and Customer & project address fields. Restrict the key in Google Cloud by HTTP referrer (built2bid.org, built2bid.netlify.app, deploy previews) and by API (Places API (New), Maps JavaScript API). Without it the fields are plain text. Must be set before the build (it is inlined), so redeploy after setting. |
| `NEXT_PUBLIC_GOOGLE_MAPS_REGIONS` | public | All | No | Comma-separated country codes for suggestions. Default `us`. |

## Instantly (INCOMPLETE until an Instantly workspace exists)

| Name | Scope | Contexts | Required | Purpose |
|---|---|---|---|---|
| `INSTANTLY_API_KEY` | **secret** | Production only | For outreach sync | API v2 key, scopes `leads:create` and `block_list_entries:create`. |
| `INSTANTLY_SYNC_ENABLED` | server | Production only | For outreach sync | Must be `true` for the app to call Instantly at all. |
| `INSTANTLY_WEBHOOK_SECRET` | **secret** | Production only | For webhook | Random 32+ character string. Added to each Instantly webhook as header `x-built2bid-webhook-secret`. Without it the endpoint returns 503. |

## Build

| Name | Where | Purpose |
|---|---|---|
| `NODE_VERSION` | `netlify.toml` | 22 |
| `NEXT_TELEMETRY_DISABLED` | `netlify.toml` | 1 |

## Not environment variables (configured in dashboards)

* Supabase Auth Site URL, Redirect URLs, SMTP host/user/password: Supabase dashboard → Authentication.
  The Gmail app password used for SMTP today lives there. **Rotate it (pasted in chat 2026-11-12)** and move to a Workspace sender.
* Stripe webhook endpoint URL and Customer Portal settings: Stripe dashboard.
* DNS records: Netlify DNS (domain bought through Netlify).
