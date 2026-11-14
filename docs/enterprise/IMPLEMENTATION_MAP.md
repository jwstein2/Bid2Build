# Enterprise implementation map (Parts 7-13 + 6.9)

Scope of this track: Enterprise pricing, seat licensing and Stripe billing, the company workspace,
roles/teams/permissions, the Company Command Center, pipeline, analytics and anomaly alerts, and the
Enterprise side of company-shared Saved Pricing (6.9). Parts 2-6 already shipped (PRs #17-#20, #21
open). Part 14 (platform-owner complimentary access) is a parallel track that feeds the same
entitlement function described below.

## 1. What exists today and what we extend

| Area | Today | Enterprise plan |
|---|---|---|
| Accounts | `auth.users` + `profiles` + one `business_profiles` row per user | Unchanged. A company is a new layer above users; nobody's user id changes. |
| Ownership | Every row has `user_id`; RLS is "owner only" | Add nullable `company_id` to `estimates`, `customers`, `saved_items`, `assemblies`. NULL = personal (all existing rows). |
| Entitlement | `has_unlimited(uuid)` reads `subscriptions`; everything (credit_status, finalize_bid, quota_status, library_access, PR #21 `hasPremiumAccess`, checkout guard) calls it | New `user_entitlement(uuid)` returns tier free/unlimited/enterprise + source; `has_unlimited` becomes `tier <> 'free'`. Every existing check picks up Enterprise seats and comp grants without code changes. |
| Stripe | One product, monthly + annual prices, `subscriptions` table synced by verified, idempotent, order-safe webhooks (`apply_subscription_update`) | Same pipeline. `subscriptions` gains `company_id` + `seat_quantity`, `plan` gains `enterprise`. |
| Price source of truth | `src/lib/billing/plans.ts`, checked against Stripe before Checkout | `src/lib/enterprise/pricing.ts` (graduated seat tiers), same verify-before-checkout pattern. |
| Admin | `admin_roles` + `is_admin()`; `/admin` pages; `audit_logs` (platform, service-role only) | Untouched. Company admin is a separate scope (`company_members.role`), with its own `company_audit_log`. Customer admins never touch `/admin`. |
| Estimate status | `draft` / `finalized` / `archived` | Pipeline stage is a new column in Phase 4 (`draft → ready_for_review → approved → sent → pending → won/lost`), mapped from existing status, never auto-"sent" on PDF export. |

## 2. Three authorization scopes (Part 15)

* **Individual** (Free/Unlimited): unchanged owner-only RLS on rows with `company_id IS NULL`.
* **Company** (Enterprise): `company_members` (role owner/manager/estimator/viewer + per-person
  grants/revocations), `company_teams`, `company_team_members`. RLS reads company rows through
  `my_visible_bid_owners()`, a set-returning security-definer function evaluated once per query, so
  it stays cheap at 200+ members. All writes to company tables go through security-definer
  functions; `authenticated` has SELECT only.
* **Platform** (`admin_roles`): unchanged and structurally separate.

### Roles and default permissions

| Permission | Owner | Manager | Estimator | Viewer |
|---|---|---|---|---|
| view_own_bids | ✓ | ✓ | ✓ | ✓ |
| view_team_bids | ✓ | ✓ | | ✓ |
| view_company_bids | ✓ | | | |
| create_estimates | ✓ | ✓ | ✓ | |
| edit_team_estimates | ✓ | ✓ | | |
| view_costs | ✓ | ✓ | ✓ | |
| view_margin | ✓ | ✓ | | |
| approve_bids | ✓ | ✓ | | |
| manage_company_pricing | ✓ | | | |
| view_analytics | ✓ | ✓ | | ✓ |
| manage_teams | ✓ | | | |
| manage_users | ✓ | | | |
| manage_billing | ✓ | | | |

The owner can grant or revoke any permission per person. Rules enforced in SQL: nobody changes their
own access; nobody grants a permission they don't hold; `manage_billing` and `manage_users` are
owner-only grants; the owner row can't be edited by anyone else.

### Company-owned data (10.4)

* New estimates/customers by an active member are stamped with the company (`stamp_company_owner`
  trigger) and `created_by`.
* Deactivating a member removes their access immediately (RLS requires an active membership even for
  their own company rows) but keeps every bid.
* Deleting an employee's login hands their company bids to the owner first instead of cascading
  (`preserve_company_records` trigger). The owner's login can't be deleted while the company exists.
* Pre-existing personal bids are never moved into a company automatically. (A "move my existing bids
  into the company" action can come later as an explicit, audited choice.)

## 3. Entitlement contract shared with the complimentary-access track

* `user_entitlement(p_user_id)` → `(tier, source, company_id, expires_at)`. Order: active company
  seat (enterprise) → individual subscription (unlimited) → personal comp grant (unlimited) → free.
* `company_entitlement(p_company_id)` → `(active, source stripe|complimentary, seat_limit, expires_at)`.
  Paid seats = `subscriptions.seat_quantity` (min 3); comp seats = 3 + `complimentary_grants.extra_seats`.
* Expiry is evaluated at read time (`expires_at > now()`), so access ends on time without a cron job.
* `complimentary_grants` belongs to the comp track's migration `20261114004000`; this track reads it
  only if it exists, so either migration can run first. The comp track guards its own
  `has_unlimited` change so it never overwrites this one.
* `create_company(owner, name)` (service role only, idempotent) is the single way a company is born:
  from the Enterprise checkout webhook or from Enterprise comp activation.

## 4. Seats and invitations

* A seat = an active member or an unexpired pending invitation. Invites, accepts and reactivations
  lock the company row, so concurrent changes can't exceed the licensed count.
* Invitations store only a sha256 of the emailed token; acceptance requires the signed-in account's
  **verified** email to equal the invited email, and works once. Re-inviting revokes the old link.
  One active company per person.
* SMS sign-in note: a phone-only account must add and verify the invited email before accepting. The
  invite email starts sign-in, and the login itself still follows the normal (SMS when enabled) flow.

## 5. Stripe design (Phase 2, needs James's OK before anything is created in live mode)

One Enterprise subscription per company, two items:

1. **Enterprise base**: flat $49.99/month, quantity 1 (includes 3 users).
2. **Enterprise additional users**: graduated tiered price, quantity = total users − 3.
   Tiers: first 2 at $19.99, next 5 at $17.99, then $15.99. (`ENTERPRISE_SEAT_TIERS`.)

Graduated tiers give exactly the spec's non-retroactive pricing (200 users = $3,218.02, tested against
a Stripe-style evaluation for 1-400 users). Seat changes update item 2's quantity with
`proration_behavior: create_prorations`; the preview uses Stripe's upcoming-invoice API so the admin
sees the exact prorated charge before confirming. The webhook writes `seat_quantity = 3 + item 2 qty`.
Checkout and portal reuse the existing routes and live-key guard. No annual Enterprise plan.

Multiple cards (8.6): v1 is consolidated billing with one default card managed in the Stripe portal.
Split billing would mean separate subscriptions per billing group; the schema allows several
`subscriptions` rows per company, but seat allocation across groups is deferred until asked for.

## 6. Phases and PRs

| Phase | PR content | DB migration | Owner action |
|---|---|---|---|
| 1 (this PR) | Implementation map, workspace/roles/teams/invitations schema, RLS, entitlement function, pricing + permission modules, tests | `20261114005000_enterprise_workspace.sql` | Paste SQL (no visible change until a company exists) |
| 2 | Enterprise on pricing page, Enterprise Checkout, webhook → `create_company` + seats, seat add/remove with proration preview, billing history/invoices, failed payment banner | small (plan/price columns if needed) | Approve creating 2 live Stripe prices; set `STRIPE_PRICE_ENTERPRISE_BASE` / `STRIPE_PRICE_ENTERPRISE_SEAT` in Netlify |
| 3 | Command Center shell + nav (Overview, Bids & Pipeline, Team Performance, Estimating Intelligence, Saved Pricing, Users & Permissions, Billing & Licenses, Company Settings), Users & Permissions UI, invite emails + accept page, teams, read-only review view of teammates' bids, company Saved Pricing (6.9) | policies for company saved items | none expected |
| 4 | KPI dashboard (server-side aggregates), filters, CSV export, pipeline stages, manager dashboards, optional approval rules + review history | pipeline/review tables, aggregate RPCs, indexes | none expected |
| 5 | Trade statistics, geographic rollups with minimum sample sizes, deterministic anomaly alerts (median/IQR per trade+unit), weekly executive report (exportable; schedulable later) | alerts table | none expected |

## 7. Risks and how they're handled

* **Changing `has_unlimited`**: it gates credits and the library. Covered by the existing credit,
  quota and library DB tests plus new tier tests; individual Unlimited behavior is asserted unchanged.
* **RLS rewrite of `estimates_own_all` / `customers_own_all`**: identical for personal rows (company_id
  IS NULL). Personal list screens now also filter by `user_id` so a company owner's "My bids" stays
  personal once teammates' bids become readable.
* **Builder on a teammate's bid**: a manager opening a teammate's bid by URL can read it but saving
  fails (save_estimate is owner-only). Phase 3 adds a proper read-only review view. No company exists in
  production until Phase 2, so this can't happen before then.
* **Migration order**: additive, idempotent, and safe whether or not the comp migration ran first.
  Rollback steps are at the end of the migration file.
* **Scale (Part 18)**: indexes on `(company_id, user_id, updated_at)`; RLS uses a once-per-query
  visibility set rather than per-row lookups; dashboards will use server-side aggregate RPCs and
  pagination, never loading every bid into the browser.
