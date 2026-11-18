import { classifyItem, type SourceOverride } from "./classify";
import { stateName } from "./geo";
import { parseFederalRegister, parseOpenFema, parseRss, toPlainText, type RawItem } from "./parse";
import { CADENCE_HOURS, NEWS_SOURCES, type NewsSourceDef } from "./sources";
import { guardSummary, newsAiSettings, summaryEligibility, summaryInput, SUMMARY_SYSTEM, summarySchema, tidySummary, type SummaryOut } from "./summarize";
import type { Authority, Category, GeoLevel, SummaryStatus } from "./types";
import { dedupe, verifyItem } from "./verify";

/**
 * Background ingestion (V6.8 §13). Runs from the scheduled job only, never on a page render:
 * one fetch per source (not per user), conditional GETs (ETag / Last-Modified), per-source cadence,
 * size and time limits, dedupe against what's already stored. A failed source records its error and
 * keeps its earlier articles with their real timestamps.
 */

export const USER_AGENT = "Built2BidNewsBot/1.0 (+https://built2bid.org/industry/sources)";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3_000_000;
const PRESS_SNIPPET_CHARS = 300;

export interface ArticleRow {
  source_key: string; url: string; url_key: string; url_host: string; fingerprint: string; headline: string; publisher: string;
  published_at: string; date_precision: "day" | "time"; categories: Category[]; trades: string[]; trade_terms: Record<string, string[]>;
  geo_level: GeoLevel; states: string[]; counties: string[]; places: string[]; regions: string[]; article_type: string; authority: Authority;
  snippet: string | null; summary: string | null; summary_status: SummaryStatus; summary_model: string | null; effective_on: string | null;
  jurisdiction: string | null; image_url: string | null; verified: boolean; expires_at: string;
}

export interface SourceState {
  source_key: string; enabled: boolean; excluded: boolean; trades_override: string[] | null; categories_override: string[] | null; geo_override: GeoLevel | null;
  last_ok_at: string | null; last_run_at: string | null; consecutive_failures: number; etag: string | null; last_modified: string | null;
}

export interface RunRecord {
  source_key: string; phase: "fetch" | "summarize" | "purge"; started_at: string; finished_at: string; status: "ok" | "not_modified" | "skipped" | "failed";
  http_status?: number | null; bytes?: number; fetched?: number; inserted?: number; updated?: number; duplicates?: number; rejected?: number;
  reject_reasons?: Record<string, number>; ai_summaries?: number; ai_rejected?: number; ai_cost_usd?: number; error?: string | null;
}

export interface PendingSummary { id: string; source_key: string; headline: string; snippet: string | null; article_type: string; effective_on: string | null; publisher: string }

/** Storage the job needs. Supabase in production (store.ts), in-memory in tests. */
export interface NewsStore {
  sourceStates(): Promise<SourceState[]>;
  existingUrlKeys(keys: string[]): Promise<Set<string>>;
  recentFingerprints(prints: string[], sinceIso: string): Promise<Set<string>>;
  insertArticles(rows: ArticleRow[]): Promise<number>;
  touchArticles(urlKeys: string[], nowIso: string): Promise<number>;
  saveSourceState(key: string, patch: Partial<SourceState> & { last_error?: string | null; last_error_at?: string | null; last_run_at?: string }): Promise<void>;
  recordRun(run: RunRecord): Promise<void>;
  pendingSummaries(limit: number): Promise<PendingSummary[]>;
  saveSummary(id: string, patch: { summary: string | null; summary_status: SummaryStatus; summary_model: string | null }): Promise<void>;
  aiSpendSince(iso: string): Promise<number>;
  purgeExpired(): Promise<number>;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export interface FetchResult { status: number; body: string | null; etag: string | null; lastModified: string | null; bytes: number }

export async function fetchFeed(source: NewsSourceDef, state: SourceState | undefined, fetchImpl: FetchLike): Promise<FetchResult> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: source.format === "rss" ? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" : "application/json" };
  if (state?.etag) headers["if-none-match"] = state.etag;
  if (state?.last_modified) headers["if-modified-since"] = state.last_modified;
  const res = await fetchImpl(source.feedUrl, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 304) return { status: 304, body: null, etag: state?.etag ?? null, lastModified: state?.last_modified ?? null, bytes: 0 };
  if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
  const body = await res.text();
  if (body.length > MAX_BYTES) throw Object.assign(new Error("Feed larger than 3 MB"), { httpStatus: res.status });
  return { status: res.status, body, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), bytes: body.length };
}

