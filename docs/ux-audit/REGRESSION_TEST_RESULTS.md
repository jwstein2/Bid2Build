# Regression test results (2026-11-13)

Run on the final commit of `claude/project-thread-yo7h1t`.

| Suite | Command | Result |
|---|---|---|
| Type check | `tsc --noEmit` | Pass |
| Lint | `eslint src scripts tests` | 0 errors; 5 warnings, all pre-existing on `main` |
| Production build | `next build` | Pass |
| Unit/integration | `npm test` (vitest) | 16 files, **171 passed** (165 existing + 6 new accordion tests), 82 skipped (DB suite, run separately below) |
| Database (local Postgres with Supabase stubs) | `npm run test:db` | 7 files, **82 passed**: credit accounting (starter/monthly order, no roll-over), finalize_bid, subscription entitlement, billing race, RLS |
| Browser interaction checks | `node scripts/ux-audit/interactions.mjs` | **33/33 pass** (results JSON in `screenshots/2026-11-13/interactions/`) |
| Overflow sweep | `node scripts/ux-audit/capture.mjs` | **0/198** route × viewport combos overflow (was 9) |

## Coverage map (brief Phase 12)

| Area | Covered by | Result |
|---|---|---|
| Authentication | Signed-in routes render with a session; redirects unchanged. Real sign-in (email OTP) not exercised: needs live Supabase | Partial |
| Bid creation | Anonymous: `/bids` → Siding → builder (interaction check, 320px) | Pass |
| Existing bid editing | Signed-in estimate edited (qty change, adds) | Pass |
| Autosave / manual save | `tests/builder-state.test.ts`; header shows "Saved"; save route unchanged | Pass |
| Materials & quantities | Suggestion/picker checks; no duplicate rows | Pass |
| Pricing calculations | `tests/engine.test.ts`, `tests/pricing.test.ts`; totals identical after collapse/expand and after restoring the edited quantity | Pass |
| Credit accounting / subscription entitlement | DB suite + `tests/credits.test.ts`, `tests/billing.test.ts`; no Stripe calls made | Pass |
| Scope generation / exclusions | `tests/proposal-text.test.tsx`; Scope step untouched | Pass |
| Proposal preview | Preview dialog opens and fits at 375 and 1440 | Pass |
| PDF export | `tests/pdf.test.tsx` renders PDFs; export route untouched. Real download through the deployed site not exercised | Pass (unit) |
| Company branding | Proposal preview shows company header from profile | Pass |
| Mobile navigation | Menu toggle + order check at 375 | Pass |
| Admin permissions | Admin code untouched; admin link shown only when `is_admin` | Not re-tested visually |

## Interaction check list

Mobile (375) and desktop (1440), each: Company profile directly below Bids · only first section expanded · value persists after collapse/expand · collapsing doesn't change totals · totals return after restoring value · multiple sections open at once · suggestion adds one row · other suggestions stay visible · second suggestion right away · picked marked Added · Added chip doesn't duplicate · picker stays open for several picks · picker shows checks · no horizontal scroll after interactions · preview dialog fits. Anonymous 320: trade pick opens builder · new bid only first section expanded · no horizontal scroll.
