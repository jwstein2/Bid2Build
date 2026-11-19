/**
 * Sales rep links. Pure helpers shared by the proxy, the /s/<code> route, the signed-in layout and
 * tests. Separate from the customer referral program (src/lib/growth/referral.ts): its own path,
 * cookie and code space, so a contractor's "refer a friend" link never counts as a sales rep sale.
 */
import { site } from "../site";

export const SALES_COOKIE = "b2b_rep";
/** How long a visit through a rep's link is remembered in the browser before the visitor signs up. */
export const SALES_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export const SALES_UTM = { utm_source: "sales_rep", utm_medium: "referral", utm_campaign: "sales_team" } as const;

export function normalizeRepCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z2-9]{6,12}$/.test(c) ? c : null;
}

/** The link a rep shares: https://built2bid.org/s/AB3DE7GH */
export function repLink(code: string, origin = site.url): string {
  return new URL(`/s/${encodeURIComponent(code)}`, origin).toString();
}

/** Where /s/<code> sends the visitor: the home page (or a safe page on this site) carrying UTM tags. */
export function repLandingPath(code: string, to?: string | null): string {
  const path = to && /^\/(?!\/)[a-z0-9/_-]{0,80}$/i.test(to) ? to : "/";
  const q = new URLSearchParams({ ...SALES_UTM, utm_content: code });
  return `${path}?${q.toString()}`;
}

/** Cookie value: "<CODE>.<visit time in epoch seconds>" so the account can be checked against the visit. */
export function encodeRepCookie(code: string, at = new Date()): string {
  return `${code}.${Math.floor(at.getTime() / 1000)}`;
}

export function decodeRepCookie(raw: string | null | undefined): { code: string; visitAt: Date | null } | null {
  if (!raw || raw.length > 40) return null;
  const [c, t] = raw.split(".");
  const code = normalizeRepCode(c);
  if (!code) return null;
  const sec = Number(t);
  return { code, visitAt: Number.isFinite(sec) && sec > 1_600_000_000 ? new Date(sec * 1000) : null };
}