export function parseFeed(source: NewsSourceDef, body: string): RawItem[] {
  if (source.format === "rss") return parseRss(body, source.key, source.maxItemsPerRun);
  const json = JSON.parse(body) as unknown;
  if (source.format === "federal_register") return parseFederalRegister(json, source.key, source.maxItemsPerRun);
  return parseOpenFema(json, source.key, stateName, source.maxItemsPerRun);
}

function snippetFor(source: NewsSourceDef, item: RawItem): string | null {
  const d = item.description.trim();
  if (!d || source.summaryPolicy === "headline") return null;
  if (d.toLowerCase() === item.title.toLowerCase()) return null;
  if (source.summaryPolicy === "snippet") {
    // Short publisher description only (no lengthy excerpts).
    return d.length > PRESS_SNIPPET_CHARS ? `${d.slice(0, PRESS_SNIPPET_CHARS - 1).replace(/\s+\S*$/, "")}…` : d;
  }
  return toPlainText(d, 2000);
}

/** Verify + classify a parsed batch into rows. Rejected items are counted by reason, never stored. */
export function buildRows(items: RawItem[], source: NewsSourceDef, override: SourceOverride, now = new Date()) {
  const rows: (ArticleRow & { authority: Authority })[] = [];
  const reasons: Record<string, number> = {};
  const bump = (r: string) => { reasons[r] = (reasons[r] ?? 0) + 1; };
  for (const it of items) {
    const v = verifyItem(it, source, now);
    if (!v.ok) { bump(v.reason); continue; }
    const c = classifyItem(it, source, override);
    if (!c.relevant) { bump("not_construction"); continue; }
    const snippet = snippetFor(source, it);
    const elig = summaryEligibility(source, it.description);
    const structured = source.summaryPolicy === "structured" && it.structuredSummary ? it.structuredSummary : null;
    const image = it.imageUrl && /^https:\/\//.test(it.imageUrl) && source.summaryPolicy !== "headline" ? it.imageUrl.slice(0, 1000) : null;
    rows.push({
      source_key: source.key, url: v.url, url_key: v.urlKey, url_host: v.host, fingerprint: v.fingerprint, headline: it.title, publisher: source.name,
      published_at: v.publishedAt, date_precision: v.datePrecision, categories: c.categories, trades: c.trades, trade_terms: c.tradeTerms,
      geo_level: c.geoLevel, states: c.states, counties: c.counties.slice(0, 400), places: c.places.slice(0, 400), regions: c.regions, article_type: c.articleType,
      authority: source.authority, snippet, summary: structured, summary_status: structured ? "structured" : elig === "eligible" ? "pending" : elig === "structured" ? "none" : elig,
      summary_model: null, effective_on: c.effectiveOn, jurisdiction: c.jurisdiction, image_url: image, verified: true,
      expires_at: new Date(new Date(v.publishedAt).getTime() + source.retentionDays * 86400_000).toISOString(),
    });
  }
  return { rows, reasons };
}

const isDue = (source: NewsSourceDef, st: SourceState | undefined, now: Date) =>
  !st?.last_ok_at || now.getTime() - new Date(st.last_ok_at).getTime() >= CADENCE_HOURS[source.cadence] * 3600_000;

export interface IngestOptions { fetchImpl: FetchLike; now?: Date; force?: boolean; only?: string[]; sources?: NewsSourceDef[]; concurrency?: number }
export interface IngestReport { source: string; status: RunRecord["status"]; inserted: number; updated: number; duplicates: number; rejected: number; error?: string }

