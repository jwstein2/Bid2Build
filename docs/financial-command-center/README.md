# Built2Bid Financial Command Center: Phase 0 Architecture & Plan

**Status:** For James's approval · 2026-11-17 · Covers the V1 master prompt plus the V2, V3 and V3.1 addenda
**Nothing has been migrated, deployed, priced in Stripe or turned on.** This document is the lead architecture review. The workstream reports it draws on are listed in §15.

---

## 1. Decisions requested from James

| # | Decision | Recommendation |
|---|---|---|
| A | Approve the architecture in §5 (one book per company or solo owner, the accepted estimate as the job, `numeric(14,2)` money, append-only contract history, a balanced double-entry ledger in Phase 2, writes only through server functions) | **Approve.** |
| B | Phase 1 scope (§12) | **Residential-first financial operations**: contract snapshot, deposit and milestone invoices, manual payments, job costs and bills, subcontract commitments, budget vs actual, documents, accountant exports. **Phase 1b** adds progress billing with a schedule of values and retainage as tracked records, before the ledger. These were the #1 and #2 contractor complaints. |
| C | Pricing (§8) | **GO WITH CHANGES**: launch as Early Access at $24.99 incl. 3 financial users + $4.99/extra with a 12-month price lock, add annual prices from day one ($249/yr + $49.99/yr per extra user), add one free read-only Accountant seat, and set a fair-use cap on AI extraction. No Stripe objects are created until you OK them separately. |
| D | Solo (Standard Unlimited) customers | Open question. Standard is a single-login plan, so "3 users" only means something for Enterprise companies. **Options:** (1) Enterprise-only at launch; (2) solo add-on at $24.99 with 1 user + accountant seat; (3) a lower solo price. My lean is (2). |
| E | AI scope (§9, per V3.1) | Approve the retained, removed and deferred lists. Every AI feature has its own company toggle, high-risk ones default **off**, and Financials works with all AI off. |
| F | CPA engagement | A licensed CPA needs to rule on deposits, retainage, WIP, cash vs accrual and sales-tax timing **before the ledger is enabled** (§11). Budget estimate: $3k–$7.5k one-time. |

---

## 2. What exists today (data audit summary)

Full audit: `phase0/architecture/data-audit.md`.

- **No financial data exists yet.** There are no invoice, payment, deposit, AR/AP or ledger tables. Money appears only as estimate prices, frozen proposal totals, change-order amounts, signature totals, sub-quote amounts and cost-forecast adjustments.
- **The job is the estimate.** Every project table (change orders, scope sections, sub quotes, photos, documents, schedules) is keyed on `estimates.id`. Finance reuses it, so no new projects table is needed.
- **Ownership is split.** Rows always have a `user_id` and an optional `company_id`, and companies exist only for Enterprise. Three different solo-vs-company patterns already coexist.
- **Critical risk: cascading deletes.** Account deletion hard-deletes the user and cascades to estimates, customers and signatures, and owners can delete their own estimates and customers. Finance tables must use `RESTRICT`. Account deletion needs a finance guard (export plus a retention rule).
- **Customer identity can change.** Customer Hub links can be re-pointed or merged (the losing row is deleted) and orphans are auto-dropped. Financial documents therefore keep both a foreign key and a frozen bill-to copy.
- **Totals are stored only on frozen versions**, and a whole-dollar rounding delta has no column. The payment schedule in the frozen proposal is formatted text (`"$1,234.00"`). Finance recomputes milestone amounts from percents and checks them against that text.
- **Change orders carry no tax**, and manual "Won" approval picks the contract version by a timestamp rule. Finance stores an explicit contract snapshot instead.
- **Webhook dedupe is select-then-insert, not atomic.** That is acceptable for subscriptions but must be fixed before any customer payment flows (Phase 3).
- **Good baseline:** contractor money is `numeric(14,2)`, with no floats anywhere.
- **Existing AI** (relevant to V3.1): proposal scope text (Haiku, with a deterministic fallback), project photo labels (`PHOTO_AI_LABELS=on` for the whole platform), Opportunity Radar drafts (admin) and pricing guides (marketing). Photo labels are currently a platform-wide env flag, not a company choice, so §9 adds a company toggle.

---

## 3. Research findings (Voice of Customer)

