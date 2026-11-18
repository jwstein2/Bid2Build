/**
 * Readers for official state rate and boundary files (V6.9 built-in tax engine). Pure functions: no network, no DB.
 *
 * Streamlined Sales Tax (SST) member states publish two files every quarter in the layout set by the SST Governing
 * Board's Technology Guide (chapter 5):
 *   - Rate file (CSV): state FIPS, jurisdiction type, jurisdiction FIPS code, general rate intrastate, general rate
 *     interstate, food/drug rate intrastate, food/drug rate interstate, effective begin (YYYYMMDD), effective end.
 *     Rates are decimals (0.06875 = 6.875%). Jurisdiction types: 45 state, 00 county, 01 city/place, others special.
 *   - Boundary file (CSV): record type (A address range, 4 ZIP+4 range, Z five-digit ZIP range), begin and end dates,
 *     address and ZIP fields, then state FIPS, county FIPS, place FIPS and up to 20 special taxing district codes.
 * Built2Bid reads the ZIP-level records (Z and 4) and keeps, per five-digit ZIP, each distinct combination of county,
 * place and special districts with how many records point at it. The street-level match comes from the Census
 * geocoder (county + place), so the large address-range (A) records are not needed.
 *
 * Every reader validates what it reads. If a file doesn't look like the published layout (wrong state, rates out of
 * range, too many malformed rows) it throws FormatChanged and the importer keeps the last good data.
 */
import { inflateRawSync } from "node:zlib";

export class FormatChanged extends Error { constructor(msg: string) { super(`format_changed: ${msg}`); } }

/** State abbreviation → two-digit FIPS. */
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18",
  IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33",
  NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

// --- ZIP archives -------------------------------------------------------------------------------------------------
/** Extract one file from a .zip (stored or deflated). Picks the first entry matching `want`, else the largest. */
export function unzipOne(buf: Buffer, want?: RegExp): { name: string; data: Buffer } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new FormatChanged("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: { name: string; method: number; size: number; local: number }[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new FormatChanged("bad zip directory");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (!name.endsWith("/")) entries.push({ name, method, size: buf.readUInt32LE(p + 24) || size, local });
    p += 46 + nameLen + extra + comment;
  }
  if (!entries.length) throw new FormatChanged("empty zip archive");
  const e = (want && entries.find((x) => want.test(x.name))) || entries.slice().sort((a, b) => b.size - a.size)[0];
  const lh = e.local;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new FormatChanged("bad zip entry");
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const csize = buf.readUInt32LE(lh + 18) || (entries.length === 1 ? buf.length - start : 0);
  const raw = buf.subarray(start, start + (csize || buf.length - start));
  if (e.method === 0) return { name: e.name, data: Buffer.from(raw) };
  if (e.method === 8) return { name: e.name, data: inflateRawSync(raw) };
  throw new FormatChanged(`unsupported zip compression ${e.method}`);
}

/** File bytes → text, unzipping when needed. */
export function fileText(buf: Buffer, want?: RegExp): { name: string | null; text: string } {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) { const f = unzipOne(buf, want); return { name: f.name, text: f.data.toString("latin1") }; }
  return { name: null, text: buf.toString("latin1") };
}

// --- CSV ----------------------------------------------------------------------------------------------------------
/** Minimal CSV line splitter (quoted fields, doubled quotes). Official files are plain, but be safe. */
export function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",").map((s) => s.trim());
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const ymd = (s: string) => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
const toPct = (frac: string) => { const n = Number(frac); return Number.isFinite(n) ? Number((n * 100).toFixed(5)).toString() : null; };

// --- SST rate file ------------------------------------------------------------------------------------------------
export interface OfficialRate { code: string; name: string; level: "state" | "county" | "city" | "special"; rate: string; effectiveFrom: string; effectiveTo: string | null }

export const jurisdictionCode = (state: string, level: OfficialRate["level"], fips: string) =>
  level === "state" ? state : `${state}-${level === "county" ? "CO" : level === "city" ? "CI" : "SP"}-${fips}`;

/**
 * Rates in force on `today` or later (current + announced future versions). Older versions are skipped: history
 * already on file stays, and new history is never backfilled from a file.
 */
