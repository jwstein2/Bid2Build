# Uptime and error monitoring

Two free tools tell James by email when built2bid.org is down or throwing errors.

| What | Tool | Watches | Alerts |
| --- | --- | --- | --- |
| Uptime | Better Stack Uptime (free: 10 monitors, 3-minute checks) | `https://built2bid.org/` and `https://built2bid.org/api/health` | Email when either fails, and again when it recovers |
| Errors | Sentry (free Developer plan: 5k errors/month) | Server errors (pages, API routes, server actions) and browser errors | Email on every new issue |

## Code in this repo

- `src/app/api/health/route.ts`: public `GET`/`HEAD /api/health`. Returns `200 {"status":"ok"}` when the app is serving
  and Supabase Auth answers within 5 s, and `503` otherwise. The Supabase result is cached for 30 s per instance so the
  endpoint can't be used to hammer Supabase. No keys, versions or user data are returned. The session-refresh proxy skips it.
- `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/lib/monitoring/sentry-options.ts`: Sentry setup.
  **Off unless `NEXT_PUBLIC_SENTRY_DSN` is set** at build time. Errors only (no tracing, no session replay), no PII
  (`sendDefaultPii: false`). Events are tagged with the Netlify deploy context (`production`, `deploy-preview`,
  `branch-deploy`) and the commit.
- `src/app/error.tsx` and `src/app/global-error.tsx` report caught UI errors.

Source maps are not uploaded, so browser stack traces show minified code. Server traces are readable. Adding
`withSentryConfig` plus a `SENTRY_AUTH_TOKEN` later would fix browser traces if needed.

## Setup (James)

### 1. Sentry

1. Go to https://sentry.io/signup/ and sign up with your built2bid.org Google account (skip if you already have Sentry).
2. Organization name: `Built2Bid`. Data region: United States.
3. Create a project: platform **Next.js**, alert setting **Alert me on every new issue**, project name `built2bid`.
4. Skip the wizard (the code is already in the repo). Copy the **DSN** it shows. You can find it later under
   Settings > Projects > built2bid > Client Keys (DSN).
5. Open https://app.netlify.com/projects/built2bid/configuration/env, click **Add a variable > Add a single variable**:
   key `NEXT_PUBLIC_SENTRY_DSN`, value = the DSN, scope all, same value for all deploy contexts. Save.
6. Trigger a new production deploy (Deploys > Trigger deploy > Deploy project). The DSN is read at build time.
7. Check Settings > Account > Notifications in Sentry: **Issue Alerts** should be On and going to your email.

### 2. Better Stack Uptime

1. Go to https://betterstack.com/users/sign-up and sign up with the same email.
2. In Uptime (https://uptime.betterstack.com), click **Create monitor**:
   - Alert us when: **URL becomes unavailable**
   - URL: `https://built2bid.org/`
   - On-call escalation: tick **E-mail**
   - Click **Create monitor**.
3. Create a second monitor the same way for `https://built2bid.org/api/health` (after the PR is merged and deployed).
   It goes red if Supabase stops answering, even when the home page still loads.

### Test it

- Uptime: pause and resume a monitor, or open `https://built2bid.org/api/health` and confirm `"status":"ok"`.
- Sentry: after the DSN deploy, Sentry's Issues page should stay empty in normal use. To force a test event, open the
  browser console on built2bid.org and run `setTimeout(() => { throw new Error("Sentry test") })`.
