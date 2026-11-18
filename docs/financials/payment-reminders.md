# Automatic payment reminders

Contractors turn these on at **Financials → Accounts receivable → Automatic payment reminders**. No SQL: the
rules table (`fin_reminder_rules`), the save RPC (`fin_email_config_save`) and the suppression check
(`fin_reminder_suppressed`) shipped with Financials Phase 1.

## How it works

- **Planning** (`planFinancialReminders`, `src/lib/financials/reminder-run.ts`) runs inside the hourly customer
  email job (`runComms`). For every book with a rule on, an active (not read-only) Financials plan and no sandbox,
  it looks at issued invoices with a balance and a due date and asks `reminderToPlan` (`src/lib/financials/reminders.ts`):
  - *Before due*: first one `offsetDays` before the due date, repeating every `repeatEveryDays` until the due date.
  - *Past due*: first one `offsetDays` (at least 1) after the due date, repeating every `repeatEveryDays`.
  - At most `maxReminders` of each kind, never two within 2 days for one invoice, never before 9 AM in the book's time zone.
  A planned reminder is a `comm_messages` row: `kind = 'financial'`, `automation = true`, `status = 'scheduled'`,
  idempotency key `fr:<invoice>:<kind>:<sequence>:<local date>`.
- **Delivery** (`deliverDue`) re-checks right before sending: plan still active, rule still on, invoice not paid,
  void or disputed, a before-due reminder not yet past due. The text is re-rendered from the invoice as it is then
  (current balance, the company's saved wording and tone). Otherwise the row is canceled with a plain reason,
  shown in the "Recent automatic reminders" list.
- It respects `COMM_EMAIL_MODE`, the Built2Bid emergency stop, the account's "pause all customer emails" and owner
  off switch, the daily caps, and "all email" suppressions (bounces, complaints). Reminders are transactional, so a
  marketing or project-update unsubscribe does not stop them and they carry no unsubscribe header.
- Sender name is the contractor's company; replies go to the contractor (or reply routing when configured).

## Tests

`tests/financials-reminders.test.ts` (schedule rules) and `tests/db/fin-reminders.test.ts` (plan, send once, cancel
when paid, before-due never sent late) against real Postgres.
