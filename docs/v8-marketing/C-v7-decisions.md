# C. Decisions on V7 recommendations

ACCEPT = shipped as recommended · MODIFY = shipped differently (reason given) · DEFER = later batch or needs a decision/data · REJECT = not doing.

| V7 item | Decision | Reasoning | Where |
|---|---|---|---|
| UPS-2 What's New labels | ACCEPT + fix | Add-on features now say "Project Command Center add-on". Also found that the page never checked add-on access, so PCC holders were told to upgrade; fixed with `loadPmAccess`. One plan note per release replaces the per-feature Upgrade buttons | `whats-new/page.tsx` |
| ONB-1 No popup for visitors | ACCEPT | Auto-open only on the signed-in dashboard, once. Watch Demo and help-menu replay unchanged. Subtitle now "Let's build your first bid." | `onboarding/state.ts` |
| MKT-1 One-job hero | MODIFY | Headline "Professional estimates for your trade, ready to send." instead of "…in minutes": we have no measured time-to-first-bid, so "in minutes" would be an unverified claim. Revisit once the median is measured | `(marketing)/page.tsx` |
| MKT-1 Trade picker first on phones | ACCEPT | Grid reorder: headline → picker → CTAs on phones; desktop layout unchanged | same |
| MKT-1 "See a sample proposal" CTA | ACCEPT | Replaces "Explore Project Command Center" for visitors. PCC stays one click away in the pillar nav directly under the hero | same |
| MKT-2 One tagline | ACCEPT | Site config, default title, OG/Twitter alt text and regenerated share images; onboarding subtitle | `site.ts`, `layout.tsx`, `public/brand/` |
| MKT-3 Fewer homepage features | MODIFY | Kept all three pillars and every live feature (feature discovery matters and nothing may be hidden from authorized users). Removed only coming-soon items from the homepage; they remain on the pricing comparison, now linked as "See every feature by plan" | `pillars.tsx` |
| TRU-1 About + trust block | ACCEPT (partial) | Built from verified facts only. Founder section waits for the owner's text; no placeholder text reaches customers | `/about`, `about.ts` |
| UPS-1 Header Upgrade only at ≤1 credit | ACCEPT | `showHeaderUpgrade()` used by dashboard and builder headers. Plan cards, pricing, out-of-credits dialog and premium panels unchanged | `credits/status.ts` |
| UPS-1 Remove locked nav items for free users | REJECT | Locked items are how free users discover premium features; the diamond marker is low-pressure. Removing them reduces discoverability, which the V8 brief forbids | – |
| QA-1 Checkout test selectors | ACCEPT | 20/20 pass | `scripts/checkout-e2e/run.mjs` |
| SEO-1 Hygiene | ACCEPT | 404 title, switched-off `/trial` title, `/learn` H1, `/login` canonical, pricing title with price, `/about` in sitemap. `/bid-check` already has H1s (V7 finding was the loading state) | various |
| MKT-4 Pricing to 3 cards | DEFER (Batch 4) | Billing copy must stay exact; needs owner review of wording | – |
| MKT-5 Enterprise → Team | DEFER (owner decision) | Display-only rename would still touch emails, docs and invoices; propose, don't implement | – |
| MKT-6 Trade page learning block | DEFER (Batch 3) | Depends on public calculators | – |
| MKT-7 Coming-soon accuracy for comms | DEFER (Batch 2) | Needs production check of comms flags | – |
| MKT-8 One Learn menu | DEFER (Batch 3) | With calculators | – |
| TRU-2 GA before consent | DEFER (Batch 2) | Needs a consent decision; documented in measurement plan | – |
| LIF-1 Lifecycle emails | DEFER (owner) | Turning on production email needs explicit approval | – |
| ANL-1 Event taxonomy | DEFER (Batch 2) | Needs a migration for the event CHECK list; SQL goes to the owner as a file | – |
| EST-3 Mobile builder header | DEFER (Batch 2) | Medium layout risk; deserves its own PR | – |
| EDU-0..4 Calculators + guides | DEFER (Batch 3) | Largest growth lever; separate PRs | – |
| T1, T5, T8, RET-1, BLD-2 | DEFER (Batch 4) | Need the offer log and caps first | – |
| LIB-2 Saved Items for free | DEFER (owner) | Entitlement change | – |
| T6, T7, ENT-2, EST-4, DSH-5 | DEFER (later) | Lower confidence or need data | – |
| V7 statistics suggestions (time-saved, rework) | REJECT for homepage | See claims register: sponsored, old or not about our buyer | – |
