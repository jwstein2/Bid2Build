# E. Implementation report: Batch 1

Two commits on `claude/project-thread-59tvi8`. No new dependencies, no SQL, no environment variables.

| # | Change | Files | Test coverage |
|---|---|---|---|
| 1 | One-job hero: headline, product-fact sub line, visitor eyebrow, "See a sample proposal" CTA, phone order headline → trade picker → CTAs | `src/app/(marketing)/page.tsx`, `src/lib/account/status.ts` (`sample` CTA action), `hero-quick-start.tsx` (duplicate link removed) | v47 walk, account-CTA walk, prohibited-claims unit test |
| 2 | One tagline: "Professional estimates for your trade, ready to send." | `src/lib/site.ts`, `src/app/layout.tsx` (default title), `onboarding/steps.ts`, OG/Twitter alt text, `scripts/brand/generate_svgs.py` → regenerated `public/brand/og-source.svg`, `built2bid-logo-tagline.svg`, `src/app/opengraph-image.png`, `twitter-image.png` | `tests/v8-marketing.test.ts` |
| 3 | Homepage pillars list live features only; coming-soon items stay on `/pricing#compare` (new anchor), linked once under the pillars | `pillars.tsx`, `pricing/page.tsx`, homepage | v47 walk |
| 4 | Welcome popup auto-opens only on `/dashboard` (signed in, once); Watch Demo and help menu unchanged | `src/lib/onboarding/state.ts` | `tests/onboarding.test.ts`, onboarding walk 125/125 |
| 5 | `/about` + homepage trust block from verified facts; founder section renders only when supplied | `src/app/(marketing)/about/page.tsx`, `src/lib/marketing/about.ts`, footer, sitemap | unit test (no prohibited claims, founder null) |
| 6 | Header Upgrade link at 1 or 0 free bids only | `src/lib/credits/status.ts` (`showHeaderUpgrade`), dashboard, builder | unit tests; screenshots show 1 → 0 links at 3 credits, 1 → 1 at 0 credits |
| 7 | What's New: correct plan labels, add-on access read, one plan note per release | `src/app/(app)/whats-new/page.tsx` | screenshots (5 upgrade buttons → 0, plan notes shown) |
| 8 | SEO: 404 title + noindex, switched-off `/trial` title, `/learn` H1, `/login` canonical, pricing title with price | `not-found.tsx`, `trial/page.tsx`, `learn/page.tsx`, `login/page.tsx`, `pricing/page.tsx` | screenshot report titles |
| 9 | Test scripts brought up to date (two-step login, current copy, webp poster, trade CTA labels, new popup rule) | `scripts/checkout-e2e`, `scripts/marketing/v47-walk.mjs`, `scripts/account-ctas`, `scripts/onboarding/walk.mjs`, `scripts/e2e-smoke.mjs` | all walks pass |

## Statistics on the site

None added. Every claim on the changed pages is a product fact (category 1). See [claims-register.md](claims-register.md).
