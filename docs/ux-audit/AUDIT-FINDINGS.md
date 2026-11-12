# Baseline UX/UI audit

Audited 2026-11-12 against `main` @ a8d5487 (local production build, no Supabase/Stripe credentials). See [ROUTE-INVENTORY.md](ROUTE-INVENTORY.md) for access limits and [SCREENSHOT-MANIFEST.md](SCREENSHOT-MANIFEST.md) for every capture (`screenshots/before/`).

**Verified** = seen in a screenshot or reproduced. **Code** = read in source, not rendered (route is blocked). **Hypothesis** = likely but not proven.

## 1. Architecture summary
- **Framework:** Next.js 16 App Router (`src/proxy.ts` refreshes Supabase session cookies; authorization happens in pages/routes), React 19, TypeScript, Tailwind v4 with tokens in `src/app/globals.css` `@theme`.
- **Auth:** Supabase passwordless (magic link + OTP). `(app)` layout redirects to `/login`; admin via `requireAdmin()` + `is_admin` RPC.
- **State:** builder uses a reducer (`components/builder/state.ts`) with undo; anonymous drafts in `localStorage` (`lib/drafts/local.ts`); signed-in drafts autosave to `/api/estimates/save` (debounced 1.2 s) with a local copy kept as a safety net.
- **Money:** `lib/estimate/engine.ts`, decimal.js, half-up rounding to cents per line, markup *or* margin per estimate, adjustments before tax, pass-through at cost.
- **Customer boundary:** `lib/proposal/build.ts` produces the only customer-facing model; HTML preview and PDF both render from it.
- **Billing / quota:** 3 finalized exports per UTC calendar month, enforced in Postgres (`record_export()`); unlimited via Stripe webhooks only (`apply_subscription_update()`); `$19.99` / `$149` labels in `lib/site.ts`, price IDs from env. **Confirmed against code and DB tests** before quoting prices on marketing pages.
- **PDF:** `@react-pdf/renderer`, 5 templates, stored in private `documents` bucket with signed URLs.
- **Deploy:** Netlify (`netlify.toml`), production from `main`.
- **Tests (baseline):** lint 0 errors / 5 warnings; typecheck clean; `vitest` 67 passed + 23 DB tests passed (`npm run test:db`); build succeeds. No browser/E2E suite existed.

## 2. Risk map
| Area | Risk if touched | Approach |
|---|---|---|
| Estimate engine, quota, billing, RLS, webhooks | High: money and entitlements | **Not modified.** Visual changes only around them. |
| Proposal / PDF rendering | Medium: contractor-facing output | Keep contractor branding separate from Built2Bid brand; no template changes. |
| Builder reducer and autosave | Medium | UI-only changes (header, step nav); reducer untouched. |
| Tailwind tokens | Low–medium: global | Keep token *names*, change values, so every page updates without class churn. |
| Logo / metadata | Low | New SVG + generated PNGs; `site.ts` stays the single source for the name. |

## 3. Scored rubric (1–5, baseline)
Clarity · Task completion · Hierarchy · Responsive · Accessibility · Speed · Trust · Consistency

| Route | Cl | Task | Hier | Resp | A11y | Speed | Trust | Cons | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| `/` | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | `home--*` |
| `/bids` | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | `trades--*` |
| `/bids/[trade]` | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 3 | `trade-roofing--*`, `trade-kitchen--*` |
| `/pricing` | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | `pricing--*` |
| `/learn`, `/learn/[slug]` | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 3 | `learn--*`, `learn-article--*` |
| `/login` | 4 | 3 | 4 | 4 | 4 | 5 | 3 | 3 | `login--*` |
| `/privacy`, `/terms` | 4 | – | 4 | 4 | 4 | 5 | 3 | 3 | `privacy--*`, `terms--*` |
| 404 | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 3 | `not-found--*` |
| Builder: Company | 3 | 3 | 3 | 2 | 4 | 4 | 4 | 3 | `builder-1-company--*` |
| Builder: Customer & project | 4 | 3 | 4 | 2 | 4 | 4 | 4 | 3 | `builder-2-project--*` |
| Builder: Estimate | 3 | 4 | 2 | 3 | 4 | 4 | 4 | 3 | `builder-3-estimate--*` |
| Builder: Proposal | 4 | 3 | 3 | 3 | 4 | 4 | 4 | 3 | `builder-4-proposal--*` |
| Preview modal / auth gate | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | `builder-5-*`, `builder-6-*` |
| Dashboard, settings, admin | BLOCKED | | | | | | | | `dashboard-blocked--*`, `admin-blocked--*` show the config guard only |

