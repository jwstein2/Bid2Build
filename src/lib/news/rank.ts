import { tradeName } from "@/lib/trades/catalog";
import { CATEGORY_LABEL, regionOfState } from "./categories";
import { stateName } from "./geo";
import { tradeNews } from "./trades";
import type { Category, GeoLevel, NewsArticle, NewsContext } from "./types";

/**
 * Relevance engine (V6.8 §7). Ingestion is shared by everyone; personalization happens here, at query
 * time, from the reader's trades, place, market and preferences. Pure: no I/O.
 *
 * Order of weight: trade match, geography, recency, practical relevance, source credibility, topic
 * preference, novelty, company configuration (market).
 */

/** Where the item sits relative to THIS reader. "elsewhere" = about another state: not shown. */
export type ReaderGeo = "local" | "state" | "regional" | "national" | "elsewhere";

export interface RankedArticle extends NewsArticle {
  score: number;
  readerGeo: ReaderGeo;
  geoLabel: string;
  matchedTrade: string | null;
  matchedTerms: string[];
  reasons: string[];
  whyItMatters: string;
  read: boolean;
  saved: boolean;
}

export interface ArticleWithTerms extends NewsArticle { tradeTerms?: Record<string, string[]>; places?: string[] }

export function readerGeo(a: ArticleWithTerms, ctx: NewsContext, serviceCounties: string[] = []): ReaderGeo {
  const inState = ctx.state != null && a.states.includes(ctx.state);
  if (a.geoLevel === "national" && !a.states.length) return "national";
  if (a.geoLevel === "regional" && !a.states.length) {
    const r = regionOfState(ctx.state);
    return r && a.regions.includes(r) ? "regional" : a.regions.length ? "elsewhere" : "national";
  }
  if (!inState) return a.states.length ? "elsewhere" : "national";
  const places = a.places ?? [];
  const city = ctx.city?.toLowerCase() ?? null;
  const text = `${a.headline} ${a.snippet ?? ""} ${a.summary ?? ""}`.toLowerCase();
  const placeHit = serviceCounties.some((c) => places.includes(c)) || (city != null && city.length > 2 && (places.includes(city) || new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "")}\\b`).test(text)));
  if (placeHit) return "local";
  // A local item elsewhere in your state is state-level news for you (we don't call it local).
  return "state";
}

const GEO_POINTS: Record<ReaderGeo, number> = { local: 30, state: 20, regional: 11, national: 8, elsewhere: 0 };
const AUTH_POINTS = { official: 10, industry: 6, local_news: 5, community: 0 } as const;
const ACTIONABLE: Category[] = ["building_codes", "licensing_regulations", "safety", "material_prices", "labor_workforce"];

export function geoLabel(g: ReaderGeo, a: NewsArticle, ctx: NewsContext): string {
  if (g === "local") return ctx.city ? `Local · near ${ctx.city}` : "Local";
  if (g === "state") return `State · ${stateName(a.states.includes(ctx.state ?? "") ? ctx.state! : a.states[0])}`;
  if (g === "regional") return `Regional · ${a.regions.join(", ")}`;
  return "National";
}

export function scoreArticle(a: ArticleWithTerms, ctx: NewsContext, now: Date, serviceCounties: string[] = []): RankedArticle | null {
  if (ctx.hiddenArticles.has(a.id)) return null;
  if (ctx.hiddenPublishers.includes(a.publisher)) return null;
  if (ctx.sourceTypes.length && !ctx.sourceTypes.includes(a.authority)) return null;
  if (a.categories.some((c) => ctx.mutedTopics.includes(c)) && !a.categories.some((c) => ctx.topics.includes(c))) return null;
  const g = readerGeo(a, ctx, serviceCounties);
  if (g === "elsewhere") return null;

  // 1. Trade
  const primary = ctx.primaryTrade && a.trades.includes(ctx.primaryTrade) ? ctx.primaryTrade : null;
  const followed = primary ?? ctx.trades.find((t) => a.trades.includes(t)) ?? null;
  let trade = primary ? 40 : followed ? 26 : 0;
  // Disaster declarations matter to storm trades through the source mapping, not keywords.
  const terms = followed ? (a.tradeTerms?.[followed] ?? []) : [];
  if (!followed) {
    const broad = a.categories.some((c) => ["labor_workforce", "business_taxes", "housing_market", "safety", "licensing_regulations"].includes(c));
    if (a.authority === "official" && broad) trade = 10;
    else if (broad && a.trades.includes("general-contracting")) trade = 6;
  }
  // 2. Geography (+ emphasis)
  let geo = GEO_POINTS[g];
  if (ctx.geoEmphasis !== "balanced" && ctx.geoEmphasis === g) geo += 14;
  if (ctx.geoEmphasis === "local" && g === "national") geo -= 4;
  // 3. Recency (half-life about a week). Items past 45 days sink.
  const ageDays = Math.max(0, (now.getTime() - new Date(a.publishedAt).getTime()) / 86400_000);
  let recency = 22 * Math.exp(-ageDays / 9);
  if (ageDays > 45) recency -= 10;
  // 4. Practical relevance
  let practical = a.categories.some((c) => ACTIONABLE.includes(c)) ? 5 : 0;
  if (a.articleType === "final_rule" || a.articleType === "proposed_rule") practical += 6;
  if (a.articleType === "disaster_declaration" && (g === "local" || g === "state")) practical += 10;
  if (a.articleType === "disaster_declaration" && g === "national") practical -= 20;
  // 5. Credibility
  const cred = AUTH_POINTS[a.authority];
  // 6. Topic preference
  const topic = a.categories.some((c) => ctx.topics.includes(c)) ? 12 : 0;
  // 7. Novelty
  const read = ctx.readArticles.has(a.id);
  const novelty = read ? -15 : 0;
  // 8. Company configuration: residential vs commercial focus
  let market = 0;
  if (ctx.market === "residential" && a.categories.includes("commercial_construction") && !a.categories.includes("residential_construction")) market = -8;
  if (ctx.market === "commercial" && a.categories.includes("residential_construction") && !a.categories.includes("commercial_construction")) market = -6;

  const score = Math.round((trade + geo + recency + practical + cred + topic + novelty + market) * 10) / 10;
  // Nothing that isn't about the reader's trades, their place, or an official construction rule.
  if (trade === 0 && g !== "local" && !(g === "state" && a.authority === "official")) return null;
  if (score < 30) return null;

  const reasons = [
    followed ? `Matches ${tradeLabel(followed)}` : null,
    g === "local" ? "In your area" : g === "state" ? `In ${stateName(ctx.state ?? a.states[0])}` : g === "regional" ? `Your region` : null,
    a.categories.find((c) => ctx.topics.includes(c)) ? `Topic you follow: ${CATEGORY_LABEL[a.categories.find((c) => ctx.topics.includes(c))!]}` : null,
  ].filter((x): x is string => Boolean(x));

  return {
    ...a, score, readerGeo: g, geoLabel: geoLabel(g, a, ctx), matchedTrade: followed, matchedTerms: terms, reasons,
    whyItMatters: whyItMatters(a, { trade: followed, terms, geo: g, ctx }),
    read, saved: ctx.savedArticles.has(a.id),
  };
}

const tradeLabel = (slug: string) => tradeName(slug);

/**
 * "Why it matters to your business" (V6.8.1 §7). Deterministic and grounded: it names only the
 * reader's trade when the item actually matched it, the item's type (proposed vs final), and its
 * category. It never claims an effect the source didn't state; implications are phrased as things to check.
 */
export function whyItMatters(a: NewsArticle, p: { trade: string | null; terms: string[]; geo: ReaderGeo; ctx: NewsContext }): string {
  const who = p.trade ? `${tradeLabel(p.trade).toLowerCase()} contractors` : "contractors";
  const Who = who[0].toUpperCase() + who.slice(1);
  const about = p.terms.length ? ` Mentions: ${p.terms.slice(0, 2).join(", ")}.` : "";
  const eff = a.effectiveOn ? ` The source lists an effective date of ${fmt(a.effectiveOn)}.` : "";
  switch (a.articleType) {
    case "final_rule":
      return `This is a final federal rule.${eff} If it covers work ${who} do, review the official document before changing how you estimate, install or document jobs.${about}`.trim();
    case "proposed_rule":
      return `This is a proposal, not a final rule, so nothing has changed yet. ${Who} may want to follow it, and the official document explains how to comment.${about}`.trim();
    case "notice":
      return `An official notice from ${a.publisher.replace(/^Federal Register — /, "")}. Notices often need no action; skim it to see whether it touches products or work ${who} use.${about}`.trim();
    case "enforcement":
      return `An enforcement case. These show what inspectors cite on real jobs, which is useful for checking your own crew's practices.${about}`.trim();
    case "disaster_declaration":
      return p.geo === "local"
        ? "Your service area is in the declared area. Homeowners there may need repairs; confirm local permit and licensing rules before taking storm work."
        : `A disaster declaration in ${stateName(a.states[0] ?? "")}. If you work in the declared counties, expect repair inquiries and check local permit and licensing rules for storm work.`;
  }
  const cat = a.categories.find((c) => ["material_prices", "labor_workforce", "housing_market", "safety", "building_codes", "licensing_regulations", "business_taxes", "industry_technology"].includes(c));
  switch (cat) {
    case "material_prices": return `Material cost news${p.trade ? ` relevant to ${who}` : ""}. Worth comparing with the prices in your saved items and recent bids.${about}`.trim();
    case "labor_workforce": return `Labor and workforce news that may affect hiring, wages or scheduling for ${who}.${about}`.trim();
    case "housing_market": return `Housing-market news, an early signal for demand${p.trade ? ` for ${tradeLabel(p.trade).toLowerCase()} work` : ""}.${about}`.trim();
    case "safety": return `Safety news. Compare it with your crew's procedures and training.${about}`.trim();
    case "building_codes": return `Code-related news. Ask your local building department which code edition applies before changing your work.${about}`.trim();
    case "licensing_regulations": return `Regulatory news. Check whether it applies in your state and to the work ${who} do.${about}`.trim();
    case "business_taxes": return `Business news that may affect costs, financing or taxes for ${who}.${about}`.trim();
    case "industry_technology": return `Technology news for ${who}; useful if you're weighing new tools or equipment.${about}`.trim();
  }
  return p.trade ? `Matches your ${tradeLabel(p.trade)} trade.${about}`.trim() : `General construction-industry news.${about}`.trim();
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Pick the briefing: best first, at most `perSource` from one publisher, and (balanced) at least one
 * local/state item when any exists so national stories don't crowd out what's nearby.
 */
