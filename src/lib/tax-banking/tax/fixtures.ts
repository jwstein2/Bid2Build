/**
 * TEST FIXTURES ONLY. Versioned, made-up jurisdiction data for the mock tax provider, tests and the sandbox.
 * These numbers are NOT current tax rates and must never be shown as real rates in production: the mock provider
 * refuses to run in a production deploy outside a practice (sandbox) book (see isolation.ts).
 *
 * Version history lets tests simulate a rate update without code changes elsewhere: a fixture version with a later
 * `effectiveFrom` behaves exactly like a provider reporting a new rate.
 */
import type { LineClass, ProviderJurisdiction } from "./types";

export const FIXTURE_VERSION = "2026-11-fixture-1";

export interface FixtureArea { zipPrefix: string; state: string; label: string; jurisdictions: { j: ProviderJurisdiction; from: string }[] }

const j = (code: string, name: string, level: ProviderJurisdiction["level"], rate: string, taxType: ProviderJurisdiction["taxType"] = "sales"): ProviderJurisdiction => ({ code, name, level, rate, taxType });

export const FIXTURE_AREAS: FixtureArea[] = [
  // Minnesota: two areas in one state with different local rates, plus a future state-level change for tests.
  { zipPrefix: "559", state: "MN", label: "Fixture MN area A", jurisdictions: [
    { j: j("MN", "Minnesota (fixture)", "state", "6.875"), from: "2020-01-01" },
    { j: j("MN", "Minnesota (fixture)", "state", "7.000"), from: "2027-01-01" },
    { j: j("MN-CO-A", "County A (fixture)", "county", "0.500"), from: "2020-01-01" },
    { j: j("MN-CI-A", "City A (fixture)", "city", "0.500"), from: "2020-01-01" },
  ] },
  { zipPrefix: "554", state: "MN", label: "Fixture MN area B", jurisdictions: [
    { j: j("MN", "Minnesota (fixture)", "state", "6.875"), from: "2020-01-01" },
    { j: j("MN", "Minnesota (fixture)", "state", "7.000"), from: "2027-01-01" },
    { j: j("MN-CO-B", "County B (fixture)", "county", "0.150"), from: "2020-01-01" },
    { j: j("MN-SP-B", "Transit district B (fixture)", "special", "1.000"), from: "2020-01-01" },
  ] },
  { zipPrefix: "372", state: "TN", label: "Fixture TN area", jurisdictions: [
    { j: j("TN", "Tennessee (fixture)", "state", "7.000"), from: "2020-01-01" },
    { j: j("TN-LO-A", "Local A (fixture)", "county", "2.250"), from: "2020-01-01" },
    { j: j("TN-LO-A", "Local A (fixture)", "county", "2.750"), from: "2026-10-01" },
  ] },
  { zipPrefix: "750", state: "TX", label: "Fixture TX area", jurisdictions: [
    { j: j("TX", "Texas (fixture)", "state", "6.250"), from: "2020-01-01" },
    { j: j("TX-CI-A", "City A (fixture)", "city", "2.000"), from: "2020-01-01" },
  ] },
  { zipPrefix: "970", state: "OR", label: "Fixture OR area (no sales tax)", jurisdictions: [] },
];

/**
 * Fixture taxability: materials taxable; labor/installation depends on the fixture state and contract. TX + lump-sum
 * labor is flagged for review on purpose so the review path is exercised. Fixture logic, not legal advice.
 */
export function fixtureTaxable(state: string, cls: LineClass, contract: string | null | undefined): { taxable: boolean; needsReview?: boolean } {
  if (state === "OR") return { taxable: false };
  if (cls === "materials" || cls === "equipment_rental") return { taxable: true };
  if (cls === "permit_fee") return { taxable: false };
  if (state === "TX" && (cls === "labor_repair" || cls === "installation" || cls === "labor_new_construction")) return { taxable: false, needsReview: contract !== "time_and_materials" };
  if (state === "TN" && cls === "installation") return { taxable: true };
  return { taxable: false };
}

export function fixtureArea(zip: string | null | undefined) {
  const z = (zip ?? "").trim();
  return FIXTURE_AREAS.find((a) => z.startsWith(a.zipPrefix)) ?? null;
}

export function fixtureRates(zip: string | null | undefined, date: string): ProviderJurisdiction[] | null {
  const a = fixtureArea(zip);
  if (!a) return null;
  const byCode = new Map<string, { j: ProviderJurisdiction; from: string }>();
  for (const x of a.jurisdictions) {
    if (x.from > date) continue;
    const cur = byCode.get(x.j.code);
    if (!cur || cur.from < x.from) byCode.set(x.j.code, x);
  }
  return [...byCode.values()].map((x) => x.j);
}
