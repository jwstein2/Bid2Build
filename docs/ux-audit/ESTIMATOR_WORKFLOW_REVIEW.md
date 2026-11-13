# Estimator workflow review (2026-11-13)

All trades share one builder (`components/builder/*`): every trade estimate is a set of sections (groups) with line items, generated from the trade template in `src/lib/trades/data.ts`. So the accordion, suggestion and mobile fixes apply to every trade at once. Checked in the browser: Siding (signed-in test estimate and a new anonymous estimate). Other trades were checked from template data, since they render through the same components; the parallel "Add trade calculators and washing estimators" thread is adding calculators and the Pressure/Soft Washing trades on top of this builder.

## Requested behaviors

| Requirement | Implementation | Verified by |
|---|---|---|
| Selecting a suggestion adds the material | Chip click adds a line item from the template (name, unit, cost type, taxable) and focuses its unit cost | PASS "Picking a suggestion adds one row" |
| Other suggestions remain visible | Chips never disappear on pick; unpicked ones listed first | PASS "Other suggestions stay visible" (4 → 3 unpicked + 1 Added) |
| Several picks in a row | Yes, inline and in the picker (picker stays open, Done closes it) | PASS (both) |
| Clear selected indication | Teal chip with check and "Added"; picker rows show check + "Added" | PASS "marked Added", "Picker shows added items with a check" |
| Prevent accidental duplicates | Added chips jump to the existing row; picker disables added rows. Deliberate duplicates still possible with the row's Duplicate action or Add line item | PASS "does not duplicate" |
| Manual custom entry | "Add line item" always present; picker offers "Add custom item “…”" for any search text that isn't an exact match | Code + screenshot |
| Placeholders vs examples vs real items | Suggestions are dashed chips labelled "Not in your totals until added"; real items are rows/cards with prices | Screenshot |
| Quantities, pricing, calculations preserved | No change to `engine.ts`, reducer actions or template data; chips use the existing `addItem` action | `tests/engine.test.ts`, `tests/builder-state.test.ts` pass; totals check below |
| First section expanded, others collapsed | `useOpenSections` (`builder/open-sections.ts`) | Unit tests + PASS on signed-in and anonymous estimates |
| Collapsed names visible, obvious controls | Header keeps name, item count, cost/price/GM, chevron (44px mobile), Expand all / Collapse all | Screenshots |
| Values preserved when collapsed | Collapsing hides the panel only; state lives in the reducer | PASS "Value persists after collapse/expand" and "Collapsing does not change totals" |
| Multiple sections open | Independent toggles | PASS |
| Revisiting a draft | Open state remembered per estimate in sessionStorage; first visit opens the first section | Unit test "restores a saved state" |
| Errors not hidden | Collapsed section with invalid entries shows "Needs attention"; the top-of-page alert listing issues is unchanged | Code |
| Keyboard / screen reader | Toggle is a `<button>` with `aria-expanded`, `aria-controls`, and "Expand/Collapse <section name>" | Code |

## Consistency notes across the estimate step

- Category organization, units, pricing method, markup/margin and visibility controls are shared components, so they are consistent across trades by construction.
- Save indicator and Back/Next appear on every step.
- Mobile line items now expose every field the desktop table has (type, qty, unit, unit cost, ext. cost, unit price, customer price) plus the details drawer and actions menu.
- Integration point left for the calculators thread: the quantity input in `ItemRow` is the same element in table and card layouts, so their `QuantityCalculator` mounts once and works in both.
