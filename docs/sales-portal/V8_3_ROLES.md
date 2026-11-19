# Sales Hub V8.3: dual roles

Migration `20270113001000_sales_v83_roles.sql`, rollback in `supabase/rollback/`.

## Roles

| Login is… | Gets | How it's set |
|-----------|------|--------------|
| Sales Rep | My Sales Hub | Active `sales_reps` row (role rep/manager) |
| Sales Admin only | Admin Sales Hub | `sales_reps.role = 'admin'`, `sells = false` |
| Rep + Sales Admin | Both, with the switcher | `role = 'admin'`, `sells = true` |
| Platform Owner + Rep | Both, with the switcher | `admin_roles` + a `sales_reps` row with the owner's email (now allowed) |
| Platform Owner + Sales Admin | Admin Sales Hub, all powers | `admin_roles` only |

An Enterprise company admin is a customer role and gets nothing in the Sales Hub.

## Capabilities (computed by `sales_capabilities(user)`)

* **Rep:** view_own_leads, edit_own_leads, import_own_leads, send_own_outreach, view_own_commissions.
* **Sales Admin:** view_admin_hub, view_all_reps, view_all_leads, reassign_leads, approve_commissions, review_compliance, manage_reps, export_reports, set_team_goals.
* **Platform Owner only:** edit_commission_policies, adjust_commissions, payout_operations, manage_sales_admins.

Every `admin_sales_*` function calls `sales_require_admin` (now: has view_admin_hub). Policy save, milestone
rules, commission adjustments and payout recording add an owner-only check through thin wrappers; the
original V8.2 functions were renamed `*_v82` and are unchanged. Only the owner can grant, change or remove
the Sales Admin role, and nobody but the owner edits their own team record.

**Separation of duties:** a Sales Admin can't approve or cancel their own statement or milestone box
(`cannot_approve_own`). The owner can.

## The switcher

"My Sales Hub | Admin Sales Hub" appears only for people with both. It goes through `/sales/view?to=…`,
which remembers the choice in a `sales_view` cookie so `/sales` opens where they left off. It never changes
a role: pages and actions check capabilities on the server either way. Admin-only members who open a My
Sales Hub page are sent to `/sales/admin`. The old `/admin/sales-hub` redirects to `/sales/admin`.

## Admin Sales Hub

Overview (team goal, team activity totals), Representatives, Activity & analytics, All leads, Customers,
Commission approvals, Statements & payouts, Compliance, Policies.

* **Rep detail** (`/sales/admin/reps/<id>`): "Viewing Sarah's Sales Activity" with range filters, funnel,
  contacted leads per week, calls, emails, follow-ups, overdue tasks, meetings, closed sales, conversion,
  trials, commissions, pending and unpaid amounts, milestones, leads, customers and statements. Read through
  `admin_sales_rep_detail`, not by signing in as the rep; every view is audited. CSV export needs
  export_reports, is formula-injection safe and is audited.
* **Reporting** sums per-rep rows, so each sale counts once. The "Include / Exclude admin-reps" filter
  removes members who are also administrators.
* **Compliance** shows real certification and overdue-task data. Tax forms and agreements say "Not collected
  yet" until tax onboarding ships.
* Admin lead actions (assign, reassign) record the admin as the actor.

## Notifications

One bell in the top right, from `sales_my_notifications()`. Personal items (overdue follow-ups, gift box
ready) and Administrative items (statements and bonuses to approve, unassigned leads, payouts to record).
Each item appears once. Administrative items never include the person's own pay. Groups are labelled only
for people with both roles.

## Not in this stage

Two-step sign-in enforcement for sales staff, inactivity sign-out, offboarding and the rest of the V8.2
compliance items follow in the next stage.
