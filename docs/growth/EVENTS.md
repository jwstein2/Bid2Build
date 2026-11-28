# Product events

One table, `public.analytics_events` (service role only). Business events carry a stable `event_id`;
recording the same id twice stores it once (migration `20261117001000`). Server events are recorded
only where the transaction actually succeeded. Code: `src/lib/growth/events.ts`.

| Spec name | Stored as | Recorded when | event_id |
|---|---|---|---|
| landing_view | browser only (GA4 `landing_view`, Pixel `ViewContent`) | `/bids/<trade>` view, once per session | |
| signup_started | browser only (GA4 `signup_started`, Pixel `Lead`) | Sign-in code sent | |
| CompleteRegistration | `account_created` | Auth callback or first signed-in sync | `account_created:<user>` |
| first_bid_started | `first_bid_started` | First successful cloud save of any estimate | `first_bid_started:<user>` |
| bid_created | `bid_created` | First save of an estimate with ≥ 3 meaningful items | `bid_created:<estimate>` |
| bid_activated | `bid_activated` | First qualifying action inside the 7-day window | `bid_activated:<user>` |
| proposal_previewed | `preview_opened` | Preview opened on a saved bid (browser → `/api/events`, ownership checked) | `preview_opened:<estimate>:<day>` |
| pdf_exported | `export_succeeded` | A new finalized version was generated | `export_succeeded:<version>` |
| (sent) | `proposal_sent` | Signing link created | `proposal_sent:<request>` |
| paid_subscription_started | `subscribed` | Stripe `checkout.session.completed` (complimentary access never counts) | `subscribed:<subscription>` |
| subscription_renewed | `subscription_renewed` | Stripe `invoice.paid` with billing_reason `subscription_cycle` and amount > 0 | `subscription_renewed:<invoice>` |
| subscription_canceled | `subscription_canceled` | Stripe `customer.subscription.deleted` | `subscription_canceled:<subscription>` |
| (cancel scheduled) | `subscription_cancel_scheduled` | Stripe `customer.subscription.updated` with cancel at period end (Growth OS Phase 3) | `subscription_cancel_scheduled:<subscription>:<cancel_at>` |

Before the migration is applied, legacy names still record (without dedupe) and new names are skipped,
so nothing breaks if the code deploys first. No prices, customer names or addresses are stored in events.

## Ad platforms (PR 3, all off by default)

| Product event | Meta (server CAPI + browser Pixel, same event_id) | GA4 (browser) |
|---|---|---|
| account_created | CompleteRegistration | `sign_up` |
| bid_activated | ActivatedContractor (custom) | (server only for now) |
| subscribed | Subscribe (+ plan list value, USD) | (not sent: see setup) |
| preview_opened / export_succeeded | not sent | `proposal_previewed` / `pdf_exported` |

Details, consent and owner steps: [META_GA4_SETUP.md](META_GA4_SETUP.md).
