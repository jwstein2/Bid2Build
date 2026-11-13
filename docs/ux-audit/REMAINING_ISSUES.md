# Remaining issues (2026-11-13)

Not fixed in this branch, with the reason and a recommendation. None block the four requested fixes.

| ID | Route | Component | Problem | Severity | Recommendation | Status |
|---|---|---|---|---|---|---|
| R-01 | all | – | Tested only in Chromium mobile emulation. No real iOS Safari / Android Chrome pass, and on-screen keyboard overlap could not be measured. | High (verification gap) | On the deploy preview, James (or a tester) walks: dashboard → New bid → Siding → add 2 suggestions → edit qty → Preview, on an iPhone and an Android phone. | Open |
| R-02 | full journey | auth, export | Account creation, email verification, credit deduction and real PDF download were not run against live Supabase from the audit container (no session; no test accounts created in production). | High (verification gap) | Run the same walk on the deploy preview with a test account, then delete it. Unit/DB tests cover the logic. | Open |
| R-03 | builder header, phones | `builder.tsx` | Header stacks title, Upgrade, Preview, Download PDF and the credit line; ~150px tall and not sticky-friendly on short screens. | Medium | Move credit line into the Download button's tooltip/sheet on mobile, or collapse Upgrade into a menu. | Open |
| R-04 | `/dashboard/customers`, `/dashboard/items` | delete forms | Delete removes a customer/saved item/assembly immediately with no confirmation or undo. | Medium | James approved 2026-11-13: two-step "Delete <name>?" confirm added (`dashboard/confirm-delete.tsx`). | Closed |
| R-05 | all | – | No automated axe scan and no screen-reader session. | Medium | Add `@axe-core/playwright` to the capture script in a follow-up (dev-only), run VoiceOver once on the builder. | Open |
| R-06 | dashboard, builder | profile reminder, open-sections | Both read browser storage after hydration, so the reminder can appear a moment after the page and a restored accordion can shift once on reload. | Low | Acceptable; could move the dismissal to the profile row in the database if it matters. | Open |
| R-07 | `/admin/*` | admin | Not visually reviewed (needs the service key). Tables there are desktop-oriented. | Low (admin only) | Review on the deploy preview as an admin. | Open |
| R-08 | `/settings/company`, builder Company step | company form | Contact name, email, phone and address are marked required (`*`) in the existing form. The brief says not to invent mandatory fields; these predate this work and are not enforced for export. | Low | James decided 2026-11-13: leave as is. | Closed (won't change) |
| R-09 | proposal settings | checkboxes | 13px checkboxes (inside full-width labels, so the tap area is fine) look small on phones. | Low | Bump to 18–20px with the shared checkbox style. | Open |
| R-10 | estimate builder | merge with calculators work | Draft PR #10 (calculators) edits the same Qty cell in `ItemRow`. Whichever lands second needs a small rebase; the calculator should mount next to the same qty input, which serves both the desktop table and the mobile card. | Process | #10 merged first; main merged into this branch and the calculator now sits beside the qty input in both the table and the mobile card. | Closed |
| R-11 | dashboard | bid list | Test-data slug `kitchen-remodeling` showed raw because it isn't a catalog slug (fixture issue, not a product bug). | – | None | Closed |

## Added after review (2026-11-13)

- Google Places address suggestions on Business address (Company step / Company profile) and Project address (Customer & project). Needs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; without it the fields stay plain inputs. Picking a job site suggestion fills ZIP/city/state only where they are empty. Not tested against live Google from the audit container (no key); the parser is unit tested (`tests/places.test.ts`).
