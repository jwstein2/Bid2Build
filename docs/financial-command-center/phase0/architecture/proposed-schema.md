# Financial Command Center — Proposed Financial Schema (Phase 0 design)

**Author:** Agent 2 (Accounting Engine & Database) · **Date:** 2026-11-17 · **Status:** for review. Nothing here is applied.
**Read with:** `data-audit.md` and **`proposed-schema-v3.md`** (V3 addendum: trade configuration, budgets, commitments, billing rules, time, equipment, compliance, dashboard; phase tags) in the same folder. Citations such as `M/project_documents.sql:37` refer to `supabase/migrations/2026…_project_documents.sql` line 37 in `/home/user/bid2build` @ `710ca6a`.

All SQL below is a **reviewable sketch**: names, columns, constraints and the shape of the functions are deliberate; bodies are abbreviated where they would only repeat an existing repo pattern.

---

## 0. Decisions at a glance

| # | Decision | Why (short) |
|---|---|---|
| D1 | **Tenant = a "book" (`fin_books`)**: exactly one per company, one per solo owner (XOR, like `pm_resources`). Every financial row carries a non-null `book_id`. | Gives one FK-enforced tenant key. Companies stay Enterprise-only; no change to how solo users work today. Auto-personal-company was rejected (breaks scheduling and Customer Hub matching — `data-audit.md` §2.4). |
| D2 | **Money = `numeric(14,2)`** (unit prices `numeric(14,4)`, rates `numeric(7,4)`), half-up ("away from zero") rounding to cents at line level, decimal.js in TS. Stripe integer cents converted only at the boundary. | Same type as every existing contract amount (`estimate_versions`, `change_orders`, `signatures`); PG `round(numeric, 2)` and decimal.js `ROUND_HALF_UP` agree; avoids a cents/decimal split inside contractor finance. |
| D3 | **Job identity = the accepted estimate** (`estimates.id`). A thin `fin_jobs` row (1:1, `estimate_id unique`, `ON DELETE RESTRICT`) holds finance-only state. No new projects table. | Every project-ops table already keys on `estimate_id`; `project_schedules` is optional and archivable. |
| D4 | **Customer identity = `customers.id`** (Customer Hub), `RESTRICT` FK **plus** a frozen `bill_to` snapshot on each document. | One customer record; documents survive later edits/merges; bookkeepers can read balances without widening bid visibility. |
| D5 | **Vendors reuse the Team directory**: `fin_vendors.resource_id → pm_resources` (unique per book) for subcontractors; suppliers live only in `fin_vendors`. | No duplicate sub records; directory has no supplier/tax/payment fields and is a scheduling surface. |
| D6 | **Contract = snapshot + append-only changes.** `fin_contract_snapshots` (from the signature or a user-confirmed manual approval) + `fin_contract_changes` (from approved/signed change orders, and deductions). *Current contract = original + approved COs − deductions.* | Replaces the read-time heuristic in `project_proposal_history` (`M/project_documents.sql:309-317`). |
| D7 | **Documents are numbered on issue**, gapless per book and document type, never reused (void keeps its number). | Audit expectation; drafts don't burn numbers. |
| D8 | **Balances are derived, not stored.** Invoice/payment/customer balances are views over allocations; invariants enforced under row locks + deferred constraint triggers. | No cache to drift; concurrency handled in one place. |
| D9 | **Phase 2 GL is the book of record, dual-basis tagged** (`basis ∈ {both, accrual, cash}` per journal entry). | Accrual and cash reports from one ledger without recomputation; both are needed for small contractors (tax vs management). |
| D10 | **Financial permissions are new keys in `company_permission_keys()`**; financial "roles" are presets on a financial **seat** (`fin_seats.fin_role`), and every finance check also requires a covered seat. | Reuses Users & Permissions, granted/revoked, owner-only rule and escalation guard; seats separate from Enterprise and PM editor seats. |
| D11 | **Writes only through `SECURITY DEFINER` RPCs**; RLS = read policies; no `UPDATE/DELETE` grants; posted/issued rows immutable by trigger; **no `ON DELETE CASCADE` into finance tables from users, estimates, customers or companies.** | Matches repo convention; fixes the cascade risk (audit R3). |

---

## 1. Tenant model (D1)

### 1.1 What the code does today
Solo users never have a company (`companies` are created only by `create_company()` from the Enterprise webhook or an Enterprise comp grant — `M/enterprise_workspace.sql:450-477`). Their rows have `company_id IS NULL`; the owner may do everything (`estimate_permission`, `M/project_operations.sql:82-89`). A person who joins a company keeps old bids personal (`docs/enterprise/IMPLEMENTATION_MAP.md:61`).

### 1.2 Options considered