Full report: `phase0/research/voc-report.md`, evidence in `phase0/research/evidence.csv`.

**Sample:** 144 distinct observations (E001–E144). About 99 are user or reviewer voices; the rest are official docs, vendor pages and comparisons. **Limits, stated honestly:** in this session Reddit, intuit.com and most review sites could only be read through search-result summaries, not opened directly. Gartner-network reviews (Capterra, GetApp, Software Advice) are counted once. No review was fabricated, and no inaccessible review was counted as analyzed. Treat the rankings as directional until contractor interviews confirm them.

**Ranked contractor problems → Built2Bid response**

| # | Problem (evidence type) | Built2Bid response |
|---|---|---|
| 1 | Progress billing is locked to the original estimate, so change orders break it (repeated community theme) | The schedule of values comes from the signed contract, and approved change orders append SOV lines. Earlier invoices are never rewritten. |
| 2 | Retainage is a manual negative line and is wrong on a cash basis (repeated theme; official limitation below Advanced) | Retainage receivable and payable as real records with release invoices; CPA-reviewed posting in Phase 2 |
| 3 | Job costing is unreliable, especially labor (repeated theme) | Costs are entered inside the job and coded by trade/section/cost code from the estimate |
| 4 | Committed costs and sub balances are invisible (repeated theme) | Subcontract commitments and POs. A quote is not a commitment, and a commitment is not a payable. |
| 5 | WIP and over/under billing are rebuilt in Excel (repeated theme) | WIP report in Phase 4, cost-to-cost only, never based on schedule % |
| 6 | Price hikes; construction features and custom roles only on Advanced (aggregated review finding plus official pricing) | Flat, predictable pricing with all financial features included |
| 7 | Bank-feed duplicates and reconciliation drift (aggregated finding) | Manual import first, with dedupe keys and explicit reconciliation states |
| 8 | Payment holds and card fees on large invoices (repeated theme) | ACH by default for large invoices via Connect in Phase 3 |
| 9 | Field staff can see company financials (repeated theme) | Financial seats plus role presets; PMs see only their assigned jobs |
| 10 | Support quality and forced UI or AI changes (aggregated finding) | Stable navigation, optional AI, plain-language errors |

**QuickBooks 2026 facts** (from Intuit pages and your screenshot):
- **Construction features in Advanced.** Since August 2026, Advanced includes construction financials at no extra cost: job costing, budget vs actual, AIA-style billing by phase, change orders and WIP. Cost-to-complete arrived in September 2026.
- **Labeled NEW.** Your screenshot marks "Construction financials solution" and "Advanced project financials" as NEW and Advanced-only.
- **Retainage and pay apps.** Retainage, schedule of values and G702/G703 pay apps are **beta in Intuit Enterprise Suite**. Native retainage in Advanced is unconfirmed.
- **Intuit Intelligence** is beta, admin-only and capped by plan.
- **Prices** are about $38, $85, $140 and $340/mo for 1, 3, 5 and 25 users after the 2026-08-01 increase. These come from third parties, so confirm on intuit.com before quoting them publicly.

**Sage 100 Contractor** (official help and 2026.1–2026.3 release notes): cost codes by cost type, POs and subcontract commitments, sub change orders, retainage both ways, SOV pay apps on purchased AIA forms, over/under billing, certificate-expiry warnings, lien waivers, an equipment add-on, and certified payroll. The **2023 Sage datasheet you sent is vendor marketing**. About a third of its QuickBooks Online "No" cells are outdated by the 2026 Advanced release. The ToolStack article is treated as editorial.

**Where Built2Bid wins:** no one else starts from the contractor's own estimate and e-signed proposal. Built2Bid can turn the signed bid into the contract, budget, SOV and invoice schedule with no re-entry. The others either lack estimating (QBO, Xero) or are heavy and expensive (Sage, Buildertrend).

---

## 4. Capability matrix (lead reconciliation)

The full matrix is in `phase0/research/qb-sage-capability-matrix.md`, the QuickBooks screenshot benchmark in `phase0/research/qbo-feature-benchmark.md`, and the cross-product matrix in `phase0/research/competitor-matrix.md`. The table below fills in the "Built2Bid Existing" column from the code audit.

