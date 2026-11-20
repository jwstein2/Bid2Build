import { describe, expect, it, vi } from "vitest";
import { tradeSeeds } from "@/lib/trades/data";
import { TRADE_NEWS, tradeNews } from "@/lib/news/trades";
import { NEWS_SOURCES, newsSource, UNAVAILABLE_SOURCES } from "@/lib/news/sources";
import { decodeEntities, parseFederalRegister, parseOpenFema, parseRss, toPlainText } from "@/lib/news/parse";
import { canonicalUrl, dedupe, fingerprint, parseDate, verifyItem } from "@/lib/news/verify";
import { classifyItem, matchTrades } from "@/lib/news/classify";
import { statesInText, stateName } from "@/lib/news/geo";
import { guardSummary, summaryEligibility, MIN_SOURCE_CHARS } from "@/lib/news/summarize";
import { pickBriefing, rankAll, readerGeo, type ArticleWithTerms } from "@/lib/news/rank";
import { buildRows, runIngest, runSummaries, type ArticleRow, type FetchLike, type NewsStore, type RunRecord, type SourceState, type SummaryWriter } from "@/lib/news/ingest";
import { sampleArticles } from "@/lib/news/fixtures";
import { mergePrefs, prefsSchema, prefsToRow, tradeSlugFrom } from "@/lib/news/prefs";
import { toCard, shortSummary } from "@/lib/news/format";
import type { NewsContext } from "@/lib/news/types";
import { ACHR_RSS, FEMA_JSON, FR_ABSTRACT, FR_JSON, OSHA_RSS } from "./fixtures/news-feeds";

const NOW = new Date("2026-11-18T12:00:00Z");

const ctx = (over: Partial<NewsContext> = {}): NewsContext => ({
  primaryTrade: "roofing", trades: ["roofing"], zip: "55401", state: "MN", city: "Minneapolis", countyFips: null, market: "residential",
  radiusMiles: 50, geoEmphasis: "balanced", topics: [], mutedTopics: [], sourceTypes: [], hiddenPublishers: [],
  hiddenArticles: new Set(), readArticles: new Set(), savedArticles: new Set(), ...over,
});

let seq = 0;
const art = (over: Partial<ArticleWithTerms> = {}): ArticleWithTerms => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, sourceKey: "construction-dive", headline: "Story", publisher: "Construction Dive",
  url: `https://www.constructiondive.com/news/story-${seq}/`, publishedAt: new Date(NOW.getTime() - 86400_000).toISOString(), datePrecision: "time",
  lastVerifiedAt: NOW.toISOString(), categories: [], trades: [], tradeTerms: {}, geoLevel: "national", states: [], counties: [], places: [], regions: [],
  articleType: "news", authority: "industry", snippet: "desc", summary: null, summaryStatus: "not_permitted", effectiveOn: null, jurisdiction: null, imageUrl: null, verified: true, ...over,
});

