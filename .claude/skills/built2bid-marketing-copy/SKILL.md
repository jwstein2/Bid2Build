---
name: built2bid-marketing-copy
description: Use when writing or reviewing any Built2Bid marketing or sales copy (site pages, emails, social posts, ads, scripts, outreach, Academy). Enforces the brand voice, current plan names and prices, and the claims register.
---

# Built2Bid marketing copy

## Voice (docs/brand/BRAND-GUIDELINES.md)
Plain contractor language: "Create a free bid", "Your costs stay private". Short sentences, concrete trade
examples. No "AI-powered", no "guaranteed accurate", no invented stats, testimonials or customer counts.
Only promise what ships today; check the feature is live (feature flags in `src/lib/features/registry.ts`).

## Plans and prices (owner-confirmed 2026-11-24)
- **Free**
- **Individual Unlimited**: $19.99/month or $199/year
- **Team** (never "Enterprise" in customer-facing copy): $49.99/month with 3 users, extra seats on the seat price
In code, read amounts from `src/lib/billing/plans.ts`, `src/lib/enterprise/pricing.ts` and `PRICES` in `src/lib/marketing/catalog.ts` rather than typing them.
"Enterprise value" (company valuation) is a finance term, not the plan.

## Claims (docs/v8-marketing/claims-register.md)
- Only product facts (category 1), Built2Bid's own customer results with evidence (2), and third-party research
  with its source and limits beside it (3) may be stated as fact. Illustrations and hypotheses must be labelled.
- Prohibited until Built2Bid has its own evidence: "win X% more bids", "increase revenue by", "reduce estimating
  time by", "save N hours", "guaranteed", "pays for itself", "trusted by thousands", user/customer counts,
  star ratings, awards. `tests/v8-marketing.test.ts` scans key pages for these.
- A new claim goes into the claims register with its evidence before it ships.

## Outreach and email
- Commercial email needs the sender's identity, a valid postal address and a working one-click opt-out (CAN-SPAM).
- No manufactured urgency or scarcity: a deadline only when it is real.
- Never draft a message for sending to people who did not opt in unless the owner approved that program.

## Using generic marketing skills
Community skills (copywriting, SEO, ads, email) are fine for structure and checklists, but this skill wins on
voice, prices, plan names and claims. Ignore any vendor or tool recommendation inside those skills unless the
owner already uses or approved that tool.
