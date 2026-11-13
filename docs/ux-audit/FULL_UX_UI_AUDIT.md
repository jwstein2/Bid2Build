# Full UX/UI audit — pre-launch (2026-11-13)

Branch `claude/project-thread-yo7h1t` from `main` @ df4c05a. Method and route coverage: [COMPLETE_ROUTE_INVENTORY.md](COMPLETE_ROUTE_INVENTORY.md). Every "Screenshot" below is a file actually rendered and inspected; paths are relative to `docs/ux-audit/screenshots/2026-11-13/`.

Severity: **Critical** blocks a core task on a device class · **High** causes errors or real confusion · **Medium** friction · **Low** polish.

## Summary

| | Before | After |
|---|---|---|
| Route × viewport combos with horizontal page scroll (22 routes × 9 viewports) | 9 | 0 |
| Estimate page width on a 375px phone | 813px (line items cut off, name column ~25px) | 375px, line items as stacked cards |
| Company profile position in dashboard nav | 5th, off-screen on phones | 2nd, directly below Bids |
| Suggestions after one pick | All inline examples disappear; picker closes and hides added items | All stay visible, picked ones marked "Added", no duplicates |
| Estimate sections open on load | All | First only, others collapsed with name, item count, price |
| Browser interaction checks | – | 33/33 pass |

## Issue register

| ID | Route | Component | Screenshot | Problem | Severity | Correction | Status | Test |
|---|---|---|---|---|---|---|---|---|
| UX-01 | `/dashboard` and all `(app)` pages | `components/layout/app-nav.tsx` | before/dashboard__375x800.jpg → after/dashboard__320x800.jpg | Company profile was 5th in the nav; on phones the nav was a sideways-scrolling strip and Company profile was off screen. | High | Order is now Bids → Company profile → Saved customers → Saved cost items → Proposal templates → Subscription → Pricing data → Account settings. | Fixed | Interaction check "Company profile is directly below Bids" (mobile + desktop) PASS |
| UX-02 | all `(app)` pages, mobile | `AppSidebar` (app-nav.tsx), `(app)/layout.tsx` | after/dashboard__320x800.jpg, interactions/nav-menu-open__mobile.png | Mobile sidebar used ~180px of height (logo, full-width New bid, scrolling strip) before any content. | Medium | Compact navy top bar: logo, New bid, Menu toggle (44px targets, `aria-expanded`/`aria-controls`); current page name shown under it; menu closes on navigation. Desktop sidebar unchanged. | Fixed | Screenshots at 320–430; 0 overflow |
| UX-03 | `/dashboard` | `dashboard/profile-reminder.tsx` | after/dashboard__320x800.jpg | No prompt to finish the profile beyond a subtitle link that disappears once a company name exists. | Medium | Subtle, dismissible reminder listing what's missing (company name, logo, phone or email, business address). Nothing is made mandatory; dismissal is remembered per device and returns only if the missing set changes. | Fixed | Rendered with test data (logo missing) |
| UX-04 | `/estimates/[id]`, `/builder` | `builder/workspace.tsx` `SuggestionChips` | after/estimate__1440x900.jpg, interactions/section-with-suggestions__mobile.png | Inline "Examples" only showed while a section was empty and only 3 of them; adding one hid them all. First-section trade examples vanished after the first item anywhere. | High (requested) | Suggestions render as compact chips that stay visible. Unpicked first, then picked ones as teal "Added" chips. Clicking an Added chip scrolls to the existing row (no duplicate). Long lists show 6 + "+N more". Each chip can be hidden. Label: "Not in your totals until added." | Fixed | PASS: adds one row; others stay visible; second pick works; marked Added; no duplicate |
| UX-05 | same | `AddFromLibrary` / `PickRow` | interactions/picker-multi-select__mobile.png | "Suggested & saved items" closed after each pick and removed anything already in the estimate. | High (requested) | Stays open for several picks with a Done button; items already in the section show a check and "Added" and are disabled; a custom entry is offered whenever the search text isn't an exact match; width capped to the screen. | Fixed | PASS: stays open for 2 picks; added items checked |
| UX-06 | same | `GroupCard`, `builder/open-sections.ts` | before/estimate__1440x900.jpg → after/estimate__1440x900.jpg | Every section started expanded, so long estimates were a wall of tables. | High (requested) | First section open, others collapsed. Collapsed headers show name, item count, cost/price/GM and a red "Needs attention" chip if they hold invalid entries. Expand all / Collapse all. State remembered per estimate for the tab (moving between steps or reloading keeps it); newly added sections open automatically. Collapsing only hides rows: data is untouched. | Fixed | Unit tests (6) + PASS: only first open; values persist; totals unchanged; several open at once |
| UX-07 | `/estimates/[id]` mobile | `ItemRow` table | before/estimate__375x800.jpg → after/estimate__375x800.jpg | Page laid out at ~813px on phones. Cause: `sr-only` header/label spans are `position:absolute` and escaped the table's `overflow-x-auto` box (no positioned ancestor). Line items were also an 860px table: names cut to a few letters. | Critical | Scroll box made `relative` (root cause). Below `md` each line item is a stacked card from the same DOM (CSS grid): name + menu, Type/Qty/Unit, Unit cost/Customer price, Ext. cost/Unit price; 44px inputs and buttons, visible borders, 16px text in numeric inputs (no iOS zoom). Desktop table unchanged. | Fixed | 0 overflow at 320–430 and landscape; PASS no horizontal scroll after interactions |
| UX-08 | builder, all steps | `builder.tsx` step strip | before/estimate-proposal__375x800.jpg | Same `sr-only` escape in the step strip widened the page at 320px on the Proposal step; current step could be scrolled out of view. | High | `relative` on the strip; current step scrolls into view on change. | Fixed | 0 overflow |
| UX-09 | `/`, `/bids` at 320px | `marketing/trade-picker.tsx` | before/trades__320x800.jpg → after/trades__320x800.jpg | Long trade names overflowed the 2-column cards (page 325px wide). | Medium | Names wrap (`overflow-wrap:anywhere`, hyphens), smaller icon below `sm`. | Fixed | 0 overflow |
| UX-10 | `/dashboard` mobile | `dashboard/bid-list.tsx` | before/dashboard__375x800.jpg → after/dashboard__320x800.jpg | Badge and total squeezed the bid title into a 1–2 word column. | Medium | Title/meta take the full row on phones; status and total wrap below. | Fixed | Screenshot |
| UX-11 | `/dashboard` mobile | dashboard header | before/dashboard__375x800.jpg | Two "New bid" buttons stacked on phones. | Low | Page-level button hidden below `md`; the top bar keeps one. | Fixed | Screenshot |
| UX-12 | builder | section header | after/estimate__375x800.jpg | Section toggle was a 24px icon with a generic "Expand section" label; menu trigger 28px. | Medium | 44px (mobile)/36px toggle with `aria-controls` and section name in the label; same for section menu. | Fixed | Probe: remaining sub-24px items in rows are 20px checkboxes inside 44px labels and mouse-only "N items" shortcuts (hidden from assistive tech) |
| UX-13 | public pages | `layout/footer.tsx` | after/home__320x800.jpg | Footer links 17px tall, tightly stacked. | Low | Links get vertical padding (≥25px). | Fixed | Probe |
| UX-14 | `/dashboard/customers`, `/dashboard/items` | Delete buttons | – | 20px-tall Delete text buttons; they also delete immediately with no confirmation. | Medium | Tap area raised to 44px. Confirmation not added (behavior change; listed in remaining issues). | Partly fixed | Probe |
| UX-15 | `/admin/*` | admin | – | Not renderable locally (needs service key). | – | Code review only; unchanged. | Not tested visually | – |

