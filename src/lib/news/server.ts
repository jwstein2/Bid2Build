import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUsAddress } from "@/lib/geo/address";
import { logError } from "@/lib/http/api";
import { sampleArticles } from "./fixtures";
import { mergePrefs, tradeSlugFrom, type NewsPrefs, type PrefsRow } from "./prefs";
import { sinkRead, pickBriefing, rankAll, type ArticleWithTerms, type RankedArticle } from "./rank";
import type { Authority, Category, GeoLevel, NewsArticle, NewsContext } from "./types";

/**
 * Feed API (server side). Reads permitted metadata that the background job already stored and
 * personalizes it at query time. Never fetches an external site during a page render.
 */

const COLS = "id, source_key, headline, publisher, url, published_at, date_precision, last_verified_at, categories, trades, trade_terms, geo_level, states, counties, places, regions, article_type, authority, snippet, summary, summary_status, effective_on, jurisdiction, image_url, verified";

interface Row {
  id: string; source_key: string; headline: string; publisher: string; url: string; published_at: string; date_precision: "day" | "time"; last_verified_at: string;
  categories: Category[]; trades: string[]; trade_terms: Record<string, string[]> | null; geo_level: GeoLevel; states: string[]; counties: string[]; places: string[]; regions: string[];
  article_type: NewsArticle["articleType"]; authority: Authority; snippet: string | null; summary: string | null; summary_status: NewsArticle["summaryStatus"];
  effective_on: string | null; jurisdiction: string | null; image_url: string | null; verified: boolean;
}

export const toArticle = (r: Row): ArticleWithTerms => ({
  id: r.id, sourceKey: r.source_key, headline: r.headline, publisher: r.publisher, url: r.url, publishedAt: r.published_at, datePrecision: r.date_precision,
  lastVerifiedAt: r.last_verified_at, categories: r.categories ?? [], trades: r.trades ?? [], tradeTerms: r.trade_terms ?? {}, geoLevel: r.geo_level,
  states: r.states ?? [], counties: r.counties ?? [], places: r.places ?? [], regions: r.regions ?? [], articleType: r.article_type, authority: r.authority,
  snippet: r.snippet, summary: r.summary, summaryStatus: r.summary_status, effectiveOn: r.effective_on, jurisdiction: r.jurisdiction, imageUrl: r.image_url, verified: r.verified,
});

export interface ReaderProfile { ctx: NewsContext; prefs: NewsPrefs; companyId: string | null; canManageCompany: boolean; profileTrade: string | null; hasAddress: boolean }

