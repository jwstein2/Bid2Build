/**
 * Project location -> permitting-area choices (pure, client-safe). Mirrors scripts/academy/kb/gen_geo.py so an
 * address match and a ZIP pick produce the same jurisdiction id. A ZIP only narrows the choices; the visitor picks.
 */
import DUPS from "./seed/place-dups.json";

export type GeoKind = "city" | "township" | "county";
export type GeoOption = { id: string; label: string; kind: GeoKind; share: number };

export const FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
  "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
  "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY",
  "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX",
  "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
};
const DUP = new Set(DUPS as string[]);

export function slug(s: string): string {
  const t = `${s.toLowerCase()} `.replace(/\bst\.?\s/g, "saint ").replace(/\bste\.?\s/g, "sainte ").replace(/&/g, " and ");
  return t.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
}
export const countyBase = (n: string) => n.replace(/\s+(County|Parish|Borough|City and Borough|Census Area|Municipality|Municipio|city)$/, "");
export const placeBase = (n: string) =>
  n.replace(/\s+(city|town|village|borough|municipality|CDP|city and borough|urban county|unified government|consolidated government|metro government|metropolitan government)(\s*\(.*\))?$/i, "");

export function placeId(state: string, placeName: string, countyName: string): string {
  const s = slug(placeBase(placeName));
  return DUP.has(`${state}:${s}`) ? `${state}:${s}-${slug(countyBase(countyName))}` : `${state}:${s}`;
}
export function townId(state: string, townName: string, countyName: string): string {
  const base = townName.replace(/\s+(township|town|charter township|plantation|gore|grant|location|purchase|reservation|unorganized territory)$/i, "");
  return `${state}:${slug(countyBase(countyName))}:${slug(base)}-${/township$/i.test(townName) ? "twp" : "town"}`;
}
export const countyId = (state: string, countyName: string) => (state === "DC" ? "DC:district-of-columbia" : `${state}:${slug(countyBase(countyName))}-county`);

export const shardUrl = (zip: string) => (/^\d{5}$/.test(zip) ? `/academy-geo/${zip.slice(0, 3)}.json` : null);

const ORDER: Record<GeoKind, number> = { city: 0, township: 1, county: 2 };
/** The choices for one ZIP: cities first, then townships, then unincorporated county land, each by share of the ZIP. */
export function parseShard(data: unknown, zip: string): GeoOption[] {
  const rows = (data as Record<string, [string, string, string, number][]>)?.[zip];
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => Array.isArray(r) && /^[A-Z]{2}(:[a-z0-9-]{2,60})+$/.test(r[0]))
    .map(([id, label, kind, share]) => ({ id, label, kind: (["city", "township", "county"].includes(kind) ? kind : "county") as GeoKind, share }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.share - a.share);
}

/** Census geocoder result -> the jurisdiction id the picker would use. */
export function idFromCensus(g: { state: string; place?: { NAME: string } | null; cousub?: { NAME: string; FUNCSTAT?: string; LSADC?: string } | null; county: { NAME: string } }): GeoOption {
  const st = FIPS[g.state];
  if (st === "DC") return { id: "DC:district-of-columbia", label: "District of Columbia", kind: "city", share: 1 };
  if (g.place) return { id: placeId(st, g.place.NAME, g.county.NAME), label: placeBase(g.place.NAME), kind: "city", share: 1 };
  if (g.cousub && g.cousub.FUNCSTAT === "A" && /(township|town)$/i.test(g.cousub.NAME)) {
    const label = g.cousub.NAME.replace(/\b(township|town)$/i, (m) => m[0].toUpperCase() + m.slice(1));
    return { id: townId(st, g.cousub.NAME, g.county.NAME), label: `${label}, ${g.county.NAME}`, kind: "township", share: 1 };
  }
  return { id: countyId(st, g.county.NAME), label: `Unincorporated ${g.county.NAME}`, kind: "county", share: 1 };
}

const title = (s: string) => s.split("-").filter(Boolean).map((w) => (w === "and" || w === "of" ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
/** Readable name from a jurisdiction id, for places not on file yet ("MN:olmsted:cascade-twp" -> "Cascade Township, Olmsted County"). */
export function labelFromId(id: string): string {
  if (id === "DC:district-of-columbia") return "District of Columbia";
  const parts = id.split(":").slice(1);
  if (parts.length === 2) {
    const [county, town] = parts;
    const kind = town.endsWith("-twp") ? "Township" : "Town";
    return `${title(town.replace(/-(twp|town)$/, ""))} ${kind}, ${title(county)} County`;
  }
  const one = parts[0] ?? "";
  return one.endsWith("-county") ? `Unincorporated ${title(one.replace(/-county$/, ""))} County` : title(one);
}

/**
 * What the ZIP field should say. Each situation gets its own message; none of them blocks a statewide search.
 * - resolved: one area, picked automatically · multiple: the visitor picks · no_local_data: a real ZIP with no areas
 * - unknown: not a Census ZIP (PO-box-only, unique or unassigned) · failed: the lookup didn't load · mismatch: ZIP is in another state
 */
export type ZipStatus = "none" | "incomplete" | "loading" | "resolved" | "multiple" | "no_local_data" | "unknown" | "failed" | "mismatch";
export function zipStatusFor(i: { zip: string; loading: boolean; shardStatus: "ok" | "unknown" | "failed" | null; options: GeoOption[]; state: string | null | undefined }): ZipStatus {
  if (!i.zip) return "none";
  if (!/^\d{5}$/.test(i.zip)) return "incomplete";
  if (i.loading || !i.shardStatus) return "loading";
  if (i.shardStatus === "failed") return "failed";
  if (i.shardStatus === "unknown") return "unknown";
  if (!i.options.length) return "no_local_data";
  const zipState = i.options[0].id.slice(0, 2);
  if (i.state && i.state !== zipState) return "mismatch";
  return i.options.length > 1 ? "multiple" : "resolved";
}
