# UI/UX polish pass: UI UX Pro Max, 21st.dev, Motion (2026-11-16)

Branch `claude/project-thread-6bfew7` from `main` @ `62e46ae`. Local build against the mock Supabase
(`scripts/ux-audit/mock-supabase.mjs`, test data only). No production data, schema, pricing, Stripe,
auth or permission logic was touched.

## 1. Stack (verified from the repo)

| Area | Finding |
|---|---|
| Framework | Next.js 16.4.6 (App Router, Turbopack), React 19.3, TypeScript 5 |
| Styling | Tailwind CSS 4.3 with brand tokens in `src/app/globals.css` (`@theme`), Light/Dark/Black app themes (PR #61) |
| Components | Own small kit (`src/components/ui`: Button, Card, Badge, Notice, Field), Radix Dialog / Dropdown / Tooltip, lucide icons |
| Animation before this pass | CSS only: `transition-colors` on buttons, 120ms field focus, `animate-spin`, one admin keyframe, global `prefers-reduced-motion` rule. No animation library. |
| Package manager / scripts | npm (`package-lock.json`); `typecheck`, `lint`, `test` (vitest), `build`, `test:e2e` |
| Data / auth | Supabase SSR client, Stripe server-side; not modified |

## 2. Third-party tool verification

| Tool | Official source checked | What it is | Install / status | Data leaving the machine | Cost |
|---|---|---|---|---|---|
| **UI UX Pro Max** | github.com/nextlevelbuilder/ui-ux-pro-max-skill @ `e59ff37` (v2.15.0, MIT) | A Claude Code skill: SKILL.md plus CSV data and a Python 3 search script (standard library only) | **Installed and working**, project-scoped at `bid2build/.claude/skills/ui-ux-pro-max/` in the build session, kept out of git (`.git/info/exclude`). Reviewed: no network imports, no subprocess, no install hooks. Official installs are `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` + `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`, or `npx ui-ux-pro-max-cli init --ai claude`. | None (local CSV search) | Free |
| **21st.dev MCP** | npm `@21st-dev/cli` 1.18.0 (MIT; supersedes `@21st-dev/magic` 0.2.3, now a proxy) | Hosted MCP endpoint at 21st.dev: component search (free), component code retrieval (metered: small daily free allowance, then paid), optional hosted AI generation (separate paid capability) | **Blocked, not installed.** (a) 21st.dev is outside this cloud session's network allowlist (proxy refused the connection); (b) it needs a 21st.dev account: `21st login` or an API key from 21st.dev/settings/api-keys in `TWENTYFIRST_TOKEN` / `API_KEY_21ST`. | Search queries; `--context auto` and `21st init --design-context` upload a design summary of the repo (`.21st/design.json`); `publish` uploads component source. Use without `--context` to avoid sending project details. | Free search; paid for unlimited code retrieval and AI |
| **Motion** (motion.dev) | npm `motion` 14.14.0 (MIT; wraps `framer-motion` + `motion-dom` + `motion-utils`; peer React 18/19; no install scripts) | Animation library; `motion/react` is the right entry for this React 19 app | **Verified compatible, evaluated, measured, not shipped.** A first implementation (LazyMotion + `m` + AnimatePresence) added **+17 to 18 KB gzipped** first-load JS to every page (home 279.8 → 297.9 KB). Everything the brief asks for here (menu reveal, section expand, save feedback, press feedback) works with CSS transitions at ~0.5 KB, so the dependency was removed. motion.dev itself was unreachable from the session (same allowlist block); the npm package was inspected directly. | None (client library) | Free (Motion+ premium is optional, not used) |

## 3. UX audit

Method: repository review; UI UX Pro Max rule checks (touch, navigation, animation, a11y domains);
axe-core 4 (WCAG 2.0/2.1/2.2 A+AA) across 16 routes at 390px and 1440px; overflow and small-target
probes; Playwright screenshots at 390 / 768 / 1440; mobile Lighthouse 13 on `/` and `/pricing`.
Earlier audits in `docs/ux-audit/` (2026-11-13) were read first and not repeated.

Not reachable from the container: real iOS/Android devices, live Supabase sign-up, Stripe Checkout,
real PDF download, `/admin` (needs the service key), Enterprise screens with real data. These remain
verification gaps (see `docs/ux-audit/REMAINING_ISSUES.md` R-01, R-02, R-07).

### Ranked matrix

| # | Pri | Page / component | Current behavior | User problem | Proposed improvement | Business benefit | Difficulty | Risk | Validate by | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | P1 | Public phone menu (`mobile-nav.tsx`) | Escape did nothing, tapping outside did nothing, focus stayed on the button, no transition, links 48px but menu snapped open over content | Keyboard and screen-reader users stuck in the menu; touch users had to find the X; abrupt | Escape + tap-outside (dimmed page) close, focus in/out, CSS drop-in, closes on navigation and Back | Less friction from landing page to Pricing / sign-up on phones | S | Low | Walk checks 1–8 (`scripts/ui-polish/walk.mjs`) | **Done** |
| 2 | P1 | App phone menu (`app-nav.tsx`) | Escape did not close; menu snapped in | Same as above inside the app | Escape closes (phones only) and returns focus; CSS drop-in | Faster navigation on phones | S | Low | Walk checks 9–12 | **Done** |
| 3 | P1 | WCAG AA violations (axe) | 8 violations on 5 routes: contrast 3.56:1 on the welcome popup "Play video 2:56" (home, /bids), contrast 4.18:1 on dashboard links, unlabeled logo file input, unfocusable scrolling pricing table, `aria-label` on a plain div (home sample proposal) | Low-vision and keyboard users | Darker token (`text-navy`, `text-accent-dark`), `aria-label` + `tabIndex=-1` on the hidden file input, `role=region tabIndex=0` on the comparison table, `role=figure` on the sample | Accessibility and trust; fewer legal/a11y complaints | S | Very low | axe re-run: 8 → 0 | **Done** |
| 4 | P2 | Estimate builder sections (`workspace.tsx`) | Chevron swapped icons; rows appeared instantly | Hard to see what opened on a long estimate | Chevron rotates 90°; rows fade/lift in (180ms) only when the contractor toggles, never on load; no height animation on tables | Clarity when scoping multi-trade bids | S | Low (presentation only; calculations untouched) | Walk checks 13–18; transform cleared after reveal so fixed calculator sheet/BulkBar unaffected | **Done** |
| 5 | P2 | Save status (`builder.tsx` SaveBadge) | Text swapped silently; screen readers heard nothing on sync failure | Contractor may not notice "Not synced" | 120ms fade on each change; polite live region announces only a failed sync (not every autosave) | Trust that work is saved | S | Very low | Walk INFO lines; manual | **Done** |
| 6 | P2 | Buttons (`ui/button.tsx`) | Color change only on press | On a phone in sun/gloves a tap gives no feedback | 2% press-in (`scale`), transform-only, off under reduced motion | Perceived responsiveness | XS | Very low | Visual; reduced-motion walk | **Done** |
| 7 | P2 | Motion system | Durations scattered (120ms inline) | Inconsistent feel as features grow | Tokens `--motion-fast/base/slow`, `ease-brand-out/in`, utilities `motion-drop-in/fade/reveal`, guard-rail tests | Consistency, cheap to maintain | XS | Very low | `tests/motion-tokens.test.ts` | **Done** |
| 8 | P1 | Dashboard (`/dashboard`) | CLS 0.12 at 768px and 0.08 at 1440px (measured, before and after this pass) | "Your bids" jumps down when blocks that render after hydration appear above it (the company-profile reminder, `role=status`, and the card row), measured with layout-shift sources | Reserve space for those blocks, or decide them on the server | Professional feel; Core Web Vitals | M | Low | CLS < 0.05 at 768/1440 | Recommended (dashboard is being edited in the KPI-cards thread, so left alone) |
| 9 | P1 | Home hero (mobile) | Lighthouse CLS 0.06 on the hero paragraph (web-font swap reflows the h1) | Visible text jump on first load | Font fallback metrics (`size-adjust` / `next/font`) for Montserrat | LCP/CLS, first impression on ads traffic | M | Low | Lighthouse CLS < 0.02 | Recommended |
| 10 | P2 | Visitor welcome popup | Opens ~1.2s after load even if the visitor already opened the menu or is mid-scroll | Interrupts the first visit; covered the open phone menu in testing | Don't open while a menu/dialog is open or after the visitor has interacted; or open on second page view | Fewer early bounces | S | Low | Bounce rate, welcome popup dismiss rate (GA4) | Recommended |
| 11 | P2 | Builder header on phones | ~300px of header (title, actions, plan line, theme toggle, steps) before the first line item | Less room for the estimate | Collapse plan line + theme toggle into a menu below md (R-03) | Faster estimate entry on phones | M | Medium (busy component) | Time to first line item | Recommended |
| 12 | P3 | Small targets | `N items` toggle 16px tall in builder section header (duplicate of the 44px chevron, `aria-hidden`); 13px checkboxes on login/account (inside full-width labels) | Precision tapping | Bump to 24px min / 18px checkboxes | Polish | XS | Very low | Small-target probe | Recommended |
| 13 | P3 | Breadcrumb `Trades` link on trade pages | 46×17px | Precision tapping | Add vertical padding | Polish | XS | Very low | probe | Recommended |

No P0 (broken flow / security / severe a11y) found in the reachable screens.

## 4. 21st.dev component evaluation

Because the MCP could not be reached, no 21st.dev code was retrieved or pasted. The existing kit
already covers hero, pricing cards, dashboard cards, dialogs, drawers and estimate forms with the
brand tokens and dark mode. Most 21st.dev components are shadcn/ui + Radix + `framer-motion`
based; adopting them would add a second component idiom and usually Motion (+17 KB gz). Recommendation:
use 21st.dev for **inspiration and search only** (free, no repo context), and rebuild any pattern
with the existing tokens. Candidates worth looking at once access is set up: a comparison-table
pattern for Pricing on phones, a command-palette style trade picker, and a kanban card for the
pipeline view.

## 5. Measurements (local production build, same machine, same mock data)

First-load JS referenced by each page, gzipped from `.next/static`:

| Page | Before | After | Change |
|---|---|---|---|
| `/` | 279.8 KB | 280.2 KB | +0.4 KB |
| `/pricing` | 370.5 KB | 371.0 KB | +0.5 KB |
| `/login` | 364.6 KB | 365.1 KB | +0.5 KB |
| `/dashboard` | 369.0 KB | 369.1 KB | +0.1 KB |
| Estimate builder | 549.8 KB | 550.0 KB | +0.2 KB |
| (Motion variant, rejected) `/` | 279.8 KB | 297.9 KB | +18.1 KB |

CLS (Playwright PerformanceObserver) unchanged on all pages at 390/768/1440 (dashboard 0.12/0.08
before and after). No horizontal overflow at any width. No console errors.

Lighthouse (mobile, simulated throttling): see PR description for the runs; lab scores vary ±5
run to run, so treat them as "no regression" checks, not results. SEO is low locally only because
non-production builds are `noindex` by design.

## 6. Conversion hypotheses (not results)

- A phone menu that closes the way people expect (tap outside, Back) keeps more visitors moving from
  the home page to Pricing or "Create a Free Bid". Measure: GA4 `menu_open` → `cta_click` rate on
  mobile, and home → pricing click-through, 2 weeks before vs after.
- Clear section open/close and save feedback reduces abandoned first bids. Measure: the existing
  7-day activation metric (first finalized bid) and time from bid created to first line item.

## 7. Rollback

Every change is presentation-only. Revert the PR's commit(s) with `git revert`; no data or schema
migration is involved. To roll back just the motion, delete the `motion-*` utilities and tokens in
`globals.css`; components fall back to instant state changes.