export function pickBriefing(ranked: RankedArticle[], limit: number, perSource = 2, balanced = true): RankedArticle[] {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const out: RankedArticle[] = [];
  const count = new Map<string, number>();
  for (const a of sorted) {
    if (out.length >= limit) break;
    if ((count.get(a.sourceKey) ?? 0) >= perSource) continue;
    out.push(a);
    count.set(a.sourceKey, (count.get(a.sourceKey) ?? 0) + 1);
  }
  if (balanced && out.length >= 2 && !out.some((a) => a.readerGeo === "local" || a.readerGeo === "state")) {
    const near = sorted.find((a) => (a.readerGeo === "local" || a.readerGeo === "state") && !out.includes(a));
    if (near) out[out.length - 1] = near;
  }
  return out;
}

export function rankAll(articles: ArticleWithTerms[], ctx: NewsContext, now = new Date(), serviceCounties: string[] = []): RankedArticle[] {
  return articles.map((a) => scoreArticle(a, ctx, now, serviceCounties)).filter((x): x is RankedArticle => x !== null).sort((a, b) => b.score - a.score);
}

export const tradeGeoPreference = (slug: string | null): GeoLevel | null => {
  const g = slug ? tradeNews(slug)?.geo : null;
  return g === "local_heavy" ? "local" : g === "national" ? "national" : null;
};

/** Unread first, read last, keeping the order inside each group. */
export function sinkRead<T extends { read: boolean }>(list: T[]): T[] {
  return [...list.filter((a) => !a.read), ...list.filter((a) => a.read)];
}