export async function ingestSource(store: NewsStore, source: NewsSourceDef, st: SourceState | undefined, opt: IngestOptions): Promise<IngestReport> {
  const now = opt.now ?? new Date();
  const started = new Date().toISOString();
  const base = { source_key: source.key, phase: "fetch" as const, started_at: started };
  try {
    const f = await fetchFeed(source, st, opt.fetchImpl);
    if (f.status === 304) {
      await store.saveSourceState(source.key, { last_run_at: started, last_ok_at: now.toISOString(), consecutive_failures: 0, last_error: null });
      await store.recordRun({ ...base, finished_at: new Date().toISOString(), status: "not_modified", http_status: 304 });
      return { source: source.key, status: "not_modified", inserted: 0, updated: 0, duplicates: 0, rejected: 0 };
    }
    const items = parseFeed(source, f.body ?? "");
    const override: SourceOverride = { trades: st?.trades_override ?? null, categories: (st?.categories_override as Category[] | null) ?? null, geoLevel: st?.geo_override ?? null };
    const { rows, reasons } = buildRows(items, source, override, now);
    const { kept, duplicates } = dedupe(rows.map((r) => ({ ...r, urlKey: r.url_key, fingerprint: r.fingerprint, publishedAt: r.published_at })));
    const existing = await store.existingUrlKeys(kept.map((r) => r.url_key));
    const fresh = kept.filter((r) => !existing.has(r.url_key));
    // Syndicated copies already stored from another source in the last 3 days.
    const since = new Date(now.getTime() - 3 * 86400_000).toISOString();
    const seen = await store.recentFingerprints(fresh.filter((r) => r.fingerprint.split(" ").length >= 4).map((r) => r.fingerprint), since);
    const toInsert = fresh.filter((r) => !seen.has(r.fingerprint)).map((r) => { const row: Partial<typeof r> = { ...r }; delete row.urlKey; delete row.publishedAt; return row as ArticleRow; });
    const inserted = await store.insertArticles(toInsert);
    const updated = await store.touchArticles([...existing], now.toISOString());
    const dup = duplicates + (fresh.length - toInsert.length);
    const rejected = Object.values(reasons).reduce((a, b) => a + b, 0);
    await store.saveSourceState(source.key, { last_run_at: started, last_ok_at: now.toISOString(), consecutive_failures: 0, last_error: null, etag: f.etag, last_modified: f.lastModified });
    await store.recordRun({ ...base, finished_at: new Date().toISOString(), status: "ok", http_status: f.status, bytes: f.bytes, fetched: items.length, inserted, updated, duplicates: dup, rejected, reject_reasons: reasons });
    return { source: source.key, status: "ok", inserted, updated, duplicates: dup, rejected };
  } catch (e) {
    // Supabase errors are plain objects with a message, not Error instances.
    const msg = (e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === "string" ? (e as { message: string }).message : String(e)).slice(0, 300);
    const http = (e as { httpStatus?: number }).httpStatus ?? null;
    await store.saveSourceState(source.key, { last_run_at: started, consecutive_failures: (st?.consecutive_failures ?? 0) + 1, last_error: msg, last_error_at: new Date().toISOString() });
    await store.recordRun({ ...base, finished_at: new Date().toISOString(), status: "failed", http_status: http, error: msg });
    return { source: source.key, status: "failed", inserted: 0, updated: 0, duplicates: 0, rejected: 0, error: msg };
  }
}

export async function runIngest(store: NewsStore, opt: IngestOptions): Promise<IngestReport[]> {
  const now = opt.now ?? new Date();
  const states = new Map((await store.sourceStates()).map((s) => [s.source_key, s]));
  const all = (opt.sources ?? NEWS_SOURCES).filter((s) => !opt.only || opt.only.includes(s.key));
  const reports: IngestReport[] = [];
  const due: NewsSourceDef[] = [];
  for (const s of all) {
    const st = states.get(s.key);
    if (st && (!st.enabled || st.excluded)) { reports.push({ source: s.key, status: "skipped", inserted: 0, updated: 0, duplicates: 0, rejected: 0, error: st.excluded ? "excluded" : "disabled" }); continue; }
    if (!opt.force && !isDue(s, st, now)) { reports.push({ source: s.key, status: "skipped", inserted: 0, updated: 0, duplicates: 0, rejected: 0, error: "not due" }); continue; }
    due.push(s);
  }
  const limit = Math.max(1, opt.concurrency ?? 4);
  for (let i = 0; i < due.length; i += limit) {
    const batch = await Promise.all(due.slice(i, i + limit).map((s) => ingestSource(store, s, states.get(s.key), opt)));
    reports.push(...batch);
  }
  return reports;
}

