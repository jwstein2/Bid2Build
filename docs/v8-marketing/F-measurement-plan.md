# F. Measurement plan

Batch 1 changes are judged with events that already exist, plus the Batch 2 additions. No bid amounts, names, emails or addresses are recorded.

| Change | Primary metric (existing events) | Guardrail | Read after |
|---|---|---|---|
| Hero + no visitor popup | `trade_selected` ÷ `landing_view` on `/`; `builder_started` ÷ `landing_view` | `signup_started` rate unchanged or better | 2–4 weeks or 500 home views |
| Header Upgrade gate | `checkout_started` per free account per week | Subscriptions per 100 free accounts not lower | 4 weeks |
| What's New labels | PCC add-on starts from billing; support emails about wrong plan | – | 4 weeks |
| About/trust | `/about` views; signup rate for sessions that saw `/about` (needs `page_type`, Batch 2) | – | after Batch 2 |

## Batch 2 events (needs a migration; SQL will be provided as a file)

`pricing_viewed`, `cta_clicked {cta, page_type}` (the hero now sends `data-cta="sample"`), `credits_low`, `upgrade_offer_shown/clicked/dismissed {offer_id}`, `enterprise_interest {source}`, `onboarding_completed/dismissed`, `session_started` (one per user per day), and `page_type` on `landing_view`. Add time-to-first-bid (first `builder_started` → first `bid_activated`, median) so "in minutes" can be tested as a claim.

## Consent

GA4 currently loads before consent (V7 TRU-2). Batch 2 proposal: keep GA for aggregate measurement but disclose it in the privacy page and the consent banner, or gate it behind the same banner as Meta. Owner decision.

## Low-traffic rule

With today's traffic, A/B tests will not reach significance. Use before/after windows of equal length, report raw counts with the rate, and do not call a result until each arm has at least 100 conversions-of-interest or 4 weeks pass.
