# Built2Bid functional QA audit (local, $0)

Real-browser (Playwright + Chromium) tests that click through the app against a **local** copy of the whole stack:
local Supabase (Postgres, Auth, Storage, Mailpit) with every migration applied, and a production build of the app.
No paid services, no live Stripe, no real email. `lib.mjs` refuses to run unless every target is localhost.

## 1. Start the local stack

```bash
sudo dockerd > /tmp/dockerd.log 2>&1 &          # if Docker isn't running
mkdir -p /tmp/sbproj && cd /tmp/sbproj
npx supabase@2 init
cp -r <repo>/supabase/migrations <repo>/supabase/seed.sql <repo>/supabase/templates supabase/
```

The CLI refuses duplicate migration versions. Rename the duplicates in the copy only (bump the later file's
version by 1); see "F2" in the audit report. In `supabase/config.toml`: set `site_url = "http://localhost:3000"`,
raise `[auth.rate_limit] email_sent`, and point the magic-link / confirmation templates at the repo templates
(they print the 6-digit `{{ .Token }}`). Then:

```bash
npx supabase@2 start      # prints the API URL, keys and Mailpit URL
```

## 2. Build and start the app

`.env.local` (gitignored) pointing at `http://127.0.0.1:54321` with the printed keys, a dummy Stripe key
(`sk_test_...` that is not real, so checkout stops at Stripe), and `NEXT_PUBLIC_FINANCIALS=on`,
`NEXT_PUBLIC_PROJECT_SCHEDULING=on`, `NEXT_PUBLIC_ESIGNATURES=on`, `COMM_EMAIL_MODE=off`. Optional:
`PRACTICE_MODE=on` for the Practice Mode test.

```bash
npx next build && npx next start -p 3000
```

## 3. Run

```bash
export QA_OUT=/tmp/qa            # screenshots, results-*.jsonl, crawl-*.json, inventory.json
node scripts/qa-audit/seed.mjs   # synthetic @audit.test users (owner/admin, free, Unlimited, Team owner/estimator, reps, sales admin, outsider)

# Flows (order matters a little: bids makes the finalized bid the later flows use)
node scripts/qa-audit/flows/auth.mjs
node scripts/qa-audit/flows/admin-grants.mjs
ROLE=free node scripts/qa-audit/flows/bids.mjs; ROLE=pro node scripts/qa-audit/flows/bids.mjs
ROLE=pro node scripts/qa-audit/flows/contractor-core.mjs; ROLE=free node scripts/qa-audit/flows/contractor-core.mjs
node scripts/qa-audit/flows/library.mjs
node scripts/qa-audit/flows/sales-team.mjs
node scripts/qa-audit/flows/sales-crm.mjs
node scripts/qa-audit/flows/enterprise.mjs
node scripts/qa-audit/flows/projects-financials.mjs
node scripts/qa-audit/flows/pm.mjs
node scripts/qa-audit/flows/esign-misc.mjs
node scripts/qa-audit/flows/uploads.mjs

# Crawler: every visible link, field and button on each route, per role (fresh browser context per click)
ROLE=anon ROUTES=/,/pricing node scripts/qa-audit/crawl.mjs
ROLE=owner MOBILE=1 ROUTES=/dashboard node scripts/qa-audit/crawl.mjs

node scripts/qa-audit/summarize.mjs [--fails]   # inventory.json + counts
```

When running several scripts at once, give each its own `QA_STATE_TAG=<name>`: two processes sharing one saved
session trip Supabase's refresh-token reuse detection, which signs both out.

## Results

Each test records PASS / FAIL / BLOCKED with evidence (DB rows, HTTP status, screenshots in `$QA_OUT/shots`).
BLOCKED means it can't be tested safely or for free here (live Stripe webhooks, features not built yet) and says why.
Some flows use a database fixture where the only real path is a Stripe purchase (Financials and scheduling seats on
the complimentary grant); each one says so in a comment.
