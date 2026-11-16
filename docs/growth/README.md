# Growth engine

Owner spec: "Built2Bid master growth engine" (Nov 16, 2026). It ships as a sequence of reviewable PRs
that extend what already exists instead of adding parallel systems.

| PR | Scope | SQL | Live effect |
|---|---|---|---|
| 1 | First-bid activation: dashboard first-bid prompt, activation checklist, 7-day activation metric, event dedupe | `20261117001000_growth_activation.sql` | Visible to users (dashboard) |
| 2 | Top-10 trade landing pages (same `/bids/[trade]` URLs) | none planned | Visible |
| 3 | Conversion events from real transactions; Meta Pixel/CAPI + GA4 events, built **off** | small | None until switched on |
| 4 | Lifecycle emails A–E on the existing outbox + Resend, sending **off** | yes | None until approved |
| 5 | `/admin/marketing` additions: activation, CAC payback, creatives, filters, creator hooks | maybe | Owner only |
| 6 | Ad briefs, $600/month test plan, approval gate (docs) | none | None |

Hard rules: paid campaigns stay paused; no sends, merges, deploys or spend without the owner's OK.

## Audit (Nov 16, 2026)

Reused, unchanged: first-touch UTM cookie (`b2b_attr`, `src/proxy.ts`, `src/lib/growth/attribution.ts`) and
`leads`; `/admin/marketing` channel/campaign/landing reports and manual spend; GA4 tag; welcome video +
7-step tour (`src/components/onboarding/`); guest drafting with sign-in only at download (draft moves to
the account under its own id, so a refresh or callback retry can't duplicate it); website branding
import (`src/lib/import/website.ts`, SSRF-guarded); Resend `email_outbox`; referrals; complimentary grants.

Gaps found: fixed 10-name event list with no preview/first-bid/activation events (and `preview_opened`
was never recorded); `account_created` logged twice per signup (auth callback + signed-in sync); no
Meta Pixel/CAPI and no consent banner; no lifecycle emails; "activated" only meant "finalized a bid";
Creator Partner program not in code yet.

Baseline (production, read-only, Nov 16): 8 accounts not labeled test/internal (several are likely the
owner's own logins), 6 started a bid, 3 finalized, 4 estimates with 3+ priced items, 0 paying, 0 with UTM
data, 0 marketing opt-ins.

See [ACTIVATION.md](ACTIVATION.md) and [EVENTS.md](EVENTS.md).

## PR 2: trade landing pages

Priority trades (decks, general contracting, painting, roofing, concrete, kitchens, bathrooms, flooring,
electrical, siding, drywall) get conversion copy layered on the existing `/bids/[trade]` pages
(`src/lib/trades/landing.ts`): trade headline and CTA, pain points, a real sample proposal image, the
existing walkthrough video (`preload="none"`), a calculator explainer that matches
`src/lib/calculators/mapping.ts`, and markup/margin + the four price displays. Routes, titles, canonical
URLs, FAQ JSON-LD, guides and related-trade links are unchanged; other trades render as before.

Sample proposals are rendered by the real proposal engine with example data
(`npx vitest run -c scripts/growth/vitest.samples.mts` → `public/media/proposals/<trade>-v1.webp`).
Copy guardrails are tested (`tests/trade-landing.test.ts`: no speed/profit/% claims or testimonials).
Browser walk: `scripts/growth/landing-walk.mjs` (11 trades × desktop/390px, CTA opens a builder draft).

## PR 4: lifecycle emails

Five onboarding emails on the existing `email_outbox` + Resend, **off** until `LIFECYCLE_EMAIL_MODE` is
set. Rules, copy, env vars and the owner checklist: [LIFECYCLE_EMAILS.md](LIFECYCLE_EMAILS.md).

## PR 5: owner growth dashboard

`/admin/marketing` additions, all from first-touch records (no SQL):
- Channel table: 7-day activation beside finalized, and **CAC payback** (CAC ÷ average current list-price MRR
  per paying account; complimentary access is never revenue). Payback also shows under the spend KPI.
- **Creative performance** by `utm_content`: signups, started bid, 7-day activated, finalized, paying, MRR.
- **Creator Partners**: new `creator` channel (`utm_medium=creator|partner|influencer` or `utm_source=creator`,
  `utm_campaign` = creator). Paid means a real Stripe subscription; complimentary accounts are a separate column.
- **Trade-level conversion** table, and funnel filters for creative, trade and current plan (free, paid, complimentary) beside channel, campaign, landing page and device. Creator-referred vs other = the Creator Partners channel filter.

Browser walk: `scripts/growth/dashboard-walk.mjs` (mock command-center seed). Tests: `tests/growth-reports.test.ts`.

## PR 6: ad briefs and test plan

[ADS.md](ADS.md): concepts A–E with hooks and required real screen recordings, the asset list, a reusable
video QC checklist, the UTM/creative naming standard the dashboard reads (tested in
`tests/growth-reports.test.ts`), the $600/month test plan with labeled economics and stop/scale rules, and
the owner approval gate. Planning only: nothing is launched or funded.
