# V6.7 Enterprise Workspace & Granular Feature Access

Company → **Team & Access** (`/company/users`) gives each employee a **Manage Access** editor organised around the
four workspaces: Win the Job, Run the Job, Grow the Business and Financials (plus Company administration).

## Not a second permission system

* `src/lib/access/capabilities.ts` is the capability registry. Every feature level is a named bundle of the
  **existing** company permissions (`company_permission_keys()`) or Financial Command Center permissions.
  Each permission belongs to exactly one feature (tested).
* Saving writes the same `permissions_granted` / `permissions_revoked` arrays the older editor wrote, so RLS,
  `has_company_permission()`, `fin_has_permission()` and every RPC keep enforcing records and API calls.
* `company_members.access_profile` stores only UI intent: workspace master switches, the template applied, and
  on/off for the four features no permission backs (Customers, pricing library, proposal templates, team
  directory). Those four are enforced by the app: navigation, direct-URL layouts, search kinds, actions.

## Precedence (highest first)

1. Platform security (RLS / database functions).
2. Plan and seats (`License`: Project Command Center, scheduling editor seat, Financial Command Center + seat,
   Premium). A grant never bypasses them and toggling access never buys anything.
3. Primary account holder policy (`company_access_policies`): **Restrict** = nobody but the owner holds it
   (applied by a trigger on every write path); **Lock** = only the owner can change it for anyone.
4. Per-person grants and denies (a deny always wins).
5. Role defaults (company role + financial seat preset). Role templates are starting points.

## Where it is enforced

| Surface | How |
| --- | --- |
| Records / APIs | Existing permissions in the database (unchanged code paths). `fin_job_visible` PM fallback now respects an explicit Financials revoke. |
| Navigation | `sidebarAccess()` (src/lib/access/nav.ts) hides turned-off links; features kept inside a workspace that is off show under **Other access**, labelled. |
| Direct URLs | Segment layouts call `requireCapability` / `requireAnyCapability` → `/no-access`. `/dashboard` sends a member without Win the Job to their first workspace. A missing plan/seat is left to the page's own message. |
| Universal search | `searchableKinds()` drops kinds of turned-off features before the query, so titles, snippets, counts and related suggestions can't leak; recents are filtered the same way; command actions are filtered by the feature their page belongs to. |
| Accountant Mode | Unchanged rule (`canUseAccountantMode` / `fin_set_mode` read financial permissions), so turning Financials off removes the mode; the mode never grants anything. |
| Dashboards (V6.6) | Widgets declare `CapabilityRequirement`s and call `hasCapability(access, req)`; `loadEffectiveAccess()` / `GET /api/access/me`. Saved layouts keep hidden widgets. |

Solo accounts and the primary account holder are never restricted by this layer.

## Database

`supabase/migrations/20261222001000_workspace_access.sql` (rollback: `rollback_20261222001000.sql` here).
Functions: `company_member_access_save`, `company_access_policy_save`, `company_access_overview`,
`company_access_history`, `my_workspace_access`. Every change is audited in `company_audit_log`
(`member.access_updated` / `access.policy_updated`) with before/after and an optional reason. Before the SQL is
applied the app falls back to today's behaviour (older editor, no profiles).

## Tests

* `tests/access/capabilities.test.ts` (registry, resolver, templates, search/actions, Accountant Mode).
* `tests/db/workspace-access.test.ts` (real SQL: save + audit, delegated admin rules, locks, company-wide
  restriction on every write path, RLS hides schedules, tenant isolation, admin-only reads).
* `scripts/workspace-access/walk.mjs` (browser, mock Supabase; desktop / 390 / 320 px).
