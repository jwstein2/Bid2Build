# Revenue & Commission Reconciliation

Admin → Payments & Payouts → **Reconciliation**. Added 2026-11-22. This connects the systems that were already there.
It doesn't rebuild them, and it adds no second commission ledger or billing engine.

## What already existed (reused as is)

| Piece | Where |
|---|---|
| Signed, idempotent Stripe webhook (subscriptions, invoices, refunds, disputes) | `src/app/api/stripe/webhook/route.ts`, `stripe_events` |
| Rep attribution, commissions, 30-day hold / refund policy, month-end close, statements | Sales Hub migrations, `sales_close_month`, `src/lib/sales/billing-server.ts` |
| Affiliate attribution, 10-year annual commissions, holds, refunds, chargebacks | Affiliate Hub migration, `src/lib/affiliates/billing*.ts` |
| One payout ledger, batching, limits, holds, funding check, idempotent sends, verified provider events | V8.1 `payouts`, `payout_items`, `payout_events`, `src/lib/payouts/*` |
| Automatic payout rail: Stripe Global Payouts adapter (off; Stripe approval pending) | `src/lib/payouts/provider.ts` |
| Built2Bid's own QuickBooks: 1099 vendors, bills, paid-bill check | `src/lib/quickbooks/platform.ts`, `qb_payout_bills` |
| Daily crons: sales close (07:30 UTC), payouts + QuickBooks paid-bill check (15:10 UTC) | `netlify/functions/*` |

## What this adds

1. **Stripe invoice evidence** (`billing_invoice_facts`). The webhook records every invoice, refund and dispute, and the daily
   run checks the last 40 days against Stripe. It stores evidence only.
2. **Payment gate (the non-negotiable rule).** A commission can be paid live (automatic payout or production QuickBooks bill) only when
   its Stripe invoice is verified: live mode, paid, USD, more than $0, same customer, no open or lost chargeback, and not fully refunded
   (unless the agreement keeps the commission: `never_reverse`, or a refund after the 30-day hold under `hold_30_no_clawback`).
   The gate is one added condition in `payout_plan`, `affiliate_payout_plan`, `qb_payout_candidates` and `qb_payout_bill_reserve`.
   Test mode and the QuickBooks sandbox behave exactly as before.
3. **Standing authorization (off until the owner turns it on, with two-step and a confirmation).**
   - *Approve ordinary sales statements automatically.* This runs from day N (default 3) of each month for closed statements. It approves only when
     every line is verified, past the 30-day hold, has no refund or chargeback, isn't a bonus/accelerator line, and the total is at or below the limit
     (default $1,500). The authorizing owner is recorded as approver, and each approval is audited as `sales.statement_auto_approved`.
     Anything else waits in Exceptions. Affiliates already become payable automatically and only pass through the gate.
   - *Create QuickBooks bills automatically.* While automatic payouts are off, every ready, verified obligation becomes a bill each morning.
   - *Book automatic payouts in QuickBooks.* After the provider confirms a live payout, a bill plus a "Check" bill payment is recorded from a chosen bank
     account. This is bookkeeping only, and QuickBooks moves no money.
4. **Daily reconciliation** (`netlify/functions/reconcile-cron.mts`, 14:40 UTC, before the payout run, plus "Reconcile now"):
   Stripe sweep, which records missed invoices, refunds and disputes and replays them through the existing handlers → QuickBooks paid-bill check
   and optional entries → automatic approval → database checks → exception queue → month-end close → one email only if something needs the owner.
   It runs one at a time (`recon_run_begin`), and every step is idempotent. If Stripe or QuickBooks can't be reached, the run records it and retries the next day.
   A timeout is never treated as a payment.
5. **Checks** (`recon_db_findings`): commissions approved, payable or paid without a verified payment; paid then refunded or charged back with
   no recovery on record; referred customers' paid invoices that never reached the commission ledgers; statement totals that don't match their lines;
   two payment routes for one obligation; QuickBooks bill amount mismatches; open bills whose commission is no longer payable;
   QuickBooks-paid but not marked paid; live payouts marked paid without a verified provider event; payout amounts that differ from their
   obligations; payouts stuck in transit; the same customer credited to both a rep and an affiliate; Stripe events never processed;
   QuickBooks needing sign-in.
6. **Exceptions** (`recon_exceptions`): one row per problem, with repeats counted. An exception clears only when the records no longer show
   the problem. Acknowledging needs a note, documents the difference, and never changes money. Emails: new discrepancies and actions
   go out in one digest, open ones are re-sent at most weekly, and outages are emailed only after 3 runs.
7. **Automatic month-end close** (`recon_periods`): after the month ends plus the grace days (default 3), the month closes on its own if that
   day's Stripe check succeeded and no material exception is open for that month or earlier. The report (revenue, refunds, chargebacks,
   failed invoices, cancellations, sales and affiliate commissions by state, payouts and provider fees, QuickBooks bills, discrepancies)
   is stored with a SHA-256 and can't be edited. Later corrections show up in later months. A blocked month waits and is retried daily.
   The owner gets one email only if it's still blocked a week after its grace days.
   CSV: `/api/admin/reconciliation/export?month=YYYY-MM`.

## Commission lifecycle (existing statuses, no new labels)

| Logical state | Sales Hub | Affiliate Hub |
|---|---|---|
| Attributed | `sales_attributions` | `affiliate_referrals` |
| Awaiting customer payment | no line until a paid invoice | no line until a paid invoice |
| Payment verified / refund hold | `pending` + facts paid | `pending` (`hold_until`) |
| Earned, pending approval | `earned` on an open statement | `payable` |
| Approved | `approved` (person or standing rule) | `payable` |
| Scheduled / processing / paid | payout `scheduled → submitted → paid` (verified event only) | same |
| QuickBooks bill created / paid | `qb_payout_bills` `open → paid` (QuickBooks balance 0) | same |
| Held / reversed / ineligible | `reversed`, `ineligible`, `canceled`, clawback line | `held`, `reversed`, `canceled`, adjustment |
| Reconciliation exception | `recon_exceptions` | `recon_exceptions` |

## Owner setup (one time)

1. Run the SQL (two parts) and the check query.
2. Optional: add `invoice.voided` and `invoice.marked_uncollectible` to the Stripe webhook's events. The rest are already sent.
3. Make sure `OWNER_ALERT_EMAIL` is set in Netlify (Production), so exception emails reach you.
4. Reconciliation → Standing authorization: turn on the rules you want, then tick the authorization box.
5. Real automatic transfers still need Stripe Global Payouts approval and the live activation checklist on the Automation & activation tab.
   The fee is $1.50 per US bank payout per Stripe's public pricing, to be confirmed on the account when approved.

## Separation

- Customer accounts aren't affected. Their subscriptions, billing, invoice payments and their own QuickBooks connections and crew-hours sync are unchanged.
  The only customer data read is whether a referred customer's payment to Built2Bid went through.
- W-2 employees are never paid through this. The existing payout blockers (`payroll_required`) still apply.
- Demo and Practice accounts are excluded from every report and check.
