# New Bid workflow, mobile calculators, selected-items toolbar

Covers sections 1, 6 and 7 of the consolidated UX spec (2026-11-14). No database migration, no new
environment variables, no changes to pricing math, credits, Stripe or auth.

## 1. Trade-first New Bid

Every "New bid", "Create New Bid", "Create free bid" and "Start a bid" link already goes to `/bids`
("What are you bidding today?"); a trade landing page (`/bids/roofing`) is the same choice made
from that trade's page. `/start/[trade]` creates the draft with the chosen trade and opens the builder.

**Root cause:** the builder always opened on Step 3 (Estimate). Only anonymous visitors with no
company saved in the browser were sent to Company; signed-in users without a profile, and everyone
with a profile, skipped Customer & project. Company was checkmarked on company name alone.

**Now** (`src/lib/estimate/workflow.ts`, one rule for every entry point, free and paid alike):

| Situation | Opens on |
|---|---|
| New bid, company profile incomplete | Step 1 Company |
| New bid, company profile complete | Step 2 Customer & project (Company checkmarked) |
| Resumed draft, this device remembers the step | That step |
| Resumed bid with a customer or line items | Step 3 Estimate |
| `?step=proposal` (dashboard Preview) | Proposal |

"Complete" means every field the company form marks required: company name, contact name,
business email, phone, business address (signed in: the saved `business_profiles` row; anonymous:
the profile saved in this browser). The last step per bid is kept in `localStorage` (`b2b:step:<id>`),
so a refresh, or signing in mid-bid, returns to the same step. No new company records are created.

**Behavior change to note:** an existing account whose saved profile is missing contact name,
email, phone or address will see Step 1 on its next new bid until those are filled in once.

## 6. Mobile calculators

Root causes found in `quantity-calculator.tsx` (all trade calculators share this one panel):

1. **Closing/minimizing:** on touch screens, tapping the dimmed area to dismiss the keyboard closed
   the whole calculator and threw away the typed measurements.
2. **Shifting out of view:** inputs were 14px, so iOS Safari zoomed the page on focus; the sheet
   was pinned to `bottom: 0`, which sits behind the keyboard on iOS and Chrome Android, hiding the
   lower fields and the Use button.
3. **Fields not taking taps / keyboard interrupting:** the first field was auto-focused while the
   sheet opened (keyboard popped mid-animation); on touch tablets the popover re-anchored on every
   keyboard resize.
4. **Red errors before typing:** blank required fields were reported as errors immediately.

Fixes:

- Sheet layout on phones and touch tablets; it follows the visual viewport, so it stays above the keyboard.
- A tap outside while typing only closes the keyboard; focus moving elsewhere never closes the sheet.
- Measurements typed but not applied survive closing and reopening (Cancel discards them).
- 16px fields on touch screens; no auto-focus on touch; Enter/"Next" moves to the next measurement;
  the focused field scrolls into view after the keyboard opens.
- Blank fields stay quiet until "Use" is pressed (then they're flagged and focused). A wrong value
  shows once the contractor leaves that field. Calculation logic is unchanged.

## 7. Selected line-items toolbar

**Root cause:** the bar was `sticky top-[7.5rem]`, but the builder header is ~209px tall on
phones (it wraps), so the bar slid underneath the header (z-30 over z-20) and was cut off.

**Now:** below 1024px the bar is pinned to the bottom of the screen (above the keyboard and the
home indicator, over the running total) in a compact layout: count / Delete / clear, then
markup-margin + % + Apply, then Use estimate pricing / Save as assembly. On desktop it sticks just
below the measured header height. Multi-item selection and every action are unchanged.

## Testing

- `npm test`: 24 files passed, 312 tests (DB suites skipped as usual); new `tests/workflow.test.ts`.
- `npm run typecheck` clean; `npm run lint` adds no new errors (the 2 existing ones are in `scripts/trade-sync/walk.cjs`).
- Browser walk `scripts/new-bid-mobile/walk.mjs` (Playwright Chromium, mock Supabase from
  `scripts/ux-audit/`): 173 checks at 320, 375, 390, 430, 820 (touch tablet) and 1440, all passing.
- **Not tested on real devices.** Playwright emulates touch and viewport size but not the real iOS
  or Android keyboard, iOS focus zoom or the visual viewport resize. A pass on a real iPhone
  (Safari) and an Android phone (Chrome) is still needed: open a calculator, type dimensions with
  the keyboard up, tap above the sheet, press Use.
