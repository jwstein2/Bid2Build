# Product events

One table, `public.analytics_events` (service role only). Business events carry a stable `event_id`;
recording the same id twice stores it once (migration `20261117001000`). Server events are recorded
only where the transaction actually succeeded. Code: `src/lib/growth/events.ts`.

| Spec name | Stored as | Recorded when | event_id |
|---|---|---|---|
| landing_view | `landing_view` | (PR 2/3) | |
| signup_started | `signup_started` | (PR 3) | |
| CompleteRegistration | `account_created` | Auth callback or first signed-in sync | `account_created:<user>` |
| first_bid_started | `first_bid_started` | First successful cloud save of any estimate | `first_bid_started:<user>` |
| bid_created | `bid_created` | First save of an estimate with ≥ 3 meaningful items | `bid_created:<estimate>` |
| bid_activated | `bid_activated` | First qualifying action inside the 7-day window | `bid_activated:<user>` |
| proposal_previewed | `preview_opened` | Preview opened on a saved bid (browser → `/api/events`, ownership checked) | `preview_opened:<estimate>:<day>` |
| pdf_exported | `export_succeeded` | A new finalized version was generated | `export_succeeded:<version>` |
| (sent) | `proposal_sent` | Signing link created | `proposal_sent:<request>` |
| paid_subscription_started | `subscribed` | Stripe webhook (existing) | (PR 3) |
| subscription_renewed / _canceled | new names reserved | (PR 3, Stripe webhook) | |

Before the migration is applied, legacy names still record (without dedupe) and new names are skipped,
so nothing breaks if the code deploys first. No prices, customer names or addresses are stored in events.
