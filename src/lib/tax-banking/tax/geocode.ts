/**
 * Address → county and city (place) codes, using the free U.S. Census Bureau geocoder (V6.9 built-in tax engine).
 * https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html  (no key, no cost)
 *
 * Privacy: the cache key is a SHA-256 of the normalized address and the cache stores only codes and public place
 * names, never the address itself. The cache table is readable by the service role only.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxAddress } from "./types";

type Fetch = typeof fetch;

export interface GeoResult { matched: boolean; state: string | null; zip5: string | null; countyFips: string | null; countyName: string | null; placeFips: string | null; placeName: string | null }

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export const geocodeKey = (a: TaxAddress) => createHash("sha256").update([norm(a.line1), norm(a.city), norm(a.state), (a.zip ?? "").slice(0, 5)].join("|")).digest("hex");

export const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/address";

type CensusGeo = { STATE?: string; COUNTY?: string; PLACE?: string; NAME?: string; BASENAME?: string };
type CensusResponse = { result?: { addressMatches?: { matchedAddress?: string; addressComponents?: { zip?: string; state?: string }; geographies?: Record<string, CensusGeo[]> }[] } };

/** Ask the Census geocoder. Throws on a network/server failure (the caller falls back to the ZIP code). */
export async function censusGeocode(a: TaxAddress, f: Fetch = fetch): Promise<GeoResult> {
  const q = new URLSearchParams({ street: a.line1 ?? "", city: a.city ?? "", state: a.state ?? "", zip: (a.zip ?? "").slice(0, 5), benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" });
  const r = await f(`${CENSUS_URL}?${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`census_${r.status}`);
  const body = await r.json() as CensusResponse;
  const m = body.result?.addressMatches?.[0];
  if (!m) return { matched: false, state: null, zip5: null, countyFips: null, countyName: null, placeFips: null, placeName: null };
  const g = m.geographies ?? {};
  const county = (g["Counties"] ?? [])[0];
  const place = (g["Incorporated Places"] ?? [])[0];
  const stateGeo = (g["States"] ?? [])[0] as (CensusGeo & { STUSAB?: string }) | undefined;
  return {
    matched: true, state: (m.addressComponents?.state ?? stateGeo?.STUSAB ?? "").toUpperCase() || null, zip5: m.addressComponents?.zip?.slice(0, 5) ?? null,
    countyFips: county?.COUNTY ?? null, countyName: county?.NAME ?? null, placeFips: place?.PLACE ?? null, placeName: place?.NAME ?? null,
  };
}

const DAY = 864e5;

/** Geocode with the cache (180 days for a match, 7 days for no match). `cache` must be a service-role client. */
export async function geocodeCached(a: TaxAddress, deps: { cache?: SupabaseClient | null; fetchImpl?: Fetch; now?: Date }): Promise<GeoResult | null> {
  if (!a.line1?.trim() || !a.state || !a.zip) return null;
  const key = geocodeKey(a);
  const now = deps.now ?? new Date();
  if (deps.cache) {
    const { data } = await deps.cache.from("tax_geocode_cache").select("matched, state, zip5, county_fips, county_name, place_fips, place_name, fetched_at").eq("key", key).maybeSingle();
    const c = data as Record<string, unknown> | null;
    if (c && now.getTime() - new Date(String(c.fetched_at)).getTime() < (c.matched ? 180 : 7) * DAY) {
      return { matched: Boolean(c.matched), state: (c.state as string) ?? null, zip5: (c.zip5 as string) ?? null, countyFips: (c.county_fips as string) ?? null,
        countyName: (c.county_name as string) ?? null, placeFips: (c.place_fips as string) ?? null, placeName: (c.place_name as string) ?? null };
    }
  }
  let g: GeoResult;
  try { g = await censusGeocode(a, deps.fetchImpl ?? fetch); } catch { return null; }
  if (deps.cache) {
    await deps.cache.from("tax_geocode_cache").upsert({ key, matched: g.matched, state: g.state, zip5: g.zip5, county_fips: g.countyFips, county_name: g.countyName,
      place_fips: g.placeFips, place_name: g.placeName, fetched_at: now.toISOString() }).then(() => undefined, () => undefined);
  }
  return g;
}
