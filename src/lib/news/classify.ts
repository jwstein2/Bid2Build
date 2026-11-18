import { CATEGORY_RULES, CONSTRUCTION_TERMS } from "./categories";
import { statesInText, stateName } from "./geo";
import type { RawItem } from "./parse";
import type { NewsSourceDef } from "./sources";
import { TRADE_NEWS } from "./trades";
import type { ArticleType, Category, GeoLevel } from "./types";

/** Deterministic classification from the item's own headline and description. No AI, no guessing. */

const cache = new Map<string, RegExp>();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function termRe(term: string): RegExp {
  let re = cache.get(term);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${esc(term).replace(/\s+/g, "[\\s-]+")}(?![a-z0-9])`, "i");
    cache.set(term, re);
  }
  return re;
}
export const hasTerm = (text: string, term: string) => termRe(term).test(text);
const hits = (text: string, terms: string[]) => terms.filter((t) => hasTerm(text, t));

export interface TradeMatch { slug: string; score: number; terms: string[] }

export function matchTrades(text: string, sourceTrades: string[] = []): TradeMatch[] {
  const out: TradeMatch[] = [];
  for (const t of TRADE_NEWS) {
    // Remove excluded phrases first so "political landscape" never counts as landscaping.
    let clean = text;
    for (const x of t.exclude) clean = clean.replace(new RegExp(termRe(x).source, "gi"), " ");
    const strong = hits(clean, t.keywords);
    const weak = hits(clean, t.related);
    let score = strong.length * 2 + weak.length;
    if (sourceTrades.includes(t.slug)) score += 3;
    const qualifies = strong.length >= 1 || weak.length >= 2 || sourceTrades.includes(t.slug);
    // Generic construction words alone only tag the broad trades.
    if (qualifies && score > 0) out.push({ slug: t.slug, score, terms: [...strong, ...weak].slice(0, 4) });
  }
  return out.sort((a, b) => b.score - a.score);
}

const BROAD: Category[] = ["residential_construction", "commercial_construction", "business_taxes", "industry_technology", "licensing_regulations"];
export function matchCategories(text: string, base: Category[] = []): Category[] {
  const set = new Set<Category>(base);
  for (const [cat, terms] of Object.entries(CATEGORY_RULES) as [Category, string[]][]) {
    const n = hits(text, terms).length;
    if (n >= (BROAD.includes(cat) ? 2 : 1)) set.add(cat);
  }
  return [...set];
}

export const isConstructionRelevant = (text: string) => CONSTRUCTION_TERMS.some((t) => hasTerm(text, t));

export function articleTypeOf(item: RawItem, source: NewsSourceDef): ArticleType {
  if (source.format === "openfema") return "disaster_declaration";
  const dt = (item.docType ?? "").toLowerCase();
  if (dt === "rule") return "final_rule";
  if (dt === "proposed rule") return "proposed_rule";
  if (dt === "notice") return "notice";
  if (source.authority === "official" && /\b(cites?|cited|penalt(y|ies)|fines?)\b/i.test(item.title)) return "enforcement";
  if (source.authority === "community") return "discussion";
  if (/\b(new product|launches|introduces|unveils)\b/i.test(item.title)) return "product";
  if (/\b(analysis|outlook|forecast|survey|index|report shows|data show)\b/i.test(item.title)) return "analysis";
  return "news";
}

export interface Classification {
  trades: string[];
  tradeTerms: Record<string, string[]>;
  categories: Category[];
  geoLevel: GeoLevel;
  states: string[];
  regions: string[];
  places: string[];
  counties: string[];
  articleType: ArticleType;
  jurisdiction: string | null;
  effectiveOn: string | null;
  relevant: boolean;
}

export interface SourceOverride { trades?: string[] | null; categories?: Category[] | null; geoLevel?: GeoLevel | null }

export function classifyItem(item: RawItem, source: NewsSourceDef, override: SourceOverride = {}): Classification {
  const text = `${item.title}. ${item.description}`;
  const sourceTrades = override.trades ?? source.trades;
  const trades = matchTrades(text, sourceTrades);
  const categories = matchCategories(text, override.categories ?? source.categories);
  const articleType = articleTypeOf(item, source);
  const isFederal = source.format === "federal_register";

  let states = item.states ?? [];
  let geoLevel: GeoLevel = override.geoLevel ?? source.defaultGeo;
  if (!item.states) {
    // Federal rules apply nationwide even when the text names a state (e.g. "a California manufacturer petitioned").
    const named = isFederal ? [] : statesInText(text);
    if (named.length >= 1 && named.length <= 3) {
      states = named;
      if (!override.geoLevel && geoLevel === "national") geoLevel = "state";
    }
  }
  const regions = source.regions ?? [];
  if (regions.length && geoLevel === "national" && !states.length && !override.geoLevel) geoLevel = "regional";

  const jurisdiction = isFederal || (source.authority === "official" && geoLevel === "national")
    ? "United States (federal)"
    : states.length ? states.map(stateName).join(", ") : null;
  if (articleType === "disaster_declaration" && !categories.includes("disaster_recovery")) categories.push("disaster_recovery");
  if (articleType === "enforcement" && !categories.includes("safety") && source.categories.includes("safety")) categories.push("safety");

  const tradeSpecific = trades.filter((t) => !sourceTrades.includes(t.slug) || t.terms.length);
  const relevant = !source.requireConstructionRelevance || isConstructionRelevant(text) || tradeSpecific.some((t) => t.slug !== "general-contracting" && t.slug !== "other" && t.terms.length > 0);

  return {
    trades: trades.map((t) => t.slug).slice(0, 8),
    tradeTerms: Object.fromEntries(trades.map((t) => [t.slug, t.terms])),
    categories: categories.slice(0, 6),
    geoLevel, states, regions,
    places: item.places ?? [],
    counties: item.counties ?? [],
    articleType, jurisdiction,
    effectiveOn: item.effectiveOn ?? null,
    relevant,
  };
}
