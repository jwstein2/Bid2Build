import "server-only";
/**
 * Official rate import (V6.9 built-in tax engine). Runs with the service role from /api/cron/tax-rates every hour and
 * works through the states whose import is oldest, inside a time budget, so each run stays short.
 *
 * Per state:
 *   1. Find the current files: a direct link set by the owner, or the newest matching file on the official listing page.
 *   2. Download and read the rate file; validate it (FormatChanged = keep the last good rates, mark the source).
 *   3. Record new/changed rates through public.tax_official_import (versioned, effective-dated, alerts for changes).
 *   4. When the boundary file is new, rebuild that state's ZIP areas (loaded in chunks, switched live at the end).
 * A failure never deletes or alters rates already on file. Nothing here costs money or needs credentials.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorityFor } from "../authorities";
import { aggregateSstBoundaries, describeListing, fileNameOf, fileText, findOfficialFiles, FormatChanged, linksOf, parseSstRates, parseStateTable, type OfficialRate, type TableFormat } from "./official-files";

type Db = SupabaseClient;
type Fetch = typeof fetch;

export interface SourceRow {
  state: string; kind: "sst" | "state_table" | "state_only" | "none"; listing_url: string | null; rate_url: string | null; boundary_url: string | null;
  format: TableFormat | null; status: string; last_rate_file: string | null; last_boundary_file: string | null; zips_loaded: number; last_success_at: string | null;
}

export interface StateImportResult { state: string; status: "ok" | "failed" | "format_changed" | "needs_link" | "skipped"; rates: number; changes: number; zips: number; alerts: number; error: string | null }

class NeedsLink extends Error {}

const MAX_BYTES = 80 * 1024 * 1024;
const UA = "Built2Bid-tax-rates/1.0 (+https://built2bid.org)";

async function download(url: string, f: Fetch, timeoutMs: number): Promise<Buffer> {
  const r = await f(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`download ${r.status} ${fileNameOf(url)}`);
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error(`file too large (${len} bytes)`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("file too large");
  return buf;
}

// Listing pages fetched in this run, shared by all states (one hourly run reads the same official pages many times).
const pageCache = new Map<string, { at: number; html: string }>();
const PAGE_TTL_MS = 10 * 60 * 1000;
async function page(url: string, f: Fetch, timeoutMs: number, cache: boolean): Promise<string> {
  const hit = cache ? pageCache.get(url) : undefined;
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;
  const r = await f(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`listing page ${r.status}`);
  const html = await r.text();
  if (cache) pageCache.set(url, { at: Date.now(), html });
  return html;
}

const FILE_EXT = /\.(zip|csv|txt|xlsx?|pdf)(?:$|[?#])/i;
const RB_PAGE = /rate[-\s_]*(?:and|&|&amp;)?[-\s_]*boundar/i;

/**
 * Which files to read for a source: owner-set direct links first, else found from the listing page. When the listing
 * doesn't link the files itself, up to two more same-site pages are followed: a page named for this state, or a
 * "Rate and Boundary Files" page (not an "updates" page). When nothing is found, `listing` says what each page offered.
 */
export async function resolveFiles(src: SourceRow, f: Fetch, timeoutMs = 8000, opts: { cache?: boolean } = {}): Promise<{ rateUrl: string | null; boundaryUrl: string | null; listing?: string }> {
  if (src.rate_url) return { rateUrl: src.rate_url, boundaryUrl: src.boundary_url };
  if (!src.listing_url) return { rateUrl: null, boundaryUrl: src.boundary_url };
  const host = new URL(src.listing_url).host;
  const name = authorityFor(src.state)?.stateName;
  const visited = new Set<string>();
  const notes: string[] = [];
  let url: string | null = src.listing_url;
  for (let hop = 0; url && hop < 3; hop++) {
    visited.add(url);
    let html: string;
    try { html = await page(url, f, timeoutMs, opts.cache ?? false); }
    catch (e) { if (hop === 0) throw e; notes.push(`${url}: ${(e as Error).message}`); break; }
    const found = findOfficialFiles(html, src.state, url, name);
    if (found.rateUrl) return { rateUrl: found.rateUrl, boundaryUrl: src.boundary_url ?? found.boundaryUrl };
    notes.push(`${hop ? `${url}: ` : ""}${describeListing(html, src.state, url)}`);
    const links = linksOf(html, url).filter((l) => { try { return new URL(l.url).host === host && !visited.has(l.url) && !FILE_EXT.test(l.url); } catch { return false; } });
    const statePage = links.find((l) => (name && new RegExp(`\\b${name}\\b`, "i").test(l.text)) || new RegExp(`^${src.state}$`, "i").test(l.text.trim()));
    const rbPage = links.filter((l) => RB_PAGE.test(`${l.url} ${l.text}`) && !/update|change|archive/i.test(`${l.url} ${l.text}`))
      .sort((x, y) => Number(Boolean(y.text)) - Number(Boolean(x.text)))[0];
    url = statePage?.url ?? rbPage?.url ?? null;
  }
  return { rateUrl: null, boundaryUrl: src.boundary_url, listing: notes.join(". ").slice(0, 420) };
}

