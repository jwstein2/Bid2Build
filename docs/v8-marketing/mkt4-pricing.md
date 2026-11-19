# V8 MKT-4: three-card pricing

Date 2026-11-18. No SQL, no new environment variables, no new dependencies. Stripe prices, plan ids and checkout unchanged.

| Change | Detail |
|---|---|
| Three cards | Free · Unlimited · Enterprise (was Free · Unlimited Monthly · Unlimited Annual, with Enterprise only further down). |
| Unlimited switch | Monthly / Annual switch on one card. Each side keeps its exact billing copy and its own button ("Choose Monthly" / "Choose Annual"). Opens on the plan in the URL (?plan, ?resume, ?upgrade), then the person's current plan, then Annual. |
| Dollar savings | "Save $40.88 a year" badge computed from the approved prices, beside the unchanged "Equivalent to $16.58/month. Save approximately 17%…" line. |
| Add-on row | Project Command Center price shown inside the Unlimited card with a link to its full section (still on the page). |
| Enterprise card | $49.99/month for 3 users, short list, "See Enterprise" jumps to the full Enterprise card (seat estimate + checkout, unchanged). Company owners/members see their own wording. |
| Plan helper | Three questions (bids a month, who signs in, scheduling) → one suggestion with a link to that card. Never starts checkout, stores nothing. Logic in `src/lib/marketing/plan-helper.ts`. |

Unchanged: page title ("Pricing: Free, then $19.99/month"), FAQ text including the refund wording, comparison table, Project Command Center and Enterprise sections. No popularity or savings claims beyond the computed price difference.

## Results (mock backend)
- Checkout e2e 20/20 (updated: Monthly is one tap on the switch). Marketing v4.7 walk 319/321 (the two known mock-only Academy 404s), axe clean, no overflow at 320/390/1280.
- Vitest 1,722 passed (5 new in `tests/v8-plan-helper.test.ts`). Type check and lint pass.
- Screenshots: `/mnt/project-files/marketing-audit-v8/screenshots/mkt4/`.
