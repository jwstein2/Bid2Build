# Payout taxes, withholding and tax-season documents (V8.4)

Migration: `supabase/migrations/20270304001000_payout_tax_compliance.sql` · Rollback: `docs/payout-taxes/rollback_20270304001000.sql`

**Scope:** Built2Bid's own payees only: staff on the contractor path, sales reps and affiliates. It never applies to a
contractor customer's crews (those are in the HR records and Team 1099 tools).

**State when merged:** nothing changes for money. Payout mode, provider and live activation are untouched (still off /
practice). Backup withholding is **off** and its rate is **unverified**. All 50 states + DC are **unverified**.

## How the automated pipeline fits together

| Step | What runs | Built in |
|---|---|---|
| 1. Commission earned | Sales Hub / Affiliate Hub commission lines | V8, PR #201 |
| 2. Customer payment verified in Stripe | Daily reconciliation, 8:40 AM CT | PR #248 |
| 3. Statement approved | Owner, or auto-approval under the standing authorization | PR #248 |
| 4. Payout planned | One batched payout per person per run; W-9, agreements, bank and **tax** checks | PR #198 + this |
| 5. Tax withheld (if an IRS notice) | Federal 24% (once verified) + state rate where verified | **this** |
| 6. Funding check | Stripe balance vs due; if short, nothing is sent and the owner is emailed | PR #198 |
| 7. Sent | Stripe Global Payouts outbound payment, stable idempotency key | PR #198 |
| 8. Settled / returned | Signed Stripe webhook; paid marks statements paid | PR #198 |
| 9. Year-end | 1099 summary, e-file CSV, Copy B PDFs, withholding + state reports | **this** |

## What this adds

1. **Backup withholding.** The owner marks a payee with an IRS notice (B-notice / CP2100) on Payments & Payouts →
   Year-end tax → Payees. While withholding is off, that person's payouts are **held** (never paid in full). Once the owner
   confirms the rate with a CPA and turns withholding on, every unsent payout for that person is recalculated:
   federal at the settings rate (24% pre-filled), plus the state rate when the payee's state is verified and has one
   (California 7% pre-filled, unverified). Amounts freeze once a payout is claimed for sending. The ledger, the person's
   CSV statement and the accounting export show the withholding.
   Missing W-9 / TIN still **holds** the payout. Paying with withholding instead of holding is not offered.
2. **State-by-state gate.** A **live** payout needs the payee's tax state (work state, else address state) known and that
   state's rules marked verified with a source. Test mode isn't affected.
3. **State rules table.** Per state: income tax, state 1099 filing (Combined Federal/State, direct, only if withheld,
   none), state threshold, state backup withholding rate, nonresident withholding note, contractor (new-hire) reporting
   with threshold and days, agency website, notes, source and verified. Pre-filled (all unverified): no-income-tax states
   (AK, FL, NV, NH, SD, TN, TX, WA, WY), California (DE 542 contractor reporting at $600 within 20 days, 7% backup
   withholding, nonresident note), and a reminder on Minnesota.
4. **Contractor reports.** For states marked "required", the tab works out when each payee crossed the threshold and the
   due date, and the owner records the filing.
5. **Withholding deposits.** The owner records each EFTPS (or state) deposit; the report shows withheld vs deposited
   by month. Built2Bid can't make tax deposits.
6. **TIN Matching result** (from IRS e-Services) recorded per payee.
7. **Downloads** (`/api/payouts/tax-season`), each as CSV and PDF:
   tax season packet (everything plus the to-do list and deadlines), 1099-NEC summary, payout ledger, withholding
   report, state-by-state report. Also 1099-NEC Copy B PDFs (last 4 of TIN, boxes 4-7 filled) and the 1099-NEC e-file
   CSV with full TINs (owner + two-step only, every download logged).

## Needs a CPA or counsel (not decided in code)

- The 2026 1099-NEC threshold ($2,000 entered, unverified) and whether gross includes recipient-paid fees.
- The backup withholding rate (24% pre-filled) and Form 945 deposit schedule (monthly vs semiweekly).
- **Every state** your payees work in, starting with Minnesota: state 1099 filing, contractor reporting, state backup
  withholding, nonresident withholding. Mark each verified only after confirming.
- Whether reps are correctly classified as 1099 (Sales Comp V3 notes the MN drawing exception covers employees only).
- Electronic delivery of Copy B needs each person's affirmative consent; until then, mail or hand it over.
- W-2 staff: wage withholding, W-2s and employee new-hire reporting need a payroll provider. Salsa declined us and
  Honkamp has no API; Check's startup tier is waitlisted. Nothing here pays or withholds wages.

## What James does

1. Paste the SQL in the [Supabase SQL Editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new), then merge.
2. Open [Payments & Payouts → Year-end tax](https://built2bid.org/admin/payouts?tab=tax) and fill **Payer details**
   (EIN, address, filing method, CPA).
3. With your CPA, verify **Minnesota** (and any other payee state) in **State-by-state rules**.
4. Leave backup withholding off unless the IRS sends a notice for someone.
5. In January, download the **Tax season packet** for your CPA and the **e-file CSV** for your filing service.

## Testing

- `tests/db/payout-tax-compliance.test.ts`: 6 database tests (safe defaults, IRS-noticed payee held then withheld at
  24%, amounts frozen after claim, state withholding only when verified, flag removal, live state gate, tax season
  report incl. CA contractor deadline, owner-only writes, accountant read).
- `tests/payout-tax-season.test.ts`: 6 unit tests (TIN masking, formula-safe CSV, deposit gaps, e-file columns, readiness,
  deadlines, PDF rendering).
- Migration applied over all migrations, re-run, rolled back and re-applied.