// ---- 7. All 42 trade mappings ---------------------------------------------------------------------------
describe("trade registry", () => {
  it("maps every trade in the repository (42) and nothing else", () => {
    expect(tradeSeeds).toHaveLength(42);
    expect(TRADE_NEWS.map((t) => t.slug).sort()).toEqual(tradeSeeds.map((t) => t.slug).sort());
  });
  it("gives every trade associations, keywords, sources and topics that exist", () => {
    for (const t of TRADE_NEWS) {
      expect(t.associations.length, t.slug).toBeGreaterThan(0);
      expect(t.keywords.length, t.slug).toBeGreaterThan(0);
      expect(t.topics.length, t.slug).toBeGreaterThan(0);
      for (const k of [...t.publications, ...t.official]) expect(newsSource(k), `${t.slug} → ${k}`).toBeTruthy();
      for (const a of t.associations) {
        expect(a.url).toMatch(/^https:\/\//);
        if (a.feed) expect(newsSource(a.feed)).toBeTruthy();
      }
    }
  });
  it("uses the associations the spec names", () => {
    const abbr = (s: string) => tradeNews(s)!.associations.map((a) => a.abbr);
    expect(abbr("general-contracting")).toEqual(expect.arrayContaining(["NAHB", "AGC"]));
    expect(abbr("electrical")).toEqual(expect.arrayContaining(["NECA", "NFPA"]));
    expect(abbr("roofing")).toContain("NRCA");
    expect(abbr("hvac")).toContain("ACCA");
    expect(abbr("plumbing")).toContain("PHCC");
    expect(abbr("landscaping")).toContain("NALP");
    expect(abbr("painting")).toContain("PCA");
    expect(abbr("concrete")).toEqual(expect.arrayContaining(["ACI", "ASCC"]));
  });
});

// ---- 8, 26. Source classification, rights ------------------------------------------------------------
describe("source registry", () => {
  it("uses only free feeds over https with per-source hosts and rights notes", () => {
    for (const s of NEWS_SOURCES) {
      expect(s.feedUrl, s.key).toMatch(/^https:\/\//);
      expect(s.hosts.length).toBeGreaterThan(0);
      expect(s.rights.length).toBeGreaterThan(40);
      expect(s.retentionDays).toBeGreaterThan(0);
      expect(new URL(s.feedUrl).hostname.replace(/^www\./, "")).toBe(new URL(s.homepage).hostname.replace(/^www\./, ""));
    }
  });
  it("only allows AI summaries for public-domain government sources", () => {
    for (const s of NEWS_SOURCES.filter((x) => x.summaryPolicy === "ai_summary")) expect(s.authority, s.key).toBe("official");
    for (const s of NEWS_SOURCES.filter((x) => x.authority !== "official")) expect(["snippet", "headline"]).toContain(s.summaryPolicy);
  });
  it("classifies associations as Industry and agencies as Official", () => {
    expect(newsSource("nahb-eye-on-housing")!.authority).toBe("industry");
    expect(newsSource("fr-osha")!.authority).toBe("official");
    expect(newsSource("fema-declarations")!.authority).toBe("official");
  });
  it("lists known unavailable sources, including paywalled and bot-protected ones", () => {
    const names = UNAVAILABLE_SOURCES.map((u) => u.name).join(" ");
    expect(names).toMatch(/New York Times/);
    expect(names).toMatch(/Qualified Remodeler/);
  });
});

// ---- Parsing ---------------------------------------------------------------------------------------------
describe("parsers", () => {
  it("decodes double-encoded entities and strips HTML", () => {
    expect(decodeEntities("agency&amp;#39;s")).toBe("agency's");
    expect(toPlainText("&lt;p&gt;Hello &amp;amp; <b>bye</b>&lt;/p&gt;")).toBe("Hello & bye");
    expect(toPlainText("<figure><img src=x></figure><p>Text</p>")).toBe("Text");
  });
  it("parses RSS items with links, dates and image enclosures", () => {
    const items = parseRss(ACHR_RSS, "achr-news");
    expect(items[0].title).toBe("Carbon Monoxide Safety Goes Beyond the Furnace");
    expect(items[0].imageUrl).toMatch(/^https:/);
    expect(items[1].description).toBe("Distributors say heat pump demand rose this fall.");
  });
  it("parses Federal Register JSON with type and abstract", () => {
    const items = parseFederalRegister(FR_JSON, "fr-osha");
    expect(items[0].docType).toBe("Proposed Rule");
    expect(items[1].description).toContain("agency's preliminary finding");
  });
  it("groups OpenFEMA county rows into one factual item per disaster and state", () => {
    const items = parseOpenFema(FEMA_JSON, "fema-declarations", stateName);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://www.fema.gov/disaster/4955");
    expect(items[0].counties).toEqual(["12005", "12045"]);
    expect(items[0].places).toEqual(["bay", "gulf"]);
    expect(items[0].structuredSummary).toContain("FEMA declared a major disaster for Florida on Oct 27, 2026");
    expect(items[0].structuredSummary).toContain("Bay (County), Gulf (County)");
  });
});

// ---- 9, 10, 11, 12, V6.8.1 §3 verification ----------------------------------------------------------------
describe("verification", () => {
  const achr = newsSource("achr-news")!;
  it("keeps only https links on the publisher's own host that point at a specific article", () => {
    const items = parseRss(ACHR_RSS, "achr-news");
    const out = items.map((i) => verifyItem(i, achr, NOW));
    expect(out[0]).toMatchObject({ ok: true, url: "https://www.achrnews.com/articles/167014-carbon-monoxide-safety-goes-beyond-the-furnace" });
    expect(out.map((o) => (o.ok ? "ok" : o.reason))).toEqual(["ok", "ok", "no_date", "link_not_publisher", "link_not_article", "future_date"]);
  });
  it("preserves the original publication date (never the ingestion date)", () => {
    const v = verifyItem(parseRss(ACHR_RSS, "achr-news")[0], achr, NOW);
    expect(v.ok && v.publishedAt).toBe("2026-11-17T18:00:00.000Z");
    expect(parseDate("2026-11-17")).toEqual({ iso: "2026-11-17T12:00:00.000Z", precision: "day" });
    expect(parseDate("Mon, 16 Nov 2026 12:00:00 +0000")!.precision).toBe("day");
    expect(parseDate("nonsense")).toBeNull();
  });
  it("rejects lookalike hosts and credentials in URLs", () => {
    expect(canonicalUrl("https://achrnews.com.evil.io/articles/1", achr.hosts)).toBeNull();
    expect(canonicalUrl("https://user:pw@www.achrnews.com/articles/1", achr.hosts)).toBeNull();
    expect(canonicalUrl("javascript:alert(1)", achr.hosts)).toBeNull();
    expect(canonicalUrl("http://www.achrnews.com/articles/1#x", achr.hosts)!.url).toBe("https://www.achrnews.com/articles/1");
  });
  it("drops syndicated duplicates, keeping the more authoritative / original copy", () => {
    const base = { fingerprint: fingerprint("OSHA proposes heat illness prevention rule for construction workers") };
    const { kept, duplicates } = dedupe([
      { ...base, urlKey: "constructiondive.com/a", publishedAt: "2026-11-17T15:00:00Z", authority: "industry" as const },
      { ...base, urlKey: "federalregister.gov/b", publishedAt: "2026-11-17T12:00:00Z", authority: "official" as const },
      { ...base, urlKey: "federalregister.gov/b", publishedAt: "2026-11-17T12:00:00Z", authority: "official" as const },
    ]);
    expect(duplicates).toBe(2);
    expect(kept[0].urlKey).toBe("federalregister.gov/b");
    expect(fingerprint("The OSHA heat rule, proposed")).toBe(fingerprint("OSHA heat rule proposed"));
  });
});

// ---- Classification, 3 ZIP/state mapping, 12 labels -----------------------------------------------------
describe("classification", () => {
  it("matches trades by keyword and ignores excluded phrases", () => {
    expect(matchTrades("New shingle underlayment rules for roofers")[0].slug).toBe("roofing");
    expect(matchTrades("The political landscape shifted").map((t) => t.slug)).not.toContain("landscaping");
    expect(matchTrades("Cabinet secretary announces tariffs").map((t) => t.slug)).not.toContain("cabinets-countertops");
    expect(matchTrades("Heat pump and furnace efficiency").map((t) => t.slug)).toContain("hvac");
  });
  it("finds states in text without mistaking federal Washington for Washington State", () => {
    expect(statesInText("cites Illinois utility construction company")).toEqual(["IL"]);
    expect(statesInText("Washington, D.C. agency announces")).toEqual(["DC"]);
    expect(statesInText("officials in Washington said")).toEqual([]);
    expect(statesInText("Seattle, Washington contractors")).toEqual(["WA"]);
  });
  it("labels OSHA regional releases State, Federal Register items National with type", () => {
    const osha = newsSource("osha-news")!;
    const il = classifyItem(parseRss(OSHA_RSS, "osha-news")[0], osha);
    expect(il).toMatchObject({ geoLevel: "state", states: ["IL"], articleType: "enforcement" });
    expect(il.trades).toContain("excavation");
    const fr = newsSource("fr-osha")!;
    const items = parseFederalRegister(FR_JSON, "fr-osha");
    const prop = classifyItem(items[0], fr);
    expect(prop).toMatchObject({ geoLevel: "national", articleType: "proposed_rule", jurisdiction: "United States (federal)" });
    expect(prop.categories).toContain("safety");
    expect(classifyItem(items[1], fr).articleType).toBe("notice");
  });
  it("labels FEMA declarations Local with counties and storm trades", () => {
    const fema = newsSource("fema-declarations")!;
    const c = classifyItem(parseOpenFema(FEMA_JSON, fema.key, stateName)[0], fema);
    expect(c).toMatchObject({ geoLevel: "local", states: ["FL"], articleType: "disaster_declaration" });
    expect(c.trades).toEqual(expect.arrayContaining(["roofing", "siding", "gutters"]));
  });
  it("drops broad-agency items that aren't about building work", () => {
    const epa = newsSource("fr-epa")!;
    const sip = classifyItem({ sourceKey: "fr-epa", title: "Air Plan Approval; California; Revised Format for Materials Incorporated by Reference", url: "https://www.federalregister.gov/documents/x/y", guid: null, publishedRaw: "2026-11-16", description: "EPA is revising the format for materials submitted by the State of California that are incorporated by reference into the State Implementation Plan.", imageUrl: null }, epa);
    expect(sip.relevant).toBe(false);
    const rrp = classifyItem({ sourceKey: "fr-epa", title: "Lead-Based Paint Activities; Renovation, Repair and Painting Program Updates", url: "https://www.federalregister.gov/documents/x/z", guid: null, publishedRaw: "2026-11-16", description: "EPA is amending requirements for renovation of homes built before 1978.", imageUrl: null }, epa);
    expect(rrp.relevant).toBe(true);
    expect(rrp.trades).toContain("painting");
  });
});

// ---- 1–6 ranking ----------------------------------------------------------------------------------------
describe("relevance ranking", () => {
  it("1. personalizes by primary trade", () => {
    const roof = art({ headline: "Shingle prices", trades: ["roofing"], tradeTerms: { roofing: ["shingle"] }, categories: ["material_prices"] });
    const elec = art({ headline: "Panel upgrades", trades: ["electrical"] });
    const r = rankAll([elec, roof], ctx(), NOW);
    expect(r.map((x) => x.id)).toEqual([roof.id]);
    expect(rankAll([elec, roof], ctx({ primaryTrade: "electrical", trades: ["electrical"] }), NOW).map((x) => x.id)).toEqual([elec.id]);
  });
  it("2. combines multiple trades, primary first", () => {
    const roof = art({ trades: ["roofing"] }), gut = art({ trades: ["gutters"] }), tile = art({ trades: ["tile"] });
    const r = rankAll([gut, tile, roof], ctx({ trades: ["roofing", "gutters"] }), NOW);
    expect(r.map((x) => x.id)).toEqual([roof.id, gut.id]);
  });
  it("3–6. ranks local over state over national, and hides other states", () => {
    const national = art({ trades: ["roofing"] });
    const state = art({ trades: ["roofing"], geoLevel: "state", states: ["MN"] });
    const other = art({ trades: ["roofing"], geoLevel: "state", states: ["TX"] });
    const local = art({ trades: ["roofing"], geoLevel: "local", states: ["MN"], places: ["hennepin"], headline: "Hennepin storm" });
    const r = rankAll([national, other, state, local], ctx(), NOW, ["hennepin"]);
    expect(r.map((x) => x.readerGeo)).toEqual(["local", "state", "national"]);
    expect(r.find((x) => x.id === other.id)).toBeUndefined();
    expect(r[0].geoLabel).toBe("Local · near Minneapolis");
  });
  it("never calls an in-state local item Local unless it names the reader's area", () => {
    const elsewhereInState = art({ trades: ["roofing"], geoLevel: "local", states: ["MN"], places: ["st. louis"], headline: "Duluth storm" });
    expect(readerGeo(elsewhereInState, ctx(), ["hennepin"])).toBe("state");
  });
  it("prefers recent items and sinks stale ones", () => {
    const fresh = art({ trades: ["roofing"] });
    const old = art({ trades: ["roofing"], publishedAt: new Date(NOW.getTime() - 50 * 86400_000).toISOString() });
    const r = rankAll([old, fresh], ctx(), NOW);
    expect(r[0].id).toBe(fresh.id);
    expect(r.find((x) => x.id === old.id)?.score ?? 0).toBeLessThan(r[0].score);
  });
  it("applies hidden articles, hidden publishers, muted topics and source types", () => {
    const a = art({ trades: ["roofing"], categories: ["safety"] });
    expect(rankAll([a], ctx({ hiddenArticles: new Set([a.id]) }), NOW)).toHaveLength(0);
    expect(rankAll([a], ctx({ hiddenPublishers: ["Construction Dive"] }), NOW)).toHaveLength(0);
    expect(rankAll([a], ctx({ mutedTopics: ["safety"] }), NOW)).toHaveLength(0);
    expect(rankAll([a], ctx({ sourceTypes: ["official"] }), NOW)).toHaveLength(0);
  });
  it("labels proposals as proposals in Why it matters and names the trade only when it matched", () => {
    const p = art({ authority: "official", articleType: "proposed_rule", trades: ["roofing"], tradeTerms: { roofing: ["roofing"] }, categories: ["safety"] });
    const why = rankAll([p], ctx(), NOW)[0].whyItMatters;
    expect(why).toMatch(/proposal, not a final rule/);
    expect(why).toMatch(/Roofing contractors/);
    const general = art({ authority: "official", articleType: "final_rule", categories: ["labor_workforce"], trades: [] });
    const w2 = rankAll([general], ctx(), NOW)[0].whyItMatters;
    expect(w2).not.toMatch(/roofing/i);
  });
  it("balances the briefing: at most two per source and at least one nearby item", () => {
    const many = Array.from({ length: 6 }, () => art({ trades: ["roofing"], sourceKey: "construction-dive" }));
    const near = art({ trades: ["roofing"], geoLevel: "state", states: ["MN"], sourceKey: "osha-news", publishedAt: new Date(NOW.getTime() - 20 * 86400_000).toISOString() });
    const pick = pickBriefing(rankAll([...many, near], ctx(), NOW), 4);
    expect(pick.filter((a) => a.sourceKey === "construction-dive").length).toBeLessThanOrEqual(2);
    expect(pick.some((a) => a.readerGeo === "state")).toBe(true);
  });
});

// ---- 13, 14, V6.8.1 summaries ------------------------------------------------------------------------
describe("summaries", () => {
  const src = { headline: "Heat Injury and Illness Prevention", text: FR_ABSTRACT, docType: "Proposed Rule", effectiveOn: null };
  it("only allows summaries for permitted sources with real source text", () => {
    expect(summaryEligibility(newsSource("construction-dive")!, "x".repeat(500))).toBe("not_permitted");
    expect(summaryEligibility(newsSource("osha-news")!, "x".repeat(500))).toBe("not_permitted");
    expect(summaryEligibility(newsSource("fr-osha")!, "Short headline-only text")).toBe("insufficient_text");
    expect(summaryEligibility(newsSource("fr-osha")!, FR_ABSTRACT)).toBe("eligible");
    expect(FR_ABSTRACT.length).toBeGreaterThanOrEqual(MIN_SOURCE_CHARS);
  });
  it("accepts a faithful summary", () => {
    const ok = "OSHA proposed a standard to protect construction and other workers from hazardous heat. The proposal would require employers to create a heat injury and illness prevention plan, provide water and rest breaks, and train workers. OSHA is inviting public comments on the proposal.";
    expect(guardSummary(ok, src)).toEqual([]);
  });
  it("rejects invented numbers, unlabeled proposals, advice and false finality", () => {
    expect(guardSummary("OSHA will fine contractors $16,000 per violation starting in 2027 under the new heat standard for construction workers across all industries in the nation today.", src).join(" ")).toMatch(/unsupported_number:16000.*unsupported_number:2027/);
    expect(guardSummary("OSHA finalized a heat standard for construction workers that requires plans, water, rest breaks and training for all workers in outdoor and indoor settings nationwide.", src)).toEqual(expect.arrayContaining(["proposal_not_labeled", "unsupported_final"]));
    expect(guardSummary("OSHA proposed heat protections. You must update your safety plan immediately to stay compliant with these new proposed requirements for every construction job.", src)).toContain("forbidden:you must");
  });
  it("routes publisher text through untouched for snippet sources (no AI)", () => {
    const { rows } = buildRows(parseRss(ACHR_RSS, "achr-news"), newsSource("achr-news")!, {}, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0].summary).toBeNull();
    expect(rows[0].summary_status).toBe("not_permitted");
    expect(rows[0].snippet).toBe("November is Carbon Monoxide Awareness Month. Contractors can help uncover hidden risks and protect homeowners.");
  });
  it("shows headline only for OSHA releases (feed has no description)", () => {
    const { rows } = buildRows(parseRss(OSHA_RSS, "osha-news"), newsSource("osha-news")!, {}, NOW);
    expect(rows.every((r) => r.snippet === null && r.summary === null)).toBe(true);
  });
  it("marks eligible Federal Register items pending and FEMA items structured", () => {
    const fr = buildRows(parseFederalRegister(FR_JSON, "fr-osha"), newsSource("fr-osha")!, {}, NOW).rows;
    expect(fr[0].summary_status).toBe("pending");
    const fema = buildRows(parseOpenFema(FEMA_JSON, "fema-declarations", stateName), newsSource("fema-declarations")!, {}, NOW).rows;
    expect(fema[0]).toMatchObject({ summary_status: "structured", geo_level: "local" });
  });
});

// ---- Ingestion with a mocked store and mocked fetch (24, 25, 12) -------------------------------------
function memoryStore(): NewsStore & { rows: ArticleRow[]; runs: RunRecord[]; states: Map<string, Partial<SourceState> & { last_error?: string | null }>; summaries: Map<string, { summary: string | null; summary_status: string }> } {
  const rows: ArticleRow[] = [], runs: RunRecord[] = [];
  const states = new Map<string, Partial<SourceState> & { last_error?: string | null }>();
  const summaries = new Map<string, { summary: string | null; summary_status: string }>();
  return {
    rows, runs, states, summaries,
    async sourceStates() { return [...states.entries()].map(([k, v]) => ({ source_key: k, enabled: true, excluded: false, trades_override: null, categories_override: null, geo_override: null, last_ok_at: null, last_run_at: null, consecutive_failures: 0, etag: null, last_modified: null, ...v })); },
    async existingUrlKeys(keys) { return new Set(rows.filter((r) => keys.includes(r.url_key)).map((r) => r.url_key)); },
    async recentFingerprints(prints, since) { return new Set(rows.filter((r) => prints.includes(r.fingerprint) && r.published_at >= since).map((r) => r.fingerprint)); },
    async insertArticles(r) { rows.push(...r); return r.length; },
    async touchArticles(keys) { return keys.length; },
    async saveSourceState(k, p) { states.set(k, { ...(states.get(k) ?? {}), ...p }); },
    async recordRun(r) { runs.push(r); },
    async pendingSummaries(limit) { return rows.filter((r) => r.summary_status === "pending").slice(0, limit).map((r, i) => ({ id: String(i), source_key: r.source_key, headline: r.headline, snippet: r.snippet, article_type: r.article_type, effective_on: r.effective_on, publisher: r.publisher })); },
    async saveSummary(id, p) { summaries.set(id, p); const r = rows.filter((x) => x.summary_status === "pending")[Number(id)]; if (r) Object.assign(r, p); },
    async aiSpendSince() { return runs.reduce((s, r) => s + (r.ai_cost_usd ?? 0), 0); },
    async purgeExpired() { return 0; },
  };
}
const feedFetch = (map: Record<string, { status: number; body?: string; etag?: string }>): FetchLike => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  if (!key) throw new Error(`unexpected fetch ${url}`);
  const r = map[key];
  if (r.status === 0) throw new Error("network down");
  return { status: r.status, headers: { get: (n: string) => (n === "etag" ? r.etag ?? null : null) }, text: async () => r.body ?? "" };
};

