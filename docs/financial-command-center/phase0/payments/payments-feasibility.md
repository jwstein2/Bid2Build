# Financial Command Center: Payments and Bank Data Feasibility (Phase 0)

Owner: Agent 3 (Payments and Application Integration)
Date: 2026-11-17
Status: Research and planning only. No code, repo edits, or Stripe objects were created.

## How to read this document

- **Verified** means the fact was read from an official source in this session (docs.stripe.com through the Stripe documentation tool, platform.claude.com, supabase.com docs through the Supabase docs tool).
- **Secondary** means stripe.com/pricing, plaid.com and intuit.com could not be fetched from this session (their hosts are outside the session's network allowlist). Those figures come from search-result snippets of the official pricing pages or from third-party summaries. **Confirm them on the official page before anyone relies on them.** Each one is marked.
- Nothing here is legal, tax or accounting advice. The items in the approval-gates list need sign-off from the owner, and from counsel or a CPA where noted.

---

## 1. Summary

| Decision | Recommendation |
|---|---|
| Connect model | **Accounts v2 connected accounts with Stripe-owned pricing**: `defaults.responsibilities.fees_collector = stripe`, `losses_collector = stripe` (Managed Risk), and `dashboard = full`. The contractor is the merchant of record. |
| Charge type | **Direct charges** on the contractor's connected account. Do not use destination charges or separate charges and transfers. With direct charges, homeowner money never lands in a Built2Bid balance. |
| Platform account | **A separate Stripe account for the Connect platform** (for example "Built2Bid Payments"), under the same Stripe organization. It gets its own API keys, its own restricted keys and its own Connect webhook endpoint and secret. The existing SaaS billing account is left untouched. |
| Platform fee | **No application fee at launch.** Monetize through the Financial add-on subscription. Revisit a small application fee (for example 0.25 to 0.5%) once volume is known. |
| Payment methods | ACH Direct Debit (US bank account) is the default for large invoices. Cards and Link are offered as options. Instant Bank Payments is an optional later step. |
| Bank data (Phase 2) | **Manual CSV, OFX and QFX import first**, with a reconciliation UI. Evaluate Stripe Financial Connections versus Plaid only after import usage proves demand. |
| PCI | Stripe Checkout or Payment Element only, which keeps Built2Bid in the SAQ A scope. Card numbers and bank credentials are never stored. |

---

## 2. Context from the repository (read-only inspection)

- The existing Stripe integration is **SaaS billing only**. The pieces are `src/lib/billing/*`, `src/app/api/stripe/{checkout,enterprise-checkout,portal,webhook}` and a single webhook secret (`STRIPE_WEBHOOK_SECRET`) used by `/api/stripe/webhook`.
- `src/lib/billing/stripe.ts` creates one client from `STRIPE_SECRET_KEY` and has a live-mode gate (`STRIPE_ALLOW_LIVE`). Connect must **not** reuse this client, key or webhook route. See section 13.
- Webhook handling is already idempotent. It records each event ID in `stripe_events` and skips event IDs that are already processed. It also checks signatures with `constructEvent`. The Connect handler should copy this pattern into a **separate table** (for example `stripe_connect_events`) and a **separate route** (for example `/api/stripe/connect/webhook`).

---

## 3. Connected account configuration

### 3.1 Legacy account types compared with the current model

Stripe now steers new platforms to **Accounts v2** (or v1 with controller properties) instead of the legacy `type` values. The legacy types map to responsibilities as follows. Source: [Migrate to controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties) (Verified).

| Legacy type | `losses.payments` | `fees.payer` | `requirement_collection` | Dashboard | Liability for fraud and disputes |
|---|---|---|---|---|---|
| Standard | stripe | account | stripe | full | Connected account for direct charges |
| Express | application | application_express | stripe | express | Platform |
| Custom | application | application_custom | application | none | Platform; platform also does KYC and support |

Accounts v2 expresses the same choices as `defaults.responsibilities.fees_collector`, `defaults.responsibilities.losses_collector` and `dashboard`. These values **cannot be changed after creation**. Source: [Configure connected accounts (v2)](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration) (Verified).

- KYC is Stripe's job unless `losses_collector = application` **and** `dashboard = none`. Built2Bid should never take on KYC.
- `losses_collector = application` requires `fees_collector = application`, which is the buy-rate model in which the platform carries negative balances.
- As of the 2026-06-24 API version, Express accounts can also use Stripe-owned pricing and Stripe loss liability. Source: [changelog](https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v2-stripe-owned-pricing-negative-balance-liability) (Verified). This means `dashboard = express` is a valid alternative if a lighter dashboard is preferred.

### 3.2 Recommended configuration

```
Accounts v2:
  dashboard: full                        (alternative: express)
  identity.country: US
  defaults.responsibilities.fees_collector: stripe
  defaults.responsibilities.losses_collector: stripe   (Managed Risk)
  configuration.merchant.capabilities: card_payments, us_bank_account (ACH), link
```

**Why this configuration**

1. **Legal and operational responsibility.** The contractor is the merchant of record: their customer, their contract and their sales tax. In the SaaS model, Stripe describes connected accounts as the MoR responsible for goods and services ([SaaS platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces), Verified). Built2Bid stays a software provider, not a payment facilitator or a party to the contractor–homeowner contract.
2. **Disputes.** Disputes on direct charges live on the connected account. The contractor responds to them, and the dispute fee is debited from the contractor's balance.
3. **Negative balances.** With `losses_collector = stripe`, Stripe absorbs unrecoverable negative balances. Under the buy-rate or Express-legacy models, Built2Bid would carry that liability. For a small SaaS company that is an unacceptable tail risk. One contractor's chargebacks on a $40k kitchen job could exceed a year of add-on revenue.
4. **Who pays fees.** Stripe charges the contractor its standard rates directly. In this model, Stripe says the platform "doesn't pay any Connect-related fees as long as Stripe sets payment pricing and directly charges fees to connected accounts" ([SaaS platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces), Verified). The model is also eligible for Stripe revenue share ([Build a SaaS platform](https://docs.stripe.com/connect/saas), Verified).
5. **Full Dashboard.** The contractor manages refunds, disputes, payouts, tax forms and bank changes in Stripe's own Dashboard. That cuts Built2Bid's support load and the surface of features it must build. Connect embedded components can still show payments, payouts and notification banners inside Built2Bid.

**Trade-offs we accept:** Built2Bid cannot use the platform pricing tool or mark up processing (it does not apply to direct charges on Standard-like accounts; see [Platform pricing tool](https://docs.stripe.com/connect/platform-pricing-tools), Verified). Contractors also see Stripe branding. Both are acceptable for a "payments are the contractor's" positioning.

---

## 4. Charge types

| Type | Where the charge lives | MoR | Disputes and refunds | Platform Connect fees | Fit |
|---|---|---|---|---|---|
| **Direct charges** | Connected account | Contractor | Contractor's balance | None under Stripe-owned pricing | **Recommended** |
| Destination charges | Platform account, then transferred | Platform (unless `on_behalf_of`) | Platform balance; platform liable | Platform pays processing and Connect fees | No. Money passes through a Built2Bid balance |
| Separate charges and transfers | Platform account | Platform | Platform | Platform pays | No. Same problem, and more reconciliation work |

Destination charges and separate charges and transfers both create the payment on the platform account. Stripe also notes that their events arrive in the platform's own scope ([Connect webhooks v2](https://docs.stripe.com/connect/webhooks?accounts-namespace=v2), Verified). That conflicts directly with the owner's rule that contractor customer payments never go through the SaaS merchant account. Direct charges are the only option that meets the rule by design.

---

## 5. Onboarding and KYC

- Use **Stripe-hosted onboarding** (Account Links) or **embedded onboarding**. Stripe collects identity, business, tax ID (EIN or SSN), bank account and beneficial-owner details. Built2Bid stores only the `acct_…` ID, onboarding status, `charges_enabled`, `payouts_enabled` and outstanding requirements.
- Requirements change over time. Listen for `account.updated` (v1) and `v2.core.account[requirements].updated` (v2). Show a "Stripe needs more information" banner using the embedded Notification Banner component.
- **Gate the feature in the UI:** a contractor can send an invoice with a "Pay online" link only when `charges_enabled` is true.
- One connected account per Built2Bid **company** (or per solo account). Only the company owner or an admin with a "Payments admin" permission can start onboarding.
- Managed Risk has its own onboarding requirements. Review them before building: [Managed Risk accounts](https://docs.stripe.com/connect/risk-management/connected-accounts-with-managed-risk) (Verified).

---

## 6. Payment methods and fees (contractor pays; US)

| Method | Fee to contractor (Stripe standard) | Settlement and notes |
|---|---|---|
| Card (online, domestic) | 2.9% + 30¢ per successful charge (Secondary: stripe.com/pricing) | International cards and currency conversion cost extra (see stripe.com/pricing) |
| ACH Direct Debit | **0.8%, capped at $5.00** (Secondary: snippet of stripe.com/us/pricing) | Delayed notification. **T+4 standard settlement, T+2 faster settlement for eligible accounts** ([ACH Direct Debit](https://docs.stripe.com/payments/ach-direct-debit), Verified). Failed-debit and ACH dispute fees apply (third-party reports say about $4 failed and $15 disputed; **unverified**) |
| Link (saved card or bank through Stripe) | Link card payments are charged at the card rate (Secondary) | Faster checkout. No extra integration with the Payment Element |
| Instant Bank Payments (bank through Link) | See stripe.com/pricing (not verified this session) | Instant confirmation, and Stripe guarantees bank-initiated returns ([ACH comparison](https://docs.stripe.com/payments/ach-direct-debit), Verified) |

**Why ACH should be the default for construction invoices.** On a $25,000 progress payment, card fees are about $725 (2.9% + 30¢). ACH is capped at $5 (Secondary pricing). Contractors already push homeowners toward checks and ACH for this reason.

**ACH constraints to design for:**
- Consumer ACH debits can be disputed for up to **60 calendar days**, and business accounts for up to **2 business days**. Source: [ACH accept a payment, disputes](https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment?payment-ui=elements&api-integration=checkout) (Verified).
- Payments can fail after showing `succeeded`. In that case Stripe creates a dispute with reasons such as `insufficient_funds` and charges a failure fee (same source).
- A mandate (customer authorization) and bank verification are required. Financial Connections instant verification or microdeposits handle this.
- Stripe may apply per-transaction or volume limits to new accounts. **Confirm current ACH limits** in the Dashboard or with Stripe before promising large single payments. No limit figure was verified in this session.

**Card surcharges and convenience fees:** do not build these in Phase 3 without legal review. State laws and card-network rules apply, and pricing compliance would shift to Built2Bid's product.

---

## 7. Refunds

- With direct charges, refunds are created on the connected account (Stripe-Account header). Funds come from the contractor's balance. If the balance is short, Stripe debits the contractor's bank account.
- Stripe does not return the processing fee on refunds (Secondary: stripe.com/pricing; confirm). Show a warning before issuing a refund.
- ACH refunds take several business days. Track them with `charge.refunded` and `refund.failed`.
- A Built2Bid refund records the reversal on the invoice and in job costing, and never moves money itself.

## 8. Disputes and chargebacks

- Cards: the dispute amount and a **dispute fee** are debited from the contractor's balance when the dispute opens. Outside Mexico, the "dispute received" fee is **not refundable**. If the merchant counters, a **"dispute countered" fee** applies on top, and **Stripe returns it if the dispute is won**. Source: [How disputes work](https://docs.stripe.com/disputes/how-disputes-work) (Verified). The US amount of each fee is $15 per stripe.com/pricing snippets (Secondary).
- Response windows are usually 7 to 21 days. The full lifecycle takes 2 to 3 months (same source).
- **Built2Bid's role:** show dispute status on the invoice. Provide an **evidence pack export**: signed proposal or contract (Built2Bid already has e-sign), change orders, photos, schedule and communication log. This is a real differentiator for contractors. The contractor submits evidence in their Stripe Dashboard, or Built2Bid can do it through the API later.
- Smart Disputes fee passthrough only matters when the platform pays dispute fees. Under the recommended model it does not ([Smart Disputes passthrough](https://docs.stripe.com/connect/smart-disputes-fee-passthrough), Verified).

## 9. Payouts and payout reconciliation

- Payouts go from the contractor's Stripe balance to the contractor's bank account on Stripe's schedule. Built2Bid never initiates or holds payouts.
- **Reconciliation design (Phase 3):**
  1. Put `metadata: { b2b_company_id, b2b_invoice_id, b2b_payment_id }` on every PaymentIntent.
  2. On `payout.paid`, list balance transactions for that payout: `GET /v1/balance_transactions?payout=po_…` with header `Stripe-Account: acct_…`.
  3. Each balance transaction carries `type` (charge, refund, adjustment, stripe_fee and so on), `amount`, `fee`, `fee_details` and `net`. Map charges back through `source`, then PaymentIntent metadata, to the invoice.
  4. Post one **deposit** record per payout: gross receipts, minus Stripe fees, minus refunds and disputes, equals the net bank deposit. In the later GL, that is a clearing-account entry. The payout amount should then match the bank import line from Phase 2, which closes the loop.
- `payout.failed` (connected-account scope) alerts the contractor to fix their bank details.
- Instant Payouts are optional, cost extra (see stripe.com/pricing) and are set up in Stripe. Not in scope.

## 10. Application fees and platform monetization options

| Option | How it works | Recommendation |
|---|---|---|
| A. Subscription only | The Financial add-on price covers payments features. No per-transaction fee | **Launch default.** Simple and honest ("Stripe's standard rates, no Built2Bid markup") |
| B. Small `application_fee_amount` on direct charges | The fee is netted from each charge into the platform balance. Under `fees_collector = stripe`, set it to **only Built2Bid's fee**, because Stripe deducts its own fee separately ([App fees](https://docs.stripe.com/connect/saas/tasks/app-fees), Verified). Stripe charges nothing extra on the application fee itself (same source) | Revisit after 6 months of volume data, for example 0.25% capped |
| C. Buy-rate (platform pays Stripe, marks up) | Requires `fees_collector = application`, and with it platform loss liability | **Reject.** It brings loss liability, Connect fees and pricing operations |

If Built2Bid ever controlled pricing, Connect would cost **$2 per monthly active account plus 0.25% + 25¢ per payout** (Secondary: stripe.com/connect/pricing snippets, US). **None of that applies under Stripe-owned pricing.**

## 11. Statement descriptors and receipts

- Direct charges show the **contractor's** statement descriptor, which is set during onboarding. Use `statement_descriptor_suffix` for a short invoice reference (for example `INV1042`), within Stripe's length limits. A recognizable descriptor reduces "I don't recognize this" disputes.
- Receipts: let Stripe email receipts from the connected account's settings, or send a Built2Bid-branded "Payment received" email with the contractor's branding. Do one or the other, not both, to avoid confusing duplicates. The canonical record is the Built2Bid invoice showing paid, partially paid or refunded.

## 12. Webhooks

- **A separate endpoint, secret and table**: `/api/stripe/connect/webhook`, `STRIPE_CONNECT_WEBHOOK_SECRET` and `stripe_connect_events`. It is registered on the **Connect platform account** with "Events from: Connected accounts" (`connect=true`). Source: [Connect webhooks v2](https://docs.stripe.com/connect/webhooks?accounts-namespace=v2) (Verified).
- For direct charges, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` and `payout.failed` all arrive with **connected-account scope**, and each event carries `event.account` (same source).
- v2 account events (`v2.core.account*`) arrive with **your-account scope** as thin events. This calls for a second event destination with its own `whsec_` secret.
- **Verification:** check the signature with the raw body, the `Stripe-Signature` header and the endpoint secret. Return 2xx fast and process work from a queue. Stripe may deliver duplicates, so dedupe on event ID ([Manage webhook endpoints](https://docs.stripe.com/events/manage-webhook-endpoints), Verified). Roll secrets periodically. Stripe supports a delayed expiry of up to 7 days for this.
- **Idempotency:** every write to Stripe (PaymentIntent create, refund) uses an `Idempotency-Key` derived from the Built2Bid payment-attempt ID, the same pattern already used in `pm-addon/route.ts`.
- **Tenant safety:** before touching data, resolve `event.account` to exactly one Built2Bid company through a `connected_accounts` table with a unique index. Reject unknown accounts.
- Check `livemode`. Production Connect endpoints receive both live and test events (same source).

## 13. Security and compliance

| Area | Control |
|---|---|
| PCI DSS scope | Use **Stripe Checkout** (hosted) or the **Payment Element** (Stripe-hosted iframes). Card data never touches Built2Bid servers, so the expected self-assessment is **SAQ A**. Confirm annually through Stripe's PCI wizard. Never log request bodies from payment pages. |
| Bank credentials | Bank login happens inside Stripe (Financial Connections) or Plaid Link. Built2Bid never sees credentials and stores only tokens and IDs plus the last 4 digits for display. |
| Key separation | A separate Stripe account for Connect. Separate env vars: `STRIPE_CONNECT_SECRET_KEY` (preferably a **restricted key** with only the needed permissions) and `STRIPE_CONNECT_WEBHOOK_SECRET`. Keep a separate `getConnectStripe()` client. Add a CI check that SaaS billing code never imports the Connect client and vice versa. |
| Secret management | Keep secrets in Netlify environment variables scoped to Production and Deploy Preview separately, and give previews **test keys only**. Rotate on staff change. Never expose keys to the browser. Only `NEXT_PUBLIC_STRIPE_CONNECT_PUBLISHABLE_KEY` is public. |
| Live-mode gate | Mirror `assertModeAllowed()` with a `STRIPE_CONNECT_ALLOW_LIVE` flag. This is owner approval gate G6. |
| Webhook verification | Signature check, dedupe and tenant resolution (section 12). Optionally allowlist Stripe webhook IPs at the edge. |
| Authorization | RLS on `connected_accounts`, `payments`, `payouts` and `deposits` by company. Only Payments-admin members can onboard, refund or export. Write audit-log rows for every refund, payout view and bank-detail change. |
| Data minimization | Store Stripe IDs, amounts and statuses only. No full bank or card numbers. Homeowner PII stays minimal: name, email, billing address if needed for tax. |
| Records and retention | Financial records should be kept read-only for years. The IRS generally advises keeping records 3 to 7 years depending on the situation ([IRS: How long should I keep records](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records)). Supabase backups do **not** include Storage objects, so receipts and attachments need their own off-site backup ([Supabase backups](https://supabase.com/docs/guides/platform/backups), Verified). |
| Money transmission | Direct charges with Stripe as processor mean Built2Bid never holds or moves funds. That is the basis for avoiding money-transmitter questions. Counsel should confirm (gate G2). |

## 14. Regional scope

- US only at launch: US platform account and US contractors (`identity.country = US`), USD, US homeowners. Canada (ACSS debit) and other countries are out of scope.
- Express and Custom accounts cost extra and are not needed. Stripe notes "an additional cost for using Express or Custom" in legacy types ([Account types](https://docs.stripe.com/connect/accounts), Verified).
- Sales tax on the contractor's invoices is the contractor's responsibility. Built2Bid provides tax-line fields but does not calculate tax with Stripe Tax for contractors in Phase 3.

## 15. Alternatives compared

| Option | Contractor cost (public, unverified this session) | Pros | Cons |
|---|---|---|---|
| **Stripe Connect, direct charges (recommended)** | 2.9% + 30¢ card; ACH 0.8%, $5 cap (Secondary) | Embedded in Built2Bid; invoice status updates automatically; reconciliation through balance transactions; no platform liability | Build effort (about 3 to 5 weeks); KYC friction for contractors |
| Contractor's own Stripe Payment Links | Same Stripe rates | Zero build; contractor already owns it | No automatic matching to invoices unless we add OAuth and webhooks; manual "mark paid" |
| QuickBooks Payments | About 2.99% invoice card; ACH about 1%, capped near $10 (third-party sources) | Familiar to contractors who use QBO | Ties payments to Intuit; no Built2Bid revenue share; matching requires QBO integration |
| Square Invoices | About 3.3% + 30¢ card (Free plan); ACH 1% with a $1 minimum and a $10 cap on paid plans (third-party) | Simple; in-person readers | Higher card rate; separate ecosystem |
| ACH-focused providers (for example Plaid Transfer, Dwolla, Modern Treasury) | Usually contract pricing | Lower per-transaction cost at volume | Built2Bid takes on more compliance and ops; return handling; usually minimums |

**Conclusion:** Stripe Connect direct charges is the best fit. It matches the existing Stripe stack and keeps liability with Stripe and the contractor. Ship "record a manual payment" (check, cash, external ACH, Zelle) in **Phase 1**, so the invoice and payments model exists before Connect arrives.

## 16. Bank data: Financial Connections, Plaid or manual import

| Option | Cost | Compliance and operations | Fit |
|---|---|---|---|
| **Manual CSV, OFX or QFX upload** | Storage only (fractions of a cent) | No data-sharing agreements; the user downloads from their own bank. Files can contain account numbers, so mask or store only the last 4 digits and encrypt at rest | **Phase 2 default** |
| Stripe Financial Connections | Usage-based. Secondary figures: balances about $0.10 per call, ownership about $1.50 per call, transactions possibly about $0.30 per account per month. **Unverified; check stripe.com/pricing** | One vendor (Stripe). The account holder authorizes in a Stripe modal. Good for verifying ACH and for transaction refresh on linked accounts | Phase 2b candidate if the contractor already has a Connect account |
| Plaid (Transactions) | Pay as you go, not fully public. A third party cites about $0.25 per account per month, possibly with minimums (**unverified**) | Production access review and security questionnaire; broadest bank coverage; separate vendor DPA | Phase 2b alternative; get a quote |

**Recommended Phase 2 approach**

1. Build import parsers for CSV (with a column-mapping UI and saved bank presets), **OFX 1.x/2.x** and **QFX** (Intuit's OFX variant). Dedupe on FITID (OFX) or on a hash of date, amount and description (CSV).
2. Add matching rules: payout to deposit (from Connect, section 9), bills to vendor payments, invoices to customer receipts. Add manual matching and "mark reconciled" with audit log entries.
3. Only after at least 25 companies use import monthly, run a paid pilot of Financial Connections or Plaid. Pass the cost through ("Bank feeds +$X per connected account") instead of absorbing it.

**Compliance notes:** aggregated bank data is sensitive financial data. It needs RLS by company, encryption at rest (Supabase default), no credentials stored, retention and deletion on cancellation per policy, and vendor DPAs. Watch US open-banking rulemaking (CFPB Personal Financial Data Rights, 12 CFR part 1033). Its status and scope should be checked by counsel before live feeds launch. Business accounts may be treated differently from consumer accounts.

## 17. Phased delivery

| Phase | Payments scope |
|---|---|
| 1 | Invoices; **manual payment recording** (check, cash, ACH outside the platform, Zelle); partial payments, deposits and retainage fields; receipts via Haiku extraction. No Stripe Connect. |
| 2 | Bank CSV, OFX and QFX import with reconciliation; vendor bills. |
| 3 | Stripe Connect (direct charges, Stripe-owned pricing); "Pay online" on invoices (ACH default, card optional); payout reconciliation; dispute evidence export. |
| 4 | Optional bank feeds (Financial Connections or Plaid), double-entry GL postings from payouts, optional application fee. |

## 18. Approval gates (nothing proceeds without explicit owner sign-off)

- **G1** Create a **separate Stripe account** for the Connect platform under the Stripe organization, and complete the Connect platform profile (SaaS, Stripe-owned pricing, Managed Risk).
- **G2** Counsel review: Built2Bid's role (software only, not MoR, not money transmitter), a platform agreement addendum, payment terms shown to homeowners, privacy policy updates for payment and bank data, and card surcharge policy (default: none).
- **G3** CPA or accounting review of invoice, deposit, retainage and payout-reconciliation logic before any "reconciled" or GL wording ships.
- **G4** Approve the account configuration (`fees_collector=stripe`, `losses_collector=stripe`, `dashboard=full` or `express`). It is **irreversible per account**.
- **G5** Approve platform monetization (no application fee at launch; any later fee needs separate approval and customer notice).
- **G6** Live mode for Connect (`STRIPE_CONNECT_ALLOW_LIVE=true`) only after test-mode end-to-end runs: onboarding, card, ACH success, ACH failure, refund, dispute and payout reconciliation.
- **G7** Security review: key separation, restricted key permissions, webhook verification, RLS tests, and secrets in Netlify scoped by context.
- **G8** Bank-data vendor (Phase 2b): a signed vendor DPA, confirmed pricing, and a pass-through price for customers.
- **G9** Data retention and cancellation policy for financial records and receipts, published before launch.
- **G10** Confirm all "Secondary" prices in this document against stripe.com, plaid.com and intuit.com.

## Sources

Stripe documentation (Verified via the Stripe docs tool):
- https://docs.stripe.com/connect/saas
- https://docs.stripe.com/connect/saas-platforms-and-marketplaces
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- https://docs.stripe.com/connect/migrate-to-controller-properties
- https://docs.stripe.com/connect/accounts
- https://docs.stripe.com/connect/risk-management/connected-accounts-with-managed-risk
- https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v2-stripe-owned-pricing-negative-balance-liability
- https://docs.stripe.com/connect/platform-pricing-tools
- https://docs.stripe.com/connect/saas/tasks/app-fees
- https://docs.stripe.com/connect/webhooks?accounts-namespace=v2
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/events/manage-webhook-endpoints
- https://docs.stripe.com/payments/ach-direct-debit
- https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment
- https://docs.stripe.com/invoicing/ach-direct-debit
- https://docs.stripe.com/disputes/how-disputes-work
- https://docs.stripe.com/connect/smart-disputes-fee-passthrough

Pricing pages (Secondary; not reachable from this session, so confirm):
- https://stripe.com/pricing and https://stripe.com/us/pricing
- https://stripe.com/connect/pricing
- https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes
- https://plaid.com/pricing/
- Third-party summaries used only as directional: checkoutpage.com/blog/stripe-processing-fees, paymentcloudinc.com/blog/stripe-fees, activepieces.com/blog/plaid-pricing-2026-cost-per-connection-and-request, fitsmallbusiness.com/quickbooks-payments-review, webgility.com/blog/square-fees

Other:
- https://supabase.com/docs/guides/platform/backups (Verified via the Supabase docs tool)
- https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records
