# Customer results framework

Goal: collect real, attributable outcomes so future marketing can use category-2 claims honestly.

## What to collect

| Signal | Source | Consent |
|---|---|---|
| Time to first bid (median, per trade) | Events: first `builder_started` → first `bid_activated` | Aggregate only |
| Bids sent and signed per active account per month | Existing tables (aggregate) | Aggregate only |
| Win rate before vs after (self-reported) | 3-question in-app survey after the 5th sent bid | Opt-in |
| Quotes (testimonials) | Short email or call after a signed bid | Written permission with the exact wording, name, trade, city; revocable |
| Case studies | 20-minute interview | Written permission; customer reviews the draft |

## Rules

1. Never edit a quote beyond trimming; keep the original.
2. Record date, plan, trade and whether the person got anything in return (discount, free month). Disclose incentives next to the quote.
3. Self-reported numbers are labelled as such ("Mike says his close rate went from…").
4. Aggregate stats need at least 30 accounts and the date range stated.
5. Store permissions with the quote (who, when, what wording, where it may appear). Remove on request within 7 days.
6. Review every published claim every 6 months; drop anything that no longer holds.

## First steps (Batch 4/5)

- Add the post-5th-bid survey (opt-in, no bid amounts).
- Founder emails the first 10 active accounts asking for a short call.
- Add a `customer_results` doc in project files listing each approved quote and its permission.
