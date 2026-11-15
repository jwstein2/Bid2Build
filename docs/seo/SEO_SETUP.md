# SEO and analytics setup

## What the code does
- **Share images:** every marketing page (home, pricing, /bids, 44 trade pages, /learn and guides) sends
  `og:image`, `og:url`, `og:type` and `og:site_name`. Pages that set their own share title use
  `openGraphFor()` in `src/lib/seo/open-graph.ts`, because a page-level `openGraph` replaces the root
  one in Next.js and would otherwise drop the image.
- **Structured data:** the homepage has one JSON-LD graph: Organization (name, logo, support email),
  WebSite and SoftwareApplication (plans). Trade pages keep FAQPage + BreadcrumbList; guides keep Article.
- **One host:** `netlify.toml` 301-redirects `https://built2bid.netlify.app/*` to `https://built2bid.org`.
  Deploy previews and branch deploys use other host names and are untouched.
- **Google Analytics 4:** `src/components/analytics/google-analytics.tsx`, mounted in the root layout.
  Loads only when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is a valid `G-…` id **and** the deploy is the
  indexable production deploy. Never loads on `/sign/…`, `/auth/…`, `/complimentary`, `/api/…`, `/admin`
  (URLs there carry tokens). Client-side page changes are counted by GA4 enhanced measurement.
- **Search Console:** verified by DNS (Domain property). Optional fallback:
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` adds the HTML-tag verification meta.

## Owner steps
1. Create the GA4 property: https://analytics.google.com → Admin → Create → Property → name
   "Built2Bid", time zone US Central, currency USD → business details → **Web** stream for
   `https://built2bid.org`, stream name "built2bid.org", keep Enhanced measurement ON.
   Copy the **Measurement ID** (`G-XXXXXXXXXX`; public, not a secret).
2. Netlify → Site configuration → Environment variables → add `NEXT_PUBLIC_GA_MEASUREMENT_ID`
   = that id, context **Production**. Then Deploys → Trigger deploy (value is inlined at build).
3. Check: open https://built2bid.org, then GA → Reports → Realtime should show you within a minute.
4. Optional: GA Admin → Product links → Search Console links → link built2bid.org.

## Checks after deploy
- `curl -sI https://built2bid.netlify.app/pricing` → `301` to `https://built2bid.org/pricing`.
- View source on `/bids/decks`: `og:image` = `https://built2bid.org/opengraph-image.png`.
- Paste a trade page URL into https://www.opengraph.xyz or a Slack/iMessage chat: the picture appears.
- https://search.google.com/test/rich-results on `/` lists Organization and SoftwareApplication.
