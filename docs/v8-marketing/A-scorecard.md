# A. V8 scorecard

Scores are judgement on a 1–10 scale from code, mock walks and live pages. **There is no real traffic, conversion or interview data yet**, so no score above 7 can be honestly claimed for anything that depends on customer behaviour. "9/10 needs" lists the evidence that would justify a 9, not just more features.

| Area | V7 | V8 (after Batch 1) | What changed | 9/10 needs |
|---|---|---|---|---|
| Brand clarity | 6 | 7 | One tagline everywhere (site config, default title, onboarding, share image regenerated); one-job headline | Same line in ads and emails; unaided recall from 5+ contractor interviews |
| First impression | 5 | 7 | No popup over the hero; headline states one job; trade picker directly under the headline on phones; product-fact sub line | 5-second tests with 5+ contractors stating the job correctly; hero start rate measured |
| Marketing effectiveness | 5 | 5 | Copy is sharper, but no new acquisition channel yet | Public calculators + guides live (Batch 3), Search Console impressions, attributed starts |
| UI consistency | 7 | 7 | New About page and trust block use existing tokens and components | Dark/Black theme check of new pages; design QA pass |
| UX simplicity | 5 | 6 | Coming-soon items off the homepage (still on pricing comparison); duplicate sample link removed; one plan note per What's New release | Mobile builder header (Batch 2), first-use dashboard; session recordings |
| Mobile usability | 7 | 7 | Hero reorder for phones; axe 0 on every captured page; no horizontal scroll | Real-device test of builder on 390px; mobile `bid_activated` rate |
| Activation | 6 | 6 | Popup no longer competes with the trade picker | Time-to-first-bid instrumented; first-bid rate per visitor cohort |
| Upgrade experience | 6 | 7 | Header Upgrade only at 1 or 0 free bids; What's New labels correct (add-on vs Unlimited), PCC holders no longer told to upgrade | Upgrade offer log + caps (Batch 4); conversion per exposure flat or better |
| Pricing clarity | 6 | 6 | Price in the pricing page title; `/pricing#compare` anchor | 3-card simplification (needs owner sign-off on copy); comprehension test |
| Trust | 4 | 6 | About page, company identity, written promises (private costs, export, no contract, security) | Founder story + photo; first real customer results (see framework); review profiles |
| Customer education | 5 | 5 | `/learn` H1 now describes the content | Calculator → bid handoff live; 3 funnel guides; guide-to-bid conversion |
| Retention readiness | 4 | 4 | None in Batch 1 | Lifecycle emails on (owner), success moments, cancellation reason capture |

## Honest limits

- All behaviour claims are hypotheses until Batch 2 events are live and a few weeks of data exist.
- Signed-in checks used the repository's mock backend, not production accounts.
- Real Stripe checkout and portal were not exercised (by rule). The 20-scenario checkout test intercepts Stripe.
