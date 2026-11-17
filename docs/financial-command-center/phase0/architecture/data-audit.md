# Financial Command Center — Phase 0 Data Audit

**Author:** Agent 2 (Accounting Engine & Database) · **Date:** 2026-11-17
**Repo state audited:** `/home/user/bid2build` @ `710ca6a` (origin/main, "Customer Hub …" #87). 47 migrations, last = `20261122001000_customer_hub.sql`.
**Scope:** read-only audit. Nothing was applied, edited or committed.

Path shorthand used below: `M/` = `supabase/migrations/`. A citation such as `M/…enterprise_workspace.sql:60` means `supabase/migrations/20261114005000_enterprise_workspace.sql`, line 60. Migration file prefixes are shortened to the descriptive part where unambiguous.

---

## 0. Executive summary

| # | Finding | Severity for finance |
|---|---|---|
| R1 | **There is no financial data today.** No invoice, payment, deposit, AR/AP or ledger table exists. Money only appears as estimate prices, frozen proposal totals, change-order amounts, signature totals, sub-quote amounts and internal cost-forecast adjustments. | Info (greenfield) |
| R2 | **Ownership is dual: `user_id` (always) + nullable `company_id`.** `company_id IS NULL` = personal/solo. Companies exist **only** for Enterprise (created by `create_company()` from the Enterprise webhook or a comp grant). Solo users have no company row. Three different "solo vs company" patterns already coexist (see §2.4). | High — the finance tenant key must be decided once |
| R3 | **Cascading deletes everywhere.** Nearly every business row is `on delete cascade` from `auth.users` (personal rows) and from `estimates`. `POST /api/account/delete` hard-deletes the auth user and relies on that cascade (`src/app/api/account/delete/route.ts:34`). Owners can also `DELETE` their own estimates/customers directly through PostgREST (`M/core_schema.sql:463-469`, grants `:504`). Financial records attached with the same FK style would silently disappear. | **Critical** |
| R4 | **The "project" is the estimate.** Every project-ops table keys on `estimate_id` (`change_orders`, `project_reviews`, `project_scope_sections`, `subcontractor_quotes`, `project_photos`). `project_schedules` is optional, one *live* per estimate, archivable and cascades from the estimate. | High — reuse `estimates.id` as the job identity |
| R5 | **Customer identity is new and mutable.** `estimates.customer_id` was never set before Customer Hub (`M/customer_hub.sql:3-7`); the link is now set by a trigger and can be re-pointed, merged (`customer_merge` **deletes** the losing row, `:290-324`) or auto-deleted when orphaned (`drop_orphan_bid_customer`, `:208-219`). Company customer visibility is per bid-owner, not company-wide. | High |
| R6 | **Estimate totals are stored only on frozen versions.** Live `estimates` rows have no total columns; totals are computed in TypeScript (`src/lib/estimate/engine.ts:245-266`) and written once into `estimate_versions` (`M/core_schema.sql:186-189`). There is **no `rounding` column**: when `proposal_config.roundTotal` is on, `total ≠ subtotal + tax`. | Medium |
| R7 | **Deposits / payment schedule exist only as proposal text.** `proposal_config.paymentSchedule` = `[{label, percent}]` (`src/lib/proposal/types.ts:75-79`); the frozen `estimate_versions.proposal.paymentSchedule[].amount` is a **formatted string** (`"$1,234.00"`) (`src/lib/proposal/build.ts:90-99`). No deposit amount is ever recorded. | Medium |
| R8 | **Money types are consistent on the contractor side** (`numeric(14,2)` for amounts, `numeric(14,4)` for qty/unit cost, `numeric(9,4)` percents) but the platform-admin side uses `integer` cents (`admin_expenses.amount_cents`, `referrals.reward_cents`). No float money columns anywhere. | Low (good baseline) |
| R9 | **Stripe webhook dedupe is select-then-insert, not an atomic claim** (`src/app/api/stripe/webhook/route.ts:53-57`). Two concurrent deliveries of one event can both process. Safe today only because `apply_subscription_update` is ordered by `source_event_created`; **not safe for payment events**. | High for Phase 3 (Stripe Connect payments) |
| R10 | Change-order amounts carry **no tax treatment** and a manual "Won" approval picks the contract version by a **timestamp heuristic** (`M/project_documents.sql:309-317`). | Medium — needs owner/CPA rules |

---

## 1. Platform conventions observed (to reuse)

| Convention | Where | Notes for finance |
|---|---|---|
| uuid PKs, `created_at/updated_at`, `set_updated_at()` trigger | `M/core_schema.sql:10-15` | Reuse. |
| "Money as numeric, never float" | `M/core_schema.sql:1-3` | Reuse `numeric(14,2)`. |
| RLS on every table; **reads by policy, writes only through `SECURITY DEFINER` RPCs** with `revoke insert, update, delete` | e.g. `M/project_schedules.sql:110-130`, `M/project_documents.sql:124-142` | Finance should follow the RPC-only write model. |
| Write-once guard trigger `guard_write_once()` (allows delete only inside a cascade, `pg_trigger_depth() >= 2`) | `M/project_documents.sql:113-122` | Reuse for posted documents, **but** the cascade escape hatch must not apply to ledger rows. |
| Content-hashed frozen snapshots (`content_hash ~ '^[0-9a-f]{64}$'`) | `estimate_versions` `M/core_schema.sql:175-193`, `change_order_versions` `M/project_documents.sql:72-81`, `schedule_publications` | Reuse for contract snapshots and issued invoice PDFs. |
| Optimistic revision numbers (`revision`, `stale_revision` / 40001) | `M/projects_workspace.sql:158` | Reuse for invoice drafts. |
| Per-parent document numbering: `max(number)+1` under `FOR UPDATE` of the parent | `change_order_save` `M/project_documents.sql:175-177` | Good for per-estimate CO numbers; **not** sufficient for per-company gapless invoice numbers (see proposed-schema). |
| Idempotency keys: `comm_messages.idempotency_key text unique` (`M/customer_communications.sql:264`), `analytics_events.event_id` unique (`M/growth_activation.sql:24-25`), `user_notifications (user_id, dedupe_key)` unique | — | Reuse naming: `idempotency_key`. |
| Error mapping by message token (`forbidden`, `bad_state`, `stale_revision`…) | `src/lib/operations/server.ts:10-32` | Finance RPCs should raise the same tokens. |
| Rollback scripts per migration in `docs/<area>/rollback_<ts>.sql` | `docs/project-operations/`, `docs/pipeline/`, `docs/customer-hub/ROLLBACK.sql` | Follow. |
| DB tests per migration in `tests/db/*.test.ts` on a real Postgres harness (`tests/db/harness.ts`, `pg-supabase.ts`) | `tests/db/` | Finance fixtures go here. |

---

## 2. Tenancy, membership, permissions, audit

### 2.1 Tables

| Table | Key columns | FKs / constraints | RLS | Ref |
|---|---|---|---|---|
| `companies` | `id`, `name`, `owner_user_id`, `billing_email`, `settings jsonb` | `owner_user_id → auth.users ON DELETE RESTRICT` | select: `id = my_company_id()` | `M/enterprise_workspace.sql:47-56, 397-399` |
| `company_members` | PK `(company_id, user_id)`, `role ∈ {owner, manager, estimator, viewer}`, `status ∈ {active, deactivated}`, `permissions_granted text[]`, `permissions_revoked text[]` | `company → companies CASCADE`, `user → auth.users CASCADE`; **one active company per person** (`:82`), **one owner per company** (`:83`); granted/revoked `<@ company_permission_keys()` (`:77-79`) | own row, or whole roster with `manage_users` | `:60-86, 401-403` |
| `company_teams`, `company_team_members` | team + `is_manager` | team_members FK `(company_id,user_id) → company_members` | members of the company | `:88-106` |
| `company_invitations` | `token_hash`, `role`, `expires_at` | pending invite reserves a seat | no policies (RPC only) | `:108-124` |
| `company_audit_log` | `bigint identity`, `company_id`, `actor_id`, `action`, `target_type/id`, `details jsonb` | company CASCADE | select needs `manage_users` | `:126-136, 410-412` |
| `audit_logs` (platform) | `actor_id`, `action`, `target_*`, `details` | — | no policies (service role) | `M/core_schema.sql:405-413` |
| `admin_roles` | platform `admin/support` | — | service role | `M/core_schema.sql:398-403` |

**Data ownership columns added by Enterprise:** `estimates.company_id/created_by`, `customers.company_id/created_by` (`ON DELETE RESTRICT` to companies), `saved_items.company_id`, `assemblies.company_id` (`CASCADE`) — `M/enterprise_workspace.sql:139-147`. `stamp_company_owner()` stamps `company_id` on **new** estimates/customers of an active member (`:342-354`); pre-existing personal bids are never moved (`docs/enterprise/IMPLEMENTATION_MAP.md:61`). `preserve_company_records()` reassigns company bids to the owner before an employee's login is deleted (`:358-385`).

### 2.2 Permission model

* Catalog: `company_permission_keys()` — redefined (whole list) in each later migration. **Current authoritative version:** `M/customer_communications.sql:28-48` (48 keys incl. `view_costs`, `view_margin`, `view_subcontractor_costs`, `edit_project_costs`, `create_change_orders`, `send_change_orders`, `manage_billing`, `manage_pm_seats`, …).
* Role defaults: `company_role_permissions(role)` (`M/customer_communications.sql:49-73`); owner = all keys automatically.
* Owner-only delegations: `company_owner_only_permissions()` (`:76-80`): `manage_billing, manage_users, manage_pm_seats, manage_pm_addons, change_proposal_policy, enable_customer_nurture, enable_auto_project_updates`.
* Effective permissions: `member_permissions(role, granted, revoked)` (`M/enterprise_workspace.sql:160-168`); check: `has_company_permission(company, key)` (`:181-188`).
* Escalation guard: a non-owner can only hand out keys they hold and never owner-only keys (`update_company_member`, `:541-548`).
* TS mirror: `src/lib/enterprise/permissions.ts` (UI only; `tests/db/enterprise-workspace.test.ts` checks DB↔TS agreement).
* Visibility helpers: `my_visible_bid_owners()` (`:192-210`, set-returning, evaluated once per query), `estimate_readable()` (`M/project_operations.sql:71-79`), `estimate_permission(estimate, key)` — solo owner may do everything to own bid; company bid needs visibility + key (`M/project_operations.sql:82-89`).

**Gap:** no financial keys exist. The closest are `view_costs`, `view_margin`, `view_subcontractor_costs`, `edit_project_costs`, `manage_billing` (Built2Bid subscription billing, not contractor finance). Roles are a hard `check (role in (...))` with four values, so "Bookkeeper/Accountant/Financial admin" cannot be added as roles without a constraint change.

### 2.3 Entitlement functions

| Function | Behaviour | Ref |
|---|---|---|
| `company_entitlement(company)` → `(active, source, seat_limit, expires_at)` | Paid Enterprise sub (`plan='enterprise'`, active/trialing/past_due within period; seats = `greatest(seat_quantity,3)`) or Enterprise comp grant (3 + `extra_seats`) | `M/enterprise_workspace.sql:234-257` |
| `user_entitlement(user)` → `(tier free|unlimited|enterprise, source, company_id, expires_at)` | Enterprise seat > individual Unlimited sub > personal comp grant > free | `:261-301` |
| `has_unlimited(user)` | `tier <> 'free'` (legacy callers) | `:305-308` |
| `my_entitlement()` | browser-safe wrapper | `:314-317` |
| `company_seats_used()` | active members + pending invites | `:323-328` |
| `complimentary_grants` | `plan ∈ {unlimited, enterprise}`, `included_seats`, `extra_seats`, `company_id`, `status`, `pm_editors` | `M/complimentary_access.sql:27-60`, `M/pm_entitlements.sql:53-56` |
| `pm_entitlement(user)` → `(scope company|individual|none, company_id, editor_limit, editors_assigned, can_edit, source, edit_until)` | Enterprise: 1 included + `subscriptions.pm_extra_editors`; earliest `pm_editors.assigned_at` wins when over limit. Individual: `subscriptions.pm_addon` on an Unlimited sub, or comp `pm_editors`. | `M/pm_entitlements.sql:74-131` |
| `pm_editors` | `(company_id, user_id)`, `assigned_by/at` | `:59-70` |
| `apply_pm_update()` | mirrors Stripe items onto `subscriptions.pm_addon / pm_addon_until / pm_extra_editors`, ordered by `source_event_created` | `:27-50` |

These are the exact template for a **financial-seat entitlement** (included seats + paid extra quantity + comp override + "earliest assignment wins").

### 2.4 Personal-vs-company duality (flag)

Three coexisting patterns for "account = company or solo user":

| Pattern | Tables | Ref |
|---|---|---|
| A. `user_id NOT NULL` + nullable `company_id` (NULL = personal) | `estimates`, `customers`, `project_schedules`, `change_orders`, `signatures`, `project_reviews`, `project_photos`, `subcontractor_quotes` … | `M/enterprise_workspace.sql:139-142` |
| B. XOR: `company_id` or `owner_id`, `check ((company_id is null) <> (owner_id is null))` | `pm_resources` | `M/team_assignments.sql:19-42` |
| C. `account_id uuid` + `account_kind ∈ {company,user}` (no FK) | `comm_settings` | `M/customer_communications.sql:143-145` |

How solo users are handled today: always `company_id IS NULL` and "the owner may do everything" (e.g. `estimate_permission` `M/project_operations.sql:84`; `schedule_set_people` restricts solo rep/PM to the owner `M/projects_workspace.sql:125-128`; `pm_people()` returns "self" only when `my_company_id() is null` `:201-211`). A user who joins a company keeps their old personal bids personal, so **one person can own records in two scopes**.

Why an "auto personal company" would break current code (evidence for the proposed-schema decision):
* `stamp_company_owner()` would stamp every new bid/customer of that user with the company (`M/enterprise_workspace.sql:342-354`), so Customer Hub matching (`match_bid_customer` scopes by company vs personal, `M/customer_hub.sql:100-101`) would start creating **duplicate customers** for people already in the personal scope.
* `can_schedule_estimate()` / `pm_estimate_access()` require `pe.scope = 'company'` for company bids (`M/project_schedules.sql:138-141`, `M/pm_permissions.sql:66-76`); a solo Unlimited+PM user (`scope='individual'`) would lose scheduling on new bids.
* `company_members_one_active_company` (`M/enterprise_workspace.sql:82`) would block that user from accepting an Enterprise invitation elsewhere.
* Companies drive Enterprise UI (`my_company()` returns entitlement/seat data `:482-496`).

---

## 3. Customers

| Item | Detail | Ref |
|---|---|---|
| Table | `customers(id, user_id NOT NULL → auth.users CASCADE, company_id → companies RESTRICT, created_by, name, email, phone, project_address, notes, source ∈ {manual,bid,backfill}, customer_type ∈ {person,business}, company_name)` | `M/core_schema.sql:74-86`, `M/customer_hub.sql:28-37` |
| Bid → customer link | `estimates.customer_id → customers ON DELETE SET NULL` (`M/core_schema.sql:94`). Trigger `link_estimate_customer()` (before insert/update) matches or creates a customer in the bid's scope; match = same email + compatible name, same phone + compatible name, or same name + same address (`M/customer_hub.sql:88-111, 117-200`). Linking never blocks a save (exception swallowed `:199`). | |
| Bid keeps its own copy | `estimates.customer_name/email/phone/project_address` text remains on the bid; frozen in `estimate_versions.snapshot` and `signatures.customer_name`. | `M/core_schema.sql:101-105` |
| Merge | `customer_merge(keep, remove)` re-points `estimates`, `project_photos`, `comm_contacts`, `comm_messages`, then **deletes** `remove` | `M/customer_hub.sql:290-324` |
| Orphan cleanup | `drop_orphan_bid_customer()` deletes auto (`source<>'manual'`) customers with no bids/photos/comms | `:208-219` |
| RLS | `customers_own_all` (owner CRUD, direct writes allowed), `customers_company_select` (per visible bid owner), `customers_linked_select` (anyone who can read one linked bid) | `M/enterprise_workspace.sql:425-431`, `M/customer_hub.sql:242-244` |

**Finance implications:** (a) finance FKs to `customers` must be `RESTRICT`, and `customer_merge` / `drop_orphan_bid_customer` must be taught about finance tables (same way they already know `project_photos` and `comm_*`); (b) a bookkeeper must see every customer with a balance even when bid-owner visibility would hide it — so invoices need a **bill-to snapshot** and finance RLS independent of `customers` RLS; (c) owners can `DELETE` customers directly via PostgREST today — `RESTRICT` turns that into a visible error, which is the desired behaviour.

---

## 4. Estimates, versions, line items, totals, pipeline

### 4.1 Tables

| Table | Finance-relevant columns | Ref |
|---|---|---|
| `estimates` | `user_id → auth.users CASCADE`, `company_id`, `customer_id`, `estimate_number text`, `status ∈ {draft,finalized,archived}`, `pricing_mode`, `pricing_percent numeric(9,4)`, `fixed_adjustment numeric(14,2)`, `tax_rate numeric(7,4)` (single rate), `trades text[]`, `proposal_config jsonb` (holds `paymentSchedule`, `roundTotal`, `worksheet.sectionTrades`), `pipeline_stage`, `won_at` | `M/core_schema.sql:91-127`, `M/enterprise_pipeline.sql:10-19`, `M/sales_pipeline.sql:14-17` |
| `estimate_groups` (sections) | `name`, `pricing_mode/percent`, `sort_order`; trade per section lives in `proposal_config.worksheet.sectionTrades[group_id]` | `M/core_schema.sql:129-144`, `M/project_schedules.sql:175` |
| `estimate_items` | `cost_type ∈ {material, labor, equipment, subcontractor, overhead, contingency, permit, delivery, labor_burden, other}` (widened in `M/saved_items_library.sql:98-99`), `treatment ∈ {marked_up, pass_through}`, `quantity numeric(14,4)`, `unit_cost numeric(14,4)`, `taxable`, `category` | `M/core_schema.sql:146-170` |
| `estimate_versions` (immutable) | `version_number`, `content_hash`, `snapshot jsonb`, `proposal jsonb`, **`total_cost`, `subtotal`, `tax`, `total` numeric(14,2)** | `M/core_schema.sql:175-194`; write-once trigger `M/project_documents.sql:25-34` |
| `generated_documents` | `version_id`, `storage_path` (bucket `documents`) | `M/core_schema.sql:196-204` |
| `estimate_stage_history` | `from_stage`, `to_stage`, `changed_by`, `effective_at` | `M/enterprise_pipeline.sql:30-40`, `M/sales_pipeline.sql:18` |
| `estimate_project_profiles` | market-intelligence profile per estimate | `M/market_intelligence.sql:39` |

`pipeline_stage ∈ {draft, ready_for_review, approved, sent, pending, won, scheduled, in_progress, completed, lost}` (`M/sales_pipeline.sql:15`); `won_at` and stage are guarded so only `set_estimate_stage()` writes them (`M/sales_pipeline.sql:26-127`). "Accepted" = stage in `{won, scheduled, in_progress, completed}` **or** a signature exists (`estimate_is_accepted`, `M/project_schedules.sql:156-160`).

### 4.2 Totals: stored or computed?

* **Live estimate: computed** — `computeTotals` in `src/lib/estimate/engine.ts` (decimal.js, `round2` half-up per line `:180-182`, tax `round2(taxableBase × rate)` `:245`, optional whole-dollar rounding of the final total `:249`, `rounding = total − calculatedTotal` `:266`). Rules documented in `src/lib/estimate/money.ts:3-13` and `docs/ARCHITECTURE.md:11`.
* **Frozen version: stored** — the server passes `totals.*.toFixed(2)` strings into `finalize_bid()` (`src/lib/export/finalize.ts:85-95`; SQL `M/two_balance_credits.sql:189`). The DB trusts these numbers; it does not recompute.
* **Risks:** no `rounding` column (derive `total − subtotal − tax`); `subtotal` already includes `fixed_adjustment`; `total_cost` is the estimator's cost basis (useful as job budget) but excludes later `project_cost_adjustments`.

### 4.3 Deposits / payment terms

* `proposal_config.paymentSchedule: [{label, percent}]` (zod `src/lib/estimate/schema.ts:183`, default 30/40/30 `src/lib/proposal/types.ts:75-79`).
* Frozen in `estimate_versions.proposal.paymentSchedule: [{label, percent, amount}]` where `amount` is `formatCurrency()` output (string with `$` and commas); last milestone absorbs rounding when percents sum to 100 (`src/lib/proposal/build.ts:90-99`).
* No deposit received, due date, retainage or invoice field exists anywhere. `grep -i retainage` → nothing.

---

## 5. E-signatures (signed agreements)

| Table | Key columns | Notes | Ref |
|---|---|---|---|
| `signing_requests` | `estimate_id`, `version_id → estimate_versions`, `token_hash`, `document_hash`, `content_hash`, `status ∈ {pending,signed,revoked}`, `expires_at` | server-only writes | `M/e_signatures.sql:20-40` |
| `signatures` | `request_id unique`, `estimate_id`, `version_id`, `user_id`, `company_id (SET NULL)`, signer evidence, **`total numeric(14,2)`**, `version_number`, `proposal_number`, `customer_name`, `signed_at`, `pdf_status/pdf_path/pdf_hash` | evidence write-once (`guard_signature_record` `:92-110`); signed estimates/versions cannot be deleted except by account cascade (`:114-139`) | `:45-90` |

Contract value today is assembled on read by `project_proposal_history()` (`M/project_documents.sql:303-345`): approved version = latest **signed** version, else (manual Won) the latest version created by `won_at + 1 minute` (`:309-317`) — a heuristic that finance should replace with an explicit, user-confirmed contract snapshot.

---

## 6. Change orders

| Table | Key columns | Ref |
|---|---|---|
| `change_orders` | `estimate_id`, `user_id`, `company_id`, `number` (unique per estimate), `lines jsonb [{kind add|remove|modify, description, amount}]`, **`amount numeric(14,2)` = signed sum of lines**, `schedule_days`, `status ∈ {draft, sent, approved, signed, declined, void}`, `version`, `approval_method ∈ {manual, signature}`, `approval_note` (required for manual), `approved_version`, `decided_at/by`, `source_quote_revision_id` | `M/project_documents.sql:37-70` |
| `change_order_versions` (write-once) | `content jsonb` (incl. `amount`), `content_hash` | `:72-81, 119-120` |
| `change_order_signing` / `change_order_signatures` (write-once) | token hash; signer evidence; **`amount numeric(14,2)`** copied from the frozen version | `:82-110` |

State machine (`change_order_save/send/decide/accept_signing`, `:156-298`): draft → sent → approved (manual, note) | signed (e-sign) | declined | void; revise returns sent/declined → draft. **Approved/signed cannot be voided** (`:245`). Only approved/signed count toward contract value (`:7-10`). Line amounts rounded to 2 dp, |amt| ≤ 1e8 (`:168-169`). **Gaps:** no tax on COs; no deduction/credit concept other than negative lines; approval is audited to `company_audit_log` only for company bids.

---

## 7. Projects, operations, documents, photos, schedules

| Table | Key columns / behaviour | Ref |
|---|---|---|
| `project_schedules` | `estimate_id → estimates CASCADE` (one non-archived per estimate `:45`), `user_id`, `company_id`, `status ∈ {draft, active, completed, archived}`, `source_version_id`, `source_snapshot` (scope only — **no costs/prices** `:13-15, 165-183`), `sales_rep_id`, `project_manager_id`, `actual_finish`, `closed_at/by` | `M/project_schedules.sql:20-49`, `M/projects_workspace.sql:18-23` |
| `schedule_tasks`, `schedule_dependencies`, `schedule_revisions` | Gantt; `resource_id → pm_resources` | `M/project_schedules.sql:51-108`, `M/team_assignments.sql:78-87` |
| `schedule_publications` | frozen customer updates | `M/schedule_publications.sql:18-30` |
| `project_activity` | per-schedule activity log (internal/customer) | `M/projects_workspace.sql:48-66` |
| `project_reviews` | Needs-PM-Review queue keyed by `estimate_id` (signature or manual Won) | `M/project_operations.sql:92-116` |
| `project_scope_sections` (+ revisions) | per estimate section: trade, internal/sub-facing notes, `resource_id` | `M/project_documents.sql:369-415` |
| `scope_shares` (+ versions) | frozen subset for a subcontractor via secret link | `:490-…` |
| `project_photos` | `customer_id` or `estimate_id`, `storage_path` (bucket `project-photos`) | `M/project_photos.sql:21-48` |
| `user_notifications` | in-app task review notices | `M/project_operations.sql:280-…` |

Project RLS follows the source estimate (`project_schedules_select … exists (select 1 from estimates …)`, `M/project_schedules.sql:116-118`). Edit rights need the PM entitlement + visibility (`pm_estimate_access`, `M/pm_permissions.sql:66-76`). "Viewing an assigned project never grants internal financial access" (`M/projects_workspace.sql:12-13`) — keep this rule for finance.

---

## 8. Subcontractors, team directory, sub quotes, internal costs

| Table | Key columns | Ref |
|---|---|---|
| `pm_resources` | XOR `company_id`/`owner_id`; `kind ∈ {staff, subcontractor, crew}`; `name`, `contact_name`, `linked_user_id`, `trades[]`, `email`, `phone`, `status ∈ {active, archived}` | `M/team_assignments.sql:19-42` |
| `pm_crew_members` | crew composition | `:44-49` |
| `subcontractor_quotes` | `estimate_id`, `item_id` (estimate line), `group_id`, `resource_id → pm_resources SET NULL`, `vendor_name text`, `estimated_cost numeric(14,2)` (frozen line cost), `status ∈ {received, under_review, accepted, rejected}`, `applied_revision_id` | `M/project_documents.sql:618-638` |
| `subcontractor_quote_revisions` (write-once) | `amount numeric(14,2)` 0..1e8, `quote_date`, `document_path` (bucket `project-files`) | `:640-655` |
| `project_cost_adjustments` (write-once) | `estimate_id`, `item_id`, `group_id`, `quote_id`, `amount` (delta), `forecast_cost` (after) — internal forecast only, never a price | `:656-671` |

Access: `can_view_sub_costs` (`view_subcontractor_costs`, or own bid + `view_costs`) and `edit_project_costs` (`:600-616, 739-760`). **There is no vendor master with payment/tax data, no bills, no actual-cost record.** `pm_resources` is a scheduling directory (no suppliers, no 1099 fields).

### Saved items (cost library)

`saved_items(unit_cost numeric(14,4), cost_type, treatment, trade, category, quantity, company_id)` and `assemblies/assembly_items` — `M/core_schema.sql:264-300`, `M/saved_items_library.sql:16-19`. Useful only as cost-code/category vocabulary; not transactional.

### Sales pay settings

`sales_pay_settings(user_id PK, method, rate numeric(7,3), flat_fee numeric(12,2), base_salary numeric(12,2))` — private calculator inputs (`M/sales_pipeline.sql:206-220`). Not payroll; do not treat as a liability source.

---

## 9. Storage buckets and policies

| Bucket | Limits | Path convention | storage.objects policies | Ref |
|---|---|---|---|---|
| `logos` | 2 MB, png/jpeg/webp/svg | `<user_id>/…` | owner select/insert/update/delete on own folder | `M/storage.sql:2-16` |
| `documents` | 20 MB, pdf | `<user_id>/<estimate_id>/v<n>-<hash>.pdf` | owner select only; service role writes | `M/storage.sql:18-20`, `src/lib/export/finalize.ts:106` |
| `project-photos` | 10 MB, jpeg/webp | `<company_id or user_id>/…` | **none** (service role + signed URLs) | `M/project_photos.sql:16-19`, `src/app/api/photos/route.ts:63` |
| `project-files` | 15 MB, pdf/jpeg/png/webp | `<company_id or user_id>/sub-quotes/<estimate>/<uuid>.<ext>` | **none** | `M/project_photos.sql:16-19`, `src/lib/operations/server.ts:48-53`, `src/app/api/estimates/[id]/sub-quotes/route.ts:64` |

Content sniffing is enforced server-side (`sniffDocument`, `src/lib/operations/server.ts:39-44`). **Gap:** account deletion only removes `logos` and `documents` objects (`src/app/api/account/delete/route.ts:21-32`); `project-files`/`project-photos` objects are orphaned. For finance documents (receipts, bills, W-9s, bank statements) a new private bucket with a book-scoped prefix and retention rules is needed.

---

## 10. Stripe billing code (Built2Bid's own subscriptions)

| Piece | Behaviour | Ref |
|---|---|---|
| `billing_customers(user_id PK, stripe_customer_id unique)` | user ↔ Stripe customer | `M/core_schema.sql:229-233` |
| `subscriptions` | PK `stripe_subscription_id`; `user_id`, `status`, `plan ∈ {monthly, annual, enterprise}`, `price_id`, `current_period_end`, `source_event_created` (out-of-order guard), `company_id`, `seat_quantity`, `pm_addon`, `pm_addon_until`, `pm_extra_editors` | `M/core_schema.sql:235-250`, `M/enterprise_workspace.sql:150-155`, `M/pm_entitlements.sql:20-25` |
| `stripe_events(id PK, type, event_created, processed_at, error)` | event log | `M/core_schema.sql:252-259` |
| Webhook | verifies signature on raw body (`route.ts:42-49`); handles 8 subscription/invoice event types (`:21-30`); re-fetches the subscription (`:80`) and calls `applySubscription` → `apply_subscription_update` + `apply_pm_update` (`src/lib/billing/apply.ts:26-53`); marks `processed_at` (`:112`); returns 500 on error so Stripe retries (`:117-121`). | `src/app/api/stripe/webhook/route.ts` |
| Idempotency | **select `processed_at` → if missing insert** (`:53-57`). The insert result is not checked, so a concurrent duplicate proceeds. Downstream side effects are individually idempotent (`recordEvent` event ids, referral claim, founder email "once per user"). | |
| Outbound idempotency keys | `customer-${user.id}`, `checkout-${user}-${plan}-${attempt}`, `seats-…`, `pm-editors-…`, `pm-addon-…` | `src/app/api/stripe/checkout/route.ts:60,100`, `src/app/api/company/seats/route.ts:87` |
| Plans/prices | Unlimited $19.99/mo, $149/yr (`src/lib/billing/plans.ts:16-19`); Enterprise base + seat price (3 included) (`src/lib/billing/sync.ts:52-58`); PM add-on/editor prices (`src/lib/billing/apply.ts:9-15`) | |
| Tax | Stripe Tax on Checkout unless `STRIPE_AUTOMATIC_TAX=off` (`src/lib/billing/tax.ts`) | |
| Live gate | live keys refused unless `STRIPE_ALLOW_LIVE=true` (`src/lib/billing/stripe.ts:14-19`) | |
| Cents | Stripe amounts are integer cents in code (`listValueUsd` `route.ts:14-17`); converted only for analytics | |

**There is no Stripe Connect code** (no `accounts`, `account.updated`, `payment_intent.*`, `charge.dispute.*`, `payout.*` handling). Connect events arrive signed with a **different endpoint secret** and must not share this route's `HANDLED` set or the `stripe_events` table semantics without an `account` column.

---

## 11. Money column inventory

| Kind | Type | Columns |
|---|---|---|
| Contract / price amounts | `numeric(14,2)` | `estimates.fixed_adjustment`; `estimate_versions.total_cost/subtotal/tax/total`; `signatures.total`; `change_orders.amount`; `change_order_signatures.amount`; `subcontractor_quotes.estimated_cost`; `subcontractor_quote_revisions.amount`; `project_cost_adjustments.amount/forecast_cost` |
| Unit costs / quantities | `numeric(14,4)` | `estimate_items.quantity/unit_cost`; `saved_items.unit_cost/quantity`; `assembly_items.*`; `pricing_cache.amount` |
| Percents / rates | `numeric(9,4)`, `numeric(7,4)`, `numeric(7,3)` | `pricing_percent`, `tax_rate`, `sales_pay_settings.rate` |
| Platform admin money | `integer` cents | `admin_services.amount_cents`, `admin_expenses.amount_cents` (`M/admin_costs.sql:26,50`), `referrals.reward_cents` |
| Marketing spend | `numeric(12,2)` | `marketing_costs.amount_usd` (`M/growth_funnel.sql:69`) |
| JSON money | string | `estimate_versions.proposal.paymentSchedule[].amount` (formatted), `change_orders.lines[].amount` (JSON number) |

No `real`/`double precision`/`float` money. TS side uses decimal.js throughout the estimate engine. PostgREST returns `numeric` as JSON numbers — fine for display, but finance code must parse into decimal.js, never do arithmetic on JS numbers.

---

## 12. Gaps and risks for finance (consolidated)

1. **Deletion cascades (R3).** `auth.users → estimates/customers/change_orders/signatures…` cascade; owners can directly `DELETE` unsigned estimates and customers. Finance rows must use `ON DELETE RESTRICT` (never `CASCADE`) toward estimates, customers, users and companies, and the account-deletion route needs a finance-aware guard (retention/export) — a product + legal decision.
2. **Tenant key (R2).** Must pick one representation for finance; auto-personal-company breaks scheduling and customer matching (§2.4).
3. **Identity drift (R5).** Customer rows can be merged/deleted; estimates keep their own text copy. Financial documents need both an FK and a frozen bill-to snapshot.
4. **Contract value is derived on read with a heuristic (R10).** Finance needs a persisted, explicit contract snapshot and an append-only list of contract changes.
5. **Tax.** One `tax_rate` per estimate; change orders have no tax; sales tax payable timing (accrual vs cash) is undefined. Needs CPA input.
6. **Rounding.** `total` may include a whole-dollar rounding delta that is not a column; the payment schedule's last milestone absorbs remainders. Invoices must reproduce these exactly.
7. **No vendor master / no actual costs.** `pm_resources` lacks supplier kind and tax data; sub quotes are commitments at best; `project_cost_adjustments` is a forecast.
8. **Webhook idempotency (R9).** Replace select-then-insert with an atomic claim before any money moves through webhooks.
9. **Audit.** `company_audit_log` is company-only (personal accounts have no audit trail except platform `audit_logs`) and is readable only with `manage_users`. Finance needs its own append-only log readable with finance permissions, covering solo books too.
10. **Visibility model mismatch.** Bid visibility is per bid-owner/team; finance visibility must be per book (company-wide for bookkeepers) plus per job for PMs, without widening bid/cost visibility (`view_costs`/`view_margin` stay authoritative for estimate internals).
11. **Storage.** No bucket for financial documents; existing private buckets have no retention or deletion story beyond account deletion.
12. **Concurrency.** Existing numbering (`max(number)+1` under a parent row lock) is per-estimate; per-company gapless invoice numbers and payment allocation need explicit locking (see proposed-schema §8).
