# Built2Bid V6: revised plan and priorities (2026-11-17)

V6 replaces V5 and V5.1. Work that already shipped stays. Every phase is a separate PR into `main`. Each PR comes with SQL for the owner to run and a rollback file. Nothing merges without the owner's OK.

## Already live

| Area | What exists | PR |
|---|---|---|
| Financial Command Center foundation | Books, jobs, invoices from the signed payment schedule, payments, credits, idempotent RPCs, audit log, RLS, deferred integrity checks | #88, #94, #99, #102, #103 |
| Project Financials (V5.1) | 6 clickable KPIs, unbilled amount, forecast profit and margin, pending change orders, unpaid sub bills, one-click actions | #104 |
| Accounts receivable | Clickable aging cards; filters for customer, project, rep, PM, status and dates; AR comes only from issued invoices | #104 |
| Customer ledger, bill payments, invoice PDF, job CSV report | — | #104 |
| Job costing, first pass | Original estimate vs forecast vs actual, per trade | #104 |
| Change orders | Pending vs approved, kept separate from the contract until approved | #75, #94 |
| Scenario A ($45k) and Scenario C (sub $6,500 → $7,200 → $7,000) | Covered by DB tests | #104 |

## This PR: P1 Pricing Intelligence foundation

- **Supplier price import**
  - CSV and Excel (.xlsx) price lists.
  - Columns are mapped automatically and can be changed by hand.
  - Units are normalized.
  - Rows are matched to Saved Items by SKU first, then by name.
  - The preview flags duplicates, bad numbers, formula cells and unit mismatches. Changes over 25% are flagged and left unticked.
  - Pack prices can be converted to per-unit prices.
  - Original and new prices show side by side before anything is saved.
  - Import history with Undo. Undo never overwrites a price the contractor edited afterwards.
- **Price-source metadata on Saved Items**
  - Supplier, SKU, pack size, source, effective date, and when the price was last updated.
  - A price typed by hand is labelled manual again, so the app never calls a hand-edited number a supplier price.
- **Refresh Material Costs** in the builder
  - Draft bids only. Shows the cost impact of each change, and the contractor picks which rows to update.
  - Finalized (sent, approved or signed) bids are never offered it.
- **Target gross margin**
  - A company setting, with a builder warning when a bid falls below it. It warns and never blocks.
  - The warning shows the markup needed to reach the target, so margin and markup stay distinct.
- **Supplier connector interface**
  - One shared interface for all suppliers, plus a mock used only in tests.
  - No live supplier. Everything goes through the same preview → apply → undo path.
- **SQL:** `run-v6-pricing-import.sql`. Rollback: `docs/v5-pricing-accounting/rollback_20261127001000.sql`.

## P1-B, first PR: receipts and corrections

- **Payment receipts:** customer receipt PDF for each recorded payment, and a payment record PDF for each sub/supplier bill payment. Voided payments have no receipt. Internal payment memos are never printed.
- **Void with a reason** on bills, credits and approved expenses (invoices, payments and bill payments already had it). Posted records are never deleted; to correct one, void it and enter it again. Drafts are still the only thing that can be deleted.
- **Possible duplicate expenses (Scenario B):** a new expense with the same amount and vendor/payee within 3 days of a live one goes to Needs review. Nothing changes until a person picks "Void as duplicate" (keeps the original, voids the copy with "Duplicate of EXP-x", audit kept) or "Not a duplicate".
- **SQL:** `run-v6-p1b-corrections.sql` (= `supabase/migrations/20261128001000_fin_v6_corrections.sql`). Rollback: `docs/financials/rollback_20261128001000.sql`.
- Dashboard cards and quick actions shipped in #109 and #110. Invoice preview and safe delete-a-mistake shipped in #111.

## P1-B, second PR: send states and scope-removal change orders