/** Company profile + preferences → ranking context. Uses fields the company already entered (no double entry). */
export async function loadReader(db: SupabaseClient, userId: string): Promise<ReaderProfile> {
  const [{ data: biz }, { data: fin }, { data: userPrefs }, { data: company }, { data: states }] = await Promise.all([
    db.from("business_profiles").select("primary_trade, address").eq("user_id", userId).maybeSingle(),
    db.from("fin_business_config").select("primary_trade_slug, additional_trade_slugs, market").limit(1).maybeSingle().then((r) => r, () => ({ data: null })),
    db.from("news_user_prefs").select("*").eq("user_id", userId).maybeSingle().then((r) => r, () => ({ data: null })),
    db.rpc("my_company").then((r) => r, () => ({ data: null })),
    db.from("news_user_articles").select("article_id, saved, hidden, read_at").eq("user_id", userId).limit(5000).then((r) => r, () => ({ data: null })),
  ]);
  const comp = company as { id?: string; permissions?: string[] } | null;
  const companyId = comp?.id ?? null;
  const { data: compDefaults } = companyId
    ? await db.from("news_company_defaults").select("*").eq("company_id", companyId).maybeSingle().then((r) => r, () => ({ data: null }))
    : { data: null };
  const prefs = mergePrefs(compDefaults as PrefsRow | null, userPrefs as PrefsRow | null);
  const addr = parseUsAddress((biz?.address as string | null) ?? null);
  const profileTrade = (fin?.primary_trade_slug as string | null) ?? tradeSlugFrom(biz?.primary_trade as string | null);
  const extra = ((fin?.additional_trade_slugs as string[] | null) ?? []);
  const trades = [...new Set([...(prefs.followedTrades.length ? prefs.followedTrades : [profileTrade, ...extra].filter((x): x is string => Boolean(x)))])];
  const primary = prefs.followedTrades[0] ?? profileTrade ?? trades[0] ?? null;
  const rows = (states ?? []) as { article_id: string; saved: boolean; hidden: boolean; read_at: string | null }[];
  const ctx: NewsContext = {
    primaryTrade: primary, trades: primary ? [primary, ...trades.filter((t) => t !== primary)] : trades,
    zip: addr.zip, state: addr.state, city: addr.city, countyFips: null,
    market: (fin?.market as NewsContext["market"]) ?? "mixed",
    radiusMiles: prefs.radiusMiles, geoEmphasis: prefs.geoEmphasis, topics: prefs.topics, mutedTopics: prefs.mutedTopics,
    sourceTypes: prefs.sourceTypes, hiddenPublishers: prefs.hiddenPublishers,
    hiddenArticles: new Set(rows.filter((r) => r.hidden).map((r) => r.article_id)),
    readArticles: new Set(rows.filter((r) => r.read_at).map((r) => r.article_id)),
    savedArticles: new Set(rows.filter((r) => r.saved).map((r) => r.article_id)),
  };
  return { ctx, prefs, companyId, canManageCompany: Boolean(comp?.permissions?.includes("manage_users")), profileTrade, hasAddress: Boolean(addr.state) };
}

export interface FeedFilters {
  geo?: "all" | "local" | "state" | "national" | null;
  trade?: string | null;
  topic?: Category | null;
  publisher?: string | null;
  sourceType?: Authority | null;
  days?: number | null;
  q?: string | null;
  sort?: "relevance" | "newest";
  view?: "all" | "saved" | "hidden";
}

/** Candidate rows: recent items about the reader's trades or state, plus national official items. */
async function candidates(db: SupabaseClient, ctx: NewsContext, days: number, extraTrade?: string | null): Promise<ArticleWithTerms[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const trades = [...new Set([...ctx.trades, ...(extraTrade ? [extraTrade] : [])])].filter((t) => /^[a-z-]+$/.test(t));
  const ors = [trades.length ? `trades.ov.{${trades.join(",")}}` : null, ctx.state ? `states.cs.{${ctx.state}}` : null, "and(authority.eq.official,geo_level.eq.national)", "trades.cs.{general-contracting}"].filter(Boolean).join(",");
  const { data, error } = await db.from("news_articles").select(COLS).eq("status", "published").gte("published_at", since).or(ors)
    .order("published_at", { ascending: false }).limit(900);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toArticle);
}

export interface FeedResult {
  available: boolean;            // false before the SQL runs
  sample: boolean;               // demo fixtures, clearly labeled
  articles: RankedArticle[];
  total: number;
  publishers: string[];
  lastUpdated: string | null;
}

const missing = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "")));

