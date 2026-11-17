# Built2Bid V5 / V5.1: Pricing Intelligence + Contractor Accounting

**Status (2026-11-17):** Phase P0 (audit + repairs) and P1-AR (Accounts Receivable, Project Financials summary, customer ledger, bill payments, invoice PDF) are built and tested on branch `claude/project-thread-gdkh6d`. Pricing Intelligence (P1-Pricing) is the next PR. Nothing is merged, deployed, or turned on.

Rule followed throughout: the Financial Command Center (PRs #88, #94, #99, #102, #103) is live and works. It was audited and **extended**; no accounting module was rebuilt or duplicated. No inventory features were added.

---

## 1. Verified capability matrix (from the repository, not from discussion)

Legend: **EXISTS** works and has tests · **PARTIAL** some of it exists · **MISSING** not built · **REPAIRED** was wrong, fixed in this PR · **NEW** added in this PR

### Estimating

| Capability | Status | Where | Notes |
|---|---|---|---|
| Saved items | EXISTS | `saved_items`, `src/lib/library/saved-items.ts`, `/dashboard/items` | Premium-only writes (RLS `library_access()`), per user + `company_id` for Enterprise. No price source, supplier, SKU, pack size, effective date or favorites. |
| Trade calculators | EXISTS | `src/lib/calculators/registry.ts` (43 defs: area, linear, roof planes, slabs/footings/piers, decking, stairs, siding, coverage, labor hours) | Measurement → one line's quantity, with waste. Unit-tested. |
| Assemblies | PARTIAL | `assemblies` + `assembly_items` ("Saved Stacks") | Fixed quantities; don't scale from a measurement. → P1-Pricing "dynamic assemblies". |
| Unit costs / markup / margin | EXISTS | `src/lib/estimate/engine.ts` (decimal.js) | Margin = (P−C)/P and markup = (P−C)/C computed separately and correctly; item → group → estimate overrides; pass-through (bill at cost). |
| Minimum-margin warning | MISSING | — | → P1-Pricing (company target margin; warns, never blocks unless owner policy). |
| Taxes | PARTIAL | `estimates.tax_rate`, per-item `taxable` | One rate per estimate. Change orders carry no tax. |
| Bid versions | EXISTS | `estimate_versions` (frozen snapshot, totals, hash) | Signed contracts are frozen; finance snapshots the contract version. |
| Supplier pricing fields | MISSING | `src/lib/pricing/provider.ts` is an interface with no provider; always answers "unavailable" | → P1-Pricing. |
| Subcontractor quotes | EXISTS | `subcontractor_quotes` + revisions, internal report comparison | Accepted quotes can become finance commitments. |

### Financial / accounting

| Capability | Status | Where | Notes |
|---|---|---|---|
| Tenant (book) + entitlement + seats | EXISTS | `fin_books`, `fin_seats`, `fin_entitlement`, `fin_has_permission` | Company XOR solo; add-on or comp grant; lapsed = read-only. 14 DB tests. |
| Chart of accounts / journal / GL | MISSING (by design) | — | Deferred to Phase 2 pending a CPA review (decision F, Phase 0). P&L, balance sheet and trial balance are **not** generated, so nothing unreliable is presented. |
| Cost codes | EXISTS | `fin_cost_codes` from the trade catalog | Immutable code/trade/type. |
| Contract snapshot + change orders | EXISTS | `fin_contract_snapshots`, `fin_contract_changes`, CO sync trigger | Pending COs excluded. |
| Payment schedule → milestones | EXISTS | `fin_payment_milestones` (Σ = contract), triggers, amendments | Deposit/progress/final from the signed proposal. |
| Invoices | EXISTS | `fin_invoices` + lines, gapless numbers, immutable once issued, discrepancy + exception reason, one active invoice per milestone | 14 DB tests. |
| Invoice PDF | NEW | `/api/financials/invoices/[id]/pdf`, `src/lib/pdf/invoice-pdf.tsx` | Customer-safe fields only (verified by text extraction in the walk). |
| Invoice email send | PARTIAL | drafts + templates only | Sending stays off until approved (unchanged). |
| Payments, partial, overpay, allocation | EXISTS | `fin_payments`, `fin_payment_allocations`, row locks + commit-time backstop, idempotency | |
| Credits / refunds / voids | EXISTS | `fin_credit_memos`, `fin_refunds`, reversal-based | |
| AR aging | PARTIAL → NEW | view existed (`fin_invoice_balances_v.aging_bucket`); no AR page | `/financials/receivables` with clickable aging cards + filters (customer, project, rep, PM, due range). |
| Customer ledger | PARTIAL → NEW | `fin_customer_balances_v` existed; no UI | `/financials/customers/[id]` + link from Customer detail. |
| Vendor bills, expenses, commitments | EXISTS | `fin_vendor_bills`, `fin_expenses`, `fin_commitments` (+ revisions), review queue | Quote ≠ commitment ≠ bill. |
| Bill payments (paid vendor cost) | MISSING → NEW | `fin_bill_payments`, `fin_bill_payment_record/void`, `fin_bill_balances_v` | Partial, no overpay, no bill void while paid, idempotent. |
| Bill visibility for job PMs | **REPAIRED** | `fin_vendor_bills_select` | Unqualified `id` bound to `bill_lines.id`, so a PM who can see a job never saw its bills. Too strict, never a leak. |
| Forecast cost | **REPAIRED** | `fin_job_budget_v.forecast`, `fin_job_profitability_v.projected_profit` | Was `greatest(estimate, actual+committed)` over the whole job, so a framing overrun was hidden by trades that hadn't started. Now per cost code, summed. |
| Job costing / budget vs actual | EXISTS → extended | `fin_job_budget_v` | Adds Forecast column + variance. |
| Project Financials summary (V5.1 §2) | NEW | `fin_job_summary_v`, `JobSummary` component | Six clickable numbers + unbilled, forecast profit/margin, pending COs, unpaid sub bills, one-click actions. |
| Financial reports | PARTIAL | Home KPIs + records lists; job CSV report NEW | Revenue by month, expenses by category, cash in/out → P2. |
| Reconciliation | PARTIAL | payments have `verified` flag; no bank import | Phase 2. |
| Audit history | EXISTS | `fin_audit_log` append-only (even for the DB owner) | New RPCs write to it. |
| Retention / deletion guard | EXISTS | `fin_prepare_account_deletion`, 7-year holds | |

### Project operations, permissions, billing

| Capability | Status | Notes |
|---|---|---|
| Signed agreements, change orders, sub assignments, scope, schedules, Gantt, progress, customer updates | EXISTS | V4.x; untouched. |
| Free / Standard / Enterprise, PM add-on, comp grants, solo Financials add-on | EXISTS | Untouched. No new Stripe product. |
| Enterprise financial permissions | EXISTS | 17 `fin_*` keys + seat role presets, enforced in SQL. V5 §18 list maps onto them (view dashboard = view_company_financials, create/send invoices = create_invoices, record payments, approve expenses, view sub costs = view_project_financials, budgets = manage_financial_config, reports = view_company_financials, export = export_financials, settings = manage_financial_config). |
| Contractor customer payments (Stripe Connect) | MISSING (by design) | Design: `/mnt/project-files/financial-command-center/phase0/payments/payments-feasibility.md`. Not activated; needs owner approval. SaaS billing and contractor AR stay separate tables, flows and Stripe accounts. |
| Inventory | Not present | Nothing to remove. `fin_business_config.uses_inventory` is a profile flag only; the "inventory usage" home card says "Coming soon" and is now **off the roadmap** (V5 Part 15). |

---

## 2. V5.1 acceptance tests: where each is proven

| # | Requirement | Proof |
|---|---|---|
| 1-2 | Approved proposal financials + schedule carry into the project | `tests/db/fin-v5-ar.test.ts` "1-2" |
| 3 | Duplicate invoices prevented | fin-v5-ar "3", fin-billing "one-active-invoice guard" |
| 4-6 | Invoiced / collected reconcile; unbilled milestones don't inflate AR | fin-v5-ar "$45,000 fixture" (exact cents) + `tests/financials-receivables.test.ts` |
| 7 | Partial payments | fin-v5-ar "7", fin-billing |
| 8-9 | Approved COs update contract; pending don't | fin-v5-ar "8-9" |
| 10-12 | Sub cost change moves forecast per trade, never the contract; actual separate | fin-v5-ar "10-12" (6,500 → 7,200 = +700) |
| 13 | Job expenses without inventory | fin-foundation "expenses" |
| 14 | Every KPI card opens its records | walk-v5 ("every AR card is a link", card click-throughs) |
| 15 | Enterprise permissions enforced | fin-v5-ar (forbidden for rep / bookkeeper void), walk-v5 PM view, fin-foundation matrix |
| 16 | Customer documents hide internal data | walk-v5 PDF text check |
| 17-18 | Existing accounting + subscription billing preserved | all prior fin DB tests pass; no billing code touched |
| 19 | Desktop + mobile usable, light + dark | walk-v5 screenshots, no horizontal scroll at 390 px |
| 20 | Financial calculations automated | 47 finance DB tests + unit tests |

The $45,000 fixture result (real SQL): contract 45,000 · original cost 33,000 · estimated profit 12,000 · invoiced 36,000 · collected 18,000 · AR 18,000 · unbilled 9,000.

---

## 3. Database migration plan

| Order | File | What | Paste in James's SQL Editor |
|---|---|---|---|
| 1 | `supabase/migrations/20261126001000_fin_v5_ar_job_summary.sql` | RLS repair, per-trade forecast, bill payments, summary + AR views | `/mnt/project-files/v5-pricing-accounting/run-v5-ar.sql` |

Safe to run twice. Additive except the two repairs (a policy and two views replaced with the same columns plus new ones). Run the SQL **before** merging: the app reads the new views but degrades (summary hidden, AR shows "one more database update") if they're missing.

## 4. Rollback plan

1. Revert the app PR (Netlify redeploys main).
2. Run `docs/financials/rollback_20261126001000.sql`. It refuses while any bill payment exists (financial records are never deleted silently) and restores the original views and policy exactly.

## 5. Cost implications

No new paid service. PDFs render in the existing Netlify function (react-pdf, already a dependency). No AI calls added. Storage unchanged (PDFs are generated on request, not stored).

## 6. What's next (proposed order)

1. **P1-Pricing (next PR):** supplier CSV/Excel importer (preview, column mapping, unit normalization, duplicate + change detection, approve, import history, undo), standardized price records with source/effective/expiry metadata, saved-item favorites and supplier references, company target-margin warning, Refresh Material Costs preview (never changes sent or signed bids), dynamic assemblies that scale from a measurement, and a provider-neutral connector interface with a mocked test provider.
2. **P2:** revenue by month, expenses by category, sub variance, cash in/out reports + exports; Haiku receipt extraction (company toggle, off by default, review before posting); AR reminder rules UI (drafts only).
3. **Supplier API pilot:** blocked on provider approval (see §7).

## 7. Owner approval checklist

- [ ] Run `run-v5-ar.sql` in Supabase, then say "merge".
- [ ] Supplier APIs: ABC Supply, SRS, QXO (Beacon), Ferguson and Home Depot have partner/B2B programs that need a business application; 1build, RSMeans (Gordian) and Trimble are paid licensed datasets. None will be contacted or signed up for without your OK. Recommendation: CSV/Excel import first (no partner needed), then apply to one roofing distributor partner program.
- [ ] Stripe Connect for homeowner payments: design exists; activation needs your approval and a legal check on surcharging.
- [ ] Phase 2 general ledger (P&L, balance sheet, trial balance) waits for the CPA review you approved in principle.
- [ ] Don't market Built2Bid as a complete QuickBooks replacement until the ledger is validated.
