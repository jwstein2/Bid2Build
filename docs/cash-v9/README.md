# V9 cash flow forecasting and early warnings

Additive enhancement of the Financial Command Center cash forecast. See [AUDIT.md](AUDIT.md) for what existed and
what V9 connects. Nothing existing is replaced: the V6.9 engine (`src/lib/tax-banking/forecast.ts`) is wrapped by
`src/lib/cash-v9/engine.ts`.

## Pieces

| File | What it does |
|---|---|
| `supabase/migrations/20270217001000_cash_v9.sql` | New tables + checked functions (settings, collection overrides, milestone progress rules + confirm, commitment terms, forecast overrides, alerts, snapshots, `fin_forecast_labor`). |
| `src/lib/cash-v9/schedule.ts` | Verified progress by working days / task weight / estimated cost; plan + slip projection of dates. |
| `src/lib/cash-v9/milestones.ts` | Milestone -> expected invoice -> due -> payment date. |
| `src/lib/cash-v9/collections.ts` | Customer payment rule: override > history (min sample) > default (after invoice or after due date). |
| `src/lib/cash-v9/costs.ts` | Forecast at completion by mode (known / historical / benchmark), commitment and remaining-budget timing. |
| `src/lib/cash-v9/payroll.ts` | Payroll by pay period from scheduled and clocked hours, + burden. |
| `src/lib/cash-v9/whatif.ts` | Temporary what-if adjustments (never saved). |
| `src/lib/cash-v9/engine.ts` | Assembles the forecast, profit summary, runway, project cash contribution, daily/weekly/monthly buckets. |
| `src/lib/cash-v9/alerts.ts` | Early-warning evaluation. |

## Rules the code keeps

- Unpaid invoices and milestones are never cash; they move the projected balance on their projected payment date.
- Verified progress = the % complete entered on schedule tasks. Elapsed time is never progress.
- Reaching a milestone % makes it eligible. A person with invoice rights confirms it; the existing invoice dialog
  prefills it; nothing is sent automatically.
- Actual costs stay actual in every mode. A commitment and its bill are never both counted.
- Payroll from schedules replaces manual payroll plan entries while it's on (so payroll isn't counted twice).
- What-ifs and scenarios change a copy only.
- Every figure carries its basis (a note on each event; badges for scheduled vs expected; confidence list).

## Activation

1. James pastes `run-cash-v9.sql` (same as the migration) in the Supabase SQL Editor and confirms.
2. Merge the PRs. The new cash-flow section stays hidden until `NEXT_PUBLIC_CASH_V9=on` is set in Netlify (Production).
3. Daily alerts/snapshots run inside the existing daily tax-banking job (no new scheduled function, no paid service).

## Rollback

- Turn off: remove `NEXT_PUBLIC_CASH_V9` (or set it to anything but `on`) and redeploy. The existing cash page is unchanged.
- Remove data: run `docs/cash-v9/rollback_20270217001000.sql`. It drops only V9 tables/functions. Milestone triggers
  confirmed through V9 remain as ordinary trigger records (they are part of the audit trail).