| Feature | QuickBooks | Sage 100 Contractor | Built2Bid existing (from code) | Proposed | Trades | Priority |
|---|---|---|---|---|---|---|
| Estimate → budget | Advanced (2026) | Yes | Estimates + frozen versions with `total_cost`; sections/trades; `project_cost_adjustments` | Freeze the signed version as the original budget by trade/section/cost code | All | P1 |
| Cost codes | No native object; classes (Plus has 40) | Yes, by cost type | Trade catalog (`src/lib/trades`), `estimate_items.cost_type`, section trades | `fin_cost_codes` seeded from the trade catalog. No second taxonomy. | All | P1 |
| Change orders → contract value | Advanced | Yes | `change_orders` table with approval/signing; contract value derived by a heuristic | `fin_contract_changes` append-only; current = original + approved COs − deductions | All | P1 |
| Deposits & milestone invoices | All plans (invoices) | Yes | `paymentSchedule` exists only as proposal text | Invoice schedule from the signed payment schedule; invoices created only on user action | REM, DECK, ROOF, PAINT, EXT | P1 |
| Manual payments & allocation | All plans | Yes | None | Payments + allocations; unverified until reconciled | All | P1 |
| Subcontract commitments / POs | Advanced (committed costs) | Yes | Team & Subcontractors directory (`pm_resources`), `subcontractor_quotes` + revisions | `fin_commitments` from accepted quotes or estimate lines; bills relieve the commitment | GC, REM, COMM, CONC | P1 |
| Vendor bills & expenses | Essentials+ | Yes | None | Bills/expenses coded to job + cost code; receipt upload | All | P1 |
| Progress billing / SOV | Essentials+ (100% cap); Advanced AIA-style | Yes (purchased AIA forms) | None | SOV from contract + COs; "AIA-style" summary with no AIA compliance claim | COMM, GC, CONC, ELEC, PLUMB, HVAC, DRY | P1b |
| Retainage AR/AP | IES beta | Yes | None | Retainage records + release invoices | COMM, GC, CONC | P1b (records), P2 (posting) |
| Double-entry GL, P&L, BS, TB | All plans | Yes | None | Phase 2 ledger | All | P2 |
| Bank import / reconciliation | Bank feeds all plans | Yes | None | CSV/OFX/QFX import + reconciliation first; feeds later | All | P2 |
| WIP / over-under billing | Advanced (2026) | Yes | None | Cost-to-cost WIP report | COMM, GC | P4 |
| Labor time to jobs | Essentials+ (time to invoices) | Yes + payroll | Schedule tasks and assignments only | Optional approved time entries with cost rates (no payroll) | SVC, REM, GC | P4 |
| Equipment costing | No | Add-on | None | Optional | CONC, GC | P4 |
| Sub compliance (COI etc.) | No | Yes | None | Optional document tracking with expiry warnings; no verification claims | GC, COMM | P4 |
| 1099 | Advanced (e-file via Bill Pay Elite) | Yes | None | 1099 vendor flag + report export; e-file via a partner later | All | P2 |
| Payroll | Add-on | Yes (certified) | None | **Excluded** (V3/V3.1) | — | X |
| Sales tax filing | Sales Tax AI | Yes | One `tax_rate` per estimate | Deterministic tax on invoices; filing excluded | All | P2 (liability report) |
| Inventory | Plus+ | Yes | None | Deferred (V3.1) | — | X |
| Custom permissions | Advanced | Yes | Enterprise roles + granted/revoked permissions | Financial permission keys + seat role presets | All | P1 |

---

## 5. Architecture

Full design: `phase0/architecture/proposed-schema.md` and `phase0/architecture/proposed-schema-v3.md`.

### 5.1 Core decisions (lead-approved)

