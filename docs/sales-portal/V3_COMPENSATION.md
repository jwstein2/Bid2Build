# Sales Compensation Model V3: implementation report

Requested by James, 2026-11-19. Migration `supabase/migrations/20270202001000_sales_comp_v3.sql`
(additive, safe to re-run). Builds on the V8 policy (`V8_POLICY.md`) and milestone boxes
(`20270111001000`).

**Production state when this was built:** 1 sales rep, 0 attributed customers, 0 milestone awards,
0 commission lines (read-only check, 2026-11-19). No earned compensation exists that V3 could
affect.

## 1. What was audited

| Area | Where | Kept as is? |
|---|---|---|
| Standard commissions: one month of plan at monthly list price, sale month + anniversaries (2 at the time; 9 since the ten-year term, TEN_YEAR_TERM.md), 30-day hold, no clawback, first-month cancel pays nothing, upgrades at the anniversary | `sales_sync_billing`, `sales_close_month`, `basis.ts`, policy v2 | Yes, unchanged |
| Referral attribution: `/s/<code>` 90-day cookie + server-side `sales_attributions` (one row per customer, primary key = customer), history table, owner reassign/end | `sales_record_attribution`, `sales_attribution_history` | Yes, unchanged |
| Revenue facts per paid invoice (pre-tax, net of refunds) | `sales_revenue`, `sales_record_revenue`, `sales_revenue_refunded` | Extended (period, billing reason, dispute) |
| Milestone boxes V2: every 50, rate × still-active revenue since last box, $150 minimum, 30-day hold | `sales_milestones_evaluate`, `sales_milestone_awards` | V2 code path kept; V3 is now the default |
| Approvals, statements, payouts, roles (owner vs Sales Admin, no self-approval) | V8.3 wrappers | Yes; approval now refuses a disputed award |
| Randomized activity bonus | Never built ("fixed formula, no random cash") | Still not built; only the disabled, gated program record |

## 2. Formulas implemented

**Schedule** (`sales_settings`: `milestone_every = 25`, flat `[10 → $25, 25 → $75]`, rates
`[50 → 3%, 100 → 4%, 250 → 5%]`, `milestone_min_cents = 0`): 10, 25, 50, 75, 100, 125, …, 225 at 4%,
250 and every 25 after at 5%. One award per rep per threshold, ever (`unique (rep_id, milestone)`).

