# Online invoice payments (Stripe Connect)

Migration: `supabase/migrations/20270213001000_fin_connect_payments.sql` · Rollback: `docs/financials/rollback_20270213001000.sql`

## What it does

- **Contractor setup** (`/financials/payments`, owner only): **Connect Stripe** opens Stripe's hosted onboarding. Each
  contractor book gets its **own** Stripe account. Built with controller properties equivalent to a Standard account:
  full Stripe Dashboard, the contractor pays Stripe's fees, Stripe carries payment losses, and Stripe collects the
  KYC requirements. A contractor who already uses Stripe can sign in to it.
- **Settings:** card on or off, bank (ACH) on or off (at least one must stay on), and who pays the card fee. "Customer
  pays" (a credit card surcharge) is ON (2026-11-21) with state-by-state enforcement: credit only, capped, banned
  states blocked, disclosed, 30-day notice. See [card-surcharge-rules.md](card-surcharge-rules.md). Kill switch:
  `CONNECT_CARD_SURCHARGE=off`.
- **Pay online link** on every issued invoice with a balance. This creates one secure link per invoice (only a SHA-256
  of the token is stored; a new link replaces the old one) and copies it to paste into an email or text.
- **Public pay page** `/pay/<token>`: invoice number, dates, total and amount due, then **Pay** opens Stripe Checkout.
- **The charge is a direct charge on the contractor's account.** Money goes customer → contractor's Stripe → the
  contractor's bank. It never touches Built2Bid's balance. **No application fee** (James, 2026-11-21).
- **Recording:** only the signature-verified Connect webhook records payments. A card payment is recorded right away.
  For ACH, the payment shows as "Bank payment clearing" until Stripe confirms the debit (3-5 business days); a failed
  debit is marked Failed. The payment is a verified `fin_payments` row (source `stripe`, method card/ach, reference =
  PaymentIntent), applied to the invoice up to its open balance. Any overpayment stays unapplied as a customer
  credit. Settling is idempotent per Checkout session, and webhook events are de-duplicated in `stripe_events`.
- **Refunds and disputes** made in Stripe flag the online payment ("Refunded in Stripe", "Disputed") and write an audit
  entry. The Payments page shows a "Needs attention" notice so the contractor records the refund in Financials.
- **Guards:** Practice books can't connect; Demo / Practice Mode blocks the Connect API; test keys on deployed copies
  are limited to test accounts; a test-mode account is never used by a live deploy (and the reverse); the live
  switch needs both `STRIPE_ALLOW_LIVE=true` and `CONNECT_PAYMENTS_LIVE=true`.

## Turning it on (James)

1. **Run the SQL** in the [Supabase SQL Editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new): paste
   `20270213001000_fin_connect_payments.sql` (copy in project files `connect-payments/run-connect-payments.sql`).
   Check: `select to_regclass('public.fin_online_payments');` returns `fin_online_payments`.
2. **Stripe → Connect settings** on the live account (Connect is already enabled):
   [Onboarding interface](https://dashboard.stripe.com/settings/connect/onboarding-interface): add the Built2Bid name,
   icon and brand color so contractors see Built2Bid on Stripe's onboarding page.
3. **Stripe → Webhooks → Add destination** ([link](https://dashboard.stripe.com/workbench/webhooks/create)):
   - Events from: **Connected accounts**
   - URL: `https://built2bid.org/api/stripe/connect-webhook`
   - Events: `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`
   - Copy its signing secret.
4. **Netlify → Environment variables** (Production): `STRIPE_CONNECT_WEBHOOK_SECRET` = that secret (mark it secret),
   and `CONNECT_PAYMENTS_LIVE=true`. Never paste the secret in chat.
5. **Deploy** (Trigger deploy, or the next merge to main).
6. **Test with your own company:** Financials → All tools → Online payments → Connect Stripe. Then issue a $1 invoice,
   click Pay online link, pay it by card, and check that the invoice shows Paid and a payment appears. Refund it from
   your Stripe Dashboard afterwards.

## Not in this change

- Bill pay / paying subs and vendors (outbound payments to people outside Stripe) needs Stripe Financial Accounts
  (Treasury) approval. It's a separate change.
- Card surcharging (locked; see above). Saved cards / autopay, payment plans, and consumer financing.
- Automatic refund recording (refunds are flagged; the contractor records them).