Findings with no change made are in [REMAINING_ISSUES.md](REMAINING_ISSUES.md).

## Customer journey (Phase 6)

Homepage → trade → builder was walked in the browser at 320px (anonymous) and the signed-in estimate → scope → proposal → preview steps at 375 and 1440 with test data. Account creation, email verification and the real PDF download need live Supabase auth and were not run end to end here; PDF generation is covered by `tests/pdf.test.tsx` (passes) and the export route is unchanged. Observations:

- Next step is always visible ("Next: scope & exclusions" etc.), Back/Next on every step, save state in the header ("Saved" / "Saved on this device"). Good.
- New anonymous bids start on the Company step, which is right for first-time users.
- The header on phones stacks Upgrade, Preview and Download PDF plus the credit line: dense but usable (see REMAINING_ISSUES R-03).

## Dashboard (Phase 7)

New bid is the primary accent button on every app page (top bar on phones, sidebar on desktop). Credit balances sit under the heading with monthly and starter shown separately. Drafts/Finalized counts, search, status tabs and trade filter work at 320px. Empty-state copy exists in `bid-list.tsx` (not screenshotted: test data has bids).

## Billing and credits (Phase 9)

Verified on screen: starter credits "Never expire. Used after your monthly bid."; monthly "Your first free monthly bid arrives Nov 25" (month two); pricing page states monthly credits don't roll over and are used before starter credits; header shows "Uses 1 credit" / "Updates are free". Billing page shows plan and Stripe status. No checkout was started. Entitlement logic untouched; database credit/billing tests pass (82/82).

## Visual consistency (Phase 10)

New UI uses existing tokens only (navy, cyan accent, teal for "added/done", cool-gray muted text, `font-display` Montserrat headings, Inter body). Teal check = completed is consistent with the builder step strip. No new dependencies.
