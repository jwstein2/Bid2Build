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
