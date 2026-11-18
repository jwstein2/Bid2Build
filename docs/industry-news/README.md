# Industry Intelligence & Industry News (V6.8 + V6.8.1)

Free for every plan (Free, Unlimited, Enterprise, complimentary). Personalized from the company profile you already have, with no double entry and no GPS.

## What ships

| Surface | Path |
|---|---|
| Full page with filters, search, sort, Saved/Hidden views and sample mode | `/industry` (`?sample=1` shows fictional samples) |
| Preferences (trades, service counties, topics, sources, hidden publishers, opt-in alerts) | `/industry/preferences` |
| Public source list, credibility labels, associations per trade, unavailable sources | `/industry/sources` |
| Dashboard widget "Your Industry Briefing" | `src/components/news/industry-briefing-widget.tsx` (gets registered in the V6.6 dashboard registry once PR #122 merges) |
| Owner Source Health (run, disable, exclude, overrides, failures, cost and engagement) | `/admin/news` |
| Universal Search | "Industry News · public articles" section, kept apart from company records |

## Pipeline

1. **Ingest once per source, personalize at query time.** `netlify/functions/news-cron.mts` runs daily at 10:20 UTC and calls `/api/cron/news` in three phases: fetch, summarize, purge. Each source has its own cadence. Requests are conditional (ETag/Last-Modified), time out after 10 s and are capped at 3 MB.
2. **Verify.** Only https links on the publisher's own host that point at a specific article are kept. Each item needs a real publication date: dates in the future and links to a homepage are rejected. Tracking parameters are stripped. Duplicates are dropped by URL and by headline fingerprint within 3 days, and the more authoritative copy is kept.
3. **Classify.** Trades, topics, geography (Local/State/Regional/National) and article type are matched by keyword from the item's own text, with exclusions (for example, "political landscape" never counts as landscaping). Federal rules are always National.
4. **Summaries (V6.8.1).**
   - Federal Register items are public domain. Haiku writes them in a "What happened" format from the agency abstract only. A guard rejects any summary that adds a number not in the source, drops the "proposed" label, claims a rule is final when it isn't, or gives advice. Rejected summaries are not stored.
   - FEMA summaries are built from the declaration's own fields. No AI is involved.
   - Trade press items show the publisher's own short description, trimmed to about 300 characters and labeled "From {publisher}". No AI is involved.
   - OSHA releases show the headline only, because their feed has no description.
   - "Why it matters to your business" is deterministic and personalized per reader at no cost.
5. **Read original article** opens on the publisher's site with `target="_blank" rel="noopener noreferrer"`.

## Geography rules

- **Local** means the item names one of your service counties (set in Preferences) or your city.
- An item from elsewhere in your state is labeled **State**. National news is never called local.
- Items about other states are hidden.

## Environment variables (owner)

| Var | Default | Meaning |
|---|---|---|
| `NEWS_INGEST_ENABLED` | off | Set to `true` in Production to start the daily ingestion. Nothing runs until then. |
| `NEWS_AI_SUMMARIES` | on | Set to `off` to stop Haiku summaries. Federal items then show the agency abstract. |
| `NEWS_AI_MONTHLY_BUDGET_USD` | 2 | Hard monthly cap. AI calls stop when it is reached. |
| `NEWS_AI_MAX_PER_RUN` | 15 | Maximum number of summaries per daily run. |

The job reuses `EMAIL_OUTBOX_SECRET` for cron authorization and `ANTHROPIC_API_KEY` for Haiku. It sends no email: alert preferences are stored only, and email digests need owner approval before they are built.

## Cost estimate

- Feeds: $0. Every source is a free RSS feed or a free government API, and no paid news APIs are used.
- AI: Federal Register volume across OSHA, DOE EERE, EPA (construction-relevant only) and DOL WHD is about 2–6 items a day. Each summary is about 450 input and 150 output tokens on Haiku, a fraction of a cent. Expect **under $0.50 a month**, hard-capped at `NEWS_AI_MONTHLY_BUDGET_USD` ($2).
- Database: a few thousand small metadata rows. Rows expire after 120 days for press and 365 days for official sources.
- Network: about 18 conditional fetches a day, most of which return 304.

## Sources

There are 18 active sources, all checked on 2026-11-18 (see `src/lib/news/sources.ts`):

- **Official:** Federal Register (OSHA, DOE EERE, EPA, DOL WHD), OSHA news releases, OpenFEMA disaster declarations.
- **Industry:** Eye on Housing (NAHB), Construction Dive, JLC, ACHR News, Roofing Contractor, Plumbing & Mechanical, Walls & Ceilings, Landscape Management, Lawn & Landscape, Floor Covering News, For Construction Pros.

**Unavailable, recorded and not used:**
- Association newsrooms (NRCA, NECA, ACCA, PHCC, NALP and others): no public feed. They are listed as references only.
- Qualified Remodeler: bot challenge.
- EC&M, Electrical Contractor and Professional Remodeler: feeds return 404.
- Masonry Magazine: the feed redirects to HTML.
- BLS: links go to the homepage, not to articles.
- NYT and Google News: terms.
- Reddit: needs an approved API app.
- Paid news APIs: need owner approval.

The site never implies membership in or endorsement by any association.

## Trade registry

All 38 trades in `src/lib/trades/data.ts` are mapped in `src/lib/news/trades.ts`. Each entry has associations (name, URL, role), publications, official sources, topics, strong and related keywords, exclusions, geography emphasis and market. A test enforces exactly 38.

## Tests

- `tests/industry-news.test.ts`: 47 tests on mocked feeds covering the registry, parsers, verification, classification, ranking, summaries and guard, ingestion (dedupe, conditional GET, cadence, failures, budget), preferences, fixtures and cards.
- `tests/db/industry-news.test.ts`: 7 tests against the real SQL covering published-only reads, private preferences and saved state, company defaults permissions, search isolation and purge.
- Screenshots are produced by `scripts/industry-news/setup-db.mts`, which ingests the mocked feeds through the real pipeline into a throwaway database, with the UX mock and `PG_REST_PREFIXES=news_`.

## Database

The migration is `supabase/migrations/20261221001000_industry_news.sql`. A paste-ready copy and a rollback are in the project files under `industry-news/`.
