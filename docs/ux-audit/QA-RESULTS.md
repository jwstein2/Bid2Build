# QA results

Run 2026-11-12 on branch `claude/project-thread-a0eulr`, local production build, no Supabase/Stripe credentials.

## Automated
| Check | Baseline (main) | After | Notes |
|---|---|---|---|
| `npm run lint` | 0 errors, 5 warnings | 0 errors, 5 warnings | Same pre-existing warnings (F20). |
| `npm run typecheck` | pass | pass | |
| `npm test` (vitest) | 67 passed, 23 DB skipped | 93 unit passed (+26 brand-token contrast tests) | `tests/brand-tokens.test.ts` checks every text/background pair, the focus ring and "never white on cyan". |
| `npm run test:db` | 23 passed | 23 passed | RLS, quota, billing in Postgres: unchanged. |
| `npm run build` | pass | pass | |
| `npm run test:e2e` (new) | n/a | 24/24 passed | Desktop 1440 + mobile 390: hero, CTA → trades, Company → Customer → Estimate with Next, line item maths (10 × $40 at 25% markup = $500.00), Back, refresh recovery, preview content, anonymous download → free-account gate, no page errors. |
| Horizontal overflow | none | none | Checked on all 57 captures per run. |

## Not changed (by design)
Estimate engine, proposal/PDF templates, quota and export SQL, Stripe checkout/webhooks, RLS, API routes, DB schema. No migrations.

## Not testable here
- Signed-in pages (dashboard, settings, admin), cloud autosave, export with credit counting, checkout (test mode), session expiry: need Supabase/Stripe credentials. **Manual steps** on the Netlify deploy preview:
  1. Sign in with the magic link. Dashboard: sidebar is navy, current page highlighted, "New bid" is cyan with navy text.
  2. Open a bid, step through with Next/Back, refresh mid-way: the "Saved" badge returns and data is intact.
  3. Download a PDF: credit counter drops by one; re-download the same version: no credit used.
  4. Pricing → Choose Monthly (Stripe test card 4242…): returns to billing as Unlimited; cancel in portal.
  5. Tab through header, builder steps, dialogs: visible teal focus ring everywhere, cyan on navy areas.
- Lighthouse/Core Web Vitals: not run (no Chrome DevTools protocol budget here); fonts are self-hosted variable fonts, no new images on public pages except the OG image.

## Known issues
- With no Supabase env, `/dashboard` logs a server error from the page while the layout shows the config guard (pre-existing; only affects unconfigured local runs).
- Logo checked against the written brief only; the referenced board image wasn't provided.