## 4. Findings
| # | Route | Finding | Type | Sev | Recommended fix | Status |
|---|---|---|---|---|---|---|
| F1 | All | Visual identity doesn't match the approved Blueprint Precision brand: warm paper background, burnt-orange accent (brief calls out orange as a cliché), Archivo display font, roofline/house logo (brief: "not a roofline"). | Verified | P1 | Swap token values to navy/cyan/teal/cool gray, Montserrat + Inter, new B + check mark. | Fixed |
| F2 | `/` | Hero H1 "What Are You Bidding Today?" doesn't say what the product does or for whom; CTA labels don't match the brief ("Create a free bid" / "See how it works"). | Verified | P1 | New H1 "Professional bids, without the busywork.", subhead describing real features, brief CTAs. | Fixed |
| F3 | `/` | Primary hero CTA "Start Your Bid" silently opens a *General Contracting* bid, skipping trade choice. | Verified | P2 | Point the primary CTA at the trade picker (`/bids`); the trade cards remain one-click starts. | Fixed |
| F4 | `/` | No sample of the actual client-facing proposal, which is the product's main output. The "Pricing summary" card is labelled illustrative but shows internal numbers only. | Verified | P2 | Render the real `ProposalView` component with clearly labelled example data. | Fixed |
| F5 | Builder (mobile 390) | Project header collapses into a ~300 px tall narrow column: title truncates to "R…", each meta item wraps on its own line, actions squeeze. | Verified (`builder-1-company--mobile`) | P1 | Stack title row above actions on mobile; hide secondary meta (dates, number) below `sm`. | Fixed |
| F6 | Builder | Estimate and Proposal steps have no Back/Next controls; Customer & project has no Back. Users must find the tab strip at the top. | Verified | P1 | Shared step footer with Back / Next on every step; final step leads to Preview and Download. | Fixed |
| F7 | Builder: Company | Button reads "Continue to estimate" but goes to *Customer & project* when no customer is set. | Verified (code + render) | P2 | Label follows the real destination. | Fixed |
| F8 | Builder | Step tabs show numbers but no completion state or "step X of 4", so progress is unclear. | Verified | P2 | Add completion checks (company has name, customer has name, estimate has items) and "Step X of 4" for screen readers. | Fixed |
| F9 | Builder: Estimate | Each section repeats a full-width "Customer sees" select plus helper text, adding ~80 px of chrome per section and pushing line items down. | Verified | P2 | Compact inline control in the section header area. | Fixed |
| F10 | Global | Focus ring uses orange accent at 2 px; on cyan/teal it would fail 3:1 non-text contrast. | Verified (contrast calc) | P2 | Navy-teal focus ring (`#007C91`, 4.89:1 on white) with light variant on navy surfaces. | Fixed |
| F11 | Global | Muted text `#6b7686` on paper `#faf8f4` = 4.3:1 (fails AA for 12–14 px helper text). | Verified (contrast calc) | P2 | Muted `#56677A` (≥5:1 on new surfaces). | Fixed |
| F12 | Global | No favicon set beyond `favicon.ico`; no PWA manifest, apple icon or social preview image. | Verified | P2 | Generated favicon 16/32/48, icon 192/512, apple-touch, `manifest.webmanifest`, 1200×630 OG image. | Fixed |
| F13 | `(app)` sidebar | No active-page indication in the account nav. | Code | P2 | Client nav with `aria-current="page"` and active style; navy sidebar per brand. | Fixed |
| F14 | `/dashboard` | Row action icons are 32 px targets (below 44 px practical target); 7 icons wrap awkwardly on mobile. | Code / hypothesis for mobile layout | P2 | Raise targets to 40 px, group secondary actions. | Partly fixed (40 px targets); grouping into a menu in backlog |
| F15 | `/dashboard` | No explicit sort control (fixed "last edited" order). | Code | P3 | Add sort (last edited, title, total). | Backlog |
| F16 | `/dashboard` | Status filter uses `role=tab` without tab panels. | Code | P3 | Use `aria-pressed` toggle buttons. | Fixed |
| F17 | Global | `site.tagline` / meta description still use old line "What Are You Bidding Today?". | Verified | P2 | Tagline "Build estimates. Create bids. Win more work." | Fixed |
| F18 | `/login` | Login works only when Supabase is configured; locally shows an error after submit. Expected, not a defect. | Verified | – | None. | n/a |
| F19 | `/privacy`, `/terms` | Marked as placeholders pending attorney review. | Verified | P1 (launch) | Owner action. | Backlog (owner) |
| F20 | Lint | 5 pre-existing warnings (`window.location.assign` to internal routes; PDF `<Image>` alt). | Verified | P3 | Leave: assign is intentional for full reloads after auth/Stripe; react-pdf `Image` has no alt prop. | Not changed |

