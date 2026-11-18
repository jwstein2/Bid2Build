import { normPlace } from "./geo";

/**
 * Feed parsers: RSS 2.0 / Atom, the Federal Register documents API (JSON) and OpenFEMA disaster
 * declarations (JSON). Pure functions (no network) so tests run on fixture feeds.
 *
 * Output is untrusted text: HTML is stripped, entities decoded, lengths capped. Nothing here decides
 * whether an item is published; verify.ts and classify.ts do.
 */

export interface RawItem {
  sourceKey: string;
  title: string;
  url: string;
  guid: string | null;
  publishedRaw: string | null;
  description: string;          // plain text, publisher-provided
  imageUrl: string | null;
  effectiveOn?: string | null;
  docType?: string | null;      // Federal Register: Rule / Proposed Rule / Notice
  action?: string | null;
  agencies?: string[];
  states?: string[];
  counties?: string[];
  places?: string[];            // normalized county/area names the source names
  structuredSummary?: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", copy: "©", reg: "®", trade: "™", deg: "°" };

function decodeOnce(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Decode entities (twice: some feeds double-encode, e.g. "&amp;#39;"). */
export function decodeEntities(s: string): string {
  const once = decodeOnce(s);
  return /&(#x?[0-9a-f]+|[a-z]+);/i.test(once) ? decodeOnce(once) : once;
}

const stripCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** HTML → plain text, single-spaced, capped. Scripts/styles/figures are dropped entirely. */
export function toPlainText(html: string, max = 2000): string {
  let s = stripCdata(html);
  // Feeds escape their HTML; decode first so tags become tags.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<(script|style|figure|iframe|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : s;
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? stripCdata(m[1]).trim() : null;
}
function attr(block: string, name: string, attribute: string, where?: (el: string) => boolean): string | null {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  for (const el of block.match(re) ?? []) {
    if (where && !where(el)) continue;
    const m = el.match(new RegExp(`\\s${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (m) return decodeEntities(m[1]);
  }
  return null;
}

const MAX_FEED_BYTES = 3_000_000;

export function parseRss(xml: string, sourceKey: string, limit = 60): RawItem[] {
  const text = xml.slice(0, MAX_FEED_BYTES);
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) ?? text.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out: RawItem[] = [];
  for (const b of blocks.slice(0, limit)) {
    const title = toPlainText(tag(b, "title") ?? "", 300);
    const linkText = tag(b, "link");
    const link = (linkText && /^https?:\/\//i.test(decodeEntities(linkText)) ? decodeEntities(linkText) : null)
      ?? attr(b, "link", "href", (el) => !/rel\s*=\s*["'](?!alternate)/i.test(el));
    const guid = tag(b, "guid") ?? tag(b, "id");
    const published = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "dc:date") ?? tag(b, "updated");
    const desc = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content:encoded") ?? tag(b, "content") ?? "";
    const image = attr(b, "media:thumbnail", "url") ?? attr(b, "media:content", "url", (el) => !/medium\s*=\s*["'](?!image)/i.test(el))
      ?? attr(b, "enclosure", "url", (el) => /type\s*=\s*["']image\//i.test(el));
    if (!title || !link) continue;
    out.push({ sourceKey, title, url: link.trim(), guid: guid ? decodeEntities(guid) : null, publishedRaw: published, description: toPlainText(desc, 1200), imageUrl: image });
  }
  return out;
}

interface FrDoc {
  title?: string; abstract?: string | null; html_url?: string; publication_date?: string; effective_on?: string | null;
  type?: string; action?: string | null; agencies?: { name?: string; raw_name?: string }[]; document_number?: string;
}

export function parseFederalRegister(json: unknown, sourceKey: string, limit = 60): RawItem[] {
  const results = (json as { results?: FrDoc[] } | null)?.results;
  if (!Array.isArray(results)) throw new Error("Federal Register response had no results array");
  return results.slice(0, limit).flatMap((d) => {
    if (!d.title || !d.html_url) return [];
    return [{
      sourceKey, title: toPlainText(d.title, 300), url: d.html_url, guid: d.document_number ?? null, publishedRaw: d.publication_date ?? null,
      description: toPlainText(d.abstract ?? "", 2000), imageUrl: null,
      effectiveOn: d.effective_on && /^\d{4}-\d{2}-\d{2}$/.test(d.effective_on) ? d.effective_on : null,
      docType: d.type ?? null, action: d.action ? toPlainText(d.action, 200) : null,
      agencies: (d.agencies ?? []).map((a) => a.name ?? a.raw_name ?? "").filter(Boolean),
    }];
  });
}

interface FemaRow {
  disasterNumber?: number; state?: string; declarationType?: string; declarationDate?: string; incidentType?: string; declarationTitle?: string;
  incidentBeginDate?: string | null; incidentEndDate?: string | null; fipsStateCode?: string; fipsCountyCode?: string; designatedArea?: string;
  iaProgramDeclared?: boolean; paProgramDeclared?: boolean; ihProgramDeclared?: boolean;
}

const DECL: Record<string, string> = { DR: "a major disaster", EM: "an emergency", FM: "a fire management assistance declaration" };
const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * OpenFEMA returns one row per designated county. Group rows into one item per disaster + state, and
 * write the summary only from the fields (no AI, nothing added).
 */
export function parseOpenFema(json: unknown, sourceKey: string, stateName: (code: string) => string, limit = 60): RawItem[] {
  const rows = (json as { DisasterDeclarationsSummaries?: FemaRow[] } | null)?.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw new Error("OpenFEMA response had no DisasterDeclarationsSummaries array");
  const groups = new Map<string, FemaRow[]>();
  for (const r of rows) {
    if (!r.disasterNumber || !r.state || !r.declarationDate) continue;
    const k = `${r.disasterNumber}-${r.state}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: RawItem[] = [];
  for (const [, g] of [...groups].slice(0, limit)) {
    const r = g[0];
    const state = stateName(r.state!);
    const areas = [...new Set(g.map((x) => x.designatedArea).filter((a): a is string => Boolean(a)))];
    const counties = [...new Set(g.filter((x) => x.fipsStateCode && x.fipsCountyCode && x.fipsCountyCode !== "000").map((x) => `${x.fipsStateCode!.padStart(2, "0")}${x.fipsCountyCode!.padStart(3, "0")}`))];
    const incident = r.incidentType ? r.incidentType.toLowerCase() : "incident";
    // "Hurricane: Hurricane Isaias" reads oddly; use the title alone when it already names the incident type.
    const titled = r.declarationTitle ? titleCase(r.declarationTitle) : null;
    const label = titled && titled.toLowerCase().includes(incident) ? titled : titled ? `${titleCase(incident)}: ${titled}` : titleCase(incident);
    const kind = DECL[r.declarationType ?? ""] ?? "a disaster declaration";
    const shown = areas.slice(0, 4).join(", ");
    const more = areas.length > 4 ? ` and ${areas.length - 4} more` : "";
    const begin = fmtDay(r.incidentBeginDate), end = fmtDay(r.incidentEndDate);
    const programs = [r.iaProgramDeclared || r.ihProgramDeclared ? "individual assistance" : null, r.paProgramDeclared ? "public assistance" : null].filter(Boolean).join(" and ");
    const summary = [
      `FEMA declared ${kind} for ${state} on ${fmtDay(r.declarationDate)} (${label}).`,
      areas.length ? `Designated areas: ${shown}${more}.` : null,
      begin ? `Incident period: ${begin}${end && end !== begin ? ` to ${end}` : ""}.` : null,
      programs ? `Programs declared: ${programs}.` : null,
    ].filter(Boolean).join(" ");
    out.push({
      sourceKey, title: `${titleCase(incident)} disaster declaration for ${state}${r.declarationTitle ? ` (${titleCase(r.declarationTitle)})` : ""}`,
      url: `https://www.fema.gov/disaster/${r.disasterNumber}`, guid: `fema-${r.disasterNumber}-${r.state}`, publishedRaw: r.declarationDate!,
      description: summary, imageUrl: null, states: [r.state!], counties, places: areas.map(normPlace).filter(Boolean), structuredSummary: summary, docType: "Disaster declaration",
    });
  }
  return out;
}