export async function loadFeed(db: SupabaseClient, reader: ReaderProfile, f: FeedFilters = {}, opts: { sample?: boolean } = {}): Promise<FeedResult> {
  const { ctx } = reader;
  const now = new Date();
  let raw: ArticleWithTerms[] = [];
  let available = true;
  if (!opts.sample) {
    try {
      raw = await candidates(db, ctx, Math.min(365, Math.max(1, f.days ?? 60)), f.trade);
      if (f.view === "saved" || f.view === "hidden") {
        const ids = [...(f.view === "saved" ? ctx.savedArticles : ctx.hiddenArticles)].slice(0, 300);
        const have = new Set(raw.map((a) => a.id));
        const need = ids.filter((id) => !have.has(id));
        if (need.length) {
          const { data } = await db.from("news_articles").select(COLS).in("id", need);
          raw.push(...((data ?? []) as Row[]).map(toArticle));
        }
        raw = raw.filter((a) => ids.includes(a.id));
      }
    } catch (e) {
      // Customers never see an error here: log it for the owner and show the normal "no stories yet" state.
      if (missing(e as { code?: string })) available = false;
      else { logError("news.feed", e); raw = []; }
    }
  }
  const sample = Boolean(opts.sample);
  if (sample) raw = sampleArticles(ctx.state);

  // The reader's saved/hidden views ignore hide rules so they can undo them.
  const rankCtx = f.view === "hidden" ? { ...ctx, hiddenArticles: new Set<string>() } : ctx;
  const filterTrade = f.trade && /^[a-z-]+$/.test(f.trade) ? f.trade : null;
  const tradeCtx = filterTrade ? { ...rankCtx, primaryTrade: filterTrade, trades: [filterTrade, ...rankCtx.trades.filter((t) => t !== filterTrade)] } : rankCtx;
  let ranked = rankAll(raw, tradeCtx, now, reader.prefs.serviceCounties);
  if (f.view === "saved" || f.view === "hidden") {
    // Keep everything the reader explicitly saved/hid even if it no longer ranks.
    const keep = new Set(ranked.map((r) => r.id));
    for (const a of raw) if (!keep.has(a.id)) {
      const r = rankAll([a], { ...tradeCtx, trades: [...tradeCtx.trades, ...a.trades], primaryTrade: a.trades[0] ?? null }, now, reader.prefs.serviceCounties)[0];
      if (r) ranked.push(r);
    }
  }
  if (filterTrade) ranked = ranked.filter((a) => a.trades.includes(filterTrade));
  if (f.geo && f.geo !== "all") ranked = ranked.filter((a) => (f.geo === "state" ? a.readerGeo === "state" || a.readerGeo === "regional" : a.readerGeo === f.geo));
  if (f.topic) ranked = ranked.filter((a) => a.categories.includes(f.topic!));
  if (f.publisher) ranked = ranked.filter((a) => a.publisher === f.publisher);
  if (f.sourceType) ranked = ranked.filter((a) => a.authority === f.sourceType);
  if (f.q) {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    ranked = ranked.filter((a) => { const t = `${a.headline} ${a.publisher} ${a.snippet ?? ""} ${a.summary ?? ""} ${a.trades.join(" ")} ${a.states.join(" ")}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  }
  if (f.sort === "newest") ranked.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  // Read articles drop to the bottom of the main feed (stable: order within each group is kept).
  if (f.view !== "saved" && f.view !== "hidden") ranked = sinkRead(ranked);
  const lastUpdated = raw.reduce<string | null>((m, a) => (!m || a.lastVerifiedAt > m ? a.lastVerifiedAt : m), null);
  return { available, sample, articles: ranked, total: ranked.length, publishers: [...new Set(raw.map((a) => a.publisher))].sort(), lastUpdated };
}

/** The dashboard briefing: 3–5 balanced items. */
export async function loadBriefing(db: SupabaseClient, reader: ReaderProfile, opts: { limit?: number; topics?: Category[]; geo?: NewsContext["geoEmphasis"]; sample?: boolean } = {}) {
  const r = { ...reader, ctx: { ...reader.ctx, topics: opts.topics?.length ? opts.topics : reader.ctx.topics, geoEmphasis: opts.geo ?? reader.ctx.geoEmphasis } };
  const feed = await loadFeed(db, r, {}, { sample: opts.sample });
  const unread = feed.articles.filter((a) => !a.read);
  return { ...feed, articles: sinkRead(pickBriefing(unread.length >= 3 ? unread : feed.articles, Math.min(10, Math.max(3, opts.limit ?? 4)))) };
}