| Option | Verdict |
|---|---|
| A. Auto personal company for every finance user | **Rejected.** `stamp_company_owner()` would move new bids/customers into the company scope (duplicate customers via `match_bid_customer`), `can_schedule_estimate`/`pm_estimate_access` require `pe.scope='company'` for company bids (solo PM add-on users lose scheduling), one-active-company index blocks later Enterprise invites. |
| B. `user_id` + nullable `company_id` on every finance row (pattern A in audit) | Rejected for finance: tenant becomes `coalesce(company_id, user_id)` everywhere, no single FK, ambiguous when a solo user later joins a company. |
| C. **`fin_books` row per tenant (company XOR owner) — recommended** | One uuid tenant key with a real FK on every row; mirrors `pm_resources` XOR; book of an estimate is deterministic (`estimate.company_id` → company book, else owner's personal book); a person in a company can still close out their old personal jobs in their personal book. |

### 1.3 DDL

```sql
create table public.fin_books (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid unique references public.companies (id) on delete restrict,
  owner_user_id          uuid unique references auth.users (id) on delete restrict,   -- solo book; blocks hard account delete (see §11)
  name                   text not null check (char_length(name) between 1 and 200),
  currency               char(3) not null default 'USD' check (currency = 'USD'),     -- single currency for now
  timezone               text not null default 'America/Chicago',                     -- business dates are this zone's calendar dates
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  reporting_basis        text not null default 'accrual' check (reporting_basis in ('accrual', 'cash')),
  locked_through         date,                                                        -- Phase 1 lock date; Phase 2 uses fin_accounting_periods
  ledger_enabled_at      timestamptz,                                                 -- Phase 2 switch (posting starts)
  settings               jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint fin_books_scope check ((company_id is null) <> (owner_user_id is null))
);

-- Book for an estimate's scope (company bid -> company book; personal bid -> owner's book). Creates lazily.
create function public.fin_book_for_estimate(p_estimate_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$ … $$;   -- service/RPC only
```

---

## 2. Money, rounding, dates (D2)

| Rule | Definition |
|---|---|
| Amount columns | `numeric(14,2)`; max 999,999,999,999.99. Quantities `numeric(14,4)`, unit prices `numeric(14,4)`, rates/percents `numeric(7,4)`. |
| Line amount | `amount = round(quantity × unit_price, 2)` (enforced by check constraint). |
| Rounding mode | Half away from zero — PG `round(x, 2)`; TS `round2` (`src/lib/estimate/money.ts:30`). Identical for positive and negative values. |
| Invoice tax | `tax_total = round(Σ taxable line amounts × tax_rate / 100, 2)` (same as engine `:245`); per-line `tax_amount` allocated pro-rata with the **last taxable line absorbing the remainder** so Σ line tax = `tax_total`. |
| Percent splits (milestones, retainage, pro-rata cash-basis revenue) | Largest-remainder is *not* used; the repo rule is "**last part absorbs remainder**" (`src/lib/proposal/build.ts:90-99`). Use it everywhere for consistency. |
| Contract rounding line | `rounding = total − subtotal − tax` from the frozen version (no column exists — audit R6); stored explicitly on the contract snapshot. |
| JSON money | Never trust `estimate_versions.proposal.paymentSchedule[].amount` (formatted string). Recompute milestone amounts from percents and the snapshot total with the rule above, and check against the parsed string (mismatch → user review). |
| API boundary | RPCs accept/return amounts as **strings** (`'1234.50'`), like `finalize_bid` callers (`src/lib/export/finalize.ts:91-94`); TS parses with decimal.js. |
| Stripe | `bigint` cents only in raw Stripe mirror columns (`*_cents`); converted with exact division by 100. |
| Dates | Business dates are `date` in `fin_books.timezone`; event times `timestamptz`. |

---

## 3. Identity reuse (D3–D5)

| Concept | Source of truth | Finance object | Link rule |
|---|---|---|---|
| Customer | `customers` | `customer_id` on jobs/invoices/payments/credits + `bill_to jsonb` snapshot | `RESTRICT`; must be in the same scope as the book (`customer_in_scope`, `M/customer_hub.sql:73-78`). |
| Project / job | `estimates` (accepted: `estimate_is_accepted`, `M/project_schedules.sql:156-160`) | `fin_jobs` (1:1) | `estimate_id unique RESTRICT`; created on first finance action or from the Needs-Review queue. |
| Signed agreement | `signatures` + `estimate_versions` | `fin_contract_snapshots` | `RESTRICT` to both. |
| Change order | `change_orders` (approved/signed) | `fin_contract_changes` | `unique (change_order_id)`, created by trigger. |
| Subcontractor | `pm_resources (kind='subcontractor')` | `fin_vendors.resource_id` | `unique (book_id, resource_id)`, `ON DELETE SET NULL` + name kept on vendor. |
| Sub quote (accepted) | `subcontractor_quotes` / `_revisions` | `fin_commitments` | optional FK, `SET NULL`. |
| Trade / category | `trade_categories.slug`, `estimate_items.cost_type`, section trade in `proposal_config.worksheet.sectionTrades` | `fin_cost_codes` | seeded per book. |
| Estimated cost (budget) | `estimate_versions.total_cost` + `project_cost_adjustments` | profitability views | read-only. |

---

## 4. Permissions and financial seats (D10)

### 4.1 New permission keys (appended to `company_permission_keys()`; mirrored in `src/lib/enterprise/permissions.ts`)

| Key | Meaning |
|---|---|
| `view_company_financials` | All finance data of the book (AR/AP, balances, reports). |
| `view_project_financials` | Finance data of jobs the person is attached to (PM / sales rep / bid owner). Costs additionally need existing `view_costs` or `view_subcontractor_costs`. |
| `create_invoices` | Draft, issue, void invoices and credit memos. |
| `record_payments` | Record/void customer payments, allocate, refund. |
| `record_expenses` *(added)* | Submit job expenses/receipts. |
| `approve_expenses` | Approve/reject expenses. |
| `record_bills` | Enter/approve vendor bills, commitments, bill payments. |
| `manage_accounts` | Chart of accounts, cost codes, opening balances. |
| `post_journal_entries` | Manual/adjusting journal entries and reversals. |
| `reconcile` | Mark payments verified; bank reconciliation (Phase 3). |
| `close_periods` | Close/lock/reopen periods; set `locked_through`. |
| `export_financials` | CSV/accountant exports. |
| `manage_payment_connections` | Stripe Connect onboarding/settings — **owner-only to delegate**. |
| `manage_financial_seats` *(added)* | Assign financial seats/roles — **owner-only to delegate** (like `manage_pm_seats`). |

V3 adds `manage_financial_config`, `approve_vendor_bills`, `manage_sub_compliance` (see `proposed-schema-v3.md` §9). `company_owner_only_permissions()` gains `manage_payment_connections`, `manage_financial_seats`. `company_role_permissions()` is **unchanged** for manager/estimator/viewer (no finance keys by default), so nobody gains finance access on deploy; owner gets all keys automatically.

### 4.2 Financial role presets (on the seat, not on `company_members.role`)

`company_members.role` is a 4-value check constraint used by many functions; adding roles there is high-risk. Instead the seat carries a preset; `permissions_granted/revoked` on `company_members` still adjust it.

| Key | owner | financial_admin | bookkeeper | accountant | project_manager | sales_rep | view_only |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| view_company_financials | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| view_project_financials | ✓ | ✓ | ✓ | ✓ | ✓ (assigned jobs) | ✓ (jobs sold; contract & billing only) | ✓ |
| create_invoices | ✓ | ✓ | ✓ | – | – | – | – |
| record_payments | ✓ | ✓ | ✓ | – | – | – | – |
| record_expenses | ✓ | ✓ | ✓ | – | ✓ | – | – |
| approve_expenses | ✓ | ✓ | – | – | – | – | – |
| record_bills | ✓ | ✓ | ✓ | – | – | – | – |
| manage_accounts | ✓ | ✓ | – | ✓ | – | – | – |
| post_journal_entries | ✓ | ✓ | – | ✓ | – | – | – |
| reconcile | ✓ | ✓ | ✓ | ✓ | – | – | – |
| close_periods | ✓ | ✓ | – | ✓ | – | – | – |
| export_financials | ✓ | ✓ | ✓ | ✓ | – | – | – |
| manage_payment_connections | ✓ | – | – | – | – | – | – |
| manage_financial_seats | ✓ | – | – | – | – | – | – |

Segregation of duties defaults: bookkeeper records but does not approve expenses or post manual JEs; accountant adjusts and closes but cannot create invoices or move money.

### 4.3 Seat entitlement — $24.99/mo incl. 3 financial users, $4.99 per extra

* Separate from Enterprise licensed users (`company_entitlement.seat_limit`) and PM editor seats (`pm_editors`). A financial seat can only be assigned to an **existing active company member** (it never creates a login or consumes an Enterprise seat).
* Billing mirrors the PM add-on: two Stripe prices (base incl. 3, per-seat) as items on the existing subscription, mirrored by an `apply_fin_update()` exactly like `apply_pm_update()` (`M/pm_entitlements.sql:27-50`), ordered by `source_event_created`.
* Over-limit rule = PM editors: earliest `assigned_at` wins; the owner's seat is always ranked first.
* Lapse: finance becomes **read-only + export** (never deleted), like schedules after the PM add-on ends.

```sql
alter table public.subscriptions add column if not exists fin_addon boolean not null default false;
alter table public.subscriptions add column if not exists fin_addon_until timestamptz;          -- paid-through after removal
alter table public.subscriptions add column if not exists fin_extra_seats integer not null default 0
  check (fin_extra_seats between 0 and 1000);
alter table public.complimentary_grants add column if not exists fin_seats integer
  check (fin_seats is null or fin_seats between 0 and 50);                                      -- null = no finance

create table public.fin_seats (
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete cascade,   -- a seat is not a record; history is in fin_audit_log
  fin_role    text not null check (fin_role in ('owner', 'financial_admin', 'bookkeeper', 'accountant',
                                                 'project_manager', 'sales_rep', 'view_only')),
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create function public.fin_role_permissions(p_role text) returns text[] language sql immutable as $$ … $$;  -- table above

-- (active, source, seat_limit, read_only, expires_at) for a book.
create function public.fin_entitlement(p_book_id uuid)
returns table (active boolean, read_only boolean, source text, seat_limit integer, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$ … $$;
-- company book: Enterprise active AND (fin_addon on the Enterprise sub OR comp grant fin_seats) -> 3 + fin_extra_seats
-- solo book:    fin_addon on the owner's Unlimited sub OR personal comp grant -> seat_limit 1 (owner)

-- THE check every finance RPC and RLS policy uses.
create function public.fin_has_permission(p_book_id uuid, p_key text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  -- solo book: auth.uid() = owner_user_id (all keys)
  -- company book: active member AND covered seat (rank <= seat_limit) AND
  --   p_key in ( owner ? all : (fin_role_permissions(seat.fin_role) ∪ member.permissions_granted) − member.permissions_revoked )
  -- p_write additionally requires fin_entitlement.active and not read_only
  …
$$;
```

---

## 5. Phase 1 — operational tables

Common columns omitted below for brevity: `created_by uuid references auth.users on delete set null`, `created_at/updated_at timestamptz default now()`, `set_updated_at()` trigger. Every table: `alter table … enable row level security`, `revoke all … from anon, authenticated`, `grant select … to authenticated` (see §8).

### 5.1 Core: numbering, audit, documents

```sql
-- Gapless numbering per book and document type. Row lock held to commit = no gaps, no duplicates.
create table public.fin_number_sequences (
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  doc_type   text not null check (doc_type in ('job', 'invoice', 'credit_memo', 'payment', 'refund', 'bill', 'bill_payment', 'journal')),
  prefix     text not null default '' check (char_length(prefix) <= 12),
  next_value bigint not null default 1 check (next_value >= 1),
  pad        smallint not null default 4 check (pad between 1 and 10),
  primary key (book_id, doc_type)
);
create function public.fin_next_number(p_book uuid, p_type text, out seq bigint, out label text)
language plpgsql security definer set search_path = public as $$
begin
  insert into fin_number_sequences (book_id, doc_type) values (p_book, p_type) on conflict do nothing;
  update fin_number_sequences set next_value = next_value + 1
   where book_id = p_book and doc_type = p_type
   returning next_value - 1, prefix || lpad((next_value - 1)::text, pad, '0') into seq, label;
end $$;  -- called only inside the issuing RPC's transaction

-- Append-only finance audit trail (company AND solo books; company_audit_log is company-only and manage_users-gated).
create table public.fin_audit_log (
  id          bigint generated always as identity primary key,
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (char_length(action) <= 80),          -- 'invoice.issued', 'payment.allocated', …
  entity_type text not null check (char_length(entity_type) <= 40),
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  request_id  text check (char_length(request_id) <= 100),
  prev_hash   text, row_hash text not null,                               -- sha256 chain per book (tamper evidence)
  created_at  timestamptz not null default now()
);
create index on public.fin_audit_log (book_id, created_at desc);
create trigger fin_audit_log_append_only before update or delete on public.fin_audit_log
  for each row execute function public.fin_guard_immutable();             -- no cascade escape (unlike guard_write_once)

-- Financial documents in a new private bucket 'finance-files', path '<book_id>/<kind>/<uuid>.<ext>'.
-- No storage.objects policies (service role + short signed URLs), same as project-files.
create table public.fin_documents (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  kind          text not null check (kind in ('receipt', 'vendor_bill', 'invoice_pdf', 'credit_memo_pdf', 'payment_proof',
                                              'w9', 'lien_waiver', 'contract', 'bank_statement', 'other')),
  storage_path  text not null unique check (char_length(storage_path) <= 500),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type  text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv')),
  bytes         integer not null check (bytes between 1 and 20971520),
  original_name text check (char_length(original_name) <= 200),
  entity_type   text check (entity_type in ('job', 'invoice', 'credit_memo', 'payment', 'refund', 'vendor', 'bill', 'expense', 'commitment', 'journal_entry')),
  entity_id     uuid,
  job_id        uuid,                                                      -- FK added after fin_jobs
  archived_at   timestamptz,                                               -- never deleted by the app
  unique (book_id, sha256, entity_type, entity_id)                         -- same file attached twice = one row
);
-- content columns write-once (only archived_at may change)
```

### 5.2 Jobs, contract snapshot, contract changes

```sql
create table public.fin_jobs (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid not null references public.fin_books (id) on delete restrict,
  estimate_id         uuid not null unique references public.estimates (id) on delete restrict,
  customer_id         uuid not null references public.customers (id) on delete restrict,
  job_number          text,                                               -- from fin_next_number('job') on open
  status              text not null default 'open' check (status in ('open', 'closed', 'void')),
  retainage_percent   numeric(7,4) not null default 0 check (retainage_percent between 0 and 50),
  tax_rate            numeric(7,4) not null default 0 check (tax_rate between 0 and 100),   -- default from contract
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  closed_by           uuid references auth.users (id) on delete set null,
  unique (book_id, job_number)
);
create index on public.fin_jobs (book_id, status);

create table public.fin_contract_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  book_id             uuid not null references public.fin_books (id) on delete restrict,
  job_id              uuid not null unique references public.fin_jobs (id) on delete restrict,  -- one baseline per job
  source              text not null check (source in ('signature', 'manual_approval')),
  signature_id        uuid references public.signatures (id) on delete restrict,
  estimate_version_id uuid not null references public.estimate_versions (id) on delete restrict,
  content_hash        text not null check (content_hash ~ '^[0-9a-f]{64}$'),   -- copied from the version
  subtotal            numeric(14,2) not null,       -- includes fixed_adjustment
  tax                 numeric(14,2) not null,
  rounding            numeric(14,2) not null default 0,
  total               numeric(14,2) not null,
  cost_basis          numeric(14,2) not null,       -- estimate_versions.total_cost (budget)
  tax_rate            numeric(7,4) not null,
  payment_schedule    jsonb not null default '[]',  -- [{label, percent, amount}] recomputed (§2)
  confirmed_by        uuid not null references auth.users (id) on delete restrict,   -- explicit for manual approvals
  confirmed_at        timestamptz not null default now(),
  constraint fin_contract_total check (total = subtotal + tax + rounding),
  constraint fin_contract_source check (source <> 'signature' or signature_id is not null)
);  -- write-once

create table public.fin_billing_milestones (            -- schedule of values (simple)
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.fin_jobs (id) on delete restrict,
  seq           integer not null check (seq >= 1),
  label         text not null check (char_length(label) between 1 and 200),
  percent       numeric(7,4),
  amount        numeric(14,2) not null check (amount >= 0),
  kind          text not null default 'progress' check (kind in ('deposit', 'progress', 'final', 'change_order')),
  contract_change_id uuid,                               -- FK below
  unique (job_id, seq)
);

create table public.fin_contract_changes (
  id                     uuid primary key default gen_random_uuid(),
  book_id                uuid not null references public.fin_books (id) on delete restrict,
  job_id                 uuid not null references public.fin_jobs (id) on delete restrict,
  kind                   text not null check (kind in ('change_order', 'deduction', 'correction')),
  change_order_id        uuid unique references public.change_orders (id) on delete restrict,
  change_order_version   integer,
  amount                 numeric(14,2) not null,          -- signed; CO may be negative (remove lines)
  tax_amount             numeric(14,2) not null default 0, -- CPA/owner rule needed: COs carry no tax today (audit R10)
  description            text not null check (char_length(description) between 1 and 1000),
  effective_date         date not null,
  approved_by            uuid references auth.users (id) on delete set null,
  approved_at            timestamptz not null,
  constraint fin_cc_co   check ((kind = 'change_order') = (change_order_id is not null)),
  constraint fin_cc_ded  check (kind <> 'deduction' or amount < 0)
);  -- write-once; a mistake is fixed by a 'correction' row

-- Trigger on change_orders: when status becomes 'approved' or 'signed' and a fin_job exists for the estimate,
-- insert one fin_contract_changes row (on conflict (change_order_id) do nothing). fin_job creation backfills
-- every already-approved CO the same way. change_order_decide forbids voiding approved COs (M/project_documents.sql:245).

create view public.fin_job_contract_v with (security_invoker = true) as
select j.id as job_id, j.book_id, s.total as original_contract,
       coalesce(sum(c.amount) filter (where c.kind = 'change_order'), 0)        as approved_changes,
       -coalesce(sum(c.amount) filter (where c.kind = 'deduction'), 0)          as deductions,
       coalesce(sum(c.amount) filter (where c.kind = 'correction'), 0)          as corrections,
       s.total + coalesce(sum(c.amount), 0)                                     as current_contract
from fin_jobs j join fin_contract_snapshots s on s.job_id = j.id
left join fin_contract_changes c on c.job_id = j.id
group by j.id, j.book_id, s.total;
```

### 5.3 Receivables: invoices, payments, allocations, credit memos, refunds

```sql
create table public.fin_invoices (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid not null references public.fin_books (id) on delete restrict,
  job_id             uuid references public.fin_jobs (id) on delete restrict,       -- null = customer-level invoice
  customer_id        uuid not null references public.customers (id) on delete restrict,
  kind               text not null check (kind in ('deposit', 'progress', 'final', 'retainage_release', 'time_materials', 'other')),
  status             text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  number_seq         bigint,
  number             text,
  revision           integer not null default 1,              -- optimistic lock for drafts
  issue_date         date,
  due_date           date,
  bill_to            jsonb,                                    -- {name, companyName, email, phone, address} frozen on issue
  memo               text check (char_length(memo) <= 4000),
  subtotal           numeric(14,2) not null default 0,
  tax_total          numeric(14,2) not null default 0,
  retainage_withheld numeric(14,2) not null default 0 check (retainage_withheld >= 0),
  total              numeric(14,2) not null default 0,         -- amount due on this invoice
  pdf_document_id    uuid references public.fin_documents (id) on delete restrict,
  content_hash       text check (content_hash ~ '^[0-9a-f]{64}$'),   -- hash of issued content
  issued_at          timestamptz, issued_by uuid references auth.users (id) on delete set null,
  voided_at          timestamptz, voided_by uuid references auth.users (id) on delete set null,
  void_reason        text check (char_length(void_reason) <= 500),
  idempotency_key    text not null check (char_length(idempotency_key) <= 200),
  unique (book_id, number_seq),
  unique (book_id, idempotency_key),
  constraint fin_inv_total  check (total = subtotal + tax_total - retainage_withheld),
  constraint fin_inv_number check ((status = 'draft') = (number_seq is null)),
  constraint fin_inv_issue  check (status = 'draft' or (issue_date is not null and bill_to is not null and issued_at is not null)),
  constraint fin_inv_void   check ((status = 'void') = (voided_at is not null and void_reason is not null))
);
create index on public.fin_invoices (book_id, customer_id, status);
create index on public.fin_invoices (job_id) where job_id is not null;

create table public.fin_invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.fin_invoices (id) on delete restrict,
  line_no            integer not null check (line_no >= 1),
  line_type          text not null check (line_type in ('milestone', 'change_order', 'deposit', 'deposit_application',
                                                         'retainage_release', 'item', 'discount')),
  description        text not null check (char_length(description) between 1 and 1000),
  quantity           numeric(14,4) not null default 1,
  unit_price         numeric(14,4) not null,
  amount             numeric(14,2) not null,
  taxable            boolean not null default false,
  tax_amount         numeric(14,2) not null default 0,
  retainage_amount   numeric(14,2) not null default 0 check (retainage_amount >= 0),
  milestone_id       uuid references public.fin_billing_milestones (id) on delete restrict,
  contract_change_id uuid references public.fin_contract_changes (id) on delete restrict,
  applies_invoice_id uuid references public.fin_invoices (id) on delete restrict,   -- deposit_application -> the deposit invoice
  cost_code_id       uuid,                                                          -- FK after fin_cost_codes
  revenue_account_id uuid,                                                          -- Phase 2 FK
  unique (invoice_id, line_no),
  constraint fin_il_amount check (amount = round(quantity * unit_price, 2)),
  constraint fin_il_depapp check ((line_type = 'deposit_application') = (applies_invoice_id is not null) and (line_type <> 'deposit_application' or amount < 0))
);
-- Lines editable only while the parent is draft; header immutable after issue except the void columns (trigger).
-- Issue RPC: lock invoice -> recompute subtotal/tax/retainage from lines (§2) -> fin_next_number -> bill_to snapshot
-- -> content_hash -> audit -> (Phase 2) post.

create table public.fin_payments (
  id                      uuid primary key default gen_random_uuid(),
  book_id                 uuid not null references public.fin_books (id) on delete restrict,
  customer_id             uuid not null references public.customers (id) on delete restrict,
  number_seq              bigint not null,                    -- receipt number
  received_on             date not null,
  method                  text not null check (method in ('check', 'cash', 'ach', 'wire', 'card_external', 'zelle', 'venmo', 'paypal', 'stripe', 'other')),
  reference               text check (char_length(reference) <= 200),       -- check #, confirmation #
  amount                  numeric(14,2) not null check (amount > 0),
  status                  text not null default 'recorded' check (status in ('recorded', 'void')),
  verified                boolean not null default false,     -- true only after reconciliation (Phase 3) or by 'reconcile' holder
  verified_at             timestamptz, verified_by uuid references auth.users (id) on delete set null,
  bank_transaction_id     uuid,                               -- Phase 3 FK
  deposit_account_id      uuid,                               -- Phase 2 FK (default Undeposited Funds)
  source                  text not null default 'manual' check (source in ('manual', 'stripe', 'import')),
  stripe_payment_intent_id text unique,
  memo                    text check (char_length(memo) <= 1000),
  voided_at timestamptz, voided_by uuid references auth.users (id) on delete set null, void_reason text,
  idempotency_key         text not null check (char_length(idempotency_key) <= 200),
  unique (book_id, number_seq),
  unique (book_id, idempotency_key),
  constraint fin_pay_verified check (not verified or verified_at is not null),
  constraint fin_pay_void check ((status = 'void') = (voided_at is not null))
);
-- Possible-duplicate warning (not a constraint): same customer, amount, method, reference within 7 days.
create index fin_payments_dupe_idx on public.fin_payments (book_id, customer_id, amount, method, reference, received_on);

create table public.fin_payment_allocations (            -- many-to-many payment <-> invoice
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  payment_id    uuid not null references public.fin_payments (id) on delete restrict,
  invoice_id    uuid not null references public.fin_invoices (id) on delete restrict,
  amount        numeric(14,2) not null check (amount > 0),
  allocated_on  date not null,
  reversed_at   timestamptz, reversed_by uuid references auth.users (id) on delete set null, reversal_reason text,
  idempotency_key text not null,
  unique (book_id, idempotency_key)
);
create index on public.fin_payment_allocations (payment_id) where reversed_at is null;
create index on public.fin_payment_allocations (invoice_id) where reversed_at is null;
-- immutable except a single reversed_at set (trigger). "Unapply" = reverse; never delete.

create table public.fin_credit_memos (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  job_id uuid references public.fin_jobs (id) on delete restrict,
  source_invoice_id uuid references public.fin_invoices (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  number_seq bigint, number text, issue_date date, bill_to jsonb,
  reason text not null check (char_length(reason) between 1 and 1000),
  subtotal numeric(14,2) not null default 0, tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0 check (total >= 0),
  idempotency_key text not null, unique (book_id, number_seq), unique (book_id, idempotency_key),
  constraint fin_cm_total check (total = subtotal + tax_total)
);
create table public.fin_credit_memo_lines ( /* same shape as fin_invoice_lines minus deposit/retainage columns */ );
create table public.fin_credit_applications (            -- credit memo -> invoice
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  credit_memo_id uuid not null references public.fin_credit_memos (id) on delete restrict,
  invoice_id uuid not null references public.fin_invoices (id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  applied_on date not null,
  reversed_at timestamptz, reversed_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null, unique (book_id, idempotency_key)
);

create table public.fin_refunds (                        -- money back out, incl. chargebacks
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  kind text not null check (kind in ('refund', 'chargeback', 'chargeback_reversal')),
  payment_id uuid references public.fin_payments (id) on delete restrict,       -- refund of unapplied payment / chargeback
  credit_memo_id uuid references public.fin_credit_memos (id) on delete restrict, -- cash refund of a credit memo
  number_seq bigint not null,
  amount numeric(14,2) not null check (amount > 0),
  refunded_on date not null,
  method text not null check (method in ('check', 'cash', 'ach', 'wire', 'card_external', 'stripe', 'other')),
  reference text, stripe_refund_id text unique, stripe_dispute_id text,
  status text not null default 'recorded' check (status in ('recorded', 'void')),
  idempotency_key text not null, unique (book_id, idempotency_key), unique (book_id, number_seq),
  constraint fin_ref_source check (num_nonnulls(payment_id, credit_memo_id) = 1),
  constraint fin_ref_cb check (kind = 'refund' or payment_id is not null)
);

create table public.fin_payment_fees (                   -- processing/dispute fees (manual in P1, Stripe in P3)
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  payment_id uuid references public.fin_payments (id) on delete restrict,
  refund_id uuid references public.fin_refunds (id) on delete restrict,
  kind text not null check (kind in ('processing', 'dispute', 'refund', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  incurred_on date not null,
  stripe_balance_transaction_id text unique,
  idempotency_key text not null, unique (book_id, idempotency_key)
);
```

**Derived balances (views, `security_invoker = true`):**

| View | Formula |
|---|---|
| `fin_invoice_balances_v` | `open = total − Σ active allocations − Σ active credit applications`; display status `draft / open / partially_paid / paid / overdue / void`. |
| `fin_payment_balances_v` | `unapplied = amount − Σ active allocations − Σ recorded refunds/chargebacks (+ chargeback reversals)`; status void ⇒ 0. |
| `fin_customer_balances_v` | `ar_open = Σ invoice open`; `credits = Σ payment unapplied + Σ credit memo unapplied`; `net = ar_open − credits`; aging buckets 0-30/31-60/61-90/90+ by `due_date`. |
| `fin_retainage_v` | per job: Σ `retainage_withheld` on issued invoices − Σ `retainage_release` lines. |

Overpayment = payment with `unapplied > 0` (customer credit); it can be allocated later, refunded, or (Phase 2) left as a Customer Credits liability.

### 5.4 Costs and payables: vendors, cost codes, commitments, bills, expenses, job costs

```sql
create table public.fin_vendors (
  id                   uuid primary key default gen_random_uuid(),
  book_id              uuid not null references public.fin_books (id) on delete restrict,
  resource_id          uuid references public.pm_resources (id) on delete set null,   -- subcontractor in Team directory
  name                 text not null check (char_length(btrim(name)) between 1 and 200),
  kind                 text not null check (kind in ('subcontractor', 'supplier', 'service', 'other')),
  email text, phone text, remit_address text check (char_length(remit_address) <= 500),
  is_1099              boolean not null default false,
  tax_form_status      text not null default 'not_requested' check (tax_form_status in ('not_requested', 'requested', 'received', 'not_required')),
  tin_last4            char(4) check (tin_last4 ~ '^[0-9]{4}$'),   -- full TIN never stored; W-9 PDF goes to fin_documents
  payment_terms_days   integer check (payment_terms_days between 0 and 365),
  default_cost_code_id uuid,
  status               text not null default 'active' check (status in ('active', 'archived')),
  unique (book_id, resource_id)
);

create table public.fin_cost_codes (                     -- Project (job dimension) -> Trade -> Category
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.fin_books (id) on delete restrict,
  parent_id  uuid references public.fin_cost_codes (id) on delete restrict,
  level      text not null check (level in ('trade', 'category')),
  trade_slug text references public.trade_categories (slug) on update cascade,
  cost_type  text check (cost_type in ('material', 'labor', 'labor_material', 'equipment', 'subcontractor', 'overhead',
                                      'contingency', 'permit', 'delivery', 'labor_burden', 'other')),
                                      -- same list as estimate_items.cost_type (M/saved_items_library.sql:98-100)
  code       text not null check (char_length(code) between 1 and 30),
  name       text not null check (char_length(name) between 1 and 120),
  active     boolean not null default true,
  unique (book_id, code),
  constraint fin_cc_level check ((level = 'trade') = (parent_id is null))
);
-- Seed per book: one 'trade' per trade used in the book's estimates; 'category' children per cost_type.
-- Estimate-to-actual mapping: section trade (proposal_config.worksheet.sectionTrades) + item cost_type -> code.

create table public.fin_commitments (                    -- committed cost (subcontract / PO)
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  job_id uuid not null references public.fin_jobs (id) on delete restrict,
  vendor_id uuid not null references public.fin_vendors (id) on delete restrict,
  cost_code_id uuid not null references public.fin_cost_codes (id) on delete restrict,
  kind text not null check (kind in ('subcontract', 'purchase_order')),
  subcontractor_quote_id uuid references public.subcontractor_quotes (id) on delete set null,
  quote_revision_id uuid references public.subcontractor_quote_revisions (id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  retainage_percent numeric(7,4) not null default 0,
  status text not null default 'open' check (status in ('open', 'closed', 'void')),
  approved_by uuid references auth.users (id) on delete set null, approved_at timestamptz,
  idempotency_key text not null, unique (book_id, idempotency_key)
);

create table public.fin_vendor_bills (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  vendor_id uuid not null references public.fin_vendors (id) on delete restrict,
  vendor_bill_number text check (char_length(vendor_bill_number) <= 60),
  number_seq bigint not null,
  bill_date date not null, due_date date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'void')),
  subtotal numeric(14,2) not null default 0, tax_total numeric(14,2) not null default 0,
  retainage_withheld numeric(14,2) not null default 0, total numeric(14,2) not null default 0,
  commitment_id uuid references public.fin_commitments (id) on delete restrict,
  document_id uuid references public.fin_documents (id) on delete restrict,
  approved_by uuid references auth.users (id) on delete set null, approved_at timestamptz,
  idempotency_key text not null, unique (book_id, idempotency_key), unique (book_id, number_seq),
  constraint fin_bill_total check (total = subtotal + tax_total - retainage_withheld)
);
-- Duplicate-bill guard: same vendor + vendor number cannot be entered twice (unless voided).
create unique index fin_vendor_bills_vendor_no on public.fin_vendor_bills (book_id, vendor_id, lower(vendor_bill_number))
  where vendor_bill_number is not null and status <> 'void';

create table public.fin_vendor_bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.fin_vendor_bills (id) on delete restrict,
  line_no integer not null, job_id uuid references public.fin_jobs (id) on delete restrict,
  cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  commitment_id uuid references public.fin_commitments (id) on delete restrict,
  description text not null, amount numeric(14,2) not null,
  billable boolean not null default false,                 -- re-bill to customer (T&M)
  expense_account_id uuid,                                  -- Phase 2 FK
  unique (bill_id, line_no)
);

create table public.fin_bill_payments ( /* mirror of fin_payments for vendors: vendor_id, paid_on, method, reference,
  amount > 0, status recorded|void, verified, bank_transaction_id, idempotency_key, number_seq */ );
create table public.fin_bill_payment_allocations ( /* mirror of fin_payment_allocations: bill_payment_id, bill_id, amount, reversed_at */ );

create table public.fin_expenses (                       -- paid immediately (card/cash/personal reimbursable)
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.fin_books (id) on delete restrict,
  job_id uuid references public.fin_jobs (id) on delete restrict,
  vendor_id uuid references public.fin_vendors (id) on delete restrict,
  cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  spent_on date not null,
  paid_with text not null check (paid_with in ('company_card', 'company_cash', 'company_check', 'ach', 'personal_reimbursable')),
  amount numeric(14,2) not null check (amount > 0), tax_amount numeric(14,2) not null default 0,
  description text not null check (char_length(description) between 1 and 500),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'void')),
  submitted_by uuid not null references auth.users (id) on delete restrict,
  approved_by uuid references auth.users (id) on delete set null, approved_at timestamptz,
  document_id uuid references public.fin_documents (id) on delete restrict,
  idempotency_key text not null, unique (book_id, idempotency_key),
  constraint fin_exp_approved check ((status = 'approved') = (approved_by is not null and approved_at is not null))
  -- self-approval (approved_by = submitted_by) is decided in the approve RPC: allowed for solo books, configurable for companies (§14.8)
);

-- Job cost entries: append-only, one row per source event; reversals are negative rows.
-- V3 UPDATE (proposed-schema-v3.md §3): committed amounts are read from fin_commitments + revisions, NOT stored here;
-- this table holds 'actual' rows only, so bill relief can never double count.
create table public.fin_job_costs (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.fin_books (id) on delete restrict,
  job_id        uuid not null references public.fin_jobs (id) on delete restrict,
  cost_code_id  uuid references public.fin_cost_codes (id) on delete restrict,
  vendor_id     uuid references public.fin_vendors (id) on delete restrict,
  cost_status   text not null check (cost_status in ('committed', 'actual')),
  source_type   text not null check (source_type in ('commitment', 'bill_line', 'expense', 'labor', 'adjustment')),
  source_id     uuid not null,
  source_event  text not null default 'create' check (source_event in ('create', 'change', 'reverse')),
  amount        numeric(14,2) not null,                     -- signed
  incurred_on   date not null,
  estimate_group_id uuid, estimate_item_id uuid,            -- link to the estimate section/line (no FK: lines may be edited)
  description   text,
  unique (source_type, source_id, cost_status, source_event)  -- idempotent writer
);
create index on public.fin_job_costs (job_id, cost_status, cost_code_id);
```

**Job profitability (`fin_job_profitability_v`, security invoker):**

| Measure | Formula |
|---|---|
| Current contract | `fin_job_contract_v.current_contract` |
| Billed / collected / open AR | Σ issued invoice totals (+ retainage withheld) / Σ allocations / `fin_invoice_balances_v` |
| Budget cost | `fin_contract_snapshots.cost_basis` + Σ `project_cost_adjustments.amount` for the estimate (existing internal forecast) |
| Actual cost | Σ `fin_job_costs.amount` where `cost_status='actual'` |
| Open commitments | Σ committed − Σ actual billed against each commitment (floored at 0) |
| Projected cost | `max(budget, actual + open commitments)` per cost code |
| Gross profit (projected) | `current_contract − projected cost`; margin % |
| Gross profit (to date) | `billed − actual` (accrual) / `collected − paid costs` (cash) |

---

## 6. Phase 2 — double-entry ledger

```sql
create table public.fin_accounts (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references public.fin_books (id) on delete restrict,
  code        text not null check (code ~ '^[0-9A-Za-z.-]{1,20}$'),
  name        text not null check (char_length(name) between 1 and 120),
  type        text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype     text check (subtype in ('bank', 'undeposited_funds', 'stripe_clearing', 'ar', 'retainage_receivable',
                 'costs_in_excess', 'ap', 'retainage_payable', 'customer_deposits', 'customer_credits', 'sales_tax_payable',
                 'billings_in_excess', 'credit_card', 'retained_earnings', 'opening_balance', 'contract_revenue',
                 'sales_returns', 'job_cost', 'merchant_fees', 'other')),
  normal_side text generated always as (case when type in ('asset', 'expense') then 'debit' else 'credit' end) stored,
  parent_id   uuid references public.fin_accounts (id) on delete restrict,
  is_system   boolean not null default false,              -- seeded control accounts; cannot be archived
  active      boolean not null default true,
  unique (book_id, code)
);
-- One control account per singleton subtype per book.
create unique index fin_accounts_system_subtype on public.fin_accounts (book_id, subtype)
  where is_system and subtype in ('undeposited_funds', 'stripe_clearing', 'ar', 'retainage_receivable', 'ap', 'retainage_payable',
                                  'customer_deposits', 'customer_credits', 'sales_tax_payable', 'retained_earnings', 'opening_balance');

create table public.fin_accounting_periods (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'open' check (status in ('open', 'closed', 'locked')),
  closed_at timestamptz, closed_by uuid references auth.users (id) on delete set null,
  locked_at timestamptz, locked_by uuid references auth.users (id) on delete set null,
  unique (book_id, period_start),
  constraint fin_period_month check (period_start = date_trunc('month', period_start)::date
                                     and period_end = (period_start + interval '1 month' - interval '1 day')::date)
);
-- open: anyone with posting rights; closed: only holders of close_periods (adjusting entries); locked: nobody.
-- Reopening a locked period: owner only, audited.

create table public.fin_journal_entries (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references public.fin_books (id) on delete restrict,
  entry_number    bigint not null,                            -- fin_next_number('journal')
  entry_date      date not null,
  period_id       uuid not null references public.fin_accounting_periods (id) on delete restrict,
  basis           text not null check (basis in ('both', 'accrual', 'cash')),
  status          text not null default 'posted' check (status in ('draft', 'posted')),   -- drafts only for manual JEs
  source_type     text not null check (source_type in ('invoice', 'payment', 'allocation', 'credit_memo', 'credit_application',
                     'refund', 'fee', 'bill', 'bill_payment', 'expense', 'manual', 'opening_balance', 'reversal', 'wip_adjustment')),
  source_id       uuid,
  source_event    text not null,                              -- 'issued', 'voided', 'allocated', 'reversed', …
  idempotency_key text not null check (char_length(idempotency_key) <= 200),
  lines_hash      text not null check (lines_hash ~ '^[0-9a-f]{64}$'),   -- replay with different lines = conflict
  reversal_of     uuid unique references public.fin_journal_entries (id) on delete restrict,  -- each entry reversed at most once
  memo            text check (char_length(memo) <= 1000),
  posted_at       timestamptz, posted_by uuid references auth.users (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (book_id, idempotency_key),
  unique (book_id, entry_number),
  constraint fin_je_posted check ((status = 'posted') = (posted_at is not null))
);
create index on public.fin_journal_entries (book_id, entry_date);
create index on public.fin_journal_entries (source_type, source_id);

create table public.fin_journal_lines (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.fin_journal_entries (id) on delete restrict,
  book_id      uuid not null references public.fin_books (id) on delete restrict,
  line_no      integer not null check (line_no >= 1),
  account_id   uuid not null references public.fin_accounts (id) on delete restrict,
  debit        numeric(14,2) not null default 0 check (debit >= 0),
  credit       numeric(14,2) not null default 0 check (credit >= 0),
  job_id       uuid references public.fin_jobs (id) on delete restrict,
  customer_id  uuid references public.customers (id) on delete restrict,
  vendor_id    uuid references public.fin_vendors (id) on delete restrict,
  cost_code_id uuid references public.fin_cost_codes (id) on delete restrict,
  memo         text check (char_length(memo) <= 500),
  unique (entry_id, line_no),
  constraint fin_jl_one_side check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index on public.fin_journal_lines (account_id, entry_id);
create index on public.fin_journal_lines (job_id) where job_id is not null;

-- Balance: checked at COMMIT (deferred), so lines can be inserted one by one inside the posting transaction.
create function public.fin_assert_entry_balanced(p_entry uuid) returns void language plpgsql as $$
declare v_status text; v_dr numeric; v_cr numeric; v_n integer;
begin
  select status into v_status from fin_journal_entries where id = p_entry;
  if v_status is distinct from 'posted' then return; end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into v_dr, v_cr, v_n
    from fin_journal_lines where entry_id = p_entry;
  if v_n < 2 or v_dr = 0 or v_dr <> v_cr then
    raise exception 'unbalanced_entry' using errcode = 'P0001', detail = format('%s: dr %s cr %s n %s', p_entry, v_dr, v_cr, v_n);
  end if;
end $$;
create function public.fin_lines_balanced_trg() returns trigger language plpgsql as $$
begin perform fin_assert_entry_balanced(coalesce(new.entry_id, old.entry_id)); return null; end $$;
create function public.fin_entries_balanced_trg() returns trigger language plpgsql as $$
begin perform fin_assert_entry_balanced(new.id); return null; end $$;
create constraint trigger fin_journal_lines_balanced after insert or update or delete on public.fin_journal_lines
  deferrable initially deferred for each row execute function public.fin_lines_balanced_trg();
create constraint trigger fin_journal_entries_balanced after insert or update on public.fin_journal_entries
  deferrable initially deferred for each row execute function public.fin_entries_balanced_trg();

-- Immutability: no UPDATE/DELETE of posted entries or their lines, ever (no cascade escape hatch).
create function public.fin_guard_posted() returns trigger language plpgsql as $$ … $$;
  -- fin_journal_entries: before update/delete -> if old.status = 'posted' raise 'entry_immutable'
  --                      (draft -> posted is the only allowed status change)
  -- fin_journal_lines:   before insert/update/delete -> if parent status = 'posted' and tg_op <> 'INSERT'
  --                      (or INSERT after the posting transaction) raise 'entry_immutable'
-- Period lock: before insert/update on fin_journal_entries -> period status must allow the caller (see above).
revoke all on public.fin_accounts, public.fin_accounting_periods, public.fin_journal_entries, public.fin_journal_lines
  from anon, authenticated;
grant select on public.fin_accounts, public.fin_accounting_periods, public.fin_journal_entries, public.fin_journal_lines to authenticated;

-- The ONLY writer. Idempotent: same key + same lines_hash returns the existing id; different hash -> 'idempotency_conflict'.
create function public.fin_post_entry(p_book uuid, p_date date, p_basis text, p_source_type text, p_source_id uuid,
  p_source_event text, p_lines jsonb, p_memo text default null) returns uuid
language plpgsql security definer set search_path = public as $$ … $$;
  -- idempotency_key = p_source_type || ':' || coalesce(p_source_id::text, '-') || ':' || p_source_event || ':' || p_basis

create function public.fin_reverse_entry(p_entry uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$ … $$;
  -- new entry, same basis, swapped debit/credit, reversal_of = p_entry, dated in an OPEN period (never back into a locked one)

create view public.fin_trial_balance_v with (security_invoker = true) as …;   -- per book, basis, account, period
```

Posting happens **inside the same transaction** as the operational action (issue invoice → post) once `fin_books.ledger_enabled_at` is set; a one-time backfill posts Phase 1 history in date order using the same idempotency keys, so re-running it is safe.

---

## 7. Event → journal mapping

Accounts named by subtype. AR lines carry `customer_id`/`job_id`; cost lines carry `job_id`/`cost_code_id`/`vendor_id`. "R" = revenue amount, "T" = tax, "Ret" = retainage.

| # | Event (source_type:event) | Accrual basis entry | Cash basis entry | Notes |
|---|---|---|---|---|
| 1 | Invoice issued — progress/final (`invoice:issued`) | Dr AR (total) · Dr Retainage Receivable (Ret) · Cr Contract Revenue (R) · Cr Sales Tax Payable (T) | none | Tax timing ⚠ CPA |
| 2 | Deposit invoice issued (`invoice:issued`, kind deposit) | Dr AR · Cr Customer Deposits (liability) | none | ⚠ CPA: deposit is unearned until work/milestone |
| 3 | Payment received & allocated to invoice (`allocation:allocated`) | Dr Undeposited Funds (or Bank) · Cr AR | Dr Undeposited Funds · Cr Contract Revenue (pro-rata R) · Cr Sales Tax Payable (pro-rata T) | pro-rata by the invoice's revenue/tax mix, last part absorbs remainder |
| 4 | Payment received, not yet allocated (`payment:recorded`) | Dr Undeposited Funds · Cr Customer Credits | same (basis `both`) | becomes #3-style when allocated: Dr Customer Credits · Cr AR (accrual) / Dr Customer Credits · Cr Revenue+Tax (cash) |
| 5 | Deposit received against deposit invoice (`allocation:allocated`) | Dr Undeposited Funds · Cr AR | Dr Undeposited Funds · Cr Customer Deposits | ⚠ CPA: many cash-basis filers treat deposits as income on receipt |
| 6 | Deposit applied on a progress invoice (`invoice:issued`, `deposit_application` line) | Dr Customer Deposits · Cr AR | Dr Customer Deposits · Cr Contract Revenue (+T) | |
| 7 | Credit memo issued (`credit_memo:issued`) | Dr Sales Returns & Allowances (R) · Dr Sales Tax Payable (T) · Cr Customer Credits | none | |
| 8 | Credit applied to invoice (`credit_application:applied`) | Dr Customer Credits · Cr AR | none (no cash moved) ⚠ | cash-basis treatment of non-cash credits ⚠ CPA |
| 9 | Retainage release invoiced (`invoice:issued`, retainage_release) | Dr AR · Cr Retainage Receivable | none | collected → #3 |
| 10 | Refund to customer (`refund:recorded`) | Dr Customer Credits · Cr Bank | Dr Customer Credits (if from unapplied) **or** Dr Contract Revenue + Sales Tax Payable (if refunding earned cash revenue) · Cr Bank | requires source allocation to be reversed first when refunding a paid invoice |
| 11 | Processing fee (`fee:recorded`) | Dr Merchant Fees · Cr Stripe Clearing (or Bank) | same (`both`) | Stripe: payment = Dr Stripe Clearing gross; payout = Dr Bank · Cr Stripe Clearing |
| 12 | Chargeback (`refund:recorded`, kind chargeback) | reverse allocation (Dr AR · Cr Customer Credits) then Dr Customer Credits · Cr Stripe Clearing; dispute fee → #11 | Dr Contract Revenue (+T) · Cr Stripe Clearing | chargeback reversal = mirror entry |
| 13 | Vendor bill approved (`bill:approved`) | Dr Job Cost (per line cost code) · Cr AP (total) · Cr Retainage Payable (Ret) | none | sales/use tax on purchases → cost |
| 14 | Bill paid (`bill_payment:allocated`) | Dr AP · Cr Bank | Dr Job Cost (pro-rata by bill lines) · Cr Bank | retainage payable paid later: Dr Retainage Payable · Cr Bank |
| 15 | Expense approved (`expense:approved`) | Dr Job Cost/Expense · Cr Bank / Credit Card / (reimbursable) Accrued Reimbursements | same (`both`) when paid by company; reimbursable: cash entry at reimbursement | |
| 16 | Any document voided (`*:voided`) | `fin_reverse_entry` of every entry for that source, dated in an open period | same | void of an issued invoice with allocations is refused until allocations are reversed |
| 17 | Allocation reversed (`allocation:reversed`) | reversal of #3/#5 | reversal | |
| 18 | Manual / adjusting JE (`manual:posted`) | as entered (`post_journal_entries`) | as entered; user picks basis | |
| 19 | WIP / over-under billing (`wip_adjustment`) | Dr Costs in Excess of Billings · Cr Revenue (under-billed) or Dr Revenue · Cr Billings in Excess (over-billed), auto-reversed next period | none | ⚠ CPA; Phase 3 |

### Items flagged for CPA review (blockers before Phase 2 goes live)
1. **Deposits:** liability until earned vs income on receipt (cash-basis tax filers); state deposit-limit rules.
2. **Retainage:** receivable recognition on billing vs on release; payable retention for subs; cash-basis timing.
3. **Revenue recognition for larger jobs:** completed-contract vs percentage-of-completion (cost-to-cost) and the WIP schedule; threshold by revenue size / job duration.
4. **Sales tax:** contractor as end consumer of materials vs collecting tax on the contract price; tax on change orders; payable at invoice (accrual) vs collection (cash); single `estimates.tax_rate` per job.
5. **Non-cash credits under cash basis** (#8) and refunds of revenue from a prior closed period.
6. **Processing fees:** gross vs net revenue presentation; fees passed through to customers (surcharges).
7. **Chart of accounts default** for construction (and mapping for QuickBooks/Xero exports).

---

## 8. RLS approach

| Rule | Implementation |
|---|---|
| Read: book-wide | `using (public.fin_has_permission(book_id, 'view_company_financials'))` |
| Read: job-scoped | `or (job_id is not null and public.fin_job_visible(job_id))`, where `fin_job_visible` = `view_project_financials` AND (caller is `project_schedules.project_manager_id` / `sales_rep_id` for the estimate, or the bid owner) AND `estimate_readable(estimate_id)`. Cost tables additionally require `has_company_permission(company, 'view_costs' \| 'view_subcontractor_costs')` (keeps "viewing an assigned project never grants internal financial access", `M/projects_workspace.sql:12-13`). Sales rep sees contract/billing views only. |
| Performance | Like `my_visible_bid_owners()`, expose a set-returning `fin_my_books()` → `(book_id, perms text[])` evaluated once per query; policies use `book_id in (select …)`. |
| Writes | No insert/update/delete grants to `authenticated`. All writes via `SECURITY DEFINER` RPCs that check `fin_has_permission(book, key, p_write => true)`, lock rows, write `fin_audit_log`, and (Phase 2) post. Service-role routes (Stripe, imports) call the same functions with an explicit actor. |
| Views | `with (security_invoker = true)` so they inherit table RLS. |
| Customers | Finance never reads `customers` for display; it uses `bill_to` snapshots, so bid-visibility RLS on `customers` is not widened. |
| Storage | `finance-files` bucket: no `storage.objects` policies; signed URLs (≤ 300 s) issued after `fin_has_permission`. |
| Accountant (external) | Phase 3: `fin_book_guests(book_id, user_id, fin_role='accountant', expires_at)` for solo books and accountants who are not company members (open question §14). |

---

## 9. Idempotency

| Surface | Mechanism |
|---|---|
| UI create actions (invoice draft, payment, allocation, refund, bill, expense) | client generates a uuid `idempotency_key` per form submit; `unique (book_id, idempotency_key)`; replay returns the existing row; a replay whose payload hash differs raises `idempotency_conflict`. |
| Status transitions (issue, void, approve) | `select … for update` + state check; repeating an action in the target state returns `{unchanged: true}` (pattern from `change_order_send`, `M/project_documents.sql:204-207`). |
| Contract changes from COs | `unique (change_order_id)` + `on conflict do nothing` in the trigger and in job backfill. |
| Job costs | `unique (source_type, source_id, cost_status, source_event)`. |
| Ledger postings | `unique (book_id, idempotency_key)` + `lines_hash`; `unique (reversal_of)`. |
| Stripe (Phase 3) | new `fin_stripe_events(id text primary key, account_id text, type, event_created, claimed_at, processed_at, error)` claimed atomically with `insert … on conflict (id) do nothing returning id` (fixes audit R9); plus unique external ids: `stripe_payment_intent_id`, `stripe_refund_id`, `stripe_balance_transaction_id`, dispute id. Separate Connect webhook route + secret. |
| Bank import (Phase 3) | `fin_bank_transactions unique (bank_account_id, external_id)`; for CSVs without ids, `unique (bank_account_id, import_fingerprint)` where fingerprint = sha256(date, amount, normalized description, occurrence index within the file-day). Re-importing the same file is a no-op. |

---

## 10. Concurrency

| Race | Control |
|---|---|
| Two allocations against one payment (or one invoice) at once | Allocation RPC locks in a fixed order: **payment row → invoice rows sorted by id** (`select … for update`), then re-sums active allocations (READ COMMITTED re-reads after the lock wait) and checks `Σ ≤ payment.amount − refunds` and `Σ ≤ invoice.total − credits`. A deferred constraint trigger re-checks both invariants at commit as a backstop. Fixed lock order prevents deadlocks; one payment across many invoices is one transaction. |
| Refund racing an allocation | Refund RPC takes the same payment-row lock first. |
| Gapless numbers | `fin_next_number` row lock held to commit; number allocated only at issue. |
| Issue vs edit of a draft | `revision` check (`stale_revision`, 40001) as in schedules. |
| Void vs allocation | Void locks the invoice; refuses if active allocations/credits exist. |
| Period close vs posting | Close locks the period row; posting reads period status `for share`. |
| CO approval vs job creation | Both paths insert into `fin_contract_changes` with `on conflict (change_order_id) do nothing`. |
| Webhook duplicates | atomic claim (§9). |

---

## 11. Required changes to existing objects (Phase 1 patch migration)

| Object | Change | Why |
|---|---|---|
| `company_permission_keys()`, `company_owner_only_permissions()` | append finance keys (§4.1); **re-declare the full list** (each migration replaces the function, `M/customer_communications.sql:28-80`) | permissions |
| `src/lib/enterprise/permissions.ts` + `tests/db/enterprise-workspace.test.ts` | mirror new keys/labels | DB↔TS check |
| `customer_merge()` (`M/customer_hub.sql:290-324`) | re-point `fin_jobs`, `fin_invoices`, `fin_payments`, `fin_credit_memos`, `fin_refunds` `customer_id`, and patch unissued drafts' bill-to; issued docs keep their snapshot | RESTRICT FKs would otherwise block merges |
| `drop_orphan_bid_customer()` (`:208-219`) | add `not exists` checks for finance tables | avoid FK errors / keep finance customers |
| `POST /api/account/delete` (`src/app/api/account/delete/route.ts:15-41`) | refuse (clear message) when the user owns a solo `fin_book` with issued documents, or anonymize per retention policy | `owner_user_id … on delete restrict`; legal retention ⚠ |
| Estimate delete UX | map FK error 23503 from `fin_jobs` to "This job has financial records — archive it instead" (`src/lib/operations/server.ts` style) | RESTRICT |
| `change_orders` | `after update of status` trigger → `fin_contract_changes` | D6 |
| `project_proposal_history()` | when a `fin_contract_snapshots` row exists, report it as the approval instead of the heuristic | single truth |
| Stripe webhook (`src/app/api/stripe/webhook/route.ts:53-57`) | switch to atomic claim (independent hardening; required before Phase 3) | R9 |
| `apply_subscription_update` path (`src/lib/billing/apply.ts`) | call `apply_fin_update()` like `apply_pm_update()` | seats |

---

## 12. Migration file split and rollback plan

| Phase | File (timestamps after `20261122001000`) | Contents | Rollback |
|---|---|---|---|
| 1a | `20261124001000_fin_core.sql` | `fin_books`, keys/roles/owner-only, `fin_seats`, `fin_entitlement`, `fin_has_permission`, subscriptions/comp columns, `apply_fin_update`, sequences, `fin_audit_log`, `fin_documents`, `finance-files` bucket | `docs/financials/rollback_20261124001000.sql` |
| 1b | `20261124002000_fin_contracts.sql` | `fin_jobs`, snapshots, milestones, contract changes, CO trigger, contract view | `…/rollback_20261124002000.sql` |
| 1c | `20261124003000_fin_receivables.sql` | invoices, lines, payments, allocations, credit memos/applications, refunds, fees, balance views, RPCs | `…003000.sql` |
| 1d | `20261124004000_fin_costs.sql` | vendors, cost codes, commitments, bills, bill payments, expenses, job costs, profitability view | `…004000.sql` |
| 1e | `20261124005000_fin_existing_patches.sql` | §11 SQL patches (customer merge/orphan, proposal history) | restores previous function bodies verbatim |
| 2a | `2026120x001000_fin_ledger_core.sql` | accounts, periods, entries, lines, balance/immutability/period triggers | — |
| 2b | `2026120x002000_fin_posting.sql` | `fin_post_entry`, `fin_reverse_entry`, posting hooks in Phase 1 RPCs, trial balance | — |
| 2c | `2026120x003000_fin_ledger_backfill.sql` | idempotent backfill function (run per book when enabling) | re-runnable |
| 3 | `…_fin_bank_reconciliation.sql`, `…_fin_stripe_connect.sql`, `…_fin_accountant_access.sql` | bank accounts/transactions/matches; Connect accounts, `fin_stripe_events`; guest accountants | — |

Rules:
* Every file: idempotent (`if not exists`, `drop … if exists`), additive only, `Requires every earlier migration`, header comment in the repo's style, DB tests in `tests/db/fin-*.test.ts`.
* **Rollback window:** each rollback script starts with a guard and aborts if real data exists:
  ```sql
  do $$ begin
    if exists (select 1 from public.fin_invoices where status <> 'draft')
       or exists (select 1 from public.fin_payments)
       or (to_regclass('public.fin_journal_entries') is not null and exists (select 1 from public.fin_journal_entries)) then
      raise exception 'rollback_unsafe: financial records exist; disable the feature flag instead';
    end if;
  end $$;
  ```
  then drops in reverse dependency order and restores replaced function bodies.
* **After go-live: roll forward only.** Kill switch = `feature_flags` row `financials` + `NEXT_PUBLIC_FINANCIALS` env (pattern of `NEXT_PUBLIC_ESIGNATURES`); RPCs refuse writes when off; data stays. Ledger off-switch = clear `fin_books.ledger_enabled_at` (posting stops; posted entries remain).
* Apply to a Supabase **branch** first; run `tests/db` + the fixtures below; then production during low traffic.

---

## 13. Correctness test fixtures (tests/db/fin-*.test.ts)

| # | Fixture | Expectation |
|---|---|---|
| 1 | Balanced journal: 3-line entry dr 100 / cr 92.59 + 7.41 | commits |
| 2 | Unbalanced journal (dr 100 / cr 99.99), single-line entry, zero entry, line with both debit and credit | `unbalanced_entry` at commit / check violation |
| 3 | UPDATE/DELETE posted entry or line (as service role too) | `entry_immutable` |
| 4 | Reverse an entry twice | second fails (`unique reversal_of`); reversal nets account balances to 0 |
| 5 | Posting into locked period; into closed period without `close_periods`; reversal of a locked-period entry | refused / refused / dated in open period |
| 6 | Partial payment 400 on 1,000 invoice | open 600, status partially_paid |
| 7 | Overpayment 1,200 on 1,000 invoice | invoice paid, 200 unapplied credit; refund 200 → 0 |
| 8 | One payment 1,500 across three invoices (500/700/300) | all paid; payment unapplied 0 |
| 9 | Over-allocation attempt (payment or invoice) | refused |
| 10 | **Concurrent** allocations: two sessions each allocate 600 of a 1,000 payment | exactly one succeeds |
| 11 | Concurrent issue of 50 invoices in one book | numbers 1..50, no gaps/dupes; voided keeps number |
| 12 | Duplicate submit (same idempotency_key) ×2; same key different payload | one row / `idempotency_conflict` |
| 13 | Duplicate vendor bill number for same vendor | refused (unless prior is void) |
| 14 | Duplicate bank import (same file twice; overlapping files) | no new rows |
| 15 | Refund of an allocated payment without reversing allocation | refused; with reversal → AR reopens |
| 16 | Chargeback + dispute fee, then chargeback reversal | balances and Stripe Clearing return to pre-dispute; fee remains |
| 17 | Processing fee on Stripe payment, then payout | Stripe Clearing nets to 0; Merchant Fees = fee |
| 18 | Deposit invoice → deposit payment → progress invoice with deposit_application | Customer Deposits ends at 0; AR correct under both bases |
| 19 | Retainage 10% on progress invoices, then release invoice | Retainage Receivable returns to 0 |
| 20 | Contract: original 25,000 + CO +2,400 + CO −600 + deduction −300 | current contract 26,500; CO trigger idempotent on repeated status updates |
| 21 | Contract snapshot when `roundTotal` on (subtotal 10,000.40 + tax 825.03 → total 10,825) | `rounding = −0.43`, check constraint holds |
| 22 | Rounding: 3 × 33.335; tax 8.25% on 3 taxable lines; milestones 33.33/33.33/33.34% | per-line half-up; Σ line tax = invoice tax; last part absorbs remainder; PG result = decimal.js result |
| 23 | Negative rounding (credit lines −0.005) | half away from zero both sides |
| 24 | Cash-basis pro-rata revenue on a partial payment of a mixed taxable/non-taxable invoice | revenue + tax = cash received exactly |
| 25 | Void invoice with allocations | refused until allocations reversed; void posts reversal |
| 26 | RLS: bookkeeper without seat; seat beyond seat_limit; PM on unassigned job; sales rep reading costs; member of company A reading book B; deactivated member | all denied |
| 27 | Customer merge with finance rows; orphan cleanup with finance rows | rows re-pointed / customer kept |
| 28 | Delete estimate with a `fin_job`; delete account owning a solo book with issued invoices | FK refusal / route refusal |
| 29 | Entitlement lapse | reads + export work; writes refused |
| 30 | Ledger backfill run twice | identical entry set (idempotency keys) |

---

## 14. Open questions for the owner

1. **Solo users:** is the Financial add-on sold to Unlimited (non-Enterprise) users, and at what price (the 3-user bundle doesn't fit one user)?
2. **Who must hold a financial seat?** Proposed: everyone using finance, including PMs/sales reps who only *view* job financials. Alternative: free read-only job view for assigned PMs.
3. **External accountants:** must they be company members (consuming an Enterprise seat) or get guest access (§8)?
4. **Account deletion / retention:** may a user with issued invoices delete their account? Proposed: refuse and offer export; retain finance records ≥ 7 years.
5. **Default reporting basis** for new books (cash for most small contractors?) and whether to require CPA sign-off before enabling the GL.
6. **Tax on change orders** and on invoices — same rate as the estimate? Can a CO be non-taxable?
7. **Manual approvals:** require the user to pick and confirm the contract version when there is no signature (proposed), instead of the timestamp heuristic.
8. **Expense self-approval:** may an owner/financial admin approve their own expenses (solo books must allow it)?
9. **Invoice numbering format** per company (prefix, starting number to continue from QuickBooks).
10. **Payment schedule → invoices:** auto-create draft invoices from the proposal's milestones, or manual only?
11. **Stripe Connect (Phase 3):** who pays processing fees (absorb vs surcharge), and Standard vs Express accounts.
