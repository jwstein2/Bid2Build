# V9 cash flow forecasting: audit of what already exists (2026-11-21)

Checked against `main` @ 0387da5. "Repo" means the code is in `main`. "Prod" means the SQL is applied in production per
project records (Financials, V6.9 tax/banking, V8.3 worker hub, GL all applied). Nothing here was re-verified against the
live database from this thread.

Status key: **Active** = built, connected and on. **Not connected** = built but the forecast doesn't use it.
**Partial** = some of the behavior exists. **Missing** = not built.

| Capability | Where it lives | Status before V9 | What V9 does |
|---|---|---|---|
| Financial Command Center pages | `src/app/(app)/financials/*` | Active (NEXT_PUBLIC_FINANCIALS=on) | Adds a V9 section to `/financials/cash` behind a flag. No page, card or nav removed. |
| Cash-flow forecast | `src/lib/tax-banking/forecast.ts`, `load.ts`, `/financials/cash` | Active. Confirmed / scheduled / expected lines; bank or imported-statement start; bills by due date; planned events; overdue invoices; customer lateness after due date; 7–90 day horizons | Kept as is. V9 wraps it (one optional `extra` input added; callers that don't pass it get the same result). |
| Bank balances | Plaid feed + imported statements (`fin_bank_balances`, `statementBalance`) | Active; stale/missing flags exist | Reused unchanged. |
| Gantt progress engine | `src/lib/schedule/progress.ts` | Active. Duration- or weight-based % from entered task % complete; elapsed time kept separate | Reused (`leafTasks`). V9 adds a separate "by estimated cost" weighting option and a schedule projection (plan + current slip). |
| Contract payment milestones | `fin_payment_milestones` (frozen from the signed schedule), `fin_milestone_triggers`, `fin_milestone_status_v`, MilestoneCard + InvoiceDialog | Active. Triggers: signing, start, phase verified, final, date, custom; prefilled invoice; duplicate-invoice alert | **Missing link to Gantt %**. V9 adds progress rules ("at 30%") and a confirm step that records the existing trigger once. Invoice creation and sending stay the existing flow. |
| Milestone dates in the forecast | `loadForecast` | Partial: only milestones with a due date or already ready; others left out | V9 dates every milestone from the schedule (rule %, start, finish), then the customer's payment habit. |
| Customer payment timing | `customerLateness` (days after due) | Partial: fixed default 7 days, after due date only, no override | V9: 3/5/7/14/30/custom default, "after invoice" or "after due date", per-customer override, history needs a minimum sample. |
| Job costs (estimated / committed / actual / forecast) | `fin_budget_lines`, `fin_commitments`, `fin_commitment_balances_v`, `fin_job_budget_v`, `fin_job_profitability_v`, job-costs.tsx | Active. Forecast = max(estimate, actual + committed); bills relieve commitments | Reused. V9 adds historical and benchmark modes for uncommitted spending, per-line overrides with history. |
| Commitments in cash forecast | – | **Not connected**: open subcontracts/POs never appeared in cash flow | V9 dates each open commitment from its schedule phase + payment terms (default 7 days after the phase finishes), with deposit and retainage terms. |
| Uncommitted budget in cash forecast | – | Missing | V9 spreads remaining budget over the job's remaining schedule. |
| Approved bills / AP | `fin_vendor_bills`, `fin_bill_balances_v` | Active in forecast by due date | Unchanged; billed amounts leave "committed" so nothing counts twice. |
| Overhead | `src/lib/financials/overhead.ts` (overhead bills + recurring cash events) | Active | Unchanged; counted in V9 overhead and operating profit. |
| Payroll in cash forecast | `fin_cash_events` kind payroll (manual) | Partial: manual entries only | V9 option: payroll from shifts, project assignments and time clock (incl. shop/office), by pay period, + burden %, replaces manual payroll entries while on. |
| Workforce schedules / time / pay settings | `pm_work_shifts`, `schedule_tasks` assignments, `pm_time_entries`, `pm_employee_profiles.hourly_cost`, `pm_pay_settings`, `pm_labor_report` | Active | Read through a new sums-only function `fin_forecast_labor`. Nothing in workforce changes; no payroll is run. |
| Timesheet labor as job cost | `fin_timesheet_labor_v` in `fin_job_costs_v` | Active | Unchanged (actual labor stays actual). |
| Billing alerts | `fin_alerts` + `fin_alert_candidates` (deposit not invoiced, milestone ready, duplicates…) | Active | Unchanged. V9 cash alerts live in a new `fin_cash_alerts` table. |
| Cash early warnings | – | Missing | V9: low cash, payroll coverage, delayed milestone, milestone ready to confirm, cost overrun, margin, late receivable, expense concentration, forecast confidence. |
| Reports (P&L, cash/accrual, AR aging, CSV/PDF) | `src/lib/financials/reports.ts`, `fin_report_entries_v`, GL reports | Active | Unchanged. V9 forecast is labelled a management forecast, not an accounting statement. |
| General ledger | `fin_journal_*`, PR #211 | Active | Unchanged. |
| Forecast snapshots / accuracy | – | Missing | V9 `fin_forecast_snapshots` (daily) for delayed-milestone alerts and accuracy tracking. |
| What-if, runway, project cash contribution, weekly/monthly views, 180/365 days | – | Missing | V9 engine (pure, tested). |
| Permissions / tenant isolation | `fin_has_permission`, `tb_can`, RLS | Active | Reused. New tables are read through RLS with the same capabilities; writes only through checked functions; alert sync + snapshots are server-only. |

## Gaps that can't be closed safely in V9 (documented, not forced)

- **Automatic invoice sending on milestone**: left out. Invoices stay review-then-send through the existing flow.
- **Changing a milestone's trigger kind** (e.g. turning a "phase completed" milestone into a percent milestone in the
  contract record): not done. The signed record is immutable; the progress rule sits next to it.
- **Overtime premiums in payroll forecast**: not estimated (the worker hub's overtime engine is per-person; the forecast
  only gets sums so pay rates never leave the database).
- **Interest and income tax in net profit**: not estimated unless entered as planned cash events or overhead bills;
  shown as "operating profit, before interest and income tax".
- **Industry benchmarks**: none are bundled. The benchmark mode uses only the percentages the company enters.
- **Pre-existing test failure (not V9)**: `tests/db/fin-general-ledger.test.ts` "posts card surcharges once the surcharge
  column exists" fails on `main` too (check constraint `fin_online_payments_surcharge`).
