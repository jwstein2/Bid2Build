# Sales Hub V8.4 P0: accelerators, personal records, Recognition & Incentives

Migration `20270116001000_sales_v84_accelerators.sql`, rollback in `supabase/rollback/`.

## Monthly accelerators

| New paid sales in the month (Central time) | Bonus on that month's sale commissions |
|---|---|
| 1-4 | 0% |
| 5-9 | +5% |
| 10-14 | +10% |
| 15-19 | +15% |
| 20+ | +20% |

Example: 10 sales whose sale-month commissions total $199.90, so 10% gives $19.99 and $219.89 in all.

* **Off by default.** Rates and the on/off switch live on Admin Sales Hub → Recognition & incentives and
  are part of the versioned policy (owner only). Turning it on pays from that month onward
  (`accelerator_active_from`), never earlier months. While off, the admin table previews what would pay.
* **Qualifying sale:** a sale-month (`year_no = 1`) commission line that isn't canceled, ineligible or
  reversed. Anniversaries, unpaid sign-ups and complimentary grants have no such line, so they never count.
  The base rate is never changed.
* **When it's fixed:** after the month ends and every qualifying sale has cleared its 30-day refund hold.
  A sale refunded or canceled inside the hold doesn't count (recorded as a refund adjustment). A finalized
  month is never recalculated.
* **Ledger:** `sales_accelerators` holds one row per rep and month: qualifying line ids, counts, base,
  rate, bonus, refund adjustments, policy version, tiers used, status. The bonus is split across the
  month's sales with largest-remainder rounding, so the parts add up exactly. Each part is an `accelerator`
  commission line (`earned`, current month). The unique index on (customer, year, kind) makes re-runs and
  retries safe. Lines go through the existing statement approval and manual payout recording.
* The nightly `sales-close` cron runs `sales_accelerators_evaluate` and `sales_achievements_evaluate`.

## Personal records (replaces the Bronze-Diamond rank, James 2026-11-19)

Quests and XP stay. "You vs. your best month" compares this month's XP only with the rep's own best
earlier month, and a personal records card does the same for paid accounts, follow-ups and meetings.
A rep's first month sets a baseline instead of showing a record. There are no tiers or rankings
between reps.

`sales_achievements` holds one row per rep, kind and month, so a celebration never duplicates:
first sale, first sale of the month, record month (paid accounts, follow-ups), accelerator tier. No cash
is attached.

## Recognition & incentives (admin)

* Incentive cost against collected revenue for the last 6 months: base commissions, accelerators and
  milestone boxes, as a percentage of revenue (before tax, net of refunds).
* Accelerator ledger with status (open, in hold, earned, approved, paid).
* Achievements with "Mark congratulated" and a link to the rep.
* Upcoming milestones, mystery box awards and recent sales.

The congratulation email, preferences survey, reward catalog and calendar are V8.4 P1-P2.
