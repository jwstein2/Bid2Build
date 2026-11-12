# Changelog: Blueprint Precision rebrand + bid-flow streamlining

## Brand system
- `src/app/globals.css`: new token values (navy #0B2D4D, cyan #00C2E0, teal #14B8A6, cool gray #6B7A89, AA-checked text/semantic colours), card radius/shadow tokens, teal focus ring (cyan on `.on-dark`), blueprint grid utilities. Field styles moved into `@layer components` so utilities like `w-auto`/`pl-9` apply (fixes full-width selects and icon-input padding).
- Fonts: Montserrat (display, buttons) replaces Archivo; Inter stays for body, forms and numbers.
- `src/components/layout/logo.tsx`: mark redrawn from the approved board (solid B, ruler stem, drafting cuts, 45° chamfer, teal check) and wordmark with a cyan-gradient "2".
- `public/brand/`: SVG masters (mark, transparent, mono, favicon, horizontal, reverse, mono lockups, OG source), favicon 16/32/48 PNG, icons 192/512 + maskable. Generators in `scripts/brand/` (`npm run brand:assets`).
- `src/app/`: `favicon.ico`, `icon.png`, `apple-icon.png`, `opengraph-image.png`, `twitter-image.png` (+ alt text), `manifest.ts`.
- `src/lib/site.ts`, `src/app/layout.tsx`: tagline "Build estimates. Create bids. Win more work.", new description/title, theme colour.
- `docs/brand/BRAND-GUIDELINES.md`.

## Marketing
- Homepage rewritten around the brief: navy blueprint hero (as on the board) with a feature strip, sample proposal (`components/marketing/sample-proposal.tsx`, real renderer + example data), trade selector section, 4 steps, existing profit/visibility/pricing/FAQ sections restyled.
- Header/footer/mobile nav: "Create a free bid" CTA, navy footer with support/privacy/terms.
- Pricing, trade pages, trades index: consistent CTA labels and brand tokens; no price or limit changes.

## Bid builder
- Mobile header compacted; secondary meta hidden on small screens.
- Step tabs show completion and current step; new Back / Next footer on every step; final step opens "Preview & download". Step-internal "Continue to estimate" buttons removed (one was mislabelled).
- Compact "Customer sees" control per section.

## App
- `components/layout/app-nav.tsx`: navy sidebar with `aria-current` active page.
- Dashboard: 40 px row actions, status filter as toggle buttons, empty state with CTA.

## Tests & tooling
- `tests/brand-tokens.test.ts`, `scripts/e2e-smoke.mjs` (`npm run test:e2e`), `scripts/ux-screenshots.cjs`.
- `docs/ux-audit/`: route inventory, findings, screenshot manifest, before/after, QA results, this changelog.
