# Owner Administration, Staff Onboarding, Automated Payouts & Banking (V8.1)

Migration: `supabase/migrations/20270207001000_staff_payouts.sql` · Rollback: `docs/staff-payouts/rollback_20270207001000.sql`

**State when merged:** payouts are **off**, the provider is the in-app **practice** provider, and no fee schedule is approved,
so Built2Bid pays any fee and nothing is deducted. Nothing in this change can move real money until the owner completes
the live activation checklist and the server has `PAYOUTS_ALLOW_LIVE=true`. No Stripe Connect, Global Payouts or other
paid service was turned on. Commission rules and pricing are unchanged.

## 1. Audit: what already existed (reused, not duplicated)

| Area | Existing | How this change uses it |
|---|---|---|
| Owner identity | `admin_roles` / `is_admin()`, `audit_logs` | Owner = `is_admin()`. Every staff, payout and banking action writes `audit_logs` through `staff_audit`. |
| Sales reps | `sales_reps`, invites (`src/lib/sales/invite.ts`), Sales Hub roles | Each rep gets a Team & Staff record automatically (trigger plus backfill) with classification **Pending review**. Invite tokens reuse the same hashing helpers. |
| Commissions | `sales_commissions`, `sales_statements` (open → approved → paid), `sales_payouts`, `admin_sales_payout_record` | Payouts only pay statements the owner or Sales Admin has **already approved**, unchanged. A live, settled payout marks the statement paid and writes `sales_payouts` (method `ach`), the same record the manual flow writes. Commission math is not touched. |
| HR records (PR #194) | W-4, pay, direct deposit, subcontractor ACH for **contractor companies' own** employees | Not reused for Built2Bid's own staff: those tables belong to customer companies. The new staff tables are Built2Bid-internal and staff-only. |
| PII | `sealPii` AES-256-GCM (`PII_ENCRYPTION_KEY`, already set) | The W-9 TIN is sealed before it reaches the database. Only the last 4 digits are stored in app tables. |
| Plaid (PR #125) | Read-only bank feeds per book (`fin_bank_*`) | Owner Banking reads the book the owner **designates**. There is no new bank connection and no money movement. |
| Stripe | Live subscriptions, no Connect | Banking reads Stripe payouts and balance (read-only) for reconciliation. Payouts use a **separate** key (`PAYOUTS_PROVIDER_KEY`). |
| Two-step sign-in | Supabase MFA, aal2 | Required for financial administration (limits, resume, approvals, live activation, bank designation, banking access grants). Pause never needs it. |
| Cron | Netlify scheduled function → route with `EMAIL_OUTBOX_SECRET` | `netlify/functions/payouts-cron.mts` runs daily at 15:10 UTC (9:10 or 10:10 AM Central). |

## 2. What was built

**Owner Administration** (staff-only `/admin`, never linked from the customer app):
- **Team & Staff** (`/admin/staff`): directory, KPIs and new-person form. Each person's page (`/admin/staff/[id]`) has a one-time onboarding link (expires in 7 days, only a hash is stored), onboarding steps, an edit form for personal, professional, classification and compensation fields, W-9/W-4/I-9/wage-notice verification, masked bank accounts, accepted agreements, roles and banking visibility, and status (Invited, Onboarding, Active, Suspended, Terminated). Suspending someone holds their payouts and suspends their Sales Hub access.
- **Payments & Payouts** (`/admin/payouts`) has six tabs:
  - **Overview:** mode, paused state, liabilities and next run.
  - **Ledger:** gross, fee, who paid the fee and why, net, dates, provider reference and reconciliation.
  - **Exceptions:** approved statements that can't be paid by contractor ACH, for example W-2 (payroll), unclassified, or no directory record.
  - **Settings:** mode, provider, limits, emergency pause, fee schedule approval, funding account approval and the live activation checklist.
  - **1099 / year-end:** threshold per tax year, editable and not hardcoded.
  - **Costs:** fees paid by recipients compared with Built2Bid, savings from batching, and the provider comparison.

  CSV export is at `/api/payouts/export`.
- **Banking & Cash Flow** (`/admin/banking`) is read-only. It shows designated business accounts, with personal accounts excluded, plus monthly income and expenses, Stripe revenue, and bank deposits reconciled to Stripe payouts so they aren't counted twice. It also shows known obligations for the next 30 days and projected cash. Every figure is labeled Bank-confirmed, Stripe, Scheduled or Forecast.

**Roles** are enforced in the database (`staff_capabilities`): owner, Sales Admin, sales rep, finance, operations and external accountant. The accountant is read-only plus exports. Banking needs an explicit owner grant. Anyone without access gets a 404.

**Staff self-service** (`/staff`, separate sign-in at `/staff/login`):
- Invite → sign in with the invited email → 7-step onboarding:
  1. Personal details
  2. Confirm role
  3. Agreements: typed name, IP address, user agent and a SHA-256 of the exact text; they can't be changed afterwards
  4. Tax: a W-9 for contractors; for employees, W-4, I-9 and the MN wage notice are tracked as "Payroll Integration Required"
  5. Payout method
  6. Two-step sign-in
  7. Confirm
- `/staff/payouts` (Payout Settings): **Connect Bank Account** opens the provider's hosted page, so Built2Bid only keeps the bank name and last 4. It also shows the hold status, YTD earned, fees and deposited, history with gross, fee and net, blockers, and a CSV statement for each payout. It's linked from the Sales Hub nav as "Payouts".
- `/staff/finance` is a read-only ledger, plus banking where it's been granted.

**Payout engine:**
- `payout_plan` makes **one batched payout per person per run** from approved, unpaid statements (an advisory lock plus a unique index stop a statement from being paid twice).
- `payout_claim_due` uses `FOR UPDATE SKIP LOCKED` and checks pause, live activation, per-payout and daily limits, and the approval threshold.
- The provider adapter sends with a stable idempotency key.
- Webhooks are verified, idempotent and only move a payout forward (`/api/payouts/webhook`).
- Retries use 15-minute × 4ⁿ backoff, up to 3 attempts.
- Returns undo the paid marks and flag the bank account.
- Bank changes start a 72-hour hold and email both the person and `OWNER_ALERT_EMAIL`.
- Test-mode payouts never touch real statements.

**Fees (V8.1):**
- Recipients pay the provider's standard ACH fee by default **only if** all of these hold: the fee schedule is approved, the person is a 1099 contractor or vendor, they accepted the versioned fee disclosure, their state isn't on the blocked list, and the fee is less than the payout.
- Otherwise Built2Bid pays, and the reason is recorded.
- Nothing is ever deducted from W-2 staff. There's no fee to create an account and no monthly fee.
- Standard payouts are the default. Instant payouts are off and optional.
- The fee disclosure is shown during onboarding with a worked example.

## 3. Integration status

| Integration | Status |
|---|---|
| Sales Hub commissions | Integrated. Reads approved statements and writes `sales_payouts` on live settlement only. |
| Practice provider | Works now in test mode: connect a practice bank, plan, send, then simulate settle, fail or return. |
| Stripe Global Payouts | Code complete. **Enabled on the live Stripe account (2026-11-27)** with a financial account at a $0 balance, so nothing can be sent until it is funded. Still needs the key, webhook and owner activation (section 6). |
| Plaid bank feed | Reuses the existing read-only feed. The owner designates which book holds the business accounts. |
| Stripe read-only (banking) | Uses the existing `STRIPE_SECRET_KEY`. |
| W-2 payroll | **Payroll Integration Required.** Approved W-2 amounts show as exceptions, are never paid by ACH here, and no wages are shown as paid. |
| 1099 e-filing | V8.4 (`docs/payout-taxes/`): 1099 summary, e-file CSV, Copy B PDFs, backup withholding, state-by-state rules and tax-season downloads. Filing itself is done by an accountant or a filing service. |

## 4. Cost analysis (public US pricing checked 2026-11-20; confirm on the live account before activating)

| Option | $500 payout | Monthly | Fit |
|---|---|---|---|
| **Stripe Global Payouts (recommended)** | **$1.50** standard ACH; instant debit $1.50 + 0.75% (min $2) | $0 | Built for paying your own contractors from a Stripe balance |
| Stripe Connect Express | $1.50 (0.25% + $0.25); instant 1% | $2 per active account (≈ $3.50 total) | Built for marketplaces. Not set up on the live account. |
| Manual ACH from the bank | Bank fee | Bank fee | Not automated |

- **Example:** 10 reps paid monthly, each batched into one payout, costs 10 × $1.50 = **$15/month**. With an approved fee schedule, each rep sees $1.50 deducted from that month's payout, and Built2Bid pays $0. Without batching, a rep with 3 approved statements would pay 3 fees. Batching cuts that to 1, and the Costs tab shows the savings.
- **Funding:** Global Payouts pays from Built2Bid's Stripe storage balance. A storage account ("Primary Altra", $0) already exists on the live account and gets topped up from the business bank.
- **1099-NEC threshold:** 2025 is $600 (verified). 2026 is entered as $2,000 per P.L. 119-21 and **marked unverified**. Confirm with your accountant, then mark it verified on the 1099 tab.

## 5. Testing

- `tests/db/staff-payouts.test.ts` has 13 database tests covering the spec's tests 1-16:
  - Batching (two statements become one payout: $625.00 gross, $1.50 fee, $623.50 net).
  - No duplicate payout on re-plan or concurrent claims.
  - Unverified, duplicate and stale webhook events are refused.
  - Test payouts never mark statements paid.
  - Live settle and return.
  - Fee edge cases, holds, the bank-change hold, limits, pause and retry.
  - Live activation guards.
  - Accountant is read-only; W-2 routing; suspension.
  - Invite email mismatch and expiry.
  - Agreements can't be changed after acceptance.
  - Year-end and cost reports.
- `tests/staff-payouts.test.ts` has 14 unit tests:
  - The fee mirror.
  - Provider guards: the practice provider can never run live, and a test key can't be used live or the other way round.
  - Signed bank-connection state: a swapped or forged recipient is rejected.
  - Destination problems, the safe return path, Stripe↔bank reconciliation, and cash summary and reserve.
- Full unit suite: 2,028 passed (one admin-nav assertion was updated for the three new menu items).
- Related DB suites: Sales Hub, HR, finance and tax-banking all pass. `tax-banking-upgrade` can't run in this shallow clone because it needs an old commit (`git show 6c835dd`). That's an environment limit, not a failure.
- Typecheck and lint are clean.
- The migration was applied on top of every existing migration, rolled back, re-applied, and run twice. It's safe to re-run.

## 6. Activation checklist (what James must do, in order)

1. **Paste the SQL** in the [Supabase SQL Editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new): the full `20270207001000_staff_payouts.sql`. Then merge.
2. **Try it in practice mode.** Go to `/admin/payouts` → Settings and set mode to **Test**, provider Practice. Then:
   - Invite yourself (or a rep) from `/admin/staff` and complete onboarding.
   - Connect the practice bank, approve a statement, click **Run now**, then simulate settle, fail and return.
3. **Review classifications:** every rep starts as "Pending review" in Team & Staff.
4. **Counsel review:** the 7 agreement templates are labeled drafts (contractor, commission, payment terms, fee disclosure, employee acknowledgement, MN wage notice, vendor terms). Have counsel confirm whether fee recovery is allowed in each state your reps work in, and add any blocked states in Settings.
5. ~~**Apply for Stripe Global Payouts**~~ Done: enabled on the live account 2026-11-27. **Apply for Stripe Global Payouts** on the live account (Dashboard → Global Payouts), described as paying Built2Bid's own US 1099 sales contractors. Stripe reviews this.
6. **Once approved,** set these in Netlify Production (never paste them in chat):
   - `PAYOUTS_PROVIDER_KEY` (a restricted live key with Global Payouts permissions)
   - `STRIPE_PAYOUTS_WEBHOOK_SECRET`, from an event destination for `v2.money_management.outbound_payment.*` pointed at `https://built2bid.org/api/payouts/webhook`
   - `PAYOUTS_FINANCIAL_ACCOUNT` (optional: the storage account id)
   - `OWNER_ALERT_EMAIL`
   - `PAYOUTS_ALLOW_LIVE=true` (last)
7. **Fund** the Stripe storage balance from the business bank, then name and approve the funding account in Settings.
8. **Approve the fee schedule** after confirming that the live account's pricing matches $1.50.
9. **Verify the 2026 1099 threshold** with your accountant, and choose a 1099 filing method.
10. **Activate live:** tick the 9-item checklist in Settings (needs two-step sign-in). You can pause at any time without two-step.
11. **Optional:** reconnect the Stripe connector with more permissions so threads can read outbound payments. For W-2 staff, pick a payroll provider (Gusto, ADP, etc.).
12. **Banking:** in `/admin/banking`, designate the book whose Plaid feed holds Built2Bid LLC's business accounts, and exclude any personal accounts.

**Environment variables:**
- Required for live: `PAYOUTS_PROVIDER_KEY`, `PAYOUTS_ALLOW_LIVE`, `STRIPE_PAYOUTS_WEBHOOK_SECRET`.
- Optional: `PAYOUTS_FINANCIAL_ACCOUNT`, `OWNER_ALERT_EMAIL`.
- Already set: `PII_ENCRYPTION_KEY`, `EMAIL_OUTBOX_SECRET`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`.
