# Complimentary Access (platform owner admin)

Admin → **Complimentary Access** (`/admin/complimentary`). Platform admins only (`admin_roles.role = 'admin'`); everyone else gets a 404, and every database function re-checks `is_admin(caller)`.

## What a grant does
- **Unlimited**: unlimited bids, Saved Items & Pricing, Proposal Templates (via `has_unlimited`, so `credit_status`, `finalize_bid` and `library_access` all honour it).
- **Enterprise**: same for the owner, plus a company with 3 licensed users (+ extra seats an admin authorizes). The company/seat side lives in the Enterprise migration (`20261114005000_enterprise_workspace.sql`), which reads this table.
- **Never touches Stripe.** No customer, subscription or charge is created; paid subscriptions are left alone. Checkout is only blocked by a *paid* subscription (`has_paid_subscription`), so comp users can convert.

## Lifecycle
| Step | Behaviour |
|---|---|
| Grant to an email with a verified account | Starts now; ends after the chosen days. |
| Grant to a new email | Pending. Optional invitation email (Supabase Auth invite via the project's SMTP). The clock starts when that email is verified (any sign-in method) or the invite link is opened while signed in with it. |
| Invitation link | 32-byte random token, only its SHA-256 stored, single use, expires after 30 days, replaced on Resend. Only the account whose verified email matches can claim it. |
| Expiry | Enforced in SQL (`expires_at > now()`); no cron. Bids, customers, company records and paid plans stay. |
| Extend | Pushes the end date out (an ended grant restarts from today). Pending: lengthens the period. Max 365 days per action, 730 days ahead. |
| Pause / Resume | Pause cuts access now; resume moves the end date out by the paused time. |
| Revoke | Ends access now; kills any invite link. |
| Seats | Enterprise only, 0–50 extra, requires an explicit authorization checkbox. Recipients can't change seats. |

Guards: one open grant per email, 50 grants per admin per day, resend once a minute and 10 times per grant. All actions are written to `audit_logs` (`target_type = 'complimentary_grant'`), shown under Details.

Recipients see their status on `/settings/billing` (and an "ended" notice with upgrade options afterwards) and on `/complimentary`.

## Tests
- `tests/db/complimentary-access.test.ts` (real Postgres): `npm run test:db`
- `tests/complimentary-access.test.ts`, `tests/checkout-route.test.ts`
- `scripts/complimentary/walk.mjs`: 59 browser checks with the real SQL behind the mock Supabase (see header for setup).