export type SummaryWriter = (opts: { system: string; user: string; schema: typeof summarySchema; model?: string; maxTokens?: number }) =>
  Promise<{ data: SummaryOut; model: string; inputTokens: number; outputTokens: number; costUsd: number }>;

/**
 * Write "What happened" summaries for pending items (eligible sources only), within the monthly budget
 * and the per-run cap. Each output is checked against its source; failures store no summary.
 */
const SUMMARY_CONCURRENCY = 5;

export async function runSummaries(store: NewsStore, writer: SummaryWriter | null, now = new Date(), model?: string) {
  const s = newsAiSettings();
  const started = new Date().toISOString();
  const report = { written: 0, rejected: 0, costUsd: 0, skipped: null as string | null };
  if (!writer || !s.enabled) report.skipped = "AI summaries are off or not configured";
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const spent = report.skipped ? 0 : await store.aiSpendSince(monthStart);
  if (!report.skipped && spent >= s.monthlyBudgetUsd) report.skipped = `Monthly news AI budget reached ($${spent.toFixed(2)} of $${s.monthlyBudgetUsd})`;
  if (report.skipped || !writer) {
    await store.recordRun({ source_key: "all", phase: "summarize", started_at: started, finished_at: new Date().toISOString(), status: "skipped", error: report.skipped ?? "AI summaries are off" });
    return report;
  }
  const pending = await store.pendingSummaries(s.maxPerRun);
  // A few at a time: the scheduled function that calls this waits only about 15 seconds, and one by one
  // 15 summaries took about 25 seconds, so Netlify retried the whole job.
  const one = async (p: PendingSummary) => {
    const source = NEWS_SOURCES.find((x) => x.key === p.source_key);
    const text = p.snippet ?? "";
    if (!source || summaryEligibility(source, text) !== "eligible") {
      await store.saveSummary(p.id, { summary: null, summary_status: source ? (summaryEligibility(source, text) as SummaryStatus) : "not_permitted", summary_model: null });
      return;
    }
    const docType = p.article_type === "final_rule" ? "Rule" : p.article_type === "proposed_rule" ? "Proposed Rule" : p.article_type === "notice" ? "Notice" : null;
    try {
      const r = await writer({ system: SUMMARY_SYSTEM, user: summaryInput({ headline: p.headline, text, docType, effectiveOn: p.effective_on, publisher: p.publisher }), schema: summarySchema, model, maxTokens: 600 });
      report.costUsd += r.costUsd;
      const summary = tidySummary(r.data.what_happened);
      const problems = guardSummary(summary, { headline: p.headline, text, docType, effectiveOn: p.effective_on });
      if (problems.length) {
        report.rejected++;
        await store.saveSummary(p.id, { summary: null, summary_status: "rejected", summary_model: r.model });
      } else {
        report.written++;
        await store.saveSummary(p.id, { summary, summary_status: "generated", summary_model: r.model });
      }
    } catch {
      report.rejected++;
      // Leave it pending once more would loop forever on a bad item: mark rejected, the snippet still shows.
      await store.saveSummary(p.id, { summary: null, summary_status: "rejected", summary_model: null });
    }
  };
  for (let i = 0; i < pending.length; i += SUMMARY_CONCURRENCY) {
    if (spent + report.costUsd >= s.monthlyBudgetUsd) break;
    await Promise.all(pending.slice(i, i + SUMMARY_CONCURRENCY).map(one));
  }
  await store.recordRun({ source_key: "all", phase: "summarize", started_at: started, finished_at: new Date().toISOString(), status: "ok", ai_summaries: report.written, ai_rejected: report.rejected, ai_cost_usd: Math.round(report.costUsd * 1e6) / 1e6 });
  return report;
}
