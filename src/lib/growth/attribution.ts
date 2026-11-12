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
