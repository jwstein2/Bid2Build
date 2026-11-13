# Mobile responsiveness audit (2026-11-13)

Tested at 320, 375, 390, 430 portrait (Playwright Chromium with mobile emulation: `isMobile`, touch) and 667×375 / 844×390 landscape, on all 22 routes in [COMPLETE_ROUTE_INVENTORY.md](COMPLETE_ROUTE_INVENTORY.md). Automated probe per screenshot: page `scrollWidth` vs viewport, the leaf elements past the right edge, and interactive elements under 24px. Raw output: `screenshots/2026-11-13/{before,after}/overflow-report.json`.

**Not tested:** real iOS Safari and Android Chrome devices (only Chromium emulation was available in the audit container). Keyboard overlap could not be measured in emulation. See REMAINING_ISSUES R-01.

## Horizontal scrolling: before → after

| Route | Viewports affected (before) | Root cause | Fix | After |
|---|---|---|---|---|
| `/estimates/[id]` (estimate step) | 320, 375, 390, 430, 768, 667 landscape (page 813–821px) | `sr-only` spans (`position:absolute`) in the 860px line-item table escaped its `overflow-x-auto` wrapper because no ancestor was positioned | `relative` on the wrapper; below `md` the table becomes stacked cards so no inner scrolling is needed | ok everywhere |
| `/estimates/[id]?step=proposal` | 320 (331px) | Same escape from the builder step strip (`(done)` sr-only text) | `relative` on the strip | ok |
| `/`, `/bids` | 320 (325px) | Long trade names in 2-column picker cards | Names wrap; smaller icon below `sm` | ok |
| all `(app)` pages (introduced mid-work by the new top bar, caught before commit) | 320 (347px) | Logo + New bid + Menu wider than 320 | "Menu" label becomes screen-reader text and the New bid icon hides under 380px | ok |

No `overflow-x: hidden` was added anywhere; each cause was fixed at the element.

## Checklist (after)

| Check | Result | Notes |
|---|---|---|
| Horizontal scrolling | Pass | 0/198 route × viewport combos |
| Content overflowing / clipped text | Pass | Bid titles, trade names, section names wrap or truncate with full text in the input |
| Inputs extending beyond containers | Pass | Line-item cards use a 12-column grid inside the card |
| Unusable tables | Fixed | Estimate line items → cards below 768px. Proposal preview tables are part of the customer document and scale inside the preview |
| Modals wider than device | Pass | Proposal preview 16px gutters at 375 (interaction check); auth/upgrade dialogs use the same Modal |
| Dropdowns outside viewport | Pass | Radix menus collide with edges; "Suggested & saved items" capped to `100vw − 2rem` |
| Sticky elements obscuring content | Pass | Builder bottom total bar is offset by `pb-28` on main; sticky header only on builder |
| Small touch targets | Improved | Section toggles/menus, item menus, detail toggles, chips, account menu, Delete buttons now ≥40–44px on mobile. Inline text links in paragraphs remain (WCAG inline exception) |
| Excess vertical space | Improved | Mobile account bar ~110px shorter; collapsed sections |
| Landscape | Pass | 667×375 and 844×390 on all routes |
| PDF preview usability | Pass (emulated) | Preview dialog fits width; long proposals scroll inside dialog |
| Keyboard overlap | Not measured | Numeric inputs are 16px so iOS won't zoom; needs a real device pass |

## Before/after (estimate on a 375px phone)

- Before: `screenshots/2026-11-13/before/estimate__375x800.jpg` — page laid out at 813px; line-item names cut to 4–5 letters; all 4 sections open.
- After: `screenshots/2026-11-13/after/estimate__375x800.jpg` — fits 375px; first section open with cards and suggestion chips; others collapsed with item counts and prices.
