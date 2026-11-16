/**
 * Ad-measurement consent (Meta Pixel / Conversions API). Pure helpers shared by the browser banner,
 * the API route and the server queue. GA4 site analytics is unchanged and not governed by this.
 *
 * - Browser: first-party cookie `b2b_ad_consent` = "granted" | "denied" (1 year). No cookie = not asked
 *   yet = nothing ad-related loads.
 * - Account: Auth user_metadata.b2b_ad_consent = { granted, at, fbp?, fbc? }, written when a signed-in
 *   visitor answers (or signs in with an answer already in the browser). The server only queues a
 *   conversion when this says granted.
 */
export const AD_CONSENT_COOKIE = "b2b_ad_consent";
export const AD_CONSENT_KEY = "b2b_ad_consent";

export interface AdConsent { granted: boolean; at: string; fbp?: string | null; fbc?: string | null }

export function parseAdConsent(v: unknown): AdConsent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.granted !== "boolean" || typeof o.at !== "string") return null;
  const s = (x: unknown) => (typeof x === "string" && x.length <= 600 ? x : null);
  return { granted: o.granted, at: o.at, fbp: s(o.fbp), fbc: s(o.fbc) };
}

export function readConsentCookie(cookie: string): "granted" | "denied" | null {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${AD_CONSENT_COOKIE}=(granted|denied)`));
  return (m?.[1] as "granted" | "denied" | undefined) ?? null;
}

/** Meta Pixel id (public). Ads code is only ever rendered when this is a valid numeric id. */
export function pixelId(raw: string | undefined | null): string | null {
  const id = (raw ?? "").trim();
  return /^\d{5,20}$/.test(id) ? id : null;
}