describe("ingestion", () => {
  it("ingests once per source, dedupes on rerun, and sends conditional requests", async () => {
    const store = memoryStore();
    const seen: Record<string, string>[] = [];
    const base = feedFetch({ "achrnews.com": { status: 200, body: ACHR_RSS, etag: '"v1"' } });
    const f: FetchLike = async (u, init) => { seen.push(init.headers); return base(u, init); };
    const src = [newsSource("achr-news")!];
    const r1 = await runIngest(store, { fetchImpl: f, now: NOW, sources: src });
    expect(r1[0]).toMatchObject({ status: "ok", inserted: 2, rejected: 4 });
    expect(store.runs[0].reject_reasons).toMatchObject({ no_date: 1, link_not_publisher: 1, link_not_article: 1, future_date: 1 });
    const r2 = await runIngest(store, { fetchImpl: f, now: NOW, sources: src, force: true });
    expect(r2[0]).toMatchObject({ inserted: 0, updated: 2 });
    expect(store.rows).toHaveLength(2);
    expect(seen[1]["if-none-match"]).toBe('"v1"');
    expect(seen[0]["user-agent"]).toMatch(/Built2BidNewsBot/);
  });
  it("respects cadence: a source checked recently is skipped (no per-user polling)", async () => {
    const store = memoryStore();
    store.states.set("achr-news", { last_ok_at: new Date(NOW.getTime() - 3600_000).toISOString() });
    const f = vi.fn(feedFetch({ "achrnews.com": { status: 200, body: ACHR_RSS } }));
    const r = await runIngest(store, { fetchImpl: f, now: NOW, sources: [newsSource("achr-news")!] });
    expect(r[0].status).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
  });
  it("24. records a failing source and keeps earlier articles", async () => {
    const store = memoryStore();
    await runIngest(store, { fetchImpl: feedFetch({ "achrnews.com": { status: 200, body: ACHR_RSS } }), now: NOW, sources: [newsSource("achr-news")!] });
    const r = await runIngest(store, { fetchImpl: feedFetch({ "achrnews.com": { status: 503 } }), now: NOW, sources: [newsSource("achr-news")!], force: true });
    expect(r[0]).toMatchObject({ status: "failed", error: "HTTP 503" });
    expect(store.rows).toHaveLength(2);
    expect(store.states.get("achr-news")).toMatchObject({ consecutive_failures: 1, last_error: "HTTP 503" });
    const bad = await runIngest(store, { fetchImpl: feedFetch({ "achrnews.com": { status: 200, body: "<html>not a feed" } }), now: NOW, sources: [newsSource("achr-news")!], force: true });
    expect(bad[0]).toMatchObject({ status: "ok", inserted: 0 });
  });
  it("skips disabled and excluded sources", async () => {
    const store = memoryStore();
    store.states.set("achr-news", { enabled: false });
    const f = vi.fn();
    const r = await runIngest(store, { fetchImpl: f as unknown as FetchLike, now: NOW, sources: [newsSource("achr-news")!], force: true });
    expect(r[0]).toMatchObject({ status: "skipped", error: "disabled" });
    expect(f).not.toHaveBeenCalled();
  });
  it("25. caps AI cost: budget reached means no AI call; invalid summaries are not stored", async () => {
    const store = memoryStore();
    await runIngest(store, { fetchImpl: feedFetch({ "federalregister.gov": { status: 200, body: JSON.stringify(FR_JSON) } }), now: NOW, sources: [newsSource("fr-osha")!] });
    expect(store.rows.filter((r) => r.summary_status === "pending")).toHaveLength(2);
    const bad: SummaryWriter = async () => ({ data: { what_happened: "OSHA will require 12 breaks per hour starting 2027 for every construction worker in all fifty states nationwide this coming year.", status: "final" }, model: "claude-haiku-5-5", inputTokens: 500, outputTokens: 80, costUsd: 0.0001 });
    const r = await runSummaries(store, bad, NOW);
    expect(r).toMatchObject({ written: 0, rejected: 2 });
    expect(store.rows.every((x) => x.summary === null)).toBe(true);
    // Over budget: the writer is never called.
    store.runs.push({ source_key: "all", phase: "summarize", started_at: NOW.toISOString(), finished_at: NOW.toISOString(), status: "ok", ai_cost_usd: 99 });
    const spy = vi.fn(bad);
    const r2 = await runSummaries(store, spy, NOW);
    expect(r2.skipped).toMatch(/budget/);
    expect(spy).not.toHaveBeenCalled();
  });
  it("stores a faithful summary", async () => {
    const store = memoryStore();
    await runIngest(store, { fetchImpl: feedFetch({ "federalregister.gov": { status: 200, body: JSON.stringify({ results: [FR_JSON.results[0]] }) } }), now: NOW, sources: [newsSource("fr-osha")!] });
    const good: SummaryWriter = async () => ({ data: { what_happened: "OSHA proposed a standard to protect construction and other workers from hazardous heat. The proposal would require employers to create a heat injury and illness prevention plan, provide water and rest breaks, and train workers. OSHA is inviting comments.", status: "proposed" }, model: "claude-haiku-5-5", inputTokens: 500, outputTokens: 80, costUsd: 0.0001 });
    const r = await runSummaries(store, good, NOW);
    expect(r.written).toBe(1);
    expect(store.rows[0]).toMatchObject({ summary_status: "generated", summary_model: "claude-haiku-5-5" });
  });

  it("writes summaries a few at a time so the scheduled job finishes before Netlify's timeout", async () => {
    const store = memoryStore();
    const many = Array.from({ length: 12 }, (_, i) => ({ ...FR_JSON.results[0], html_url: `https://www.federalregister.gov/documents/2026/11/17/2026-2340${i}/heat-${i}`, document_number: `2026-2340${i}`, title: `Heat rule part ${i}` }));
    await runIngest(store, { fetchImpl: feedFetch({ "federalregister.gov": { status: 200, body: JSON.stringify({ results: many }) } }), now: NOW, sources: [newsSource("fr-osha")!] });
    let active = 0, peak = 0;
    const slow: SummaryWriter = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { data: { what_happened: "OSHA proposed a standard to protect construction and other workers from hazardous heat. The proposal would require employers to create a heat injury and illness prevention plan, provide water and rest breaks, and train workers. OSHA is inviting comments.", status: "proposed" }, model: "claude-haiku-5-5", inputTokens: 500, outputTokens: 80, costUsd: 0.0001 };
    };
    const r = await runSummaries(store, slow, NOW);
    expect(r.written).toBe(store.rows.length);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });
});

