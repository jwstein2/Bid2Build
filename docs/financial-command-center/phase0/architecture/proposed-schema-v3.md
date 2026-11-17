# Financial Command Center — Proposed Schema, V3 Addendum

**Author:** Agent 2 (Accounting Engine & Database) · **Date:** 2026-11-17 · **Status:** for review, nothing applied.
**Extends:** `proposed-schema.md` (same folder). Source: `../v3-addendum-summary.md` (owner's V3 addendum).
Citations: `M/…` = `supabase/migrations/…` in `/home/user/bid2build` @ `710ca6a`.

**Phase tags.** **P1** = first operational release (kept small). **P2** = with the double-entry ledger. **P4** = optional modules after bank import / Stripe Connect (P3). Every table below has a tag; anything not P1 can ship later without changing P1 tables.

---

## 0. What V3 changes in the base design

| Area | Change | Phase |
|---|---|---|
| Business & Trade Configuration | New `account_trade_profiles` (company **or** solo, XOR like `pm_resources`), reusing the existing trade taxonomy (`trade_categories` / `src/lib/trades`). Presets are UX-only and code-defined. | P1 |
| Project overrides | Job-level columns on `fin_jobs`; project trades stay on `estimates.trades` (no copy). | P1 |
| Cost dimensions | Every cost/budget row carries `job → trade_slug → estimate_group_id (section/phase) → schedule_task_id → cost_code_id`. | P1 (columns), P2 (allocations) |
| Budget model | `fin_budget_lines` snapshot from the contract version (P1); revisions + ETC forecasts (P2); views for committed / unbilled / forecast final / variance. | P1 / P2 |
| Commitments | `fin_commitments` gains revisions and lines; bills relieve commitments through `commitment_id` on bill lines, never by a second cost row. POs added. | P1 (subcontract + revisions), P2 (PO + lines + retainage payable) |
| Billing | `fin_billing_rules` per job, separate from the contract snapshot and from posting rules; SOV/progress (P2); AIA-style pay applications, T&M, cost-plus (P4). | P1 / P2 / P4 |
| Labor & equipment | Optional time entries with cost rate + burden + approval (no payroll); optional equipment directory/usage/maintenance. | P4 |
| Sub compliance | Vendor compliance documents with expirations and warnings; never "verified", never auto-pay/auto-block. | P4 |
| Dashboard | Per-company (and per-user) card preferences; essential alerts cannot be hidden. | P1 |
| Overhead & splits, Needs Review | Non-job costs, split allocations across jobs, review queue (AI suggestions only via review). | P2 (P1 has a read-only "uncoded" view) |
| Permissions | + `manage_financial_config`, `approve_vendor_bills`, `manage_sub_compliance`. | P1 |
| Revenue rule | Contract value ≠ revenue ≠ cash. **Schedule % complete (`schedule_tasks.percent_complete`) never drives revenue.** Any percentage-of-completion is cost-to-cost WIP in P2+, CPA-gated. | all |

---

## 1. Business & Trade Configuration (P1)

### 1.1 Existing taxonomy to reuse (no second taxonomy)

| Source | What it is | Ref |
|---|---|---|
| `public.trade_categories(slug PK, name, icon, family, featured, sort_order, active)` | DB catalog, public read | `M/core_schema.sql:314-322`; seeded by `scripts/gen-seed.ts:15` |
| `src/lib/trades/data.ts` | seed: 38 trades (`roofing`, `siding`, `decks`, `concrete`, `kitchens`, `bathrooms`, `interior-remodeling`, `drywall`, `painting`, `electrical`, `plumbing`, `hvac`, `pressure-washing`, `soft-washing`, `commercial-remodeling`, `general-contracting`, `handyman`, `other`, …) with `family ∈ {Exterior, Interior, Systems, Sitework, Structures, General}` | `src/lib/trades/data.ts:8-21, 28-618` |
| `src/lib/trades/catalog.ts` | `trades`, `getTrade`, `COST_TYPES` (11 cost types incl. `labor_material`) | `catalog.ts:40-70` |
| `estimates.trades text[]`, section trade in `proposal_config.worksheet.sectionTrades` | per-project trades | `M/core_schema.sql:96`, `M/project_schedules.sql:175` |
| `company_teams.trade`, `pm_resources.trades[]` | free-text/slug trades on teams and subs | `M/enterprise_workspace.sql:92`, `M/team_assignments.sql:27` |

### 1.2 DDL

```sql
-- One row per account (company OR solo owner), usable by finance AND by non-finance features
-- (onboarding, estimate templates). Never read by any entitlement or permission function.
create table public.account_trade_profiles (                                          -- P1
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid unique references public.companies (id) on delete cascade,  -- config, not a financial record
  owner_user_id         uuid unique references auth.users (id) on delete cascade,
  primary_trade_slug    text not null references public.trade_categories (slug) on update cascade,
  additional_trade_slugs text[] not null default '{}' check (cardinality(additional_trade_slugs) <= 30),
  market                text not null default 'residential' check (market in ('residential', 'commercial', 'mixed')),
  project_model         text not null default 'fixed_price'
                        check (project_model in ('fixed_price', 'time_materials', 'cost_plus', 'service_call', 'mixed')),
  payment_structure     text not null default 'deposit_progress_final'
                        check (payment_structure in ('deposit_progress_final', 'milestones', 'progress_sov', 'on_completion',
                                                     'time_materials', 'cost_plus', 'mixed')),
  labor_model           text not null default 'both' check (labor_model in ('employees', 'subcontractors', 'both')),
  uses_inventory        boolean not null default false,
  uses_equipment        boolean not null default false,
  preset_key            text check (preset_key in ('general_contractor', 'residential_remodeler', 'deck', 'roofing_siding',
                          'electrical', 'plumbing', 'hvac', 'concrete', 'painting', 'exterior_cleaning', 'drywall',
                          'commercial', 'custom')),
  preset_version        integer,                     -- version of the code-defined preset last applied
  updated_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint account_trade_profiles_scope check ((company_id is null) <> (owner_user_id is null))
);
-- additional_trade_slugs ⊆ trade_categories.slug: enforced by a trigger (arrays cannot carry FKs).
-- Writes via RPC: company -> manage_financial_config (or owner); solo -> owner. Read: any active member / the owner.
-- Every change is written to fin_audit_log (when a book exists) or company_audit_log.

-- Project-level overrides (job inherits the account profile when null).
alter table public.fin_jobs add column market        text check (market in ('residential', 'commercial', 'mixed'));          -- P1
alter table public.fin_jobs add column project_model text check (project_model in ('fixed_price', 'time_materials', 'cost_plus', 'service_call')); -- P1
-- Project trades are NOT copied: they are estimates.trades + section trades (single source).
```

### 1.3 Preset rules (code, not DB)

* Presets live in `src/lib/financials/presets.ts` (versioned), mapping a preset to existing trade slugs and UX defaults: e.g. `roofing_siding → [roofing, siding, gutters]`, `exterior_cleaning → [pressure-washing, soft-washing]`, `deck → [decks]`, `general_contractor → [general-contracting]`, `residential_remodeler → [kitchens, bathrooms, interior-remodeling]`, `commercial → [commercial-remodeling]`, `custom → []`.
* A preset supplies **suggestions only**: dashboard card order, quick actions, default reports, cost-code suggestions, billing workflow defaults, onboarding/help. Applying one is an explicit user action that writes ordinary rows (e.g. proposed cost codes the user confirms).
* **Never** read by `fin_entitlement`, `fin_has_permission`, RLS, pricing or Stripe. No trade tiers.
* **History is immutable to config:** every financial row stores its own dimensions (`trade_slug`, `cost_code_id`, `estimate_group_id`) at write time; changing the primary trade or preset updates no existing row. A DB test asserts this (§10, A3).

---

## 2. Cost dimensions and budget model

### 2.1 Dimension mapping

| Dimension | Column on cost/budget rows | Existing source | Notes |
|---|---|---|---|
| Company | `book_id` | `fin_books` | |
| Customer | via `fin_jobs.customer_id` (and `customer_id` on AR) | `customers` | |
| Project | `job_id` | `fin_jobs.estimate_id` → `estimates` | |
| Trade | `trade_slug → trade_categories` | `proposal_config.worksheet.sectionTrades[group]`, else `estimates.trades[1]` (same rule as `schedule_estimate_snapshot`, `M/project_schedules.sql:175`) | stored at write time |
| Section / Phase | `estimate_group_id` (no FK: estimates stay editable; the contract snapshot freezes ids) | `estimate_groups.id` = `schedule_tasks.source_group_id` (`M/project_schedules.sql:56`) = `project_scope_sections.source_group_id` | |
| Task | `schedule_task_id → schedule_tasks ON DELETE SET NULL` (optional) | `schedule_tasks` (`source_item_id` = estimate line) | time entries / commitments may point at a task |
| Cost code | `cost_code_id → fin_cost_codes` | trade + `cost_type` | |

These columns are added to `fin_job_costs`, `fin_vendor_bill_lines`, `fin_expenses`, `fin_commitment_lines`, `fin_budget_lines`, `fin_time_entries`, `fin_journal_lines` (P2 already has `job_id`, `cost_code_id`; add `trade_slug`, `estimate_group_id`).

### 2.2 Budget tables

```sql
-- Original budget, frozen from the contract version's snapshot (estimate_versions.snapshot holds item costs).
create table public.fin_budget_lines (                                                  -- P1
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.fin_books (id) on delete restrict,
  job_id            uuid not null references public.fin_jobs (id) on delete restrict,
  trade_slug        text references public.trade_categories (slug) on update cascade,
  estimate_group_id uuid,
  cost_code_id      uuid references public.fin_cost_codes (id) on delete restrict,
  cost_type         text not null,                      -- from estimate_items.cost_type
  original_amount   numeric(14,2) not null,             -- Σ round(qty × unit_cost, 2) for the group × cost_type
  estimated_hours   numeric(10,2),                      -- items with unit 'hour' and labor cost types (for labor variance, P4)
  source_version_id uuid not null references public.estimate_versions (id) on delete restrict,
  unique (job_id, estimate_group_id, cost_type)
);  -- write-once; Σ original_amount = fin_contract_snapshots.cost_basis (checked when created)

create table public.fin_budget_revisions (                                              -- P2
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.fin_books (id) on delete restrict,
  job_id         uuid not null references public.fin_jobs (id) on delete restrict,
  budget_line_id uuid references public.fin_budget_lines (id) on delete restrict,   -- null = new line (code below)
  cost_code_id   uuid references public.fin_cost_codes (id) on delete restrict,
  trade_slug text, estimate_group_id uuid,
  amount         numeric(14,2) not null,                -- signed delta
  reason         text not null check (reason in ('change_order', 'cost_adjustment', 'transfer', 'other')),
  contract_change_id uuid references public.fin_contract_changes (id) on delete restrict,
  project_cost_adjustment_id uuid references public.project_cost_adjustments (id) on delete restrict,  -- existing internal forecast moves
  status         text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  approved_by uuid references auth.users (id) on delete set null, approved_at timestamptz,
  note text, idempotency_key text not null, unique (book_id, idempotency_key)
);

create table public.fin_cost_forecasts (                                                -- P2 (ETC, one current row per code)
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  job_id        uuid not null references public.fin_jobs (id) on delete restrict,
  cost_code_id  uuid references public.fin_cost_codes (id) on delete restrict,
  estimate_group_id uuid,
  etc_amount    numeric(14,2) not null check (etc_amount >= 0),   -- estimate to complete
  method        text not null check (method in ('manual', 'budget_remaining', 'committed_remaining')),
  as_of         date not null,
  superseded_at timestamptz,                                       -- append-only history
  entered_by    uuid references auth.users (id) on delete set null
);
create unique index on public.fin_cost_forecasts (job_id, cost_code_id, coalesce(estimate_group_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where superseded_at is null;
```

### 2.3 Budget view (`fin_job_budget_v`, security invoker) — per job × trade × section × cost code

| Measure | Definition |
|---|---|
| Original budget | Σ `fin_budget_lines.original_amount` |
| Approved revisions | Σ approved `fin_budget_revisions.amount` (P1: 0) |
| Current budget | original + approved revisions |
| Actual | Σ `fin_job_costs.amount` where `cost_status='actual'` |
| Committed | Σ current commitment amounts (§3) |
| Unbilled commitments (open) | Σ per commitment `greatest(current_commitment − relieved, 0)` |
| Committed cost | actual + unbilled commitments (**no double count**: relieved bill amounts are inside actual, not in open) |
| ETC | current `fin_cost_forecasts.etc_amount`; default `greatest(current_budget − committed_cost, 0)` (P1 uses the default only) |
| Forecast final cost | `greatest(committed_cost, actual + ETC)` |
| Variance | current budget − forecast final (negative = overrun) |
| Forecast margin | (`fin_job_contract_v.current_contract` − forecast final) / current_contract |

Every total in reports is a sum of rows the user can drill into (source ids carried through the view); "missing data" states (no contract snapshot, uncoded costs, no budget) are returned as explicit flags, not zeros.

### 2.4 Overhead, splits, Needs Review (P2)

```sql
-- Non-job costs: fin_expenses / fin_vendor_bill_lines with job_id NULL post to overhead accounts (P2 GL).
create table public.fin_cost_splits (                                                   -- P2
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  source_type  text not null check (source_type in ('bill_line', 'expense', 'time_entry', 'equipment_usage')),
  source_id    uuid not null,
  job_id       uuid references public.fin_jobs (id) on delete restrict,     -- null = remains overhead
  cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  trade_slug text, estimate_group_id uuid,
  amount       numeric(14,2) not null,
  reversed_at  timestamptz
);
-- Rule: active splits of one source sum EXACTLY to the source amount (deferred constraint trigger); amounts from
-- percents use "last part absorbs remainder". Each split writes one fin_job_costs row (source_type = the split).
create table public.fin_overhead_allocation_rules ( /* P2: book, name, basis ('direct_cost','labor_hours','revenue','manual_percent'),
  source account/cost code, target jobs filter, period; produces fin_cost_splits for a period after review */ );

create table public.fin_review_items (                                                  -- P2
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  kind         text not null check (kind in ('uncoded_cost', 'possible_duplicate', 'unmatched_payment', 'commitment_overrun',
                                             'compliance_expiring', 'ai_suggestion', 'other')),
  entity_type  text not null, entity_id uuid not null,
  suggestion   jsonb,                                  -- AI/rule suggestion; NEVER applied without a person accepting it
  suggested_by text check (suggested_by in ('rule', 'ai')),
  status       text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null, resolved_at timestamptz,
  unique (book_id, kind, entity_type, entity_id)
);
-- P1 substitute: view fin_uncoded_costs_v (cost rows with cost_code_id or job_id missing).
```

---

## 3. Commitments: subcontracts, POs, revisions, relief

Separation the addendum requires: **quote ≠ commitment ≠ payable**. A `subcontractor_quotes` row (`M/project_documents.sql:618-638`) stays an estimating artifact; a commitment is created only by an explicit "Commit" action (`record_bills`); a payable exists only when a vendor bill is approved.

```sql
-- base table in proposed-schema.md §5.4, extended:
alter table public.fin_commitments add column number_seq bigint;                                   -- P1
alter table public.fin_commitments add column original_amount numeric(14,2);                       -- P1 (amount renamed -> original_amount)
alter table public.fin_commitments add column schedule_task_id uuid references public.schedule_tasks (id) on delete set null;  -- P1
alter table public.fin_commitments add column trade_slug text, add column estimate_group_id uuid;   -- P1
-- link chain: fin_commitments.vendor_id -> fin_vendors.resource_id -> pm_resources (Team & Subcontractors, M/team_assignments.sql:19)
--             fin_commitments.subcontractor_quote_id / quote_revision_id -> accepted quote (optional)
--             schedule_tasks.resource_id (M/team_assignments.sql:78) shows the same sub on the schedule
-- kind: 'subcontract' (P1), 'purchase_order' (P2)

create table public.fin_commitment_revisions (                                          -- P1
  id             uuid primary key default gen_random_uuid(),
  commitment_id  uuid not null references public.fin_commitments (id) on delete restrict,
  revision       integer not null check (revision >= 1),
  amount         numeric(14,2) not null,                -- signed delta to the commitment
  reason         text not null check (char_length(reason) between 1 and 500),
  contract_change_id uuid references public.fin_contract_changes (id) on delete restrict,  -- when driven by an owner CO
  status         text not null default 'approved' check (status in ('proposed', 'approved', 'void')),
  approved_by uuid references auth.users (id) on delete set null, approved_at timestamptz,
  idempotency_key text not null,
  unique (commitment_id, revision)
);  -- current_amount = original_amount + Σ approved revisions (view); write-once except status

create table public.fin_commitment_lines (                                              -- P2 (P1 commitments have one cost code)
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.fin_commitments (id) on delete restrict,
  line_no integer not null, cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  trade_slug text, estimate_group_id uuid, schedule_task_id uuid references public.schedule_tasks (id) on delete set null,
  description text not null, quantity numeric(14,4), unit_cost numeric(14,4), amount numeric(14,2) not null,
  unique (commitment_id, line_no)
);
alter table public.fin_commitments add column retainage_payable_percent numeric(7,4) not null default 0;  -- P2
```

**Relief without double counting**

1. Approving a bill line with `commitment_id` writes **one** `fin_job_costs` row: `cost_status='actual'`, `source_type='bill_line'`.
2. Commitments never write `actual` rows. Committed amounts are **not** stored as `fin_job_costs` rows in V3 (supersedes the base doc's `cost_status='committed'` rows); they are read from `fin_commitments` + revisions. `fin_job_costs.cost_status` keeps only `'actual'` (column retained for compatibility, check narrowed).
3. `relieved = Σ approved bill-line amounts linked to the commitment` (net of voids/credits). `open = greatest(current − relieved, 0)`. A bill above the open amount is allowed but raises a `commitment_overrun` review item (P2) / warning (P1).
4. Committed-cost report = actual + open. Bills without a commitment are actual only. Tests A6/A7 (§10).

---

## 4. Billing schedules and rules

Three layers, kept separate:

| Layer | Holds | Table |
|---|---|---|
| Contract | what was sold (frozen) | `fin_contract_snapshots`, `fin_contract_changes` (base doc) |
| **Billing rules** | how and when we bill this job | `fin_billing_rules`, `fin_billing_milestones`, `fin_sov_lines`, `fin_pay_applications` |
| Posting rules | how documents hit the GL | event→journal map + `fin_posting_rules` (P2, account mapping per book) |

```sql
create table public.fin_billing_rules (                                                 -- P1
  job_id                 uuid primary key references public.fin_jobs (id) on delete restrict,
  book_id                uuid not null references public.fin_books (id) on delete restrict,
  method                 text not null check (method in ('milestone', 'progress_sov', 'time_materials', 'cost_plus', 'on_completion')),
                         -- P1 supports milestone + on_completion; progress_sov P2; time_materials/cost_plus P4
  deposit_percent        numeric(7,4) check (deposit_percent between 0 and 100),
  deposit_amount         numeric(14,2) check (deposit_amount >= 0),
  deposit_treatment      text not null default 'apply_to_invoices'
                         check (deposit_treatment in ('apply_to_invoices', 'apply_to_final')),   -- CPA-reviewed accounting in P2
  retainage_receivable_percent numeric(7,4) not null default 0 check (retainage_receivable_percent between 0 and 50),
  retainage_release      text not null default 'final_invoice' check (retainage_release in ('final_invoice', 'manual')),
  change_order_billing   text not null default 'separate_line' check (change_order_billing in ('separate_line', 'add_to_sov', 'next_milestone')),
  payment_terms_days     integer not null default 0 check (payment_terms_days between 0 and 365),
  cost_plus_markup_percent numeric(7,4),                -- P4
  tm_rate_card           jsonb,                         -- P4: {labor: [{role, bill_rate}], material_markup_percent}
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint fin_br_deposit check (deposit_percent is null or deposit_amount is null)
);
-- Defaults come from account_trade_profiles.payment_structure and the contract's payment schedule (suggestion only).
-- Changing rules never edits issued invoices.

create table public.fin_sov_lines (                                                     -- P2 (progress billing)
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.fin_jobs (id) on delete restrict,
  line_no          integer not null,
  description      text not null,
  estimate_group_id uuid, trade_slug text,
  scheduled_value  numeric(14,2) not null check (scheduled_value >= 0),
  contract_change_id uuid references public.fin_contract_changes (id) on delete restrict,   -- CO added to SOV
  unique (job_id, line_no)
);  -- Σ scheduled_value must equal fin_job_contract_v.current_contract before a progress invoice can be issued

create table public.fin_pay_applications (                                              -- P4 (AIA-style, no AIA forms/claims)
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.fin_jobs (id) on delete restrict,
  app_number integer not null, period_to date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'invoiced', 'void')),
  invoice_id uuid references public.fin_invoices (id) on delete restrict,   -- the invoice it produced
  unique (job_id, app_number)
);
create table public.fin_pay_application_lines (                                         -- P4
  pay_application_id uuid not null references public.fin_pay_applications (id) on delete restrict,
  sov_line_id uuid not null references public.fin_sov_lines (id) on delete restrict,
  work_completed_this_period numeric(14,2) not null default 0,
  materials_stored numeric(14,2) not null default 0,
  primary key (pay_application_id, sov_line_id)
);
-- Billed-to-date per SOV line can never exceed scheduled_value; retainage computed per rules; result = ordinary fin_invoice.

-- T&M / cost-plus (P4): billable costs are bill lines/expenses with billable = true and approved time entries;
alter table public.fin_invoice_lines add column source_cost_type text check (source_cost_type in ('bill_line', 'expense', 'time_entry', 'equipment_usage'));  -- P4
alter table public.fin_invoice_lines add column source_cost_id uuid;                                                                                -- P4
create unique index fin_invoice_lines_billed_once on public.fin_invoice_lines (source_cost_type, source_cost_id)
  where source_cost_id is not null;   -- a cost is billed at most once (void releases it via invoice status check in RPC)

-- Retainage PAYABLE (P2): on fin_vendor_bills.retainage_withheld (base doc) + release bills; view fin_retainage_payable_v.
```

CO billing: `separate_line` bills approved `fin_contract_changes` as `change_order` invoice lines; `add_to_sov` appends an SOV line; `next_milestone` adds the amount to the next unbilled milestone. In every mode `Σ billed ≤ current contract` (+ T&M/cost-plus extras) is checked in the issue RPC.

---

## 5. Labor time entries (P4, optional — no payroll)

```sql
create table public.fin_labor_rates (                                                   -- P4
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  resource_id uuid references public.pm_resources (id) on delete restrict,   -- staff in Team directory (kind 'staff')
  role_label text check (char_length(role_label) <= 80),                     -- or a role-level default
  cost_rate numeric(10,2) not null check (cost_rate >= 0),                   -- per hour
  burden_percent numeric(7,4) not null default 0 check (burden_percent between 0 and 200),  -- internal estimate, not payroll tax
  effective_from date not null,
  unique (book_id, resource_id, role_label, effective_from)
);

create table public.fin_time_entries (                                                  -- P4
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  job_id uuid references public.fin_jobs (id) on delete restrict,             -- null = overhead time
  schedule_task_id uuid references public.schedule_tasks (id) on delete set null,
  cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  trade_slug text, estimate_group_id uuid,
  resource_id uuid references public.pm_resources (id) on delete restrict,
  work_date date not null,
  hours numeric(6,2) not null check (hours > 0 and hours <= 24),
  cost_rate numeric(10,2) not null, burden_percent numeric(7,4) not null,     -- snapshotted from fin_labor_rates
  cost_amount numeric(14,2) not null,                                          -- round(hours × rate × (1 + burden/100), 2)
  billable boolean not null default false,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'void')),
  submitted_by uuid not null references auth.users (id) on delete restrict,
  approved_by uuid references auth.users (id) on delete set null, approved_at timestamptz,
  idempotency_key text not null, unique (book_id, idempotency_key),
  constraint fin_te_cost check (cost_amount = round(hours * cost_rate * (1 + burden_percent / 100), 2))
);
-- Approval writes fin_job_costs (source 'labor'). Estimated vs actual hours: fin_budget_lines.estimated_hours vs Σ hours.
-- P2 posting: Dr Job Cost – Labor · Cr Labor Cost Applied (clearing). ⚠ CPA: clearing vs actual payroll from an external provider.
-- Explicitly out of scope: wages, withholding, payroll tax, certified payroll.
```

## 6. Equipment (P4, optional)

```sql
create table public.fin_equipment (                                                     -- P4
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  name text not null, ownership text not null check (ownership in ('owned', 'leased', 'rented')),
  internal_rate numeric(10,2), rate_unit text check (rate_unit in ('hour', 'day')),
  status text not null default 'active' check (status in ('active', 'in_repair', 'retired')),
  next_service_due date, notes text
);
create table public.fin_equipment_usage (                                               -- P4 (job allocation -> fin_job_costs source 'equipment')
  id uuid primary key default gen_random_uuid(), book_id uuid not null references public.fin_books (id) on delete restrict,
  equipment_id uuid not null references public.fin_equipment (id) on delete restrict,
  job_id uuid references public.fin_jobs (id) on delete restrict, schedule_task_id uuid references public.schedule_tasks (id) on delete set null,
  cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  used_on date not null, quantity numeric(8,2) not null check (quantity > 0), rate numeric(10,2) not null,
  cost_amount numeric(14,2) not null, idempotency_key text not null, unique (book_id, idempotency_key)
);
create table public.fin_equipment_maintenance ( /* P4: equipment_id, performed_on, description, cost via fin_expenses/bill link, next_due */ );
-- fin_job_costs.source_type gains 'equipment'; 'allocation' (P2 splits).
```

## 7. Vendor compliance documents (P4, optional)

```sql
create table public.fin_vendor_compliance_docs (                                        -- P4
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  vendor_id uuid not null references public.fin_vendors (id) on delete restrict,
  doc_type text not null check (doc_type in ('coi_general_liability', 'workers_comp', 'auto_liability', 'license',
                                             'subcontract_agreement', 'w9', 'lien_waiver', 'other')),
  document_id uuid references public.fin_documents (id) on delete restrict,
  issuer text, policy_or_license_number text, coverage_amount numeric(14,2),
  effective_on date, expires_on date,
  status text not null default 'on_file' check (status in ('on_file', 'replaced', 'rejected')),  -- never 'verified'
  recorded_by uuid not null references auth.users (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  note text check (char_length(note) <= 1000)
);
create table public.fin_vendor_compliance_requirements ( /* P4: book, vendor kind or vendor, required doc_types, warn_days_before (default 30) */ );
-- View fin_vendor_compliance_status_v: missing / expiring (≤ warn days) / expired per vendor + requirement.
-- Behaviour: warnings on vendor, commitment, bill-approval and bill-payment screens + dashboard alert.
-- Never blocks or triggers payment automatically; UI copy never says "verified" (it says "on file, expires …").
```

---

## 8. Dashboard preferences and alerts (P1)

```sql
create table public.fin_dashboard_prefs (                                               -- P1
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  user_id    uuid references auth.users (id) on delete cascade,   -- null = company default (manage_financial_config)
  cards      jsonb not null check (jsonb_typeof(cards) = 'array'),   -- [{key, visible, order, size}]
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (book_id, user_id)
);
-- Card keys are a code registry (src/lib/financials/cards.ts). Preset/profile only decides the DEFAULT order.
-- Resolution: user row > company row > preset default.

create function public.fin_essential_alert_keys() returns text[] language sql immutable as $$
  select array['overdue_receivables', 'unapplied_payments', 'bills_due', 'unbalanced_or_failed_posting',
               'locked_period_activity', 'commitment_overruns', 'compliance_expired', 'uncoded_costs',
               'entitlement_read_only']
$$;
-- Write RPC strips visible = false for essential keys (they are alerts, rendered in a fixed band, not cards),
-- and a check trigger rejects any stored cards entry that hides one.
-- Alerts come from a security-invoker view fin_alerts_v (counts + drill-down ids), so a user only sees alerts
-- about data they may read.
```

---

## 9. Permissions additions (P1)

Appended to `company_permission_keys()` (full re-declaration) and to `src/lib/enterprise/permissions.ts`:

| Key | Meaning | Owner-only to delegate? |
|---|---|---|
| `manage_financial_config` | Business & Trade Configuration, presets, billing-rule defaults, cost codes suggestions, company dashboard defaults | No (delegable; owner always has it — "owner override") |
| `approve_vendor_bills` | Approve/void vendor bills and commitment revisions (splits approval from `record_bills`, which now = enter drafts) | No |
| `manage_sub_compliance` | Record/replace vendor compliance docs and requirements | No |

Role preset additions (extends the matrix in `proposed-schema.md` §4.2):

| Key | owner | financial_admin | bookkeeper | accountant | project_manager | sales_rep | view_only |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| manage_financial_config | ✓ | ✓ | – | – | – | – | – |
| approve_vendor_bills | ✓ | ✓ | – | – | – | – | – |
| manage_sub_compliance | ✓ | ✓ | ✓ | – | ✓ | – | – |

Pricing/seat model unchanged ($24.99 incl. 3 financial users, $4.99 per extra; separate from Enterprise and PM editor seats; no trade tiers). `account_trade_profiles` for a **company** is editable by `manage_financial_config` even without a financial seat? — **No (proposed):** config edits from the FCC need a covered seat; the same fields edited from Company Profile outside FCC need `manage_financial_config` only (they gate nothing). Open question Q-V3-2.

---

## 10. Phase map and migration additions

| Phase | New / changed objects | File (after the base plan) |
|---|---|---|
| P1 | `account_trade_profiles`; `fin_jobs.market/project_model`; dimension columns; `fin_budget_lines`; `fin_commitment_revisions` + commitment columns; `fin_billing_rules` (milestone/on_completion/deposit/retainage receivable/CO billing); `fin_dashboard_prefs` + alert keys + `fin_alerts_v`; `fin_uncoded_costs_v`; `fin_job_budget_v` (original/actual/committed/open/ETC default/forecast/variance); 3 new permission keys | folded into `…001000_fin_core.sql` (profile, prefs, keys), `…002000_fin_contracts.sql` (budget lines, billing rules), `…004000_fin_costs.sql` (commitment revisions, dimension columns) |
| P2 | `fin_budget_revisions`, `fin_cost_forecasts`, `fin_cost_splits`, `fin_overhead_allocation_rules`, `fin_review_items`, POs + `fin_commitment_lines`, retainage payable, `fin_sov_lines` (progress billing), `fin_posting_rules` (account mapping), subledger↔GL control checks | `2026120x004000_fin_job_cost_depth.sql`, `2026120x005000_fin_progress_billing.sql` |
| P4 | `fin_pay_applications(+lines)`, T&M/cost-plus invoice sourcing, `fin_labor_rates`, `fin_time_entries`, `fin_equipment(+usage, maintenance)`, `fin_vendor_compliance_docs(+requirements)` | `…_fin_time_entries.sql`, `…_fin_equipment.sql`, `…_fin_sub_compliance.sql`, `…_fin_pay_applications.sql` |

Rollback rules from the base plan apply (guarded drop while no issued data; roll-forward + feature flag after go-live). P4 modules are additionally behind per-module flags (`financials_time`, `financials_equipment`, `financials_compliance`) shown/hidden by `account_trade_profiles.labor_model / uses_equipment` **as UX only**.

### Additional acceptance fixtures (map to the addendum's 20 tests)

| # | Fixture | Expectation |
|---|---|---|
| A1 | Set primary trade + 2 additional trades from `trade_categories`; unknown slug | saved / rejected |
| A2 | Job override `project_model = time_materials` on a fixed-price account | job uses override; account unchanged |
| A3 | Change primary trade and preset after 20 invoices/costs exist | **zero** rows changed in fin_* tables (row hash compare) |
| A4 | Preset applied for a user without FCC entitlement | no finance feature unlocked; `fin_has_permission` unchanged |
| A5 | Budget lines from contract version | Σ original = `cost_basis`; one row per section × cost_type |
| A6 | Commitment 10,000; revision +1,000; bills 4,000 + 8,000 | actual 12,000; open 0; committed cost 12,000 (not 23,000); overrun warning 1,000 |
| A7 | Bill without commitment | actual only; committed totals unchanged |
| A8 | Expense 900 split 1/3 across 3 jobs | 300/300/300; sum check; uneven split last part absorbs |
| A9 | Overhead expense (no job) | excluded from job costs; appears in overhead report (P2 GL) |
| A10 | Progress SOV: 3 lines, 40% then 100% with 10% retainage; CO added to SOV | invoices, retainage receivable, billed-to-date ≤ scheduled value |
| A11 | Retainage payable on sub bills then release bill | retainage payable returns to 0 |
| A12 | T&M: billable expense billed twice | second refused (`fin_invoice_lines_billed_once`) |
| A13 | Time entry approved with burden 25% | cost = round(h × rate × 1.25, 2); job cost row; rejected entry writes none |
| A14 | Compliance COI expiring in 10 days; expired | warning + essential alert; bill payment NOT blocked |
| A15 | Hide an essential alert via prefs RPC / direct row | ignored / rejected by trigger |
| A16 | Review queue AI suggestion | no change until accepted; accept writes audited change |
| A17 | Reports reconcile (P2): AR aging = AR control; AP aging = AP control; job cost actual = Σ job-cost GL lines; retainage subledgers = control accounts | equal to the cent |
| A18 | Schedule task at 100% complete | no revenue/WIP entry created |
| A19 | Permissions: `approve_vendor_bills` vs `record_bills`; `manage_sub_compliance`; `manage_financial_config`; owner override | as matrix |
| A20 | Regression: existing `tests/db` suite (estimates, schedules, change orders, customer hub, billing) passes unchanged; no Stripe price/plan changes | green |

### V3 open questions

* **Q-V3-1** Should Business & Trade Configuration also drive estimate templates/onboarding outside FCC (proposed yes: table is account-level, not finance-only)?
* **Q-V3-2** Seat needed to edit configuration inside FCC vs Company Profile (proposed above).
* **Q-V3-3** Inventory: `uses_inventory` is captured, but no inventory tables are proposed (materials are expensed to jobs). Confirm inventory is out of scope through P4.
* **Q-V3-4** Labor burden: single percentage per rate is an internal estimate; confirm no payroll-provider import is expected before P4.
* **Q-V3-5** Self-approval of bills/time entries in small companies (owner = only approver).