No horizontal overflow was detected on any captured page at 390, 768 or 1440 px (checked programmatically per screenshot).

## 5. Competitor patterns (patterns only, not copied)
Based on general knowledge of the public marketing sites of Houzz Pro (houzz.com/pro), Buildxact (buildxact.com) and Jobber (getjobber.com); **not re-verified in this session**, so treat as directional.
- **Houzz Pro:** strong emphasis on branded client-facing proposals and templates. *Lesson:* show the finished proposal early (F4).
- **Buildxact:** structured estimate → quote workflow with cost catalogues and takeoffs. *Lesson:* clear stepwise flow with visible progress (F6, F8); Built2Bid stays simpler (no takeoffs).
- **Jobber:** quote-to-job continuity, mobile-first field use. *Lesson:* mobile builder must be first-class (F5).
- **Built2Bid's edge to lean into:** no sign-up until download, trade-specific starting sections, markup/margin clarity, customer-visibility modes, honest "no fake local prices".

## 6. Implementation plan (prioritized)
1. Tokens, fonts, focus, buttons (F1, F10, F11).
2. Logo system + favicons/PWA/OG + metadata (F1, F12, F17).
3. Homepage hero, CTAs, sample proposal (F2–F4); header/footer/mobile nav restyle.
4. Builder: mobile header, step progress + Back/Next, label fix, compact visibility control (F5–F9).
5. App sidebar active state + navy, dashboard target sizes and filter semantics (F13, F14, F16).
6. Tests: contrast test for tokens, browser smoke test of the anonymous flow, after screenshots, QA report.

## 7. Remaining issues (prioritized, difficulty not time)
| Priority | Item | Difficulty | Notes |
|---|---|---|---|
| P1 | Visual QA of signed-in pages on the deploy preview | Low | Needs a session; see QA-RESULTS manual steps. |
| P1 | Attorney review of privacy/terms; real support email + domain | Owner | Placeholders today. |
| P1 | Trademark/usage check of the Built2Bid name and mark before launch | Owner | Not done. |
| P2 | Compare logo with the approved board image | Low | Image not provided. |
| P2 | Dashboard: group secondary row actions into a menu on mobile; add sort | Medium | F14, F15. |
| P2 | Estimate step on mobile: line-item table scrolls horizontally inside the card (min 860 px) | Medium–high | Card layout for rows on small screens. |
| P2 | Auto-scroll the active builder step tab into view on mobile | Low | |
| P3 | Lighthouse pass and font subsetting | Low–medium | |
| P3 | Analytics events listed in the brand strategy (start-bid, draft, export, upgrade) | Medium | No analytics provider is wired today. |
