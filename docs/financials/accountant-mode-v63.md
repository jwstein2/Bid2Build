# Accountant Mode (V6.3): audit, what shipped, what is blocked

Status: draft PR, not merged, not deployed. One SQL file to run: `run-accounting.sql` (migration `20261213001000_fin_accounting.sql`). Rollback: `docs/financials/rollback_20261213001000.sql`.

## What Accountant Mode does now

Before V6.3 the toggle changed only which home cards appeared. It is still a saved per-user view preference that grants nothing. Every page and action checks the person's Financials permissions on the server (`fin_require` / `fin_has_permission`).

| Area | Where | What it does |
|---|---|---|
| Accountant home | `/financials` (accountant mode) | Six clickable numbers: bank-reported balance (ending balance of the latest imported statement, with source, statement date and import time; shows "No statement yet" rather than estimating), projected 30-day balance (labelled as a forecast with its formula), AR, AP, unreconciled bank lines, items needing review. A review-queue summary and the accountant quick actions this person may use. |
| Review queue | `/financials/accounting` | Uncategorized costs, unmatched bank lines, possible duplicate bank lines, unapplied customer payments, bills awaiting approval, unbalanced imports, missing job allocations, reconciliation differences. Each item has a direct fix (flat selects, no nested menus). Suggestions are shown as buttons; nothing changes until a person clicks. |
| Transactions | `/financials/accounting/transactions` | One searchable, filterable list over the existing records (invoices, customer payments, bills, bill payments, expenses, bank lines). Filters: text, source, date range, project, vendor, category, reconciliation state. CSV export. It is a view, not a new ledger table. |
| Bank & reconciliation | `/financials/accounting/bank` | Add bank account (name, last 4 only, opening balance). Import CSV or OFX/QFX statements with a preview and a balance check. Re-importing skips lines already imported. Imported lines are immutable. Match a line to a payment, bill payment or expense (same amount and direction enforced), create an expense from a withdrawal, or exclude it with a reason. Undo keeps history. Reconcile a period (differences need a note), which locks its lines. Reopen the latest period with a reason. Outstanding checks list. No money moves anywhere. |
| Reports | `/financials/accounting/reports` | Searchable catalog with month/quarter/year/custom periods. Working: Profit & Loss (existing), AR aging, AP aging, customer balances, job costing (budget / committed / actual / variance kept separate), labor variance, expenses by category, sub payments. Each prints to PDF and exports CSV. Blocked reports are listed with the reason, never faked. |
| Audit trail | `/financials/accounting/audit` | Who did what and when, grouped and searchable, with previous and new values. Sensitive keys are redacted. Every export is logged. |
| Chart of accounts | `/financials/accounting/accounts` | The categories and cost codes in use plus bank accounts and their reconciliation status. Says plainly that a full double-entry chart of accounts needs the Phase 2 ledger. |
| Classification | queue + transactions | Account, category, project, trade/cost code, scope section, vendor. Blank fields can be filled once; changes after that go through the existing correction flow so history is kept. |

## Quick actions (shown by permission only)

Reconcile bank, Review uncategorized, Review bills, Review AR, Generate P&L, Export transaction ledger, Review duplicate transactions, Review audit trail, Review payroll costs (labor costs vs estimate; Built2Bid does not run payroll).

## Audit findings (existing features reused, nothing duplicated)

- Reused: invoices, payments and credits (#106, #112), bills and bill payments, expenses and corrections (#113), suppliers / subs / employees (#114), P&L loader, permission and audit functions, `fin_guard_immutable`.
- New tables are only for things that did not exist: bank accounts, statement imports, bank lines, matches, reconciliations.
- Fixed a pre-existing bug: the Financials actions route returned `rpcOk(...)` without `await`, so a database error escaped the `try` and came back as a 500 instead of a readable message. All actions now await.

## Blocked capabilities and prerequisites

| Capability | Status | Prerequisite |
|---|---|---|
| General ledger, chart of accounts, journal entries | Blocked | Phase 2 double-entry ledger (designed, not built) plus a CPA review of the account map. |
| Balance sheet, trial balance, statement of cash flows | Blocked (shown as blocked in the catalog) | Same Phase 2 ledger. These cannot be produced honestly from cash/AR/AP records alone. |
| True debit/credit columns in Transactions | Blocked | Phase 2 ledger. Today the list shows money in / money out. |
| Live bank feeds (automatic balance refresh) | Blocked | A read-only bank data provider (for example Plaid), its production approval, and a signed agreement. Until then the bank balance comes only from imported statements. Read-only connections will never be used to move money. |
| Payroll, payroll liabilities, pay runs | Blocked | A payroll provider integration. No payroll payouts are made or simulated. |
| QuickBooks / Xero sync | Not started | Provider app approval. Financials is not marketed as a QuickBooks replacement. |
| Excel (.xlsx) export | Not built | CSV opens in Excel today; .xlsx is optional. |

## How it was tested

- Unit tests: 15 new (statement parsing, match suggestions, duplicates, aging, filters, catalog, quick actions, audit view).
- Database tests: 9 new against real Postgres (import and dedupe, immutability, matching rules, create expense, reconcile, lock and reopen, classification fill-once with audit, export authorization and redaction, roles, rollback and re-apply). Existing rollback chains updated and passing.
- Browser walk (`scripts/financials/walk-accounting.mjs`, mocked Supabase, no external services): 57 checks across home, bank import and matching, reconciliation, queue, transactions, reports, audit, accounts; desktop and phone, light and dark, no horizontal scroll; PM, view-only and bookkeeper roles.
- No live Stripe, banking, payroll or email was used.
