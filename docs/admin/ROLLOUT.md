# Owner command center V2: rollout and rollback

## Database change (one migration, additive)

`supabase/migrations/20261115002000_admin_reporting.sql`

- New table `admin_account_labels` (owner's manual genuine / internal / test / demo label). Service role only.
- Three optional columns on `leads`: `referrer_host`, `click_id_type`, `device_type`.
- Changes no existing row, subscription, grant or entitlement. Safe to run twice.

The code tolerates the migration not being applied yet: labels show as “Needs migration” on Operations, saving a label shows “Run migration 20261115002000 first”, and signup attribution falls back to the old fields.

## Rollout

1. Run the migration in the [Supabase SQL Editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new).
2. Merge the PR into `main` (Netlify deploys it).
3. On **Customers**, label the owner's own extra logins as *Internal* and any test logins as *Test*. Labels only change reporting.
4. Optional: connect GA4 / Search Console (INTEGRATIONS.md) and enter monthly ad spend on Marketing.

## Rollback

- Code: revert the merge commit on `main`. The V1 pages return; the extra table/columns are ignored by V1.
- Database (only if wanted): `supabase/rollback/20261115002000_admin_reporting_down.sql` drops the labels table and the three `leads` columns. Labels and the new attribution fields are lost; nothing else is affected.

## Unchanged on purpose

Complimentary access grant/extend/revoke logic and RPCs, Stripe billing, checkout, webhooks, entitlements, and all customer-facing pages.

## V3 (Tech Stack & Costs, Business Scorecard, forecast)

Migration `supabase/migrations/20261115003000_admin_costs.sql` (additive, safe to re-run):

- `admin_services`: provider inventory overrides (plan, charge, interval, renewal, allocation %, budget, cost source). NULL amount = unknown.
- `admin_expenses`: dated charges; unique `(service_key, external_id)` prevents counting an invoice twice.
- `admin_platform_usage()`: aggregate database/storage/auth-user sizes for the usage monitor.

All three are service-role only. Without the migration the new pages load read-only and show costs as Unknown.
Rollback: `supabase/rollback/20261115003000_admin_costs_down.sql` (deletes the owner's cost records only).

After merging: open **Tools → Tech Stack & Costs**, set each active provider's plan price (or mark it Discontinued/Unknown), set the Google Workspace allocation, and add renewal dates.
