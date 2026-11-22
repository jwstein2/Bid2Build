/**
 * Live federal discovery through the official eCFR search API (https://www.ecfr.gov/developers/documentation/api/v1).
 *
 * The verified local index (academy_kb_search) stays the authority. This layer only adds more federal sections from
 * the contractor-relevant parts (OSHA construction + recordkeeping, EPA lead-safe renovation, FMCSA) when the
 * question is about a federal topic, labels them as "not reviewed by Built2Bid", never uses them as a Quick Answer,
 * and returns null on any failure so the page falls back to local results only.
 *
 * Federal regulations are U.S. Government works (public domain). Excerpts are sanitized: every tag except the
 * API's <strong> hit markers is dropped, and hits come back as plain-text segments (no HTML is ever rendered).
 * Responses are cached for a day per question (Next fetch cache), with a 4 s timeout; no key or account is needed.
 */
export interface EcfrScope { title: number; part?: string; chapter?: string; subchapter?: string; label: string; group: "safety" | "environment" | "transport" }
export const ECFR_SCOPES: EcfrScope[] = [
  { title: 29, part: "1926", label: "OSHA construction (29 CFR 1926)", group: "safety" },
  { title: 29, part: "1904", label: "OSHA recordkeeping (29 CFR 1904)", group: "safety" },
  { title: 40, part: "745", label: "EPA lead-safe renovation (40 CFR 745)", group: "environment" },
  { title: 49, chapter: "III", subchapter: "B", label: "FMCSA vehicles and drivers (49 CFR 350-399)", group: "transport" },
];

export interface EcfrSegment { text: string; hit: boolean }
export interface EcfrHit {
  citation: string; title: number; part: string; section: string; heading: EcfrSegment[]; excerpt: EcfrSegment[];
  path: string; url: string; scope: EcfrScope["group"]; scopeLabel: string; since: string | null; score: number;
}

/** "40 CFR 745.85", "29 C.F.R. § 1926.501(b)(13)", "29 CFR part 1926" -> title + section/part. */
export function parseCfrCitation(q: string): { title: number; section: string | null; part: string } | null {
  const m = q.match(/\b(\d{1,2})\s*C\.?\s*F\.?\s*R\.?\s*(?:§+|part|pt\.?)?\s*(\d{1,4})(?:\.(\d{1,5}))?/i);
  if (!m) return null;
  const title = Number(m[1]);
  if (title < 1 || title > 50) return null;
  return { title, part: m[2], section: m[3] ? `${m[2]}.${m[3]}` : null };
}

export const ecfrSectionUrl = (title: number, section: string) => `https://www.ecfr.gov/current/title-${title}/section-${section}`;
export const ecfrPartUrl = (title: number, part: string) => `https://www.ecfr.gov/current/title-${title}/part-${part}`;

const FEDERAL_TERMS = /\b(osha|cfr|c\.f\.r|epa|rrp|lead|pre-?1978|renovat\w*|dot|fmcsa|cdl|commercial (?:vehicle|driver)|drug test\w*|hours of service|fall protection|fall arrest|harness|guardrail system|scaffold\w*|ladder\w*|trench\w*|excavat\w*|shoring|silica|asbestos|respirat\w*|ppe|hard hat|hearing|noise|confined space|crane\w*|forklift|lockout|hazard communication|sds|injur\w*|fatalit\w*|recordkeeping|300 log|competent person|toolbox talk|gfci|ground[- ]fault|temporary power|demolition|welding|fire extinguisher|first aid)\b/i;

/**
 * Whether a question is about federal rules, so the live federal layer is worth showing. Building-code questions
 * ("deck railing height") are not: federal OSHA rules protect workers and never set residential building requirements.
 */
export function wantsFederal(q: string, leadGroup: string | null): boolean {
  if (parseCfrCitation(q)) return true;
  if (leadGroup && leadGroup !== "building" && leadGroup !== "adoption") return true;
  if (leadGroup === "building" || leadGroup === "adoption") return /\b(osha|cfr|epa|dot|fmcsa)\b/i.test(q);
  return FEDERAL_TERMS.test(q);
}

/** Plain-text segments from an API string: only <strong> marks a hit, every other tag is dropped. */
export function toSegments(html: string | null | undefined, max = 320): EcfrSegment[] {
  if (!html) return [];
  const out: EcfrSegment[] = [];
  let len = 0;
  const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  const re = /<strong>([\s\S]*?)<\/strong>|<span class="elipsis">[\s\S]*?<\/span>|<[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && len < max) {
    let text: string, hit = false;
    if (m[1] !== undefined) { text = decode(m[1].replace(/<[^>]*>/g, "")); hit = true; }
    else if (m[2] !== undefined) text = decode(m[2]);
    else if (m[0].startsWith("<span")) text = " … ";
    else continue;
    text = text.replace(/\s+/g, " ");
    if (len + text.length > max) text = `${text.slice(0, max - len)}…`;
    len += text.length;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text; else out.push({ text, hit });
  }
  return out;
}

