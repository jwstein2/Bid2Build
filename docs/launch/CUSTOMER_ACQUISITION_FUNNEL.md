# Customer acquisition funnel

Prospect → Outreach → Reply → Website visit → Signup → First estimate → First proposal → Upgrade →
Paid customer → Retention → Referral.

## Identity: one person, one lead

* Key: normalized email (`lower(trim(email))`) in `public.leads.email_norm`, unique.
* A prospect created by an Instantly event and the account created later with the same email are the
  same row: `leads.user_id` is filled in the first time that person loads the signed-in app.
* Stripe customers map to users through `billing_customers` (existing) and `metadata.user_id`.
* Instantly knows the person by email; we never put an email in a URL. Website visits are tied to a
  campaign by UTM parameters / `ic=<campaign id>`, captured into a first-party cookie and attached at signup.

## Stage by stage

| Stage | Signal | Where recorded | Status |
|---|---|---|---|
| Prospect | Imported into an Instantly campaign (operator action) | Instantly; our lead row appears on first webhook | BLOCKED (no workspace) |
| Outreach | `email_sent` webhook | `lead_events`, stage `contacted` | Built, untested |
| Engagement | `email_opened`, `email_link_clicked` | stage `engaged` | Built, untested |
| Reply | `reply_received`, `lead_interested`, meetings | stage `replied` / `interested`; reply handled by a human in Instantly Unibox | Built, untested |
| Website visit | UTM landing | `b2b_attr` cookie (90 days, first touch) | Built, tested locally |
| Signup | first signed-in page load | lead linked, stage `signed_up`, `analytics_events.account_created` | Built, needs migration |
| First estimate | saved estimate | `estimates` | Existing data |
| First proposal (activation) | first finalized version | `estimate_versions`; counted by `growth_funnel()` | Existing data |
| Upgrade prompt | quota/credit reached; pricing page | existing upgrade dialog | READY (current model) |
| Paid customer | `checkout.session.completed` | `subscriptions`, lead `paid`, **suppressed + Instantly block list** | Built, needs Stripe |
| Retention | renewals `invoice.paid`; cancel `customer.subscription.deleted` | `subscriptions`; lead `churned` | Built, needs Stripe |
| Referral | — | — | NOT IMPLEMENTED (proposal below) |

## Rules that prevent bad automation

1. **Customers leave prospecting** the moment they pay (suppressed + block list). Signed-up but unpaid users should also be removed from cold campaigns: Instantly campaign setting "stop on reply", plus remove any lead whose stage is `signed_up` or later from active campaigns (manual step until a sync job is added).
2. **Opt-out is global**: Instantly unsubscribe → suppressed, block-listed, and the app's own `marketing_opt_in` cleared.
3. **Transactional ≠ marketing**: sign-in, receipts and billing notices always send; onboarding tips and upgrade nudges only if `profiles.marketing_opt_in` is true (signup offers an opt-in checkbox today).
4. **One sequence at a time per person**, at most one promotional email per week, none after cancellation except a single win-back.
5. **No duplicate events**: Stripe events dedupe on event id (`stripe_events`), Instantly events on a payload hash (`lead_events.dedupe_key`).

## Lifecycle email (NOT IMPLEMENTED: needs an email provider decision)

The app sends no email itself today. Recommended minimal set, all from `hello@built2bid.org` with an unsubscribe link for the marketing ones:

| Email | Trigger | Type |
|---|---|---|
| Welcome + "build your first bid in 10 minutes" | signup | transactional (one-time) |
| "Finish your first proposal" | signup + 2 days, no finalized version | marketing (opt-in) |
| "Your first proposal is out: here's what Unlimited adds" | first finalized version | marketing (opt-in) |
| Credits running low / used up | last free credit used | transactional (account state) |
| Abandoned checkout | Stripe Checkout session expired (enable `after_expiration.recovery`) | marketing, needs promotional consent at checkout |
| Payment failed | `invoice.payment_failed` | Stripe's built-in customer emails (enable in Stripe) |
| Win-back | 30 days after cancel, once | marketing (opt-in) |

Provider options: Resend (simple API, generous free tier), Postmark (transactional focus), or MailerLite (a MailerLite connector is available to this project for marketing sequences). Recommendation: Resend for transactional + a single MailerLite automation for opt-in nurture; decide before building.

## Referral (proposal, not built)

Give each paying customer a link `https://built2bid.org/?ref=<code>`; the attribution cookie already captures `ref`. Reward via a Stripe coupon (e.g. one free month for the referrer when the referred account pays). Requires a `referral_codes` table and a coupon in Stripe.

## Internal sales dashboard

`/admin/sales` (admins only), ranges 30/90/365 days: leads, new leads, suppressed, signups, first-bid
activations (and % of signups), paying customers monthly/annual (and % of signups), run-rate MRR at list
price (clearly labeled an estimate; Stripe is the revenue source of truth), cancellations, recorded
marketing spend, cost per signup (only when spend rows exist), campaign table, leads by stage.
**No ROI is shown** until real costs and collected revenue exist.

To record spend (SQL Editor, admin only):
`insert into public.marketing_costs (period_start, channel, campaign_id, amount_usd, note) values ('2026-12-01', 'instantly', '<campaign id>', 97.00, 'Instantly plan');`
