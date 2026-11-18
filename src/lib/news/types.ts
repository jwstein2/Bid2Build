/**
 * Industry Intelligence (V6.8 / V6.8.1) shared types.
 *
 * Built2Bid is a news discovery service, not a republisher: an article row holds permitted metadata
 * (headline, publisher, original link, original publication date, a short feed-provided description)
 * and, only where the source's rights allow it, a short original summary. Never full article text.
 */

export const GEO_LEVELS = ["local", "state", "regional", "national"] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

/** How much a source can be trusted, shown on every card. Community posts are never regulatory guidance. */
export const AUTHORITIES = ["official", "industry", "local_news", "community"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const CATEGORIES = [
  "local_construction", "building_codes", "licensing_regulations", "material_prices", "labor_workforce", "safety",
  "trade_association", "housing_market", "commercial_construction", "residential_construction", "business_taxes",
  "industry_technology", "disaster_recovery", "community",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** What kind of item it is. Regulatory items keep "proposed" and "final" apart so a proposal is never shown as law. */
export const ARTICLE_TYPES = ["final_rule", "proposed_rule", "notice", "enforcement", "disaster_declaration", "news", "analysis", "product", "discussion"] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

/**
 * What the source's terms let us do with its text.
 *  - ai_summary: public-domain or licensed text. We may write a short original summary from the
 *    source-provided abstract (never from a headline alone).
 *  - structured: official structured data (e.g. FEMA). We build a factual sentence from the fields; no AI.
 *  - snippet: show the headline and a short trimmed publisher description; no AI rewriting.
 *  - headline: headline, publisher, date and link only.
 */
export type SummaryPolicy = "ai_summary" | "structured" | "snippet" | "headline";

export type SummaryStatus = "generated" | "structured" | "not_permitted" | "insufficient_text" | "rejected" | "pending" | "none";

export interface NewsArticle {
  id: string;
  sourceKey: string;
  headline: string;
  publisher: string;
  url: string;
  publishedAt: string;          // ISO, the original publication time from the source
  datePrecision: "day" | "time";
  lastVerifiedAt: string;
  categories: Category[];
  trades: string[];
  geoLevel: GeoLevel;
  states: string[];             // 2-letter codes the item is about
  counties: string[];           // 5-digit FIPS (state + county) when the source gives them
  regions: string[];            // e.g. "Midwest" for regional trade-press feeds
  articleType: ArticleType;
  authority: Authority;
  snippet: string | null;       // publisher-provided description, trimmed, plain text
  summary: string | null;       // "What happened": original summary when permitted
  summaryStatus: SummaryStatus;
  effectiveOn: string | null;   // YYYY-MM-DD, only when the source states it
  jurisdiction: string | null;  // e.g. "United States (federal)" or "Florida"
  imageUrl: string | null;
  verified: boolean;            // link host matches the publisher and points at a specific article
  sample?: boolean;             // demo fixture: never real news
}

/** Everything ranking needs to know about the reader, resolved from company profile + preferences. */
export interface NewsContext {
  primaryTrade: string | null;
  trades: string[];             // followed trades, primary first
  zip: string | null;
  state: string | null;
  city: string | null;
  countyFips: string | null;
  market: "residential" | "commercial" | "mixed";
  radiusMiles: number;
  geoEmphasis: "balanced" | "local" | "state" | "national";
  topics: Category[];           // preferred
  mutedTopics: Category[];
  sourceTypes: Authority[];     // included authorities (empty = all)
  hiddenPublishers: string[];
  hiddenArticles: Set<string>;
  readArticles: Set<string>;
  savedArticles: Set<string>;
}
