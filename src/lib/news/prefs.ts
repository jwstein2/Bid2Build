import { z } from "zod/v4";
import { trades as ALL_TRADES } from "@/lib/trades/catalog";
import { normPlace } from "./geo";
import { AUTHORITIES, CATEGORIES, type Authority, type Category } from "./types";

/**
 * News preferences. Company defaults (Enterprise) apply first; a user's own saved preferences replace
 * them field by field. Nothing here asks for GPS: location comes from the company address and the
 * optional service-area counties.
 */

const TRADE_SLUGS = new Set(ALL_TRADES.map((t) => t.slug));
export const RADII = [25, 50, 100, 250] as const;
export const EMPHASES = ["balanced", "local", "state", "national"] as const;

const slugList = (max: number) => z.array(z.string()).max(60).transform((a) => [...new Set(a.filter((s) => TRADE_SLUGS.has(s)))].slice(0, max));
const catList = z.array(z.string()).max(30).transform((a) => [...new Set(a.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c)))]);
const authList = z.array(z.string()).max(8).transform((a) => [...new Set(a.filter((c): c is Authority => (AUTHORITIES as readonly string[]).includes(c)))]);
const textList = (max: number, len: number) => z.array(z.string()).max(100).transform((a) => [...new Set(a.map((s) => s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, len)).filter(Boolean))].slice(0, max));

export const prefsSchema = z.object({
  followedTrades: slugList(12).optional(),
  radiusMiles: z.number().int().refine((n) => (RADII as readonly number[]).includes(n)).optional(),
  geoEmphasis: z.enum(EMPHASES).optional(),
  topics: catList.optional(),
  mutedTopics: catList.optional(),
  sourceTypes: authList.optional(),
  hiddenPublishers: textList(50, 200).optional(),
  serviceCounties: textList(20, 60).transform((a) => a.map(normPlace).filter(Boolean)).optional(),
  notifyOfficialRules: z.boolean().optional(),
  notifyLocalDisasters: z.boolean().optional(),
  notifyMaterialPrices: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
});
export type PrefsInput = z.infer<typeof prefsSchema>;

export interface NewsPrefs {
  followedTrades: string[];
  radiusMiles: number;
  geoEmphasis: (typeof EMPHASES)[number];
  topics: Category[];
  mutedTopics: Category[];
  sourceTypes: Authority[];
  hiddenPublishers: string[];
  serviceCounties: string[];
  notifyOfficialRules: boolean;
  notifyLocalDisasters: boolean;
  notifyMaterialPrices: boolean;
  emailDigest: boolean;
  saved: boolean;          // the user has saved their own preferences
  fromCompany: boolean;    // company defaults are in effect for at least one field
}

export const DEFAULT_PREFS: NewsPrefs = {
  followedTrades: [], radiusMiles: 50, geoEmphasis: "balanced", topics: [], mutedTopics: [], sourceTypes: [], hiddenPublishers: [], serviceCounties: [],
  notifyOfficialRules: false, notifyLocalDisasters: false, notifyMaterialPrices: false, emailDigest: false, saved: false, fromCompany: false,
};

export interface PrefsRow {
  followed_trades?: string[] | null; radius_miles?: number | null; geo_emphasis?: string | null; topics?: string[] | null; muted_topics?: string[] | null;
  source_types?: string[] | null; hidden_publishers?: string[] | null; service_counties?: string[] | null; notify_official_rules?: boolean | null;
  notify_local_disasters?: boolean | null; notify_material_prices?: boolean | null; email_digest?: boolean | null;
}

const clean = (row: PrefsRow | null | undefined): PrefsInput => {
  if (!row) return {};
  const r = prefsSchema.safeParse({
    followedTrades: row.followed_trades ?? undefined, radiusMiles: row.radius_miles ?? undefined, geoEmphasis: row.geo_emphasis ?? undefined,
    topics: row.topics ?? undefined, mutedTopics: row.muted_topics ?? undefined, sourceTypes: row.source_types ?? undefined,
    hiddenPublishers: row.hidden_publishers ?? undefined, serviceCounties: row.service_counties ?? undefined,
    notifyOfficialRules: row.notify_official_rules ?? undefined, notifyLocalDisasters: row.notify_local_disasters ?? undefined,
    notifyMaterialPrices: row.notify_material_prices ?? undefined, emailDigest: row.email_digest ?? undefined,
  });
  return r.success ? r.data : {};
};

/** Company defaults first, then the user's own row (which wins wherever it exists). */
export function mergePrefs(company: PrefsRow | null, user: PrefsRow | null): NewsPrefs {
  const defined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const c = defined(clean(company)), u = defined(clean(user));
  const out: NewsPrefs = { ...DEFAULT_PREFS, ...c, ...(user ? u : {}), saved: Boolean(user), fromCompany: Boolean(company) && !user };
  return out;
}

export function prefsToRow(p: PrefsInput): PrefsRow {
  const row: PrefsRow = {};
  if (p.followedTrades) row.followed_trades = p.followedTrades;
  if (p.radiusMiles) row.radius_miles = p.radiusMiles;
  if (p.geoEmphasis) row.geo_emphasis = p.geoEmphasis;
  if (p.topics) row.topics = p.topics;
  if (p.mutedTopics) row.muted_topics = p.mutedTopics.filter((m) => !(p.topics ?? []).includes(m));
  if (p.sourceTypes) row.source_types = p.sourceTypes;
  if (p.hiddenPublishers) row.hidden_publishers = p.hiddenPublishers;
  if (p.serviceCounties) row.service_counties = p.serviceCounties;
  if (p.notifyOfficialRules !== undefined) row.notify_official_rules = p.notifyOfficialRules;
  if (p.notifyLocalDisasters !== undefined) row.notify_local_disasters = p.notifyLocalDisasters;
  if (p.notifyMaterialPrices !== undefined) row.notify_material_prices = p.notifyMaterialPrices;
  if (p.emailDigest !== undefined) row.email_digest = p.emailDigest;
  return row;
}

/** Free-text company trade ("Roofing", "roofing", "Decks & Porches") → catalog slug. */
export function tradeSlugFrom(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  const t = ALL_TRADES.find((x) => x.slug === s || x.name.toLowerCase() === s);
  return t?.slug ?? null;
}
