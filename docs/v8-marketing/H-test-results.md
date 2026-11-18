# H. Tests, performance and regression results

All runs on 2026-11-18 against a production build of this branch with the mock backend.

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| ESLint on changed files | Pass |
| Vitest | 1654 passed, 560 skipped (baseline 1648 passed before the new V8 tests) |
| `next build` | Pass |
| Checkout resume e2e (`scripts/checkout-e2e/run.mjs`) | 20/20 (3 stale checks fixed: QA-1) |
| Account-aware CTAs (`scripts/account-ctas/run.mjs`) | 236/236 |
| Onboarding (`scripts/onboarding/walk.mjs`) | 125/125 |
| Marketing walk (`scripts/marketing/v47-walk.mjs`) | 311/312. The one failure is a homepage link to `/academy/courses/contractor-sales-academy` returning 404 on the mock, which has no Academy data (also seen in V7); not caused by this change |
| axe WCAG 2 A/AA | 0 violations on all captured pages at 390 and 1440 |
| Horizontal overflow | None at 390, 768, 1440 |

## Performance

No new dependencies or client components. `/about` is server-rendered with the shared marketing layout. Server response times on the mock were within noise of the before build (home 160–240 ms both ways; see `report.json`). Share images were regenerated at the same size (1200×630).

Logs: `/mnt/project-files/marketing-audit-v8/evidence/`.
