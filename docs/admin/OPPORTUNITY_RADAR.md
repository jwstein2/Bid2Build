# Opportunity Radar (Marketing → Opportunity Radar)

Owner-only tool for finding contractors who are already asking about estimating, answering them well,
and mentioning Built2Bid only when it genuinely helps. **Find the question → understand the problem →
useful advice → introduce Built2Bid when appropriate → answer one follow-up → close.**

Nothing in this release reads from, posts to, or messages any external platform. Every discussion is
pasted in by the owner, and every reply is approved by the owner and posted by the owner, by hand.

## Pages

| Route | What it does |
| --- | --- |
| `/admin/marketing/radar` | Status tiles, manual import, opportunity table with filters (source, trade, intent, status, date), outcome reporting, source performance, pain-point trends, cost and settings |
| `/admin/marketing/radar/[id]` | Discussion, score breakdown, conversation (reply 1, follow-up, reply 2), approval queue actions |
| `/admin/marketing/radar/sources` | Source registry and compliance/API matrix, owner confirmations per source |
| `/admin/marketing/radar/digest` | Weekly digest generated on demand (top 5, why, suggested reply, follow-ups, problems, content ideas, conversions, blockers) |

Linked from the Marketing page header and the Tools menu. Authorization: the admin layout and every
page and server action call `requireAdmin()` (platform admins only, 404 for everyone else). Every action
writes `audit_logs`.

## Workflow

1. **Import** a discussion: link, title, the original post text (first 1,500 characters kept), date and
   answer count. Duplicates are caught by canonical URL hash and platform discussion id (Reddit post id,
   forum thread id, YouTube video/comment id), so `old.reddit.com/...`, `redd.it/...` and share links with
   tracking tags all resolve to one record.
2. **Classify and score** (rules only, no AI cost): priority A (buying intent), B (workflow frustration),
   C (educational), D (poor fit: CAD/blueprint takeoff, commercial/MEP, ERP, coursework), X (not relevant,
   auto-archived). Score 0–100 from nine visible factors; 80+ high-priority, 60–79 potential, 40–59
   research, under 40 archive. The score is a review priority, not a purchase probability.
3. **Draft reply 1**: rules engine (free) or "Draft with AI" (optional, budgeted). Advice first; Built2Bid
   is mentioned only for A/B and relevant C, always with founder disclosure; free bids only for A/B; a
   tracked link only where the owner confirmed links are allowed. Phrasing varies per discussion.
4. **Review**: guards flag unsupported claims (takeoff, QuickBooks/integrations, scheduling/invoicing/
   CRM, invented stats or testimonials), missing disclosure, links where not allowed, near-duplicate text
   (≥60% overlap with any approved/posted reply), leftover placeholders and prompt-injection attempts.
   Blocking flags must be edited away; other flags need an explicit "I checked" tick.
5. **Approve → Copy response → Open discussion → post it yourself → Mark posted manually** (optionally
   with the link to your comment). A reply only counts once it is marked posted (or, in future, once a
   platform API confirms it with a reply id).
6. **Follow-up**: if someone replies directly to you, paste their reply. Reply 2 answers it (pricing,
   phone use, trades, markup/margin, what customers see, e-sign, scope/exclusions), never repeats the
   link, thanks them and closes. Integration, billing/support, team, legal/tax, safety and unrecognized
   questions are marked for the owner to answer personally instead of guessing.
7. **Close**: after two posted replies the conversation is Completed: no drafting, no follow-up form, no
   digest suggestions. The owner can **reopen** with a reason for exactly one more (support) reply.

### Two-reply cap is enforced in Postgres

`radar_drafts` triggers refuse: drafting reply N unless it is `owner_replies_used + 1`; reply 3+ without an
explicit reopen; drafting on rejected/archived/completed discussions; posting an unapproved draft;
`published` without a platform reply id; editing or deleting posted replies. See
`supabase/migrations/20261116001000_opportunity_radar.sql` and `tests/db/radar.test.ts`.

## Compliance and API matrix (reviewed 2026-11-15; owner to confirm)

Rules live in `src/lib/radar/sources.ts` and can only change through a pull request. The database stores
only owner confirmations, and a "forbidden" capability can never be recorded as authorized.