// ---- 15, 20 preferences ---------------------------------------------------------------------------------
describe("preferences", () => {
  it("sanitizes input to whitelisted values only", () => {
    const p = prefsSchema.parse({ followedTrades: ["roofing", "not-a-trade", "roofing"], topics: ["safety", "<script>"], radiusMiles: 50, serviceCounties: ["Hennepin County", " Ramsey "], hiddenPublishers: ["<b>X</b>"] });
    expect(p.followedTrades).toEqual(["roofing"]);
    expect(p.topics).toEqual(["safety"]);
    expect(p.serviceCounties).toEqual(["hennepin", "ramsey"]);
    expect(p.hiddenPublishers).toEqual(["bX/b"]);
    expect(prefsSchema.safeParse({ radiusMiles: 33 }).success).toBe(false);
  });
  it("applies company defaults until the user saves their own", () => {
    const company = { followed_trades: ["hvac"], topics: ["safety"] };
    expect(mergePrefs(company, null)).toMatchObject({ followedTrades: ["hvac"], topics: ["safety"], fromCompany: true, saved: false });
    expect(mergePrefs(company, { followed_trades: ["plumbing"] })).toMatchObject({ followedTrades: ["plumbing"], topics: ["safety"], saved: true });
  });
  it("keeps muted and followed topics apart and defaults notifications off", () => {
    expect(prefsToRow({ topics: ["safety"], mutedTopics: ["safety", "housing_market"] }).muted_topics).toEqual(["housing_market"]);
    expect(mergePrefs(null, null)).toMatchObject({ notifyOfficialRules: false, notifyLocalDisasters: false, notifyMaterialPrices: false, emailDigest: false });
  });
  it("maps the company profile's free-text trade to a slug", () => {
    expect(tradeSlugFrom("Roofing")).toBe("roofing");
    expect(tradeSlugFrom("decks & porches")).toBe("decks");
    expect(tradeSlugFrom("Underwater basket weaving")).toBeNull();
  });
});

