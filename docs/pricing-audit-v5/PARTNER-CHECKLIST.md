# Sales Partner "20% of Net": Definition Checklist

Nothing is implemented. The agreement's definition of "net" is unknown, and the commission base can
differ by thousands of dollars a year depending on the answers below. Bring this list to the executed
agreement (or to the attorney drafting it) and fill in every row before any calculation is built.

## 1. What kind of arrangement is it?

| Question | Answer |
|---|---|
| Commission on customers the partner sources, or a share of company-wide profit? | |
| Initial sale only, or recurring for as long as the customer pays? | |
| If recurring: for how many months (lifetime, 12, 24, 36)? | |
| Does it continue after the partner leaves or the agreement ends (tail period)? | |
| Is it capped (per customer, per year, total)? | |

## 2. Which revenue counts ("eligible revenue")?

| Item | Counts? (yes / no / partly) |
|---|---|
| First paid invoice | |
| Renewals (monthly and annual) | |
| Upgrades (Standard → Enterprise, extra seats, PM editors, Financials) | |
| Add-ons bought later by a sourced customer | |
| Annual prepayments: counted when collected, or spread over 12 months? | |
| Revenue from customers the partner did not source (company-wide share only) | |
| Sales tax collected (should never count: it is not Built2Bid revenue) | |
| Complimentary accounts (no revenue; should never count) | |
| Referral-program credits and promo-code discounts: deducted from revenue first? | |

## 3. What is deducted to reach "net"? (Do not assume every line applies.)

| Possible deduction | Deducted? |
|---|---|
| Refunds (subscriptions are non-refundable, but disputes and exceptions happen) | |
| Chargebacks and dispute fees | |
| Stripe card, Billing and Tax fees | |
| Direct service costs (hosting, database, email, storage, AI) | |
| Customer support cost | |
| Advertising and lead acquisition | |
| Fixed operating expenses (software, insurance, accounting, legal) | |
| Founder/owner compensation | |
| Income taxes | |

## 4. Timing, attribution and clawback

| Question | Answer |
|---|---|
| How is a customer attributed to the partner (referral link, code, written list, CRM)? | |
| What if two sources touch the same customer (partner + ad + organic)? | |
| Accrued when invoiced or when cash is collected? | |
| Paid monthly, quarterly? Minimum payout? | |
| Clawback if a customer charges back or is refunded within N days? | |
| Statement the partner receives (detail level, audit rights)? | |
| Is the partner an independent contractor (1099)? Who handles tax reporting? | |

## 5. What Built2Bid already records that a future report can use

- Acquisition source: `analytics_events`, UTM/referral tables (`referrals`, creator-partner program
  tables), the Admin → Marketing views. A partner attribution field does not exist yet.
- Revenue: Stripe invoices (source of truth), mirrored subscription state in `subscriptions`.
- Complimentary access: `complimentary_grants` (already excluded from paid revenue in admin reports).

## 6. Proposed reporting model (after the definition is signed)

An owner-only report, separate from contractor accounting, with one row per partner per period:
eligible revenue, each agreed deduction, commission basis, rate, amount accrued, amount payable,
amount paid (entered manually), and refund/clawback adjustments. It never sends money: payouts stay a
manual owner action.
