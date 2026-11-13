# Before / after screenshots (2026-11-13)

Committed subset: `docs/ux-audit/screenshots/2026-11-13/before/` and `after/` (same file names). Full set of 198 + 198 plus interaction shots: project files `ux-audit/screenshots-full-2026-11-13.tgz`. Before = `main` @ df4c05a, after = this branch; both rendered from local production builds with the same test data.

| Screen | File | Before | After |
|---|---|---|---|
| Estimate step, 375px phone | `estimate__375x800.jpg` | Page laid out at 813px, line-item names cut off, every section open | Fits the screen; first section open as stacked cards with suggestion chips; others collapsed |
| Estimate step, 320px | `estimate__320x800.jpg` | Same overflow | Fits; cards still readable |
| Estimate step, phone landscape | `estimate__667x375-landscape.jpg` | Overflow to 821px | Fits |
| Estimate step, tablet | `estimate__768x900.jpg` | Page widened to 821px | Table scrolls inside its card; page fits |
| Estimate step, desktop | `estimate__1440x900.jpg` | All four sections expanded; examples only in empty sections | First section open, others collapsed with counts; suggestions as chips with Added state |
| Proposal step, 375px | `estimate-proposal__375x800.jpg` | Steps strip pushed page wider at 320 | Current step kept in view; fits |
| Dashboard, 375px | `dashboard__375x800.jpg` | Company profile hidden off the right edge of a scrolling nav strip; two New bid buttons | (see 320 after) compact top bar with Menu; one New bid |
| Dashboard, 320px | `dashboard__320x800.jpg` | Nav strip; squeezed bid rows | Top bar fits 320; profile reminder; bid rows stack |
| Dashboard, desktop | `dashboard__1440x900.jpg` | Company profile 5th in sidebar | Company profile directly below Bids |
| Company profile, 375px | `company__375x800.jpg` | Nav strip above the form | Top bar; current page label |
| Subscription, 375px | `billing__375x800.jpg` | Nav strip | Top bar |
| Homepage, 320px | `home__320x800.jpg` | Page 325px wide (trade picker) | Fits |
| All trades, 320px | `trades__320x800.jpg` | Page 325px wide | Names wrap; fits |
| New bid, Company step (anonymous) | `builder-anon-company__375x800.jpg` | OK | Unchanged |

## Interaction states (after)

| File | Shows |
|---|---|
| `interactions/nav-menu-open__mobile.png` | Mobile account menu open: Bids, Company profile, … |
| `interactions/section-with-suggestions__mobile.png` / `__desktop.png` | First section after two suggestion picks: remaining suggestions visible, picked ones teal "Added" |
| `interactions/suggestions-after-two-picks__*.png` | Same, in page context |
| `interactions/picker-multi-select__*.png` | Suggested & saved items picker open after two picks, checks on added items |
| `interactions/proposal-preview__*.png` | Proposal preview dialog at 375 and 1440 |
| `interactions/new-siding-estimate__320.png` | New anonymous siding estimate at 320px: first section open |
