/**
 * Affiliate links. Pure helpers shared by the /a/<code> route, the signed-in layout and tests. Separate from
 * sales rep links (/s/<code>, cookie b2b_rep) and the customer referral program (?ref=, cookie b2b_ref): its own
 * path, cookie and code space, so the programs never mix.
 */
import { site } from "../site";

export const AFFILIATE_COOKIE = "b2b_aff";
/** How long a click through an affiliate link is remembered before the visitor signs up (matches the 90-day window). */
export const AFFILIATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

export function normalizeAffiliateCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z2-9]{6,12}$/.test(c) ? c : null;
}

/** Campaign / source tags an affiliate may add to a link (lowercase, short). */
export function cleanTag(raw: string | null | undefined, max = 40): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
  return t && /^[a-z0-9_.-]+$/.test(t) ? t : null;
}

/** The permanent link an affiliate shares: https://built2bid.org/a/AB3DE7GH[?c=campaign&s=source] */
export function affiliateLink(code: string, opts: { campaign?: string | null; source?: string | null; to?: string | null } = {}, origin = site.url): string {
  const u = new URL(`/a/${encodeURIComponent(code)}`, origin);
  const c = cleanTag(opts.campaign), s = cleanTag(opts.source);
  if (c) u.searchParams.set("c", c);
  if (s) u.searchParams.set("s", s);
  if (opts.to && safeLandingPath(opts.to) !== "/") u.searchParams.set("to", opts.to);
  return u.toString();
}

export function safeLandingPath(to: string | null | undefined): string {
  return to && /^\/(?!\/)[a-z0-9/_-]{0,80}$/i.test(to) && !to.startsWith("/sales") && !to.startsWith("/admin") ? to : "/";
}

/** Where /a/<code> sends the visitor: the home page (or a safe public page) with affiliate UTM tags. */
export function affiliateLandingPath(code: string, to?: string | null, campaign?: string | null): string {
  const q = new URLSearchParams({ utm_source: "affiliate", utm_medium: "referral", utm_campaign: cleanTag(campaign) ?? "affiliate", utm_content: code });
  return `${safeLandingPath(to)}?${q.toString()}`;
}

/** Cookie value: "<CODE>.<click epoch seconds>.<click id>" so the account can be checked against the click. */
export function encodeAffiliateCookie(code: string, clickId: string | null, at = new Date()): string {
  return `${code}.${Math.floor(at.getTime() / 1000)}.${clickId ?? ""}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function decodeAffiliateCookie(raw: string | null | undefined): { code: string; visitAt: Date | null; clickId: string | null } | null {
  if (!raw || raw.length > 80) return null;
  const [c, t, id] = raw.split(".");
  const code = normalizeAffiliateCode(c);
  if (!code) return null;
  const sec = Number(t);
  return { code, visitAt: Number.isFinite(sec) && sec > 1_600_000_000 ? new Date(sec * 1000) : null, clickId: id && UUID.test(id) ? id : null };
}

/**
 * Which program records first when a browser carries both a sales rep and an affiliate cookie: the earlier visit.
 * The database lock still guarantees one owner if both run at once. Returns the order to try.
 */
export function attributionOrder(rep: { visitAt: Date | null } | null, aff: { visitAt: Date | null } | null): ("sales" | "affiliate")[] {
  if (rep && !aff) return ["sales"];
  if (aff && !rep) return ["affiliate"];
  if (!rep || !aff) return [];
  const r = rep.visitAt?.getTime() ?? Number.MAX_SAFE_INTEGER, a = aff.visitAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return a < r ? ["affiliate", "sales"] : ["sales", "affiliate"];
}
