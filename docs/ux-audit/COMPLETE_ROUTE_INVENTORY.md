# Complete route inventory

Audited 2026-11-13 on branch `claude/project-thread-yo7h1t` (base `main` @ df4c05a).

**How pages were rendered.** Local production build (`next build && next start`). Signed-in pages were rendered against `scripts/ux-audit/mock-supabase.mjs`, a local stand-in for Supabase that returns test data (test user `ux-test@built2bid.test`, 3 bids, 4-section siding estimate). No production data, accounts or Stripe calls were used. `/admin/*` needs the Supabase service key, so it returned 500 locally and was reviewed from code only.

**Screenshot naming.** `<route id>__<width>x<height>[-landscape].jpg`. Full set (198 before + 198 after + interaction shots) in the project files: `ux-audit/screenshots-full-2026-11-13.tgz`. A curated subset is committed under `docs/ux-audit/screenshots/2026-11-13/`. Raw per-viewport data, including overflow offenders and small touch targets, is in `before/overflow-report.json` and `after/overflow-report.json` there.

Viewports: 320, 375, 390, 430 (portrait, mobile emulation), 768, 1024, 1440, plus landscape 667×375 and 844×390. Cell = horizontal page overflow before → after (`ok` = none).

| Route id | Path | Auth | HTTP | 320x800 | 375x800 | 390x800 | 430x800 | 768x900 | 1024x900 | 1440x900 | 667x375 | 844x390 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home | `/` | public | 200 | 325px → ok | ok | ok | ok | ok | ok | ok | ok | ok |
| trades | `/bids` | public | 200 | 325px → ok | ok | ok | ok | ok | ok | ok | ok | ok |
| trade-siding | `/bids/siding` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| pricing | `/pricing` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| learn | `/learn` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| learn-article | `/learn/markup-vs-margin` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| login | `/login` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| privacy | `/privacy` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| terms | `/terms` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| not-found | `/nope-404` | public | 404 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| builder-anon-company | `/start/siding` | public | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| dashboard | `/dashboard` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| customers | `/dashboard/customers` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| items | `/dashboard/items` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| templates | `/dashboard/templates` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| company | `/settings/company` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| billing | `/settings/billing` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| pricing-data | `/settings/pricing` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| account | `/settings/account` | signed in | 200 | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| estimate | `/estimates/11111111-1111-4111-8111-111111111111` | signed in | 200 | 813px → ok | 813px → ok | 814px → ok | 813px → ok | 821px → ok | ok | ok | 821px → ok | ok |
| estimate-proposal | `/estimates/11111111-1111-4111-8111-111111111111?step=proposal` | signed in | 200 | 331px → ok | ok | ok | ok | ok | ok | ok | ok | ok |
| admin | `/admin` | signed in | 500 | ok | ok | ok | ok | ok | ok | ok | ok | ok |

## Routes not screenshotted

| Path | Why | How it was checked |
|---|---|---|
| `/admin`, `/admin/templates`, `/admin/flags`, `/admin/logs`, `/admin/audit`, `/admin/market/*`, `/admin/proposal-text`, `/admin/sales` | Uses the service-role key (not available locally); returns 500 in the mock setup | Code review; admin pages were not changed |
| `/auth/*`, `/api/*` | No UI | Unchanged by this work |
| `/builder?draft=…` (anonymous) | Covered as `builder-anon-company` (redirect from `/start/siding`) and the anonymous journey in the interaction checks | Screenshots + interaction checks |

Interaction-state screenshots (after): `docs/ux-audit/screenshots/2026-11-13/interactions/` — menu open (mobile), section with suggestions after two picks, picker multi-select, proposal preview dialog, new siding estimate at 320px.
