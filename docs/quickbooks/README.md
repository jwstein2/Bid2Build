# QuickBooks Online hours sync (V8.4)

Contractors connect their QuickBooks Online company, match Built2Bid workers to QuickBooks employees (or vendors
for 1099 workers) and projects to QuickBooks customers, then send **approved** time entries as QuickBooks time
activities. QuickBooks Payroll picks those hours up when the contractor runs payroll. Built2Bid never runs payroll,
changes pay rates or moves money through this integration.

Page: **Projects → Contractors & Workforce → Send hours to QuickBooks** (`/projects/workforce/quickbooks`), also linked
from Time tracking → Timesheets & export.

## How it works

| Piece | Where |
| --- | --- |
| Intuit sign-in (OAuth 2.0, state cookie bound to the user) | `src/app/api/integrations/quickbooks/connect`, `callback` |
| Status, matches, sync, disconnect | `src/app/api/integrations/quickbooks/route.ts` |
| Which entries go, and what each becomes | `src/lib/quickbooks/mapping.ts` (pure, unit tested) |
| Token storage, refresh, sending | `src/lib/quickbooks/server.ts` |
| Tables, scope guard, claim function | `supabase/migrations/20270214005000_quickbooks_sync.sql` |
| Rollback | `docs/quickbooks/rollback_20270214005000.sql` |

Rules:
- Only people who manage the team (`pm_team_manageable`) can connect, match or send, and only time approvers can send.
- Sent: approved, clocked-out entries that aren't marked Unpaid, for matched workers, once each. Hours are clock
  time minus the unpaid break (paid breaks stay in), dated by the company's time zone.
- Each entry is claimed in `qb_time_exports` before the QuickBooks call, and the entry id plus a hash of the payload is sent as QuickBooks'
  `requestid`, so double clicks and retries never create duplicates. Failed entries are retried on the next send.
- OAuth tokens are encrypted with AES-256-GCM using `BANK_TOKEN_KEY` (already set for Plaid) and live in
  `qb_connection_secrets`, which only the service role can read. Disconnect revokes them at Intuit and deletes them.
- Edits made to an entry after it was sent are **not** pushed again. Fix the time in QuickBooks, or delete it there.

## Owner setup (James)

1. Run the SQL: Supabase SQL Editor → paste `run-quickbooks-sync.sql` (same as the migration) → Run.
2. Create the Intuit app:
   1. Go to https://developer.intuit.com and sign in (or sign up) with your built2bid.org Google account.
   2. Click **Dashboard → Create an app → QuickBooks Online and Payments**. Name it **Built2Bid** and pick the
      **Accounting** scope (`com.intuit.quickbooks.accounting`).
   3. Open the app → **Development settings → Keys & credentials**. Under Redirect URIs add
      `https://built2bid.org/api/integrations/quickbooks/callback` and save.
   4. Copy the development **Client ID** and **Client Secret**. Don't paste them in chat.
3. In Netlify (https://app.netlify.com → built2bid → Site configuration → Environment variables), Production context:
   - `QBO_CLIENT_ID` = Client ID, `QBO_CLIENT_SECRET` = Client Secret (mark secret)
   - `QBO_ENVIRONMENT` = `sandbox`
   - `NEXT_PUBLIC_QUICKBOOKS` = `on`
   Then **Deploys → Trigger deploy → Deploy site**.
4. Test with Intuit's free sandbox company (developer.intuit.com → Dashboard → Sandbox): connect it from the page,
   match a worker to a sandbox employee, approve some time and click **Send to QuickBooks**. The entries show in the
   sandbox under **Time → Time entries**.
5. Go live: in the Intuit app open **Production settings**, fill in the app details (terms
   `https://built2bid.org/terms`, privacy `https://built2bid.org/privacy`, host domain `built2bid.org`, launch URL
   `https://built2bid.org/projects/workforce/quickbooks`, disconnect URL the same page, connect URL
   `https://built2bid.org/api/integrations/quickbooks/connect`) and the compliance/security questionnaire (answers are
   in `/mnt/project-files/payroll-partners/Built2Bid-Security-Overview-Payroll-Partners.pdf`). Add the same redirect
   URI under production keys. When Intuit issues production keys, replace `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`, set
   `QBO_ENVIRONMENT` = `production`, and trigger a deploy. Anyone connected to a sandbox company must reconnect.

Until the keys are set the page shows "Coming soon" and the Payroll CSV export keeps working.

## How Built2Bid talks to Intuit

- **Endpoints:** the OAuth authorize, token and revoke URLs come from Intuit's discovery document
  (`openid_sandbox_configuration` / `openid_configuration`), cached for a day. If it can't be read, the documented
  URLs are used so connecting never breaks.
- **Retries:** token requests and API calls retry up to twice on network errors and Intuit 429/5xx answers, with
  back-off (honouring `Retry-After`). 4xx errors are never retried. Time entries carry a `requestid`, so a retry
  can't create a duplicate.
- **Support reference:** Intuit's `intuit_tid` response header is captured on every failure. It's logged
  (`quickbooks.*` scopes) and appended to the message the contractor sees as "QuickBooks reference …".