- **Invoice status track** on every invoice: Draft → Issued → Email prepared → Sent → Paid (also "Email failed", "partly paid", days late). It comes from Built2Bid emails plus a new **Mark as sent** for invoices sent another way (own email, printed, in person, text). A mark made by mistake is undone with a reason; both stay in the history. A sent invoice can no longer be deleted as a mistake.
- **Change orders card (Scenario D):** approved/signed change orders and how each is billed. Added scope becomes its own payment. Removed scope is taken off a remaining payment (owner/financial admin approves) or credited with a credit memo linked to the change order. Each change order is billed one way only. The original signed agreement and issued invoices never change. Credits now count against the "billed over contract" alert.
- **SQL:** `run-v6-send-scope.sql` (= `supabase/migrations/20261130101000_fin_send_states_scope_credits.sql`). Rollback: `docs/financials/rollback_20261130101000.sql`.

## Next phases (recommended order)

| Phase | Scope | New provider or cost? |
|---|---|---|
| **P1-B Daily accounting UX** | Payment receipts (customer + sub PDFs); invoice email drafts with states (Draft → Issued → Email prepared → Sent → Paid); delete/void/correct menu on every financial record (drafts delete, posted records void/reverse); scope-removal credit change orders (Scenario D); contractor vs accountant view toggle; customizable dashboard cards + safe quick actions (in-app routes only) | No (existing Resend email) |
| **P1-C Company sandbox mode** | Separate sandbox book per company (its own `fin_books` row and test projects), clear banner, confirmation to switch, all email/payment calls stubbed in sandbox, excluded from SaaS analytics (Scenario G) | No |
| **P1-D Saved items + assemblies** | Favorites, quick add, company templates; dynamic assemblies that scale from the existing trade calculators (deck, roofing, siding, painting, concrete first); supplier directory linked to price imports | No |
| **P2-A Reports** | Searchable report directory; P&L (cash basis from recorded payments/expenses; accrual only after the GL), AP aging, labor variance, project profitability; monthly/yearly money-in/money-out charts that drill into transactions | No |
| **P2-B Team** | Employee directory (reuses Enterprise users, archive not delete); clock in/out with consented GPS at punch only (accuracy shown, no continuous tracking, limited retention); manager approvals; approved hours flow into job labor cost; payroll *preparation* report and CSV export | No (no payroll provider) |
| **P2-C Subcontractor records** | Extend Team & Subcontractors with W-9/COI/agreement documents (restricted access), EIN masking, annual renewal tracker with draft request emails (sending only when enabled), 1099 totals report | No |
| **P2-D Closeout + communications** | End-of-job checklist, customer sign-off reusing the e-signature flow, closeout PDF; project communication history (draft/sent/delivered/failed from existing email logs) | No |
| **P2-E QuickBooks CSV onboarding** | Customers, vendors, invoices, payments, bills with preview, duplicate prevention and an import audit report | No |
| **P2-F General ledger** | Chart of accounts, double-entry journal, periods, reversals; needed for accrual P&L and balance sheet | Needs CPA review first |
| **P3 Banking + checks** | Bank-reported vs projected balance (Scenario F), reconciliation with duplicate detection (Scenario B), check printing | Needs a bank data provider |
| **P3 Supplier API pilot** | One authorized supplier through the connector interface | Needs a supplier agreement |

## Blocked on owner approval (nothing has been signed up for)

1. **Bank data provider** (Plaid, MX, Teller or similar): read-only balances and transactions for Scenarios B and F. It has per-connection fees. Projected balances can ship first from recorded checks and payments, labelled as estimates.
2. **Payroll provider** (Gusto Embedded, Check or similar), only if you want payroll processing. Without one, Built2Bid prepares payroll reports and exports and never calculates tax or pays employees.
3. **Supplier API access** (ABC Supply, SRS, QXO, Ferguson, Home Depot Pro, 1build, RSMeans, TRA-SER). Each needs a partner agreement that covers SaaS use, caching and redistribution. The CSV import works today without any of them.
4. **CPA review** of the chart of accounts and posting rules before accrual statements are labelled as financial statements.
5. **Stripe Connect** for contractors collecting payments from their customers. Design only; not activated.
6. **Check printing:** printing a check is fine, but marking it issued against a real bank account waits on reconciliation (P3).

## Inventory

None exists in the repo, and none will be built. Supplier catalogs, SKUs and prices are not inventory.