// ---- 23 sandbox, card output -------------------------------------------------------------------------
describe("sandbox fixtures and cards", () => {
  it("labels every sample as fictional and never links to a real publisher", () => {
    for (const s of sampleArticles("MN")) {
      expect(s.sample).toBe(true);
      expect(s.headline).toMatch(/^Sample/);
      expect(s.publisher).toMatch(/not real news/);
      expect(s.url.startsWith("/industry/sources")).toBe(true);
      expect(s.verified).toBe(false);
    }
  });
  it("builds cards with the original date, publisher and an external link flag", () => {
    const a = rankAll([art({ trades: ["roofing"], publishedAt: "2026-11-17T18:00:00.000Z", headline: "Real headline" })], ctx(), NOW)[0];
    const c = toCard(a, NOW);
    expect(c).toMatchObject({ headline: "Real headline", publisher: "Construction Dive", dateLabel: "Nov 17, 2026", external: true, summaryKind: "publisher" });
    const s = toCard(rankAll(sampleArticles("MN"), ctx(), NOW)[0], NOW);
    expect(s.external).toBe(false);
    expect(s.sample).toBe(true);
  });
  it("keeps the dashboard summary to two or three sentences", () => {
    const t = "One. Two two. Three three three. Four four four four. Five.";
    expect(shortSummary(t)).toBe("One. Two two. Three three three.");
  });
});