| | Decision | Why |
|---|---|---|
| Tenant | **`fin_books`**: one per company, or one per solo owner (exactly one of the two). Every financial row carries `book_id`. | Gives one real foreign key. An auto-created "personal company" was rejected because it breaks solo scheduling and Customer Hub matching. |
| Job | Accepted `estimates.id`, plus a thin `fin_jobs` row (1:1, `RESTRICT`) | Every project table already keys on the estimate |
| Customer | `customers.id` (`RESTRICT`) **plus** a frozen bill-to copy on each document | Merges and edits never rewrite issued documents |
| Vendors | Subcontractors reuse `pm_resources`; suppliers live in `fin_vendors` | No duplicate sub records |
| Money | `numeric(14,2)`; line rounding half away from zero; percent splits put the remainder on the last part, matching the existing proposal code; amounts cross the API as strings; Stripe cents converted only at the boundary | No float drift; matches existing columns |
| Contract | `fin_contract_snapshots` (from the signature, or a manual approval the user confirms) + `fin_contract_changes` (approved COs and deductions only) | Signing is a contract event, not revenue or cash |
| Numbering | Gapless per book and document type, assigned when issued; a voided document keeps its number | Audit expectation |
| Balances | Derived from allocations, never stored; row locks taken in a fixed order for payment allocation | No cache drift; no allocation races |
| Writes | Only through `SECURITY DEFINER` server functions; RLS is read-only; issued/posted rows are immutable by trigger; **no cascades** into finance tables | Matches repo convention; fixes audit risk R3 |
| Ledger (Phase 2) | Accounts, journal entries and lines; a deferred constraint checks Σdebit = Σcredit at commit; idempotency key per source event; reversal links; period locks; each entry tagged accrual, cash or both | A real book of record; reports come from posted data only |
| One engine | Trade presets change **only the interface** (cards, quick actions, default reports, starter cost codes, onboarding). They never alter history or gate entitled features. | V3 §3–5 |

### 5.2 Lifecycle

Estimate → Proposal → **Signed/approved** → *contract snapshot* (no invoice, no revenue) → invoice schedule suggested from the payment terms → the user issues deposit/milestone/progress invoices → payments recorded and allocated (unverified until reconciled) → costs, bills and commitments coded to the job → approved COs append contract changes and budget revisions → job profitability updates from **actual** recorded costs → closeout. Records are kept read-only.

### 5.3 Amounts are always labeled

Every amount shown is one of: **Contracted, Invoiced, Paid (unverified or verified), Outstanding, Actual cost, Committed (unbilled), Estimated, Forecast**. Profit is never inferred from contract price minus estimated cost. "Forecast margin" uses actual + committed + a user-entered cost to complete. Without that, the UI says "Not enough cost data."

### 5.4 Trade-adaptive configuration (V3)

- **Settings location.** Company Profile → Business & Trade Configuration sets the primary type, additional trades (from the existing trade catalog), residential/commercial/mixed, project model, payment structure, labor model, and equipment/inventory flags. Projects can override these.
- **Presets.** 13 presets are defined in `phase0/research/trade-profiles.md`; the profiles are mostly inference and should be validated in interviews.
- **Homepage.** Admins can choose which homepage cards appear. Essential alerts (overdue invoices, unbalanced or unreconciled items, the needs-review queue) cannot be hidden. The All Financial Tools area is always available.

### 5.5 Permissions & seats

- **New permission keys** in `company_permission_keys()`: view_company_financials, view_project_financials, create_invoices, record_payments, record_expenses, approve_expenses, record_bills, approve_vendor_bills, manage_accounts, post_journal_entries, reconcile, close_periods, export_financials, manage_financial_config, manage_sub_compliance, manage_payment_connections (owner-only to delegate), manage_financial_seats (owner-only).
- **Role presets live on the financial seat** (owner, financial admin, bookkeeper, accountant, PM, sales rep, view-only), so the risky `company_members.role` constraint stays unchanged.
- **No one gains access on deploy.** Existing manager/estimator/viewer roles get no finance keys by default.
- **Seats are separate.** A financial seat is assigned only to an existing company member. It never consumes an Enterprise seat or a PM editor seat.
- **Lapse.** If the add-on lapses, Financials becomes read-only with export. Nothing is ever deleted.

---

## 6. Accounting workflow & event → journal mapping (Phase 2)

