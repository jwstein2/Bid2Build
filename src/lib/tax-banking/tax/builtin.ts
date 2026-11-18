/**
 * Built2Bid's own tax provider (V6.9 built-in tax engine; replaces a paid service such as TaxJar). $0 per call.
 *
 *   1. Where is the job?  Census geocoder → county + city codes (cached), then the state's official ZIP boundary data
 *      for special districts. If the street can't be matched, the ZIP code is used and the result is flagged.
 *   2. What are the rates on that date?  public.tax_jurisdiction_rates: official rates imported from each state's
 *      own files (effective-dated, versioned). Official rates always win over the statewide seed rates bundled with
 *      the app. No rate on file = no rate: the engine then falls back to the contractor's own rate and says so.
 *   3. What is taxable?  The construction rules (construction-rules.ts) per line, with anything uncertain flagged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorityFor } from "../authorities";
import { constructionTreatment, ruleNote, RULES_VERSION } from "./construction-rules";
import { geocodeCached, type GeoResult } from "./geocode";
import { SEED_CHECKED_ON, STATE_ONLY } from "./seed-rates";
import { ProviderUnavailable } from "./errors";
import type { ProviderJurisdiction, ProviderResult, ReviewReason, TaxAddress, TaxProvider, TaxRequest } from "./types";

type Db = SupabaseClient;
type Row = Record<string, unknown>;

const LEVEL_ORDER: ProviderJurisdiction["level"][] = ["state", "county", "city", "special", "other"];

export class NoRateData extends ProviderUnavailable { constructor(state: string) { super("builtin"); this.message = `no_rate_data_${state}`; } }

export interface BuiltinDeps {
  /** Reads public rate and boundary tables (any signed-in or service client). */
  db: Db;
  /** Service-role client for the geocode cache (optional; without it every lookup asks the Census geocoder). */
  cache?: Db | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface Location { county: { fips: string; name: string | null } | null; place: { fips: string; name: string | null } | null; specials: string[]; approximate: boolean; ambiguous: boolean; stateMismatch: boolean }

interface ZipRow { county_fips: string; place_fips: string | null; specials: string[] | null; weight: number }

/** Pure: choose the jurisdiction combination for an address from the geocode and the ZIP's boundary rows. */
export function pickLocation(geo: GeoResult | null, rows: ZipRow[], state: string): Location {
  const stateMismatch = Boolean(geo?.matched && geo.state && geo.state !== state);
  const byWeight = (a: ZipRow, b: ZipRow) => b.weight - a.weight;
  const specialsKey = (r: ZipRow) => (r.specials ?? []).slice().sort().join(",");
  if (geo?.matched && geo.countyFips) {
    const same = rows.filter((r) => r.county_fips === geo.countyFips && (r.place_fips ?? null) === (geo.placeFips ?? null)).sort(byWeight);
    const ambiguous = new Set(same.map(specialsKey)).size > 1;
    return { county: { fips: geo.countyFips, name: geo.countyName }, place: geo.placeFips ? { fips: geo.placeFips, name: geo.placeName } : null,
      specials: same[0]?.specials ?? [], approximate: false, ambiguous, stateMismatch };
  }
  const sorted = rows.slice().sort(byWeight);
  const top = sorted[0];
  if (!top) return { county: null, place: null, specials: [], approximate: true, ambiguous: false, stateMismatch };
  const ambiguous = new Set(sorted.map((r) => `${r.county_fips}|${r.place_fips ?? ""}|${specialsKey(r)}`)).size > 1;
  return { county: { fips: top.county_fips, name: null }, place: top.place_fips ? { fips: top.place_fips, name: null } : null, specials: top.specials ?? [], approximate: true, ambiguous, stateMismatch };
}

interface RateRow { jurisdiction_code: string; jurisdiction_name: string; level: ProviderJurisdiction["level"]; rate: string | number; effective_from: string; source: string; recorded_at: string }

/** Pure: per code, the rate in force on `date`, official over seed. */
export function pickRates(rows: RateRow[], date: string): Map<string, RateRow> {
  const out = new Map<string, RateRow>();
  const rank = (r: RateRow) => (r.source === "seed" ? 0 : 1);
  for (const r of rows) {
    if (String(r.effective_from).slice(0, 10) > date) continue;
    const cur = out.get(r.jurisdiction_code);
    if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && (String(r.effective_from) > String(cur.effective_from) || (r.effective_from === cur.effective_from && r.recorded_at > cur.recorded_at)))) out.set(r.jurisdiction_code, r);
  }
  return out;
}

