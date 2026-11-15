# Weekly pricing guides

Two new guides go live every week (Monday and Thursday, 7:00 AM US Central) at `/learn/<slug>`.
Each one is a trade pricing method ("How to Price Roofing Jobs"), a trade checklist, or a general
pricing topic (labor rate, overhead, change orders...). The plan in `topicPlan()`
(`src/lib/learn/article-checks.ts`) has about 85 topics, roughly 10 months of posts.

## How it works
1. `.github/workflows/pricing-articles.yml` runs on a schedule (free GitHub Actions minutes).
2. `scripts/content/write-article.ts` picks the next unpublished topic and asks **Claude Haiku 5.5**
   (`claude-haiku-5-5`) to write it from Built2Bid's own trade data (estimate sections, items, units, tips).
3. Quality gate, all automatic:
   - Code checks (`checkArticle()`): no "average cost", price ranges, market or national claims,
     studies/surveys/statistics, years or "current prices"; dollar figures only inside worked examples
     labelled "Example"; every example calculation must add up; must tell readers to use their own costs;
     length and structure limits.
   - A second Haiku pass acts as a senior estimator/editor and rejects wrong advice, math errors, code or
     legal claims stated as universal, and filler.
   - Problems go back for up to two rewrites. If it still fails, **nothing is published** and the run fails
     (GitHub emails you). The next run tries again.
4. The guide is appended to `src/lib/learn/generated-articles.json`, committed to `main`, and Netlify
   deploys it. It appears on `/learn`, in the sitemap, on its trade page under "<Trade> pricing guides",
   and gets its own share image.

**Cost:** each guide uses about 10–20k tokens across 2–4 calls: well under 1 cent at Haiku 5.5 prices
($0.10 / $0.50 per million tokens). Each publish also uses one Netlify build (about 1 minute).

## Setup (one time)
1. Create a new key at https://console.anthropic.com/settings/keys (name it "Built2Bid articles").
   Delete the old key that was pasted in chat while you're there.
2. Add it at https://github.com/jwstein2/Bid2Build/settings/secrets/actions/new
   Name: `ANTHROPIC_API_KEY`. Value: the key. Never paste it in chat.
3. Test: https://github.com/jwstein2/Bid2Build/actions/workflows/pricing-articles.yml → **Run workflow**
   (leave "dry run" checked). The run summary shows the drafted title and cost; nothing is published.

## Day to day
- **Pause:** Actions → Pricing articles → ⋯ → Disable workflow.
- **Publish one now:** Run workflow with "dry run" unchecked.
- **Take a guide down:** delete its entry from `src/lib/learn/generated-articles.json` and merge.
- **Add topics:** add to `GENERAL` or the trade angles in `topicPlan()`.
- Optional: set a monthly spend limit on the key at https://console.anthropic.com/settings/limits.

## Share images
Trade pages and guides render their own 1200×630 share card at build time
(`src/lib/seo/share-card.tsx`): headline on the navy brand panel plus a real screenshot of that trade's
estimate builder (`src/assets/og/trades/<slug>.jpg`). Refresh the screenshots after a template change:
`NODE_PATH=$(npm root -g) node scripts/og/capture-trades.mjs` (uses the live site; drafts stay in the
browser, nothing is saved to the database).
