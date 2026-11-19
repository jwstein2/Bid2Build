# Sales Portal (Phases 1 and 2)

A separate sign-in and workspace for Built2Bid's own sales staff, plus an owner **Sales Hub**. It is not
the contractor app, not the owner admin area, and not the customer "refer a contractor" program.

| Who | Where | What |
| --- | --- | --- |
| Sales rep / manager | `/sales/login`, `/sales`, `/sales/customers`, `/sales/commissions` | Permanent referral link (copy, email, text, QR + PNG), funnel (visits → free accounts → started a bid → paying), attributed customers (limited fields), commission lines, monthly statements, projected commissions |
| Owner (platform admin) | `/admin/sales-hub` | Add/suspend/remove staff, see every rep's results, assign or reassign customers (reason required), adjust commission lines, approve statements, record payouts, run month-end, edit and confirm the commission policy |

## How attribution works

1. A rep shares `https://built2bid.org/s/<CODE>` (optionally `?to=/pricing`). The route counts one visit
   per browser, stores `b2b_rep=<CODE>.<visit time>` (90 days, first rep link wins) and redirects with
   `utm_source=sales_rep`.
2. When that browser signs in, `(app)/layout.tsx` calls `sales_record_attribution`, which stores the rep
   **on the account** (`sales_attributions`, one row per account, never overwritten by a later link).
   Only new, never-paid, genuine accounts count: not sales staff, not internal/test/demo, created within
   `attribution_window_days` (default 30) of the visit. Older accounts can be assigned by the owner.
3. A click, signup or install never earns money. Commissions come only from paid invoices.

## Commission rules (James, 2026-11-19)

One month of the customer's subscription value, before tax:

- **Sale month**: created from the first non-zero paid invoice, earned when that month closes (Central time).
- **Years 2 and 3**: created from a paid invoice in the anniversary month, at the subscription's
  **current** value (upgrades count immediately, even if just started). No payment in the anniversary
  month → recorded as ineligible. Nothing after year 3.
- **Annual plans**: the monthly list price ($19.99), per James's decision.
- **Monthly value**: everything on the subscription (plan, Enterprise seats and paid add-ons), per James.
- **Refunds**: held to month end; a full refund before payout reverses the line, after payout a
  deduction lands on the next statement. Partial refunds are flagged for owner review. Prorations are
  ignored (the plan rate is used).
- Discounts/coupons are not subtracted automatically; the owner can adjust a line before approval.

All of this lives in `public.sales_settings` (Policy tab), not in code. Statements can't be approved
until the owner ticks "I confirm these are the commission rules" once.

Statuses: pending → earned → approved → paid; also ineligible, canceled, reversed. One line per customer
per year (unique index) and one payout per statement, so nothing is paid twice.

## Jobs and Stripe

- `netlify/functions/sales-close-cron.mts` runs daily (07:30 UTC) → `POST /api/cron/sales-close`
  (Bearer `EMAIL_OUTBOX_SECRET`, already set) → `sales_close_month()`. Idempotent.
- The Stripe webhook keeps each attributed customer's plan and basis current on every subscription event
  and creates commissions from `invoice.paid`. To reverse commissions on refunds, add **charge.refunded**
  to the webhook endpoint's events in Stripe (Developers → Webhooks). Nothing here charges, credits or
  changes a customer's subscription, and payouts are recorded, not sent.

## Security

RLS on every table, no direct grants. Owner functions are service-role only and re-check `is_admin`;
every owner change is written to `audit_logs`. Rep functions use `auth.uid()` and return only the
rep's own customers: business name, contact email, plan tier, billing status and dates. Never bids,
customers, financials or operational data. Owner accounts can't be added as reps; sales staff can't
be attributed as customers.

## Phase 2: sales CRM (`20270107002000_sales_crm.sql`)

- **Leads** (`/sales/leads`): add, search, filter by pipeline stage (new, contacted, engaged, demo,
  trial, paying, lost), next actions with overdue flags. Reps see their own leads; managers see all.
- **Lead page**: activity history (call, email, text, meeting, note; stage changes and assignments are
  logged automatically), tasks with due dates, details, lost reason, do-not-contact flag.
- **One rep per business**: duplicate check on website domain, phone, or name + ZIP. A rep can't add a
  business another rep is working; the owner reassigns it.
- **Automatic stages**: a lead whose email matches an account that signs up through the rep's link is
  linked and moves to Trial; the first payment moves it to Paying.
- **Owner Leads tab** (Sales Hub): paste-in import (duplicates skipped), filter by rep, bulk assign or
  unassign, with history and audit log.

## Next phase

- Phase 3: lead discovery (Google Places API, authorized use only; storage limits apply) and compliant
  automated follow-ups (opt-out, suppression, caps, send switch off by default).

## Tests

- `tests/db/sales-portal.test.ts` (real Postgres): invites, access, attribution rules, commission
  creation incl. upgrades and Central-time months, month-end, approval/payout, refunds, reassignment,
  rep data isolation.
- `tests/sales-portal.test.ts`: basis math, links, cookie, attribution skip paths.
- `scripts/sales-portal/walk.mjs`: browser walk (31 checks) with screenshots.

Rollback: `supabase/rollback/20270107001000_sales_portal_down.sql` (deletes all sales data).