type ApiResult = {
  type: string; starts_on: string | null; ends_on: string | null; removed?: boolean; reserved?: boolean; score?: number;
  hierarchy: { title: string; part: string | null; subpart?: string | null; section: string | null };
  headings: { section: string | null; subpart?: string | null }; full_text_excerpt: string | null;
};

function scopeParams(s: EcfrScope): URLSearchParams {
  const p = new URLSearchParams();
  p.set("hierarchy[title]", String(s.title));
  if (s.part) p.set("hierarchy[part]", s.part);
  if (s.chapter) p.set("hierarchy[chapter]", s.chapter);
  if (s.subchapter) p.set("hierarchy[subchapter]", s.subchapter);
  return p;
}

const BASE = "https://www.ecfr.gov/api/search/v1/results";
const UA = "Built2Bid-Academy/1.0 (+https://built2bid.org/academy)";

async function searchScope(q: string, scope: EcfrScope, perPage: number, fetcher: typeof fetch): Promise<EcfrHit[] | null> {
  const p = scopeParams(scope);
  p.set("query", q);
  p.set("date", "current");
  p.set("per_page", String(perPage));
  try {
    const r = await fetcher(`${BASE}?${p}`, {
      headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(4000),
      next: { revalidate: 86_400 },
    } as RequestInit);
    if (!r.ok) return null;
    const data = (await r.json()) as { results?: ApiResult[] };
    if (!Array.isArray(data?.results)) return null;
    const out: EcfrHit[] = [];
    for (const x of data.results) {
      const sec = x?.hierarchy?.section;
      if (x?.type !== "Section" || !sec || x.removed || x.reserved || x.ends_on || !/^\d{1,4}\.\d{1,5}$/.test(sec)) continue;
      const title = Number(x.hierarchy.title);
      out.push({
        citation: `${title} CFR ${sec}`, title, part: sec.split(".")[0], section: sec,
        heading: toSegments(x.headings?.section, 160), excerpt: toSegments(x.full_text_excerpt),
        path: [scope.label, x.headings?.subpart ? `Subpart ${x.hierarchy.subpart ?? ""}`.trim() : null].filter(Boolean).join(" › "),
        url: ecfrSectionUrl(title, sec), scope: scope.group, scopeLabel: scope.label, since: x.starts_on ?? null, score: Number(x.score) || 0,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Live federal sections for a question, minus the ones already in the local results. Null when eCFR is down, slow or
 * rate-limited (the page then shows local results only, with no error banner).
 */
export async function ecfrDiscover(q: string, opts: { exclude?: string[]; limit?: number; fetcher?: typeof fetch } = {}): Promise<EcfrHit[] | null> {
  // An exact citation is answered by the codebook card (official link); full-text search would only add noise.
  if (parseCfrCitation(q)?.section) return [];
  // Agency names and filler words rarely appear in the regulation text itself and only dilute the full-text match.
  const query = q.replace(/[^\p{L}\p{N}\s.\-']/gu, " ")
    .replace(/\b(osha|epa|dot|fmcsa|cfr|federal|rules?|regulations?|requirements?|required|what|how|does|do|is|are|the|for|a|an|of|to|in|on|my)\b/gi, " ")
    .replace(/\s+/g, " ").trim().slice(0, 120);
  if (query.length < 3) return [];
  const fetcher = opts.fetcher ?? fetch;
  const cite = parseCfrCitation(q);
  const scopes = cite ? ECFR_SCOPES.filter((s) => s.title === cite.title) : ECFR_SCOPES;
  if (!scopes.length) return [];
  const runs = await Promise.all(scopes.map((s) => searchScope(query, s, 6, fetcher)));
  if (runs.every((r) => r === null)) return null;
  const seen = new Set((opts.exclude ?? []).map((c) => c.replace(/\(.*$/, "").trim()));
  const all = runs.flatMap((r) => r ?? []).sort((a, b) => b.score - a.score);
  // Keep only strong matches relative to the best one, so a weak hit from an unrelated agency isn't shown.
  const top = all[0]?.score ?? 0;
  const hits: EcfrHit[] = [];
  for (const h of all) {
    if (seen.has(h.citation) || (top > 0 && h.score < top * 0.5)) continue;
    seen.add(h.citation);
    hits.push(h);
  }
  return hits.slice(0, opts.limit ?? 6);
}
