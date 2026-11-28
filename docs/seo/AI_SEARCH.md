# AI search visibility (V11.0)

Goal: search engines and AI search tools (ChatGPT search, Claude, Grok, Google AI features, Bing/Copilot,
Perplexity) can read Built2Bid's public pages and describe the product accurately. No system can guarantee a
ranking or a recommendation. We earn citations with accurate, useful public pages; we never fake reviews,
mentions, rankings or "preferred provider" status.

## What is in the code

| Piece | Where | Notes |
|---|---|---|
| robots.txt | `src/app/robots.ts` | One `*` group: public pages allowed, app/account/signing/API paths disallowed. Previews and local builds return `Disallow: /`. Production needs `NEXT_PUBLIC_ALLOW_INDEXING=true` (set, verified live 2026-11-27). OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, Googlebot and Bingbot all get the public pages. Training crawlers (GPTBot, ClaudeBot) are currently allowed too; blocking them is an owner decision and does not affect search visibility. Do not add per-bot groups without copying every Disallow line: a bot that matches its own group ignores the `*` group. |
| Sitemap | `src/app/sitemap.ts` | Single canonical sitemap. New public routes must be added here. Submitted in Bing Webmaster Tools (read 2026-11-27, 137 URLs). |
| Snippet lengths | `src/lib/seo/meta.ts` | `metaDescription()` keeps meta descriptions to 160 characters (whole sentences) and `lessonTitle()` keeps Academy lesson titles near 70, the limits Bing's SEO report flags. Use them for new public pages. |
| Product facts | `src/lib/marketing/product-facts.ts` → `/what-is-built2bid`, `/llms.txt` | One source for "what Built2Bid is, who it's for, prices, integrations, limits". Prices from billing modules; features from the marketing catalog (live + flag on only). Update `VERIFIED_ON` after every re-check. |
| Structured data | `src/lib/seo/structured-data.ts` | Organization, WebSite, SoftwareApplication (offers from billing), FAQPage, BreadcrumbList. Trade, Learn, Academy and tool pages keep their own JSON-LD. Never add ratings, review counts or awards. |
| AI referrals | `src/lib/admin/channels.ts` (`ai_search`) | Signups referred by chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com, grok.com… or `utm_source=chatgpt.com`. Shown in /admin/marketing channel tables. Only clicks that pass a referrer or tag are counted; many AI visits arrive as "direct". |
| IndexNow | `scripts/seo/indexnow.mjs`, key file in `public/`, step in `.github/workflows/pricing-articles.yml` | Tells Bing (and other IndexNow engines) about a newly published guide once it returns 200. Google does not use IndexNow. Only changed public URLs; never resend unchanged pages. All 137 sitemap URLs were sent once on 2026-11-27 (first submission); from now on send only new or edited pages. |

## Repeatable AI search evaluation

Question set: `docs/seo/ai-search-eval-set.csv` (40 fixed questions across trades, crew sizes, intents and brand
checks). Keep the set fixed so results compare over time; add new questions as new rows, never edit old ones.

Run it monthly (first week), by hand, in a logged-out or fresh session where possible, in each tool you can use:
ChatGPT (search on), Claude (web search on), Google (AI Overview / AI Mode), Bing Copilot, Perplexity, Grok.
Do not automate consumer accounts.

Record one row per question per platform: date, platform, question id, search conditions (logged in?, location,
model/mode), Built2Bid appeared (y/n), cited (y/n), citation URL, position if a numbered list, other products
named, accuracy of what was said about Built2Bid (correct / outdated / wrong + note), gap observed.

Read the results as observations, not market share. Answers vary by user, location, time and model. A change
counts only when it repeats across two monthly runs.

## Review cadence

| When | Check |
|---|---|
| Every pricing or feature change | `product-facts.ts` still true; bump `VERIFIED_ON`; pricing page, homepage and facts page agree. |
| Weekly | Search Console: coverage errors, sitemap read, new queries. |
| Monthly | Eval set run; Bing Webmaster crawl errors; AI Search signups in /admin/marketing; broken outside links in Learn guides. |
| Quarterly | Comparison pages: re-verify competitor prices and features with sources; crawler docs (OpenAI, Anthropic, Google, Bing, xAI) for user-agent changes. |

## Rules

- Public pages only. Never make dashboards, financial records, customer data, estimates, employee details,
  billing, admin tools, internal APIs or member-only Academy pages indexable.
- No fabricated ratings, reviews, testimonials, awards, customer counts or statistics (claims register).
- Comparison pages: original analysis, primary-source links, verification date, and an honest "when the other
  product fits better" section. Start with a few; no mass-generated pages.
- No directory submissions, outreach or paid services without the owner's approval.
