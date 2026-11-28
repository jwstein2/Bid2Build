/**
 * Marketing touch history (Growth OS Phase 3). Pure helpers shared by the proxy, the signed-in layout,
 * the report and tests. No Next.js imports.
 *
 * - `b2b_vid`: anonymous first-party visitor id (random UUID), so visits before sign-up can be joined to
 *   the account at sign-in. Never sent to a third party.
 * - `b2b_touch`: the browser's tagged visits (campaign tags, ad click id type or outside referrer host; the
 *   same facts as the first-touch cookie). Keeps the first touch and the most recent ones, capped in size.
 *   The first-touch cookie (`b2b_attr`) is unchanged; this adds last touch and the path between.
 *
 * "Where permitted": nothing here is set when the browser sends Global Privacy Control, or after the
 * visitor turned analytics off (`b2b_ga_optout`), or when MARKETING_TOUCHES is not "on".
 */
import type { Attribution } from "./attribution";
import { GA_OPTOUT_COOKIE } from "../seo/ga-optout";

export const VISITOR_COOKIE = "b2b_vid";
export const TOUCHES_COOKIE = "b2b_touch";
export const TOUCHES_MAX_AGE = 60 * 60 * 24 * 90; // 90 days, same window as first touch and partner links
export const VISITOR_MAX_AGE = 60 * 60 * 24 * 395; // ~13 months
/** Most touches kept in the cookie: the first one plus the latest MAX_TOUCHES - 1. */
export const MAX_TOUCHES = 6;
/** The same tags again within this window are one visit (a refresh, a back button, a second tab). */
export const SAME_VISIT_MS = 30 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function touchesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MARKETING_TOUCHES ?? "").trim().toLowerCase() === "on";
}

/** Whether this request may carry touch tracking: GPC and the analytics opt-out both mean no. */
export function trackingPermitted(headers: { get(name: string): string | null }, cookie: (name: string) => string | undefined): boolean {
  if (headers.get("sec-gpc") === "1") return false;
  if (cookie(GA_OPTOUT_COOKIE) === "1") return false;
  return true;
}

export function validVisitorId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return UUID.test(v) ? v : null;
}

/** Compact cookie form of one touch. Only the fields the report needs. */
export interface Touch {
  at: string;
  s?: string; m?: string; c?: string; ct?: string; t?: string; ic?: string; ref?: string;
  p?: string; rh?: string; ck?: string; d?: string;
}

export function touchFromAttribution(a: Attribution): Touch {
  const t: Touch = { at: a.at ?? new Date().toISOString() };
  if (a.source) t.s = a.source;
  if (a.medium) t.m = a.medium;
  if (a.campaign) t.c = a.campaign;
  if (a.content) t.ct = a.content;
  if (a.term) t.t = a.term;
  if (a.campaignId) t.ic = a.campaignId;
  if (a.ref) t.ref = a.ref;
  if (a.path) t.p = a.path.slice(0, 120);
  if (a.referrer) t.rh = a.referrer;
  if (a.clickId) t.ck = a.clickId;
  if (a.device) t.d = a.device;
  return t;
}

/** Back to the Attribution shape the rest of the app uses. */
export function attributionFromTouch(t: Touch): Attribution {
  return {
    at: t.at, source: t.s, medium: t.m, campaign: t.c, content: t.ct, term: t.t, campaignId: t.ic, ref: t.ref,
    path: t.p, referrer: t.rh, clickId: t.ck as Attribution["clickId"], device: t.d as Attribution["device"],
  };
}

const tagKey = (t: Touch) => [t.s, t.m, t.c, t.ct, t.t, t.ic, t.ref, t.rh, t.ck].map((x) => x ?? "").join("|");

/** Add a touch: same tags inside SAME_VISIT_MS is the same visit; keep the first and the latest touches. */
export function appendTouch(list: Touch[], next: Touch): Touch[] {
  const last = list[list.length - 1];
  if (last && tagKey(last) === tagKey(next) && Math.abs(Date.parse(next.at) - Date.parse(last.at)) < SAME_VISIT_MS) return list;
  const out = [...list, next];
  if (out.length <= MAX_TOUCHES) return out;
  return [out[0], ...out.slice(out.length - (MAX_TOUCHES - 1))];
}

const FIELD = /^[\w .:@+\-/|]{0,200}$/;

export function encodeTouches(list: Touch[]): string {
  return encodeURIComponent(JSON.stringify(list));
}

export function decodeTouches(raw: string | null | undefined): Touch[] {
  if (!raw || raw.length > 3800) return [];
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(v)) return [];
    const out: Touch[] = [];
    for (const x of v.slice(0, MAX_TOUCHES)) {
      if (!x || typeof x !== "object" || typeof x.at !== "string" || Number.isNaN(Date.parse(x.at))) continue;
      const t: Touch = { at: new Date(x.at).toISOString() };
      for (const k of ["s", "m", "c", "ct", "t", "ic", "ref", "p", "rh", "ck", "d"] as const) {
        const val = x[k];
        if (typeof val === "string" && val && FIELD.test(val)) t[k] = val;
      }
      out.push(t);
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  } catch {
    return [];
  }
}

/** First-touch / last-touch pick for a conversion time (touches strictly after it don't count). */
export function firstLast<T extends { at: string }>(touches: T[], before?: string | null): { first: T | null; last: T | null } {
  const cut = before ? Date.parse(before) : Infinity;
  const eligible = touches.filter((t) => Date.parse(t.at) <= cut).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { first: eligible[0] ?? null, last: eligible[eligible.length - 1] ?? null };
}
