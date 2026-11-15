/**
 * First-touch campaign attribution captured from landing URLs into a first-party cookie.
 * Pure functions (no Next.js imports) so the proxy and tests can share them.
 *
 * Outreach links should carry UTM tags, e.g.
 *   https://built2bid.org/bids/roofing?utm_source=instantly&utm_medium=email&utm_campaign=<campaign-id>
 * Instantly campaign ids can also be passed as ?ic=<campaign-id>.
 * No email address or personal data is ever put in a URL or this cookie.
 */
export const ATTRIBUTION_COOKIE = "b2b_attr";
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  campaignId?: string;
  ref?: string;
  path?: string;
  at?: string;
  /** Host name of an outside referring site (never the full URL). */
  referrer?: string;
  /** Which ad click id was on the landing URL (never its value). */
  clickId?: ClickIdType;
  device?: DeviceType;
}

export const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "li_fat_id"] as const;
export type ClickIdType = (typeof CLICK_IDS)[number];
export type DeviceType = "mobile" | "tablet" | "desktop";

/** Our own hosts and sign-in/payment hops: never an acquisition source. */
const INTERNAL_REFERRERS = /(^|\.)(built2bid\.org|built2bid\.netlify\.app|netlify\.app|localhost|supabase\.co|stripe\.com|accounts\.google\.com)$/;
/** Landing paths that are never a first visit from marketing (sign-in links, customer signing links, the /r/<code> referral hop, which redirects to a tagged URL). */
const SKIP_PATHS = /^\/(auth|api|sign|complimentary|company\/join|r)(\/|$)/;

export function referrerHost(referer: string | null | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    const h = new URL(referer).hostname.toLowerCase().replace(/^www\./, "");
    if (!h || h.length > 253 || INTERNAL_REFERRERS.test(h)) return undefined;
    return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
  } catch {
    return undefined;
  }
}

export function deviceType(ua: string | null | undefined): DeviceType | undefined {
  if (!ua) return undefined;
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * First-touch attribution for a landing request: campaign parameters, an ad click id type, or an
 * outside referrer host. Returns null for a plain direct visit (that is recorded as "direct" at signup).
 */
export function captureAttribution(url: URL, referer: string | null, userAgent: string | null, now = new Date()): Attribution | null {
  if (SKIP_PATHS.test(url.pathname)) return null;
  const a = parseAttribution(url, now) ?? {};
  const clickId = CLICK_IDS.find((k) => url.searchParams.has(k));
  if (clickId) a.clickId = clickId;
  const ref = referrerHost(referer);
  if (ref) a.referrer = ref;
  if (!Object.values(a).some(Boolean)) return null;
  a.path ??= url.pathname.slice(0, 500);
  a.at ??= now.toISOString();
  const d = deviceType(userAgent);
  if (d) a.device = d;
  return a;
}

const clean = (v: string | null, max = 200) => {
  if (!v) return undefined;
  const s = v.trim().slice(0, max);
  return /^[\w .:@+\-/|]+$/.test(s) ? s : undefined;
};

/** Returns attribution if the URL carries any campaign parameter, else null. */
export function parseAttribution(url: URL, now = new Date()): Attribution | null {
  const q = url.searchParams;
  const a: Attribution = {
    source: clean(q.get("utm_source")),
    medium: clean(q.get("utm_medium")),
    campaign: clean(q.get("utm_campaign")),
    content: clean(q.get("utm_content")),
    term: clean(q.get("utm_term")),
    campaignId: clean(q.get("ic"), 128),
    ref: clean(q.get("ref"), 64),
  };
  if (!Object.values(a).some(Boolean)) return null;
  a.path = url.pathname.slice(0, 500);
  a.at = now.toISOString();
  return a;
}

export function encodeAttribution(a: Attribution): string {
  return encodeURIComponent(JSON.stringify(a));
}

export function decodeAttribution(raw: string | undefined | null): Attribution | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    if (!v || typeof v !== "object") return null;
    const out: Attribution = {};
    for (const k of ["source", "medium", "campaign", "content", "term", "campaignId", "ref", "path", "at"] as const) {
      const x = v[k];
      if (typeof x === "string") out[k] = x.slice(0, k === "path" ? 500 : 200);
    }
    if (typeof v.referrer === "string" && /^[a-z0-9.-]{1,253}$/.test(v.referrer)) out.referrer = v.referrer;
    if (typeof v.clickId === "string" && (CLICK_IDS as readonly string[]).includes(v.clickId)) out.clickId = v.clickId as ClickIdType;
    if (v.device === "mobile" || v.device === "tablet" || v.device === "desktop") out.device = v.device;
    return out;
  } catch {
    return null;
  }
}

/** Normalize an email for identity matching. Returns null if it does not look like an email. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if (e.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}
