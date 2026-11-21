# General ledger (Financials, 2026-11-21)

A double-entry book of record built from the existing Financials records. Migration:
`supabase/migrations/20270214001000_fin_general_ledger.sql`. Rollback: `docs/financials/rollback_20270214001000.sql`.

## What it does
- **Chart of accounts** per book, created on first use. It has built-in accounts that receive the automatic postings:
  - Assets: cash, AR, retainage receivable
  - Liabilities: AP, customer deposits, sales tax payable, payroll liabilities
  - Equity: opening balance equity, owner equity and draws
  - Income: contract revenue, credits and allowances
  - Job costs: job costs, job labor
  - Expenses: overhead, wages, payroll taxes, merchant fees

  People can add their own accounts and rename any account. Built-in accounts can't change type or be turned off.
- **Automatic postings (accrual).** The ledger is brought up to date whenever a ledger page or export opens. Posting is idempotent: each record gets exactly one entry per event.

  | Record | Posting |
  |---|---|
  | Issued invoice | Dr AR / Cr revenue (subtotal) / Cr sales tax |
  | Payment received | Dr cash / Cr AR (unapplied money stays as a credit in AR) |
  | Credit memo | Dr credits & allowances / Cr AR |
  | Refund | Dr AR / Cr cash |
  | Approved bill | Dr job costs (job lines) or overhead (company lines) / Cr AP |
  | Bill payment | Dr AP / Cr cash |
  | Approved expense | Dr job costs or overhead / Cr cash |
  | Voided record | A reversal dated the day it was voided |

- **Journal entries** (`post_journal_entries`): entries must balance and need a memo. Ticking "Opening balance" posts an opening entry. Posted entries are never edited; manual, opening and payroll entries are corrected by reversing them, with a reason.
- **Payroll journal**: `fin_gl_payroll_post` is the shape the payroll partner's pay runs post into.
  - Gross = withholding + net.
  - Job-allocated wages go to Job labor; the rest goes to Wages.
  - Employer taxes go to Payroll taxes.
  - Withholding plus employer taxes go to Payroll liabilities; net pay comes out of Cash.
- **Closing the books** (`close_periods`): nothing posts on or before the closed date. Late automatic postings land on the first open day. Reopening needs a reason, and both closing and reopening are audited.
- **Reports**: Balance sheet, Income statement (accrual), Trial balance, Account detail with running balance, and the Journal. Each has a CSV export (`export_financials`), and every page prints.

## Decided
- James, 2026-11-21: keep Accountant Mode and the general ledger ON for customers even though no CPA has reviewed them yet.

## For a CPA to review (not blocking)
1. Deposits currently post as revenue when invoiced. Should they go to Customer deposits until earned?
2. Retainage: there's an account for it, but nothing posts to it yet.
3. Revenue recognition for long jobs (WIP, over/under billing).
4. Sales tax timing: currently recorded when invoiced.
5. Cash-basis reporting (the existing P&L has a cash basis; the ledger is accrual only).
6. One "Cash and bank" account. Automatic postings don't split by bank account yet.
7. Cash flow statement classifications (still listed as blocked in the Reports catalog).