export function builtinProvider(deps: BuiltinDeps): TaxProvider {
  const now = () => (deps.now ? deps.now() : new Date());

  async function lookup(address: TaxAddress, date: string) {
    const state = (address.state ?? "").toUpperCase();
    const auth = authorityFor(state);
    const zip5 = (address.zip ?? "").trim().slice(0, 5);
    if (!auth || !/^\d{5}$/.test(zip5)) return { valid: false as const };
    const reasons = new Set<ReviewReason>();
    const noTax = auth.system === "none";
    const stateOnly = STATE_ONLY.has(state) || noTax;

    const [{ data: src }, loc] = await Promise.all([
      deps.db.from("tax_rate_sources").select("status, last_success_at, rates_loaded, zips_loaded").eq("state", state).maybeSingle(),
      stateOnly ? Promise.resolve<Location>({ county: null, place: null, specials: [], approximate: false, ambiguous: false, stateMismatch: false }) : (async () => {
        const [geo, zr] = await Promise.all([
          geocodeCached(address, { cache: deps.cache, fetchImpl: deps.fetchImpl, now: now() }),
          deps.db.from("tax_zip_areas").select("county_fips, place_fips, specials, weight").eq("state", state).eq("zip5", zip5).eq("live", true).limit(200),
        ]);
        return pickLocation(geo, ((zr.data ?? []) as ZipRow[]), state);
      })(),
    ]);
    if (loc.stateMismatch) return { valid: false as const };
    const source = (src ?? null) as Row | null;
    const officialLoaded = Number(source?.rates_loaded ?? 0) > 0;
    const zipsLoaded = Number(source?.zips_loaded ?? 0) > 0;

    const codes = [state, `${state}-LO`];
    if (loc.county) codes.push(`${state}-CO-${loc.county.fips}`);
    if (loc.place) codes.push(`${state}-CI-${loc.place.fips}`);
    for (const s of loc.specials) codes.push(`${state}-SP-${s}`);
    const { data: rateRows, error } = await deps.db.from("tax_jurisdiction_rates").select("jurisdiction_code, jurisdiction_name, level, rate, effective_from, source, recorded_at")
      .eq("state", state).in("jurisdiction_code", codes).lte("effective_from", date).limit(500);
    if (error) throw new ProviderUnavailable("builtin");
    const picked = pickRates((rateRows ?? []) as RateRow[], date);

    if (noTax) return { valid: true as const, jurisdictions: [], reasons, dataAsOf: now().toISOString(), staleAfterDays: 3650 };
    const stateRate = picked.get(state);
    if (!stateRate && auth.system !== "local_only") throw new NoRateData(state);

    const names: Record<string, string | null> = {};
    if (loc.county) names[`${state}-CO-${loc.county.fips}`] = loc.county.name;
    if (loc.place) names[`${state}-CI-${loc.place.fips}`] = loc.place.name;
    const jurisdictions: ProviderJurisdiction[] = [...picked.values()].map((r) => ({
      code: r.jurisdiction_code, name: names[r.jurisdiction_code] ?? (r.level === "state" ? auth.stateName : r.jurisdiction_name), level: r.level,
      rate: String(r.rate), taxType: (auth.system === "gross_receipts" ? "gross_receipts" : auth.system === "transaction_privilege" ? "transaction_privilege" : "sales") as ProviderJurisdiction["taxType"],
    })).filter((j) => Number(j.rate) > 0 || j.level === "state")
      .sort((x, y) => LEVEL_ORDER.indexOf(x.level) - LEVEL_ORDER.indexOf(y.level));

    if (!stateOnly) {
      if (!officialLoaded) reasons.add("local_rate_unverified");
      else {
        if (loc.approximate) reasons.add("address_approximate");
        if (loc.ambiguous) reasons.add("zip_spans_jurisdictions");
        // Special districts come from the boundary file; without it they can't be placed.
        const hasSpecials = await deps.db.from("tax_jurisdiction_rates").select("id", { count: "exact", head: true }).eq("state", state).like("jurisdiction_code", `${state}-SP-%`).then((r) => (r.count ?? 0) > 0, () => false);
        if (hasSpecials && !zipsLoaded) reasons.add("local_rate_unverified");
        if (!loc.county && !loc.place) reasons.add("address_approximate");
      }
    }
    const fromSeed = [...picked.values()].some((r) => r.source === "seed");
    const dataAsOf = fromSeed || !source?.last_success_at ? `${SEED_CHECKED_ON}T00:00:00.000Z` : String(source.last_success_at);
    return { valid: true as const, jurisdictions, reasons, dataAsOf, staleAfterDays: fromSeed ? 365 : undefined };
  }

  return {
    name: "builtin",
    async calculate(req: TaxRequest): Promise<ProviderResult> {
      const r = await lookup(req.address, req.transactionDate);
      const state = (req.address.state ?? "").toUpperCase();
      if (!r.valid) return { provider: "builtin", providerRef: null, addressValid: false, jurisdictions: [], lines: req.lines.map((l) => ({ ref: l.ref, taxable: false })), dataAsOf: now().toISOString() };
      const lines = req.lines.map((l) => ({ ref: l.ref, ...constructionTreatment(state, l.classification, { work: req.work, contract: req.contract, workMix: req.workMix }) }));
      const note = ruleNote(state);
      return {
        provider: "builtin", providerRef: `builtin:${RULES_VERSION}`, addressValid: true, jurisdictions: r.jurisdictions, lines, dataAsOf: r.dataAsOf,
        reviewReasons: [...r.reasons], notes: note ? [note] : [], staleAfterDays: r.staleAfterDays,
      };
    },
    async ratesFor(address, date) {
      const r = await lookup(address, date);
      return r.valid ? r.jurisdictions : [];
    },
  };
}
