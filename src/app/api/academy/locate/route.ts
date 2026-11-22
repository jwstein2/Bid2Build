import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { FIPS, idFromCensus } from "@/lib/academy/kb/geo";

export const runtime = "nodejs";

/**
 * Project address -> permitting area, through the free U.S. Census Bureau geocoder (public, no key, no account).
 * The address is sent only to the Census Bureau, never stored or logged here. Rate limited per visitor.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "forbidden", "Not allowed.");
  if (!(await rateLimit("academy.locate", 20, 60 * 60 * 1000))) return fail(429, "rate_limited", "Too many lookups. Try again later or pick from the ZIP list.");
  const body = (await req.json().catch(() => null)) as { address?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim().slice(0, 200) : "";
  if (address.length < 8) return fail(400, "invalid", "Enter the street address, city and state, or a ZIP code.");
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", vintage: "Current_Current", layers: "Incorporated Places,County Subdivisions,Counties", format: "json" }).toString();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!r.ok) return json({ found: false });
    type G = { NAME: string; STATE: string; FUNCSTAT?: string; LSADC?: string };
    const d = (await r.json()) as { result?: { addressMatches?: { matchedAddress: string; addressComponents?: { zip?: string }; geographies: Record<string, G[]> }[] } };
    const m = d.result?.addressMatches?.[0];
    const county = m?.geographies?.Counties?.[0];
    if (!m || !county || !FIPS[county.STATE]) return json({ found: false });
    const option = idFromCensus({ state: county.STATE, county, place: m.geographies["Incorporated Places"]?.[0] ?? null, cousub: m.geographies["County Subdivisions"]?.[0] ?? null });
    return json({ found: true, state: FIPS[county.STATE], zip: m.addressComponents?.zip ?? null, option, matched: m.matchedAddress });
  } catch (e) {
    logError("academy.locate", e);
    return json({ found: false });
  }
}