**Qualifying customer** (`sales_customer_qualified_at`, rule `second_cycle`):
* Monthly: the second collected billing-cycle invoice (prorations don't count).
* Annual / prepaid: one month after the first payment, with no first-month cancellation.
* Never: first-month cancel, fully refunded, charged back (until the dispute is won), free or
  complimentary (no paid invoice). A returning customer is the same attribution row, counted once.
* The owner can switch to `first_payment` (the previous rule) on Compensation & payroll; prospective only.

**Customer MRR** (`sales_customer_mrr`, the single definition):
`least(list MRR, collected MRR)` for a customer whose subscription is `active` (not trialing,
past_due, unpaid, canceled), attribution not ended, no first-month cancel, latest full-period
invoice collected > $0 after refunds and not disputed.
* list MRR = every recurring item (plan, Enterprise base, paid seats, add-ons) ÷ months in its period
  (`listMrr` in `basis.ts`, sent by the Stripe webhook): $199/yr = $16.58.
* collected MRR = latest full-period invoice, pre-tax amount paid − refunds, ÷ months it covers.
* The smaller one removes taxes, discounts, refunds and unpaid amounts. An upgrade counts once paid
  for at the next cycle; a downgrade counts at once.

**Rep qualifying active attributed MRR** = Σ customer MRR over the rep's qualifying customers.

**Award** = flat amount, or `round_half_up(MRR × rate ÷ 100)` in cents. Calculated once when the
milestone is reached; inputs (threshold, MRR, each customer's MRR, rule, policy version,
qualification rule, program status) are stored in `snapshot` with a SHA-256 `snapshot_hash`.
A trigger refuses any change to a fixed award's calculation and any delete.

## 3. Example payouts (verified by tests)

| Situation | Calculation | Award |
|---|---|---|
| Spec example: 100 customers, $2,400 MRR | 240000 × 4% | **$96.00** |
| 50 customers, all monthly at $19.99 | 99950 × 3% = 2998.5 → half-up | **$29.99** |
| 250 customers, $4,000 MRR | 400000 × 5% | **$200.00** |
| Annual customer's MRR contribution | 19900 ÷ 12 = 1658.3 | **$16.58** |
| Reaching 275 after 250 | 250 is not paid again; 275 pays 5% of MRR on that day | one award each |

## 4. Rep dashboard and owner tools

* `/sales` → **Your compensation**: total attributed, qualifying milestone customers, active
  paying, qualifying active MRR, current / next milestone, remaining, next reward (labeled estimate
  at today's MRR), progress bar, standard commissions (earned, pending) in a separate blue-edged card
  from one-time bonuses (earned, paid, pending), payout history split into commissions vs bonuses.
  Award list shows each calculation and a record fingerprint; "Question this bonus" opens a dispute.
* `/sales/how-you-get-paid`: V3 rules, who counts, MRR definition, the $96 example, program
  availability for the rep's work location.
* `/sales/admin?tab=compensation` (**Compensation & payroll**): rules in force + model switch,
  payroll CSV export, compensation by month (revenue, commissions, bonuses, paid, cost ratios), per-rep
  table (paying/attributed, retention, qualifying, MRR, earned, owed now, paid, ratios), every award
  with its stored calculation and "Record verified", disputes (written decision, optional separate
  adjustment line), programs and jurisdictions, rep work locations, program history.
* Totals, award calculations and payroll are owner-only (`payout_operations`). A Sales Admin can
  record an emergency stop; only the owner can clear it, enable a program or record approvals.

## 5. Programs and jurisdictions

`sales_incentive_programs`: `standard_commission` (not switchable), `milestone_bonus` (on, no
approval needed, can be restricted per state/city), `randomized_activity_bonus` (**off**, needs a
current documented approval for the rep's own work state to run). `sales_program_jurisdictions`
(state, optional city, approved / not approved / prohibited, memo reference + attorney required for
approvals, effective and expiry dates; never edited, only revoked). `sales_program_events` is
append-only. Availability is decided from the rep's `work_state` / `work_locality`, never HQ.
Expired approvals stop applying on their date (and the daily cron logs it). Turning the milestone
program off or restricting a state only affects milestones reached afterwards (those are recorded
as "not eligible" with the reason); earned awards stand.

## 6. Tests

* `tests/db/sales-comp-v3.test.ts` (19 database tests, real migration): V3 policy version; second
  cycle; annual qualification without second payment; $25 at 10 with snapshot hash; exclusions
  (first-month cancel, refund, chargeback + won dispute, free, past_due); MRR cap (discount, mid-period
  upgrade/proration, downgrade, Enterprise); webhook retries + concurrent evaluation; $75 at 25; 3% at
  50/75; 4% at 100-225 and 5% at 250; 275/300/325 in one jump and exactly once; no recalculation +
  edit/delete refused; rep dashboard numbers; approval → statement → payroll export reconciled →
  payout reconciled; disputes; randomized disabled + approval gate + per-state + expiry + city
  prohibition + emergency stop + append-only history; milestone restriction is prospective; terminated
  and reinstated reps; V2 awards keep V2 math; returning customer counted once; privacy.
* `tests/sales-comp-v3.test.ts` (unit): schedule, rates, $96 example, half-up rounding, next
  milestone, annual normalization, Enterprise seats, billing period, pre-tax revenue.
* Updated for V3 without changing what they check: `tests/db/sales-v8.test.ts` (policy version 3
  exists), `tests/db/sales-v8-goals.test.ts` and `tests/sales-goals.test.ts` (pin the V2 rules they cover).
* Browser: `scripts/sales-portal/comp-v3-walk.mjs` (desktop 1440 + iPhone 13).

## 7. Conflicts and items for owner + counsel

1. **When a milestone is earned.** The draft commission plan (§6) counts a customer at first payment
   with a 30-day hold. V3 counts at the second billing cycle (annual: one month). This is the proposed
   risk control from the spec; it is live in the code but flagged. The owner can switch back to
   "first payment" on Compensation & payroll (prospective, new policy version).
2. **$150 minimum removed.** The draft plan and V2 have a $150 minimum per percentage box; the V3
   table has none, so V3 uses $0. Confirm.
3. **Bonus base changed** from "collected revenue since the last box" to "active MRR on the day".
   Draft plan §6 needs rewriting to match (and the every-50 cadence becomes every 25).
4. **Two monthly values on purpose.** Standard commissions keep the approved basis (annual counted at
   the $19.99 monthly list price). Milestone MRR follows V3 (annual ÷ 12 = $16.58). Both are documented;
   confirm that this split is intended.
5. **Chargebacks** only reach the system if `charge.dispute.created` and `charge.dispute.closed` are
   added to the live Stripe webhook (and `charge.refunded`, if not already).
6. **Employee vs contractor** status (draft agreement question 1) decides which wage, payment-timing
   and earned-wage rules apply to both programs. Randomized bonuses stay off regardless.
7. **Work locations** are blank for current reps. Enter each rep's actual work state/city before any
   jurisdiction decision matters.
8. **Catch-up timing.** Awards are created by the daily sales-close job and whenever a rep or the owner
   opens their dashboard, so the MRR snapshot is taken within about a day of the milestone. If several
   milestones are crossed between runs (for example a backfill), each uses the MRR at the time of the
   run. The snapshot records both `reached_at` and `computed_at`.
9. Live payouts and withholding remain off; payroll stays manual (export + record payout).

## 8. Rollback

Schema is additive. To return to V2 behavior for future milestones without losing anything, the owner
switches the model on Compensation & payroll, or runs
`docs/sales-portal/rollback_20270202001000.sql` (settings only; awards and history are kept).