| Event | Accrual posting | Cash-basis view | CPA review? |
|---|---|---|---|
| Deposit invoice issued | Dr AR / Cr Customer Deposits (liability), not revenue | No entry until cash | **Yes** |
| Deposit received | Dr Undeposited/Bank / Cr AR | Dr Bank / Cr Customer Deposits | Yes |
| Progress/milestone invoice issued | Dr AR / Cr Contract Revenue (and deposit application: Dr Customer Deposits / Cr AR) | — | Yes (deposit application) |
| Retainage withheld | Dr Retainage Receivable / Cr AR (split at invoice) | Not income until collected | **Yes** |
| Payment received | Dr Bank (or Undeposited) / Cr AR | Dr Bank / Cr Revenue (pro-rata) | — |
| Processing fee (Phase 3) | Dr Merchant Fees / Cr Bank | same | — |
| Vendor bill | Dr Job Cost (by cost code) / Cr AP | — | — |
| Bill paid | Dr AP / Cr Bank | Dr Job Cost / Cr Bank | — |
| Expense (paid at entry) | Dr Job Cost or Overhead / Cr Bank/Card | same | — |
| Refund / credit memo | Reverse revenue or AR as applicable | as cash moves | — |
| Correction | Reversing entry + new entry; the original is never edited | same | — |
| Sales tax collected | Cr Sales Tax Payable at invoice (accrual) | at cash | **Yes** (timing by state) |
| WIP over/under billing | Suggested adjusting entry, never automatic | n/a | **Yes** |

**Idempotency:** every posting carries `(book_id, source_type, source_id, event_kind)` as a unique key, so webhook retries cannot double-post. **Stripe webhooks** for Connect use an atomic insert-or-claim before any money logic runs.

---

## 7. Payments architecture (Phase 3; not active)

Full report: `phase0/payments/payments-feasibility.md`.

- **A separate Stripe Connect platform account** with its own keys, webhook endpoint and secret, never the SaaS billing account.
- **Connected accounts** where Stripe sets the fees and carries negative-balance risk. Contractors get the full Stripe Dashboard and **direct charges**, so **the contractor is the merchant of record** and disputes and refunds stay on the contractor's account. Homeowner money never touches a Built2Bid balance.
- **Fees.** ACH is the default for large invoices (0.8%, capped at $5). Cards are offered with fees disclosed. There is **no platform fee at launch**.
- **Built2Bid stores no card or bank credentials.** Stripe-hosted Checkout or Elements keeps PCI scope at SAQ-A.
- **Bank data.** Phase 2 uses manual CSV/OFX/QFX import. Stripe Financial Connections or Plaid are piloted only on proven demand and priced as a pass-through.
- **Approval gates:** Connect platform activation, pricing and fees, terms of service, and a live end-to-end test. All of these are yours.

---

## 8. Pricing go/no-go

Full analysis: `phase0/payments/pricing-economics.md`.

**Verdict: GO WITH CHANGES.**

| Users | Price/mo | Margin yr 1 | Margin steady state |
|---|---|---|---|
| 3 | $24.99 | 62% | 87% |
| 5 | $34.97 | 68% | 88% |
| 10 | $59.92 | 76% | 89% |
| 25 | $134.77 | 83% | 91% |

- **AI is not the cost.** Haiku extraction costs about $0.0008 per receipt, or $0.24/mo at 200 receipts. Even at 10× that, it stays under $3/mo per company.
- **Support time is the biggest variable cost.**
- **Portfolio:** about −$192/mo at 10 companies, +$768/mo at 50 and +$4,322/mo at 200 (year 1). Break-even is about 18 paying companies, after about $432/mo of fixed costs (point-in-time recovery backups plus CPA and legal review spread over 24 months).
- **Market:** QBO Plus is ~$85/mo for 3 users, and construction features need Advanced at ~$340/mo. At $24.99, Built2Bid is a clear value, *as long as it is not positioned as full accounting yet*.
- **Changes required:**
  - Label it Early Access with a 12-month price lock, and plan a $34.99–$39.99 step-up once the ledger and reconciliation pass CPA review.
  - Annual prices are needed because Stripe subscriptions can't mix intervals and Standard has annual subscribers.
  - Add a free read-only accountant seat.
  - Cap AI extraction at 1,000 per company per month as fair use.
  - Cancellation means read-only access plus full export, never deletion.
- **Secondary prices:** Stripe fee rates and competitor prices came from secondary sources (stripe.com and intuit.com were blocked in this session). Confirm them before anything is published.

---

## 9. AI scope (V3.1)

**Principle:** Financials works fully with every AI service off. An LLM is never the source of balances, settlement, tax or postings.

