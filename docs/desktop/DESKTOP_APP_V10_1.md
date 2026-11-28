# Built2Bid V10.1: installable desktop app

**Status: READY FOR OWNER REVIEW** (not yet "ready for production": it still needs the install test on a real Windows
and Mac computer, listed under "Still to test" below).

## 1. What already existed (audit)

| Area | Finding |
|---|---|
| Manifest (`src/app/manifest.ts`) | Already installable: name Built2Bid, `id: "/"`, `display: standalone`, start page `/home` or `/dashboard`, official icons 192/512/maskable/SVG, time-clock shortcut. |
| Install button (`install-app-button.tsx`) | Homepage + crew "My work" button. Opens Chrome/Edge's own install dialog, or per-browser iPhone steps. Phone-focused wording. |
| Service worker | **None.** Nothing is cached offline today, so the installed app can't get stuck on an old copy. |
| HTML caching | Netlify serves every page `private, no-cache, no-store`. Every launch of the installed app loads the current production release. |
| Version skew | No build id or version check. A window left open across a deploy keeps running old code until the next navigation fails or someone reloads. |
| Sign-in | Supabase **email 6-digit code** (PR #32), optional SMS (off), and an authenticator step for admins (PR #289). **No passwords exist.** |
| Entitlements | All server-side (Supabase RLS, `getUser`, plan/seat checks, Stripe reconciliation). The installed app is the same origin, cookies and routes, so it gets exactly the same access. |
| Android | `android/` Kotlin WebView shell for the crew GPS clock (PR #215). Not affected. |
| Security headers | HSTS, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, nosniff, Permissions-Policy (geolocation self only). |

## 2. Architecture decision: Path B (improve the existing installable web app)

The installed app **is** built2bid.org in its own window (Chrome/Edge on Windows and macOS, Safari "Add to Dock" on
macOS Sonoma+). One frontend, one backend, one deploy.

Electron/Tauri were not used. No required capability is missing from the web app (uploads, downloads, printing/PDF,
OAuth, Stripe portal, notifications all work in an installed web app). A wrapper would add code signing (~$200-500/yr
for Windows plus the $99/yr Apple program), a native updater, a second release process and a larger attack surface,
with no gain in features or updates.

## 3. What changed

| File | Change |
|---|---|
| `src/app/manifest.ts` | Desktop icon sizes 256 and 1024, `display_override`, `launch_handler: focus-existing` (a second launch focuses the open window), categories, language, wide screenshots for Chrome/Edge's richer install dialog. `id` stays `/` so existing installs keep working. |
| `public/brand/icon-256.png`, `icon-1024.png` | Rendered from the official mark tile (`built2bid-mark-tile.svg`) by `scripts/brand/brand_pngs.mjs`. |
| `public/brand/screenshots/*.webp` | Install-dialog screenshots from Practice Mode (sample data only, Practice banner cropped). |
| `public/sw.js`, `public/offline.html` | Tiny service worker: only when a page load fails with no internet it shows the branded offline page. **Caches nothing else.** Non-GET and non-page requests are never touched. |
| `src/app/api/version/route.ts` | Returns the running build id (`no-store`) plus `required` for urgent releases. |
| `src/components/pwa/app-runtime.tsx` (root layout) | Registers the worker, shows "You're offline. Connect to the internet to continue using Built2Bid.", and checks for a new release 20s after load, when the window regains focus, when the connection returns and every 10 min. A failed script load from an old deploy also counts. Then it shows "Built2Bid has been updated. Refresh to use the latest version." |
| `src/lib/pwa/unsaved-work.ts` | When there's unsaved work, Refresh first says "Save your work first, then refresh", offering "I'll save first" or "Refresh anyway". This covers any text field typed into, plus the bid builder while a save is pending or failed. The builder also keeps its existing local draft copy. |
| `src/lib/pwa/install-prompt.ts` | One shared store for the browser's install event (it fires once and early), plus device/browser detection. |
| `src/components/pwa/install-desktop-card.tsx` | "Install Built2Bid on your computer" card: Chrome/Edge show their own install dialog when offered. Otherwise the card gives short steps for Chrome, Edge, or Safari (File → Add to Dock). On Firefox or older Safari it says to use Chrome or Edge and offers a copy-link button. Hidden inside the installed app. Shown: Account settings (`#install-app`), after Individual checkout success, after Team checkout success (dismissible). |
| `src/components/layout/app-nav.tsx` | Discreet "Install desktop app" menu item under Help (hidden in the app, on phones, and once installed). |
| `src/app/(marketing)/login/page.tsx`, `layout.tsx`, `globals.css` | Sign-in screen: official logo, "Welcome back to Built2Bid", "Win the job. Run the job. Grow the business." Inside the installed app, the marketing header/footer are hidden on this screen only. |
| `next.config.ts`, `netlify.toml`, `src/proxy.ts` | `NEXT_PUBLIC_BUILD_ID` (Netlify `DEPLOY_ID`), promotion flag, `no-cache` for `sw.js`/`offline.html`, those two plus `/api/version` skip the session proxy. |
| `tests/desktop-app.test.ts` | 10 unit tests. |

No database change, no SQL, no Stripe change, no Academy billing code touched.

## 4. Sign-in: conflict with the spec (decision for James)

The spec asks for Email + Password + Forgot Password. Built2Bid has **no passwords**: everyone signs in with an emailed
6-digit code (PR #32), and new accounts are created the same way. Adding passwords would change the sign-in for every
customer and the admin two-step flow, so it was **not** done. Instead the screen keeps the code sign-in: "Create
Account" is the same Continue with email step, and "Forgot password" doesn't apply. The installed app uses the identical
sign-in, session cookies, two-step and sign-out as the website.

## 5. Test results

**Automated, real production builds in Chromium (Linux, headless): 18/18 passed** (`docs/desktop/update-sync-test.mjs`)

- HTML `no-store`; `sw.js` `no-cache`; `/api/version` `no-store`.
- Chromium installability check: **no errors**; manifest parsed with no errors.
- Service worker registered and controlling; the only cache entry is `/offline.html`.
- Version A open with typing in a field → deployed version B → open window showed "Built2Bid has been updated…" within
  about 15 s → Refresh asked to save first and kept the text → Refresh anyway loaded version B's visible change with no
  reinstall → banner gone once current.
- Offline: in-app banner appeared; launching a page offline showed the Built2Bid offline page.
- "Weeks later": browser closed, two more deploys, relaunched from the same profile → current release loaded at once and
  client/server builds matched.

**Unit tests:** full suite 2,510 passed, 1 failed. The failure (`tests/theme.test.ts` ".theme-light restate") fails on
`main` too and is unrelated. Typecheck passed; lint has no new warnings.

**Entitlements / Stripe:** unchanged by design: same origin, same cookies, same server checks. Installing grants
nothing. Free stays free, Individual Unlimited, Team seats, Sales Hub, Academy and admin all keep their existing checks.
No new prices, plans or seats.

**Security:** no new permissions, no file-system access, no native code. The worker caches no auth, customer, financial
or billing data. CSP, HSTS and frame-blocking unchanged. `/api/version` exposes only an opaque deploy id.

## 5a. Same access and same view as the website (double-check, 2026-11-27)

- **Access is decided on the server, never by the app.** Nothing in this PR touches plans, seats, roles, Stripe or
  database rules. The app is the same address (built2bid.org), so every page and API call goes through the same
  sign-in check (`src/proxy.ts`, `getUser`), plan/seat checks and Supabase row-level security as the website. No code
  anywhere grants or hides features based on "installed app" (`display-mode` is only used to label a crew clock-in as
  "pwa" for the record). Access, plan, seat, Sales Hub and dashboard tests: 392/392 pass.
- **Same sign-in.** Chrome and Edge install the app into the same browser profile, so the app and the website on that
  computer share one sign-in: sign in or out in one and the other follows. Safari's Dock app keeps its own sign-in.
- **Saved on the account (same on every device and in the app):** Home and Financials dashboard layouts per mode, plus
  company/role default layouts (`/api/dashboard/layout` → `dashboard_layout_*` database functions; the server also
  drops any widget the person's plan doesn't allow), theme (also saved to the account), landing page choice, bids,
  customers, projects, and Sales pay settings once saved.
- **Kept in the browser only (same in the app and website on one computer, not shared across devices):** "More tools"
  open/closed in the menu, Projects calendar filters, dismissed tips, and Academy Study session/missed-question/history.
  The Academy study history is the one item worth moving to the account later (Academy is being changed in another
  thread, so it was not touched here).

### Still to test (needed before "READY FOR PRODUCTION")

Headless Chromium can't run as an installed app, so these need a real computer (deploy preview or production):
Windows 11 Chrome + Edge, macOS Chrome + Safari. For each: install, desktop/Start/Dock icon, launch into sign-in, email
code sign-in, deep link, Stripe portal round trip, QuickBooks/Plaid OAuth return, PDF download and print, file upload,
sign-out, offline, and an update after a deploy. The sign-in preview above (`06-installed-login-simulated.png`)
**simulates** the installed window by applying the same CSS rule. It isn't a real install.

## 6. Browser support

| Browser | Install | Notes |
|---|---|---|
| Chrome (Windows, macOS, ChromeOS, Linux) | Yes, own install dialog | Full support. |
| Edge (Windows, macOS) | Yes, own install dialog | Full support. |
| Safari 17+ (macOS Sonoma+) | File → Add to Dock | The Dock app keeps its own website data, so people may need to sign in once inside it. Update checks work. |
| Safari 16 and older, Firefox (desktop) | No | The card says to use Chrome or Edge and offers a copy-link button. |
| iPhone/iPad/Android | Existing home-screen steps | Unchanged. |

Install state can't be detected perfectly: the card hides inside the app and once this browser has installed it, but
can't tell if someone uninstalled it.

## 7. Feature flags and rollback

- `BUILT2BID_DESKTOP_INSTALL_ENABLED` (Netlify, build time): on by default; `off` hides the menu item and install
  cards. Installed apps and the website keep working.
- `BUILT2BID_REQUIRED_UPDATE=on` (runtime): for an urgent security release, open windows on an older build must
  refresh (still offered "save first"). Remove after the release.
- Service worker rollback: ship a `sw.js` that calls `self.registration.unregister()`. Browsers re-check it on every
  launch.
- Recommended: set `NETLIFY_NEXT_SKEW_PROTECTION=true` in Netlify. Netlify then serves a window that's still on the
  previous release from that release while it navigates, so nothing breaks before the refresh prompt.

## 8. Maintenance cost

About $0 a month. There's no store fee, no code signing and no separate build, and new web features show up in the app
automatically. The only upkeep is checking the install steps wording once a year as browsers rename menus.

## 9. Recommendation

Merge after review, set `NETLIFY_NEXT_SKEW_PROTECTION=true`, then run the real Windows/Mac install checklist above. Only
then call it production-ready and promote it more widely.
