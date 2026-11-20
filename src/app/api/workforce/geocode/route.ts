import { fail, json, rateLimit } from "@/lib/http/api";
import { guardRead } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

/**
 * Address → pin for a work location, using the free U.S. Census Bureau geocoder (no key, no charge). Time admins
 * only. Census matches are interpolated along the street and can be 50-200 m off, so the admin always confirms the
 * pin (or stands on site and uses "Use my current location"). Google geocoding is deliberately not used: it is a
 * paid service and needs approval first.
 */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  if (!(await rateLimit("gps-geocode", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 300);
  if (q.length < 5) return fail(400, "invalid", "Type the full street address.");
  const { data: admin, error } = await g.supabase.rpc("pm_gps_admin_overview");
  if (error || !(admin as { canAdmin?: boolean } | null)?.canAdmin) return fail(403, "forbidden", "Only time admins can look up work locations.");
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!res.ok) return fail(502, "geocode_failed", "Address lookup isn't available right now. Use your current location or enter the pin by hand.");
    const body = (await res.json()) as { result?: { addressMatches?: { matchedAddress?: string; coordinates?: { x?: number; y?: number } }[] } };
    const matches = (body.result?.addressMatches ?? []).slice(0, 5).flatMap((m) =>
      typeof m.coordinates?.x === "number" && typeof m.coordinates?.y === "number" ? [{ address: m.matchedAddress ?? q, lat: Math.round(m.coordinates.y * 1e6) / 1e6, lng: Math.round(m.coordinates.x * 1e6) / 1e6 }] : []);
    return json({ matches, source: "census" });
  } catch {
    return fail(502, "geocode_failed", "Address lookup isn't available right now. Use your current location or enter the pin by hand.");
  }
}