export function parseSstRates(text: string, state: string, today: string): OfficialRate[] {
  const fips = STATE_FIPS[state];
  if (!fips) throw new FormatChanged(`unknown state ${state}`);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: OfficialRate[] = [];
  let bad = 0, data = 0, sawState = false;
  for (const line of lines) {
    const f = splitCsv(line);
    const first = (f[0] ?? "").toUpperCase();
    if (!/^\d{1,2}$/.test(first) && first !== state) continue;   // header / notes (state given as FIPS or abbreviation)
    data++;
    const [, type, code, general, , , , begin, end] = f;
    const st = first === state ? fips : first;
    const from = ymd(begin ?? ""), to = end ? ymd(end) : null;
    const rate = toPct(general ?? "");
    if (st.padStart(2, "0") !== fips || !/^\d{2}$/.test(type ?? "") || !code || !from || rate === null || Number(rate) < 0 || Number(rate) > 20) { bad++; continue; }
    const level: OfficialRate["level"] = type === "45" ? "state" : type === "00" ? "county" : type === "01" ? "city" : "special";
    if (level === "state") sawState = true;
    if (to && to < today) continue;
    const c = jurisdictionCode(state, level, code.trim());
    // The files carry codes, not names; the address lookup supplies county/city names when it matches the street.
    const name = level === "state" ? state : `${level === "county" ? "County" : level === "city" ? "City" : "Special district"} (code ${code.trim()})`;
    out.push({ code: c, name, level, rate, effectiveFrom: from, effectiveTo: to && to < "2999-01-01" ? to : null });
  }
  if (!data) throw new FormatChanged("no rate rows");
  if (bad / data > 0.05) throw new FormatChanged(`${bad} of ${data} rate rows unreadable`);
  if (!sawState) throw new FormatChanged("no statewide rate row");
  return out;
}

// --- SST boundary file --------------------------------------------------------------------------------------------
export interface ZipArea { zip5: string; countyFips: string; placeFips: string | null; specials: string[]; weight: number }

const B = { type: 0, begin: 1, end: 2, zip: 15, zipLow: 17, zipHigh: 19, stateFips: 22, countyFips: 24, placeFips: 25, special0: 29 } as const;

/** Aggregate ZIP-level boundary records (Z, 4) active on `today` into distinct jurisdiction combinations per ZIP. */
export function aggregateSstBoundaries(text: string, state: string, today: string): ZipArea[] {
  const fips = STATE_FIPS[state];
  const combos = new Map<string, ZipArea>();
  let bad = 0, data = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.charAt(0);
    if (t !== "Z" && t !== "4") continue;
    data++;
    const f = splitCsv(line);
    const begin = ymd(f[B.begin] ?? ""), end = ymd(f[B.end] ?? "");
    const county = (f[B.countyFips] ?? "").padStart(3, "0"), place = (f[B.placeFips] ?? "").trim();
    const low = (f[B.zipLow] || f[B.zip] || "").slice(0, 5), high = (f[B.zipHigh] || low).slice(0, 5);
    if ((f[B.stateFips] ?? "").padStart(2, "0") !== fips || !begin || !/^\d{3}$/.test(county) || !/^\d{5}$/.test(low) || !/^\d{5}$/.test(high) || high < low) { bad++; continue; }
    if (begin > today || (end && end < today)) continue;
    const specials: string[] = [];
    for (let i = B.special0; i + 1 < f.length && specials.length < 20; i += 3) { const code = (f[i + 1] ?? "").trim(); if (code) specials.push(code); }
    specials.sort();
    const lo = Number(low), hi = Math.min(Number(high), lo + 99);    // a Z range never spans more than a few ZIPs; cap defensively
    for (let z = lo; z <= hi; z++) {
      const zip5 = String(z).padStart(5, "0");
      const key = `${zip5}|${county}|${place}|${specials.join(",")}`;
      const cur = combos.get(key);
      if (cur) cur.weight++; else combos.set(key, { zip5, countyFips: county, placeFips: /^\d{5}$/.test(place) ? place : null, specials, weight: 1 });
    }
  }
  if (!data) throw new FormatChanged("no ZIP boundary rows");
  if (bad / data > 0.05) throw new FormatChanged(`${bad} of ${data} boundary rows unreadable`);
  return [...combos.values()];
}

// --- Finding the current files on an official listing page ---------------------------------------------------------
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Find the newest rate and boundary file links for a state on an official listing page. SST files are named like
 * MNR2026Q4OCT01.zip (state, R=rate / B=boundary, year, quarter, month, optional day). The name is looked for in the
 * link's path, its query string and the link text, with or without an extension, so download handlers such as
 * /download?file=MNR2026Q4OCT01.zip or /media/1234 with the name as text are found too. Links with "rate"/"boundary"
 * and the state in the name are accepted as a fallback. Returns absolute https URLs, or nulls when nothing matches.
 */
