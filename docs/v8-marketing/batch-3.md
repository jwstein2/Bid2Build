# V8 batch 3: free calculators that turn into a bid

Date 2026-11-18. No SQL, no new environment variables, no new dependencies.

| Item | Change |
|---|---|
| Free calculators | `/tools` plus four pages: concrete (cubic yards for slabs, footings, piers), deck boards, roofing squares (pitch factor), markup ↔ margin. Quantity tools run the builder's own calculator engine and field components (`src/components/builder/calculators/calc-fields.tsx`, moved out of the builder dialog unchanged), so a public result matches the builder exactly. |
| Send this as a bid | Opens `/start/<trade>?tool=<slug>&q=<qty>`. The server accepts only a known tool, its own trade and a positive quantity up to 1,000,000. The draft gets ONE line (the matching template item, for example Ready-mix concrete) with that quantity and no price. The measurements go along in sessionStorage only, and are kept on the line's calculator only if they still compute the same quantity. The markup tool passes only mode + percent (the cost stays on the page). No account needed. |
| One Learn menu | Header "Academy" and "Learn" links become one "Learn" menu (Guides · Calculators · Academy); phone menu shows the same three as a group. /learn and /tools carry matching tabs. Footer adds "Free calculators". |
| Trade pages | New "Learn and calculate before you bid" block: the trade's calculator (concrete, decks, roofing), the markup calculator, the trade's Academy classroom, and the existing pricing guides. Guides link their calculator. |
| ?from= | Short safe label (`[a-z0-9_-]`, 40 chars) added to `landing_view`, `cta_clicked`, `calculator_used`, `calculator_bid_started` in GA4. Not written to the first-touch attribution cookie, so internal links never become a "source". No fingerprinting. |
| Schema/SEO | WebApplication (free offer, no ratings), HowTo, FAQPage, BreadcrumbList on each tool; canonical URLs; sitemap entries. |

Removed nothing: Academy and Guides are one click from the Learn menu on every page.

## Results (mock backend, production switches)

- New walk `scripts/marketing/v8-tools-walk.mjs`: 70/70 (pages at 1440/390/320, no overflow, axe 0, schema, concrete 20×24 ft × 4 in + 5% = 6.23 CY lands on Ready-mix concrete with its measurements, roofing 40×15 at 6/12 = 6.71 sq, deck 26 boards, markup 25% = 20% margin and the new bid starts at the chosen margin, Learn menu desktop + phone, trade learning block, sitemap).
- Vitest 1673 passed (16 new in `tests/v8-calculators.test.ts`). Type check, lint, build pass.
- ui-polish walk 0 failures. Marketing walk 317/319: the two failures are the known mock-only Academy 404s (the mock has no Academy data). e2e smoke: same 2 failures on main and on this branch (pre-existing).
- Screenshots: `/mnt/project-files/marketing-audit-v8/screenshots/batch3/`.

Follow-up idea: after a handoff the builder opens at the top of the Estimate step; scrolling to the new line would save a scroll on phones.