| Retained (opt-in, explicit button) | Removed from V1 | Deferred |
|---|---|---|
| **"Read Receipt"**: draft vendor, number, date, amount, tax and lines from an uploaded receipt or bill. Every financial field must be verified. Duplicate check runs before creating a record. The original file is stored. A failed extraction leaves only a draft. | Autonomous categorization or posting, payment allocation, reconciliation, vendor payments, unreviewed JEs, tax/deduction decisions, payroll, month-end close, statement corrections, always-on chat, persistent popups, auto-created rules, invoice modification, advice presented as fact | Conversational assistant, cash-flow forecasting, scenario planning, AI anomaly analysis, reconciliation suggestions, advanced invoice generation, policy recommendations, tax prep, inventory forecasting |
| **"Suggest Category"**: project, trade, cost code, category and possible duplicate. **Deterministic first**: known vendor mappings and confirmed rules; AI only as a fallback. The user always confirms. | | |
| **"Draft Message"**: payment reminders and updates through the **existing** Customer Hub / Communications module, using verified data only and honoring unsubscribes | | |

**Deterministic alternatives (no AI needed):** vendor → cost-code memory from confirmed choices; duplicate detection on (vendor, amount, date ±3 days, invoice no.) and file hash; rule-based anomaly flags (amount > 3× vendor median, cost on a closed job, missing cost code); template payment reminders.