export function findOfficialFiles(html: string, state: string, baseUrl: string): { rateUrl: string | null; boundaryUrl: string | null } {
  const ST = state.toUpperCase();
  const sst = new RegExp(`(?:^|[^A-Z0-9])${ST}[ _-]?([RB])[ _-]?(\\d{4})[ _-]?Q(\\d)[ _-]?([A-Z]{3})?[ _-]?(\\d{2})?(?![0-9])`, "i");
  const fallback = new RegExp(`(?:^|[^A-Z0-9])${ST}(?:[^A-Z0-9]|$)`, "i");
  const best: Record<"R" | "B", { url: string; key: string } | null> = { R: null, B: null };
  for (const { url, text } of linksOf(html, baseUrl)) {
    let decoded = url; try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
    const u = new URL(url);
    const where = [u.pathname, u.search, text].map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    let kind: "R" | "B" | null = null, key = "";
    const m = where.map((w) => w.match(sst)).find(Boolean);
    if (m) {
      kind = m[1].toUpperCase() as "R" | "B";
      const month = m[4] ? MONTHS.indexOf(m[4].toUpperCase()) + 1 : Number(m[3]) * 3 - 2;
      key = `${m[2]}${String(month).padStart(2, "0")}${m[5] ?? "00"}`;
    } else if (/\.(zip|csv)(?:$|[?&#])/i.test(decoded) && where.some((w) => fallback.test(w))) {
      const all = where.join(" ");
      kind = /bound/i.test(all) ? "B" : /rate/i.test(all) ? "R" : null; key = (all.match(/(20\d{2})[-_]?(\d{2})?/)?.slice(1).join("") ?? "");
    }
    if (kind && (!best[kind] || key > best[kind]!.key)) best[kind] = { url, key };
  }
  return { rateUrl: best.R?.url ?? null, boundaryUrl: best.B?.url ?? null };
}

/** All https links on a page with their visible text. */
export function linksOf(html: string, baseUrl: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>|href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = (m[1] ?? m[3] ?? "").replace(/&amp;/g, "&").trim();
    let url: string; try { const u = new URL(href, baseUrl); if (u.protocol !== "https:") continue; url = u.toString(); } catch { continue; }
    const text = (m[2] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    const k = `${url}|${text}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ url, text });
  }
  return out;
}

/** Short description of what a listing page offered, saved with a "couldn't find" error so the page layout can be matched. */
export function describeListing(html: string, state: string, baseUrl: string): string {
  const links = linksOf(html, baseUrl);
  const files = links.filter((l) => /\.(zip|csv|txt|xlsx?)(?:$|[?&#])/i.test(l.url) || /download|file|attachment/i.test(l.url));
  const mine = links.filter((l) => new RegExp(`(?:^|[^A-Z0-9])${state}(?:[^A-Z0-9]|$)`, "i").test(`${l.url} ${l.text}`));
  const sample = [...files, ...mine].slice(0, 6).map((l) => `${l.url.replace(/^https:\/\//, "")}${l.text ? ` [${l.text.slice(0, 40)}]` : ""}`);
  return `Page had ${links.length} links, ${files.length} file links, ${mine.length} mention ${state}${sample.length ? `: ${sample.join(" | ")}` : ""}`;
}

/** File name from a URL (to notice when a state publishes a new quarter's file). */
export const fileNameOf = (url: string) => { try { return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || url; } catch { return url; } };

// --- Generic state rate tables (non-SST states) ---------------------------------------------------------------------
/** Column mapping for a state's own CSV rate table, set by the owner per state (tax_rate_sources.format). */
export interface TableFormat { level: number | "county" | "city"; fips: number; rate: number; name?: number; effectiveFrom?: number; rateUnit: "percent" | "fraction"; skipRows?: number }

export function parseStateTable(text: string, state: string, fmt: TableFormat, today: string): OfficialRate[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(fmt.skipRows ?? 1);
  const out: OfficialRate[] = []; let bad = 0;
  for (const line of lines) {
    const f = splitCsv(line);
    const lvRaw = typeof fmt.level === "number" ? (f[fmt.level] ?? "").toLowerCase() : fmt.level;
    const level: OfficialRate["level"] | null = /state/.test(lvRaw) ? "state" : /count|parish|borough/.test(lvRaw) ? "county" : /city|town|place|munic/.test(lvRaw) ? "city" : /spec|district|transit/.test(lvRaw) ? "special" : null;
    const raw = Number(String(f[fmt.rate] ?? "").replace(/%/g, ""));
    const rate = fmt.rateUnit === "fraction" ? raw * 100 : raw;
    const fipsCode = (f[fmt.fips] ?? "").trim();
    if (!level || !Number.isFinite(rate) || rate < 0 || rate > 20 || (level !== "state" && !fipsCode)) { bad++; continue; }
    const from = (fmt.effectiveFrom !== undefined ? ymd(f[fmt.effectiveFrom] ?? "") : null) ?? today;
    out.push({ code: jurisdictionCode(state, level, fipsCode), name: (fmt.name !== undefined ? f[fmt.name] : "") || `${level} ${fipsCode}`, level, rate: Number(rate.toFixed(5)).toString(), effectiveFrom: from, effectiveTo: null });
  }
  if (!out.length || bad / (bad + out.length) > 0.05) throw new FormatChanged(`${bad} of ${bad + out.length} table rows unreadable`);
  return out;
}