export async function importState(db: Db, src: SourceRow, deps: { fetchImpl?: Fetch; now?: Date; deadline?: number } = {}): Promise<StateImportResult> {
  const f = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const left = () => Math.max(3000, (deps.deadline ?? Date.now() + 20_000) - Date.now());
  const out: StateImportResult = { state: src.state, status: "ok", rates: 0, changes: 0, zips: 0, alerts: 0, error: null };
  if (src.kind === "none" || src.kind === "state_only") {
    await db.from("tax_rate_sources").update({ status: "not_needed", last_attempt_at: now.toISOString(), updated_at: now.toISOString() }).eq("state", src.state);
    return { ...out, status: "skipped" };
  }
  if (!src.rate_url && !src.listing_url) {
    const error = "No official file link set for this state yet.";
    await db.from("tax_rate_sources").update({ status: "needs_link", last_error: error, last_attempt_at: now.toISOString(), updated_at: now.toISOString() }).eq("state", src.state);
    return { ...out, status: "needs_link", error };
  }
  const { data: run } = await db.from("tax_sync_runs").insert({ provider: "official", kind: "import", state: src.state, status: "running" }).select("id").single();
  const runId = (run as { id: string } | null)?.id ?? null;
  const patch: Record<string, unknown> = { last_attempt_at: now.toISOString(), updated_at: now.toISOString() };
  try {
    const files = await resolveFiles(src, f, Math.min(8000, left()), { cache: !deps.fetchImpl });
    if (!files.rateUrl) { throw new NeedsLink(`Couldn't find this state's current rate file on the official page.${files.listing ? ` ${files.listing}` : ""}`); }

    // Rates
    const rateBuf = await download(files.rateUrl, f, left());
    const { text } = fileText(rateBuf, /rate/i);
    let rows: OfficialRate[];
    if (src.kind === "sst") rows = parseSstRates(text, src.state, today);
    else if (src.format) rows = parseStateTable(text, src.state, src.format, today);
    else throw new NeedsLink("This state's rate table needs a column mapping before it can be read.");
    out.rates = rows.length;
    for (let i = 0; i < rows.length; i += 400) {
      const { data, error } = await db.rpc("tax_official_import", { p_state: src.state, p_run: runId, p_source_url: files.rateUrl,
        p_rows: rows.slice(i, i + 400).map((r) => ({ code: r.code, name: r.name, level: r.level, rate: r.rate, effectiveFrom: r.effectiveFrom })) });
      if (error) throw new Error(error.message);
      const d = data as { found: number; alertIds: string[] };
      out.changes += Number(d.found ?? 0);
      for (const id of d.alertIds ?? []) { const { data: n } = await db.rpc("tax_fanout_alerts", { p_change_id: id }); out.alerts += Number(n ?? 0); }
    }
    patch.last_rate_file = fileNameOf(files.rateUrl).slice(0, 300);
    patch.rates_loaded = rows.length;

    // Boundaries (SST only), when the state published a new file or none is loaded yet.
    if (src.kind === "sst" && files.boundaryUrl && (fileNameOf(files.boundaryUrl) !== src.last_boundary_file || !src.zips_loaded) && left() > 6000) {
      const bBuf = await download(files.boundaryUrl, f, left());
      const areas = aggregateSstBoundaries(fileText(bBuf, /bound|\.csv$/i).text, src.state, today);
      const bRun = runId ?? crypto.randomUUID();
      for (let i = 0; i < areas.length; i += 2000) {
        const { error } = await db.rpc("tax_zip_areas_load", { p_state: src.state, p_run: bRun, p_rows: areas.slice(i, i + 2000) });
        if (error) throw new Error(error.message);
      }
      const { error } = await db.rpc("tax_zip_areas_commit", { p_state: src.state, p_run: bRun });
      if (error) throw new Error(error.message);
      out.zips = new Set(areas.map((a) => a.zip5)).size;
      patch.zips_loaded = out.zips;
      patch.last_boundary_file = fileNameOf(files.boundaryUrl).slice(0, 300);
    }
    patch.status = "ok"; patch.last_success_at = new Date().toISOString(); patch.last_error = null;
  } catch (e) {
    if (e instanceof NeedsLink) { out.status = "needs_link"; out.error = e.message; }
    else if (e instanceof FormatChanged) { out.status = "format_changed"; out.error = e.message; }
    else { out.status = "failed"; out.error = (e as Error)?.message ?? "import failed"; }
    patch.status = out.status; patch.last_error = (out.error ?? "").slice(0, 500);
  }
  await db.from("tax_rate_sources").update(patch).eq("state", src.state);
  if (runId) await db.from("tax_sync_runs").update({ status: out.status === "ok" ? "ok" : "failed", finished_at: new Date().toISOString(), error: out.error?.slice(0, 500) ?? null,
    changes_found: out.changes, rows_read: out.rates }).eq("id", runId);
  return out;
}

/** One hourly pass: the states imported longest ago first, until the time budget runs out. */
export async function runOfficialImports(db: Db, opts: { budgetMs?: number; fetchImpl?: Fetch; now?: Date; states?: string[] } = {}) {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 18_000);
  let q = db.from("tax_rate_sources").select("state, kind, listing_url, rate_url, boundary_url, format, status, last_rate_file, last_boundary_file, zips_loaded, last_success_at")
    .in("kind", ["sst", "state_table"]).order("last_attempt_at", { ascending: true, nullsFirst: true }).limit(60);
  if (opts.states?.length) q = q.in("state", opts.states);
  const { data, error } = await q;
  if (error) return { error: error.message, results: [] as StateImportResult[] };
  const results: StateImportResult[] = [];
  for (const src of (data ?? []) as SourceRow[]) {
    if (Date.now() > deadline - 4000) break;
    // A state table without a mapping, or a state with no links at all, is skipped quickly (still marked attempted).
    results.push(await importState(db, src, { fetchImpl: opts.fetchImpl, now: opts.now, deadline }));
  }
  return { error: null, results };
}