**Company Settings → AI & Automation** (owner, or anyone holding `manage_financial_config`): independent toggles for expense suggestions, document extraction, communication drafting, photo labeling (moving today's platform-wide `PHOTO_AI_LABELS` under a company toggle), and future features. **New financial AI toggles default to OFF.** There is no master switch hiding background processes. Each toggle shows what data is sent (the minimum: one document image, or vendor name + amount), that the provider is Anthropic via the API (API data is not used for training under commercial terms; confirm retention terms in the legal review), who can see results, and how to turn it off.

**Measured per company:** requests, cost, acceptance rate, correction rate, failed extractions, duplicates caught, latency, and AI-disabled accounts. Features that raise corrections get redesigned or removed.

---

## 10. Security assessment

- **Tenant isolation:** every financial row carries `book_id`; RLS read policies go through `fin_has_permission()`; writes go only through server functions; cross-book fixtures are tested.
- **No cascades.** Account deletion is blocked while a book holds issued records until export and the retention rule are applied (legal decision).
- **Private documents:** a new private `financial-documents` bucket with book-scoped paths and short-lived signed URLs. Nothing is shared with homeowners unless the user explicitly shares it.
- **Audit:** append-only `fin_audit_log`, covering solo books too.
- **Payments:** separate Connect keys and webhook secret; signature verification; an atomic event claim; no raw card or bank data.
- **AI:** minimal prompts; no secrets, credentials or card data; per-company toggles; spend caps (the existing `AI_MONTHLY_BUDGET_USD` plus a per-company cap).
- **Backups:** enable Supabase point-in-time recovery (about $100/mo) before the ledger is enabled; run a restore drill.

---

## 11. CPA review checklist (before Phase 2 is a system of record)

1. Customer deposits: liability until earned; how deposits are applied to progress invoices
2. Retainage receivable and payable under cash and accrual
3. Revenue recognition for small contractors: completed-contract vs percentage-of-completion thresholds; the WIP calculation (cost-to-cost)
4. Sales tax: when it is collected and owed, by state; tax on change orders
5. Default reporting basis for new books (cash or accrual)
6. Chart of accounts template for contractors
7. Treatment of processing fees, refunds, chargebacks and credit memos
8. Opening balances and conversion from QuickBooks
9. Period close and reopen controls
10. 1099 vendor reporting fields
11. Record retention period (drives the account-deletion rule)
12. Sign-off that the fixture suite (§13) produces correct statements

---

## 12. Roadmap

| Phase | Scope | Migrations | Gate |
|---|---|---|---|
| **1 Ops MVP** | Books, seats and permissions; trade configuration; contract snapshot and changes; deposit/milestone/custom invoices + PDF; manual payments + allocation, credits, refunds; customer balances and AR aging; vendors; cost codes; commitments; bills and expenses; budget vs actual; job profitability (labeled); documents; audit log; accountant CSV export; AI & Automation settings; Financials overview. Behind `NEXT_PUBLIC_FINANCIALS=on` (off in prod). | Split into 4–5 files (books/seats/permissions → contract + AR → costs/commitments → documents/audit → config/AI prefs), each with a rollback | Your SQL run + merge approval |
| **1b Construction billing** | SOV progress billing from contract + COs, overbilling guard, retainage records + release, "AIA-style" summary | 1 file | Legal wording review |
| **2 Accounting foundation** | Chart of accounts, ledger + posting service, P&L/BS/TB/GL, AR/AP from ledger, periods/locks, bank import + reconciliation, accountant review, 1099 report | 2–3 files | **CPA review** |
| **3 Payments** | Stripe Connect onboarding, invoice payment links, Connect webhooks, fees, payouts, disputes, receipts | 1–2 files | Your approval + live E2E test |
| **4 Advanced construction** | WIP/over-under, cost-to-complete forecasts, budget revisions UI, optional time entries, equipment, sub compliance, multi-job cash planning | per module | CPA review for WIP |
| **5 Replacement readiness** | Independent accounting review, QBO import validated, backups/restore tested, support readiness. Payroll and sales-tax filing still excluded, so **no "replace QuickBooks" claim** while those gaps remain. | — | Your approval |

**QuickBooks coexistence and migration:** Phase 1 runs alongside the customer's books, with accountant exports (CSV of invoices, payments, bills, job costs). Phase 2 adds import of customers, vendors, chart of accounts and opening balances from QBO CSV/IIF exports, with preview, dedupe and a reconciliation summary. Two-way QBO sync is deferred until mapping and conflict rules are proven; there is never more than one source of truth per record.

**Marketing:** no website changes until features are live. Then use "Know Your Numbers" copy limited to what's live (payment tracking, job costing, invoicing, documents). Never "replace QuickBooks" until Phase 5.

---

## 13. Correctness fixtures (written before Phase 1/2 code)

Balanced journals; partial, over- and under-payment; one payment across several invoices; unapplied credit; refund; chargeback; processor fee; void vs credit memo; changed estimate after signing (snapshot unchanged); approved vs pending CO; commitment → bill relief (no double count); duplicate import (no duplicate record); extraction retry (no duplicate); reversed entry; locked-period rejection; rounding (tax pro-rata, milestone remainder); concurrent allocation on the same invoice; cross-book isolation; trade switch leaves history unchanged; all-AI-off run of every workflow; AI cannot touch tax, signed docs or another customer's allocation.

---

## 14. Open questions for James

1. Is the Financials add-on sold to solo Standard users, and at what price/seat count? (§1 D)
2. Do PMs who only *view* their job financials need a paid financial seat? Suggestion: view-only job financials are free for assigned PMs; seats are for people who record money.
3. Can an outside accountant get guest access without being a company member? Suggestion: yes, a free read-only accountant seat with an invite.
4. Can a user with issued invoices delete their account, and what is the retention period? Needs legal input.
5. Is tax charged on change orders by default?
6. Is inventory out of scope? (V3.1 says defer; I've marked it excluded for now.)

---

## 15. Workstream reports (evidence)

Folder: `docs/financial-command-center/phase0/`

- **Research (Agent 1):** `phase0/research/voc-report.md`, `evidence.csv`, `qbo-feature-benchmark.md` (your screenshot is the inventory), `competitor-matrix.md`, `qb-sage-capability-matrix.md`, `trade-profiles.md`
- **Accounting & database (Agent 2):** `phase0/architecture/data-audit.md`, `proposed-schema.md`, `proposed-schema-v3.md`
- **Payments & integration (Agent 3):** `phase0/payments/payments-feasibility.md`, `pricing-economics.md`
- **Sources James sent** (QuickBooks screenshot, 2023 Sage datasheet) are kept in the project files, not in the repo.

Three separate research and design workstreams ran in parallel, and this document is the lead reconciliation. The AI guidance from V3.1 arrived after the workstreams finished; it was applied in this lead review (§9) and will be built into Phase 1.

## 16. Production approval checklist (for each later phase)

☐ SQL run by James and verified · ☐ fixtures green · ☐ browser walk (desktop + 390px, light/dark) · ☐ permission matrix tested · ☐ AI-off walk · ☐ flag off in Production until James says go · ☐ no Stripe objects or live payment changes without explicit OK · ☐ CPA sign-off (Phase 2+) · ☐ legal review (Connect terms, AIA-style wording, retention) · ☐ rollback SQL ready
