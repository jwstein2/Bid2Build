/**
 * Academy location handling (pure, client-safe). A ZIP code suggests a state; it never decides the permitting
 * authority. The local jurisdiction is only ever set by the user picking a verified one.
 */
import { cleanZip, normalizeState, resolveGeo, US_STATES } from "@/lib/market/geo";
import type { KbLocation } from "./types";

export const LOCATION_COOKIE = "b2b_kb_loc";
export const KB_STATES: { code: string; name: string }[] = Object.entries(US_STATES)
  .filter(([c]) => !["PR", "VI", "GU"].includes(c))
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const TRADE_RE = /^[a-z][a-z-]{1,40}$/;
const LOCAL_RE = /^[A-Z]{2}(:[a-z0-9-]{2,60})+$/;

/** Builds a location from explicit inputs. An explicit state wins over the ZIP's state (researching another state). */
export function locationFrom(input: { zip?: unknown; state?: unknown; local?: unknown; trade?: unknown }, from: KbLocation["from"]): KbLocation {
  const zip = cleanZip(typeof input.zip === "string" ? input.zip : null);
  const explicit = normalizeState(typeof input.state === "string" ? input.state : null);
  const state = explicit && explicit in US_STATES && !["PR", "VI", "GU"].includes(explicit) ? explicit : zip ? resolveGeo({ zip }).state : null;
  const localRaw = typeof input.local === "string" ? input.local : null;
  const local = localRaw && LOCAL_RE.test(localRaw) && state && localRaw.startsWith(`${state}:`) ? localRaw : null;
  const trade = typeof input.trade === "string" && TRADE_RE.test(input.trade) ? input.trade : null;
  return { zip, state, local, trade, from: state || zip || trade ? from : "none" };
}

/** The state a ZIP suggests (for showing "ZIP 55901 suggests Minnesota"). */
export const stateForZip = (zip: string | null | undefined): string | null => (cleanZip(zip) ? resolveGeo({ zip: zip! }).state : null);

export function parseLocationCookie(raw: string | undefined | null): KbLocation | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const loc = locationFrom(v, "saved");
    return loc.from === "none" ? null : loc;
  } catch { return null; }
}

export const serializeLocation = (l: KbLocation) => JSON.stringify({ zip: l.zip, state: l.state, local: l.local, trade: l.trade });

/** Query string that carries the location between Academy modes. */
export function locationQuery(l: Pick<KbLocation, "zip" | "state" | "local" | "trade">, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  if (l.zip) p.set("zip", l.zip);
  if (l.state) p.set("state", l.state);
  if (l.local) p.set("local", l.local);
  if (l.trade) p.set("trade", l.trade);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const stateName = (code: string | null | undefined) => (code ? (US_STATES[code] ?? code) : null);