| Source | Discovery today | Automated discovery | API publishing | Links by default |
| --- | --- | --- | --- | --- |
| Reddit | Manual import | Needs Reddit app approval (Responsible Builder Policy; commercial use needs agreement) | Needs approval | No |
| Skool (Construction Contractors Hub, others) | Manual import | **Prohibited** (no scraper/bot, ever) | **Prohibited** | No |
| YouTube comments | Manual import | Official Data API v3, needs key + owner enablement | comments.insert via owner OAuth, needs authorization | No |
| Facebook public discussions | Manual import | **Prohibited** (no Groups API; Meta automated collection terms) | **Prohibited** | No |
| LinkedIn | Manual import | **Prohibited** | **Prohibited** | Yes |
| Contractor Talk, PaintTalk, LawnSite, WOODWEB, HVAC-Talk, Fine Homebuilding, Jobber Community, Sage Community, Houzz, trade associations, other forums | Manual import | **Prohibited** | **Prohibited** | No (most forums restrict vendor promotion) |

Never: scraping, proxies, alternate accounts, fingerprint evasion, CAPTCHA bypass, Apify-style actors,
automated DMs, collecting member lists or contact details.

## Data minimization and privacy

Stored: canonical link, title, the excerpt the owner pasted (≤1,500 chars), scores, topics, the owner's
own replies and minimal follow-up text. Not stored: author names, profiles, emails, phone numbers.
"Author removed it" deletes the stored text immediately. "Clear old pasted text" (and
`radar_purge_content()`) clears text on closed items older than the retention setting (default 90 days).
Forum text is untrusted: it is sanitized, rendered as plain text, wrapped in delimiters for AI, and
instruction-like content is flagged; AI output goes through the same guards.

## Cost

Classification, scoring and rules drafts cost nothing. AI drafting is off by default; when enabled it
uses `RADAR_AI_MODEL` (default `claude-haiku-5-5`), is logged in `radar_usage`, and stops at the monthly
Radar budget (default $5). Daily import cap (default 50). No paid scraping or monitoring service, no
scheduled jobs, no new infrastructure.

## Attribution

Tracked links use `utm_source=<platform>&utm_medium=community&utm_campaign=opportunity_radar` and nothing
else (no user, thread or account ids). Reporting reads the existing first-touch signup records, so a Radar
click never overwrites how an existing user originally arrived. Signups, first bids, activations and
paying accounts are shown as observed outcomes only; posting near a signup is never treated as causing it.

## Owner setup

1. **Apply the migration** `supabase/migrations/20261116001000_opportunity_radar.sql` to a preview/branch
   database first, then production when approved. Additive only; rollback in
   `supabase/rollback/20261116001000_opportunity_radar_down.sql`. Until it is applied the Radar page shows
   a "migration not installed" notice and nothing else is affected.
2. **Per source** (Sources & compliance): confirm which communities allow links; turn off sources you
   won't use. Ask Skool community moderators before mentioning Built2Bid.
3. **Optional AI drafting**: the existing `ANTHROPIC_API_KEY` is reused. Set `RADAR_AI_MODEL` only to
   override the default cheap model, then tick "Allow AI drafting" and set the budget.
4. **Optional, later (requires your approval before any work):** Reddit developer application for API
   monitoring; YouTube Data API key (Google Cloud, free quota 10,000 units/day) and channel OAuth for
   replies.

## Not in this release (next steps)

- YouTube Data API connector (comment discovery + reply monitoring) and any API publisher. The gates,
  `publish_pending → published` confirmation states and quota ledger are in place; no code calls an API.
- Reddit API connector, only after Reddit approval.
- Automatic follow-up detection (needs an authorized API); follow-ups are logged manually today.
- Email/Slack notification and a scheduled weekly digest email: the repo has no admin notification
  channel yet, so attention counts show on the Radar page and the digest is generated on demand.
- Website visits per Radar link (needs GA4 Data API, see Marketing).
- A "Tech Stack & Costs" dashboard does not exist in this codebase; Radar costs are shown on the Radar
  page (and in `radar_usage`) ready to feed one.

## Tests

- `tests/radar.test.ts`: owner-only guards, compliance gates, dedupe, classification/scoring, drafting,
  claims, disclosure, similarity, follow-up, state machine, budgets, UTM, prompt injection, nav intact.
- `tests/db/radar.test.ts`: RLS lockout, dedupe constraints, two-reply cap, approval before posting,
  platform confirmation, reopen, retention purge.
- `scripts/radar/walk.mjs`: end-to-end browser walk against real SQL (41 checks, screenshots in
  `docs/admin/radar/screenshots`).
