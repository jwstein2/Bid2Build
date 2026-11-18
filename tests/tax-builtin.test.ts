/**
 * V6.9 built-in tax engine (replaces a paid tax service): construction rules, official file readers, address →
 * jurisdiction choice, the builtin provider end to end on an in-memory database, the importer with mocked downloads,
 * and the seed rates staying in sync with the SQL. No network: every fetch is mocked.
 */
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TAX_AUTHORITIES } from "@/lib/tax-banking/authorities";
import { assertTestIsolation, taxProviderMode } from "@/lib/tax-banking/isolation";
import { CONSTRUCTION_RULES, constructionTreatment } from "@/lib/tax-banking/tax/construction-rules";
import { aggregateSstBoundaries, fileText, describeListing, findOfficialFiles, FormatChanged, parseSstRates, parseStateTable, splitCsv, unzipOne } from "@/lib/tax-banking/tax/official-files";
import { builtinProvider, pickLocation, pickRates } from "@/lib/tax-banking/tax/builtin";
import { censusGeocode, geocodeKey } from "@/lib/tax-banking/tax/geocode";
import { SEED_RATES, STATE_ONLY } from "@/lib/tax-banking/tax/seed-rates";
import { calculateTax } from "@/lib/tax-banking/tax/engine";
import { resolveTaxProvider } from "@/lib/tax-banking/tax/providers";
import { exemptionSchema, exemptionStatement } from "@/lib/tax-banking/tax/exemption-form";
import type { TaxRequest } from "@/lib/tax-banking/tax/types";

beforeAll(() => assertTestIsolation());
const MIG = readFileSync("supabase/migrations/20261226001000_tax_banking.sql", "utf8");

// --- tiny in-memory stand-in for the Supabase query builder (only what builtin.ts / importer.ts use) -------------
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, rpc: Record<string, (args: Row) => unknown> = {}) {
  const calls: { table: string; op: string; values?: unknown }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "upsert" | "insert" = "select"; let values: Row | null = null; let head = false; let lim = 1e9;
    const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op === "update") { for (const r of rows()) Object.assign(r, values); calls.push({ table, op, values }); return { data: null, error: null }; }
      if (op === "upsert" || op === "insert") { (tables[table] ??= []).push({ id: `id-${(tables[table] ?? []).length + 1}`, ...values }); calls.push({ table, op, values }); return { data: { id: `id-${tables[table].length}` }, error: null }; }
      const out = rows().slice(0, lim);
      return head ? { data: null, count: out.length, error: null } : { data: out, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return b; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
      lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return b; },
      like: (k: string, v: string) => { const re = new RegExp(`^${v.replace(/%/g, ".*")}$`); filters.push((r) => re.test(String(r[k]))); return b; },
      order: () => b, limit: (n: number) => { lim = n; return b; },
      update: (v: Row) => { op = "update"; values = v; return b; },
      upsert: (v: Row) => { op = "upsert"; values = v; return b; },
      insert: (v: Row) => { op = "insert"; values = v; return b; },
      maybeSingle: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      single: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  };
  const db = { from, rpc: async (fn: string, args: Row) => ({ data: rpc[fn] ? rpc[fn](args) : null, error: null }) } as unknown as SupabaseClient;
  return { db, calls, tables };
}

const lines: TaxRequest["lines"] = [
  { ref: "mat", amount: "6000.00", classification: "materials", taxableHint: true },
  { ref: "lab", amount: "4000.00", classification: "labor_repair", taxableHint: false },
  { ref: "permit", amount: "300.00", classification: "permit_fee", taxableHint: false },
];
const rate = (state: string, code: string, level: string, r: string, source = "official", from = "2026-01-01") =>
  ({ state, jurisdiction_code: code, jurisdiction_name: code, level, rate: r, effective_from: from, source, recorded_at: "2026-11-01T00:00:00Z" });
const censusOk = (county: string, place: string | null, state = "MN") => (async () => new Response(JSON.stringify({ result: { addressMatches: [{
  matchedAddress: "1 MAIN ST, ROCHESTER, MN, 55901", addressComponents: { zip: "55901", state },
  geographies: { Counties: [{ COUNTY: county, NAME: "Olmsted County", STATE: "27" }], "Incorporated Places": place ? [{ PLACE: place, NAME: "Rochester city" }] : [] } }] } }), { status: 200 })) as unknown as typeof fetch;

describe("construction rules", () => {
  it("cover all 50 states + DC", () => {
    expect(Object.keys(CONSTRUCTION_RULES).sort()).toEqual(TAX_AUTHORITIES.map((a) => a.state).sort());
  });
  it("contractor-consumer states don't tax a lump-sum contract; permits are never taxed", () => {
    expect(constructionTreatment("MN", "materials", { contract: "lump_sum" })).toEqual({ taxable: false });
    expect(constructionTreatment("MN", "labor_repair")).toEqual({ taxable: false });
    expect(constructionTreatment("WA", "permit_fee").taxable).toBe(false);
  });
  it("gross receipts and retail-construction states tax labor too", () => {
    for (const s of ["HI", "NM", "WA"]) expect(constructionTreatment(s, "labor_new_construction")).toEqual({ taxable: true });
  });
  it("repair is taxable where the state taxes repair services (NY, NJ, NC), capital improvements aren't", () => {
    expect(constructionTreatment("NY", "labor_repair").taxable).toBe(true);
    expect(constructionTreatment("NY", "materials", { work: "repair" }).taxable).toBe(true);
    expect(constructionTreatment("NC", "labor_new_construction").taxable).toBe(false);
    expect(constructionTreatment("NJ", "materials", { work: "new_construction" }).taxable).toBe(false);
  });
  it("Texas depends on residential vs commercial; unknown mix is flagged, never guessed", () => {
    expect(constructionTreatment("TX", "labor_repair", { workMix: "commercial" })).toEqual({ taxable: true });
    expect(constructionTreatment("TX", "labor_repair", { workMix: "residential" })).toEqual({ taxable: false });
    expect(constructionTreatment("TX", "labor_repair", {})).toEqual({ taxable: true, needsReview: true });
    expect(constructionTreatment("TX", "materials", { work: "new_construction", contract: "time_and_materials" }).needsReview).toBe(true);
  });
  it("uncertain states are flagged for review (and shown as taxable so a bid isn't under-priced)", () => {
    expect(constructionTreatment("AZ", "materials")).toEqual({ taxable: true, needsReview: true });
    expect(constructionTreatment("CA", "materials", { contract: "time_and_materials" }).needsReview).toBe(true);
    expect(constructionTreatment("ZZ", "materials").needsReview).toBe(true);
  });
  it("no-sales-tax states never tax anything", () => {
    for (const s of ["DE", "MT", "NH", "OR"]) for (const c of ["materials", "labor_repair", "service"] as const) expect(constructionTreatment(s, c).taxable).toBe(false);
  });
});

const RATE_FILE = [
  "State,Jurisdiction Type,Jurisdiction FIPS,General Rate Intrastate,General Rate Interstate,Food Intra,Food Inter,Begin,End",
  "27,45,27,0.06875,0.06875,0,0,20090701,29991231",
  "27,00,109,0.005,0.005,0,0,20200101,29991231",
  "27,01,54880,0.0075,0.0075,0,0,20240101,29991231",
  "27,01,54880,0.005,0.005,0,0,20150101,20231231",      // expired: skipped
  "27,63,12345,0.01,0.01,0,0,20270101,29991231",        // announced future special district rate
].join("\n");
const zline = (type: string, zip: string, county: string, place: string, specials: string[] = [], begin = "20200101", end = "29991231") => {
  const f = new Array(29).fill("");
  f[0] = type; f[1] = begin; f[2] = end; f[15] = zip; f[17] = zip; f[19] = zip; f[22] = "27"; f[24] = county; f[25] = place;
  for (const s of specials) f.push("1", s, "63");
  return f.join(",");
};

describe("official file readers", () => {
  it("reads an SST rate file: percents, levels, current + future, expired skipped", () => {
    const r = parseSstRates(RATE_FILE, "MN", "2026-11-18");
    expect(r.map((x) => [x.code, x.level, x.rate, x.effectiveFrom])).toEqual([
      ["MN", "state", "6.875", "2009-07-01"], ["MN-CO-109", "county", "0.5", "2020-01-01"], ["MN-CI-54880", "city", "0.75", "2024-01-01"], ["MN-SP-12345", "special", "1", "2027-01-01"]]);
  });
  it("refuses a file that doesn't look like the published layout (keeps the last good rates)", () => {
    expect(() => parseSstRates("hello\nworld", "MN", "2026-11-18")).toThrow(FormatChanged);
    expect(() => parseSstRates("27,00,109,0.005,0.005,0,0,20200101,29991231", "MN", "2026-11-18")).toThrow(/statewide/);
    expect(() => parseSstRates(RATE_FILE.replace(/^27,/gm, "19,"), "MN", "2026-11-18")).toThrow(FormatChanged);
  });
  it("aggregates ZIP boundary records into weighted combinations", () => {
    const text = [zline("Z", "55901", "109", "54880"), zline("4", "55901", "109", "54880"), zline("4", "55901", "109", "", ["12345"]), zline("A", "55901", "109", "54880"),
      zline("Z", "55902", "109", "54880", [], "20300101")].join("\n");
    const a = aggregateSstBoundaries(text, "MN", "2026-11-18");
    expect(a).toEqual(expect.arrayContaining([{ zip5: "55901", countyFips: "109", placeFips: "54880", specials: [], weight: 2 }, { zip5: "55901", countyFips: "109", placeFips: null, specials: ["12345"], weight: 1 }]));
    expect(a.some((x) => x.zip5 === "55902")).toBe(false);   // not effective yet
  });
  it("reads zip archives (deflated) and plain text", () => {
    const data = Buffer.from(RATE_FILE);
    const comp = deflateRawSync(data);
    const name = Buffer.from("MNR2026Q4OCT01.csv");
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + comp.length;
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, comp, central, name, eocd]);
    expect(unzipOne(zip).data.toString()).toBe(RATE_FILE);
    expect(fileText(zip).text).toBe(RATE_FILE);
    expect(fileText(Buffer.from("x,y")).text).toBe("x,y");
    expect(() => unzipOne(Buffer.from("not a zip at all, definitely not"))).toThrow(FormatChanged);
  });
  it("finds the newest rate and boundary files for a state on an official page", () => {
    const html = `<a href="/files/MNR2026Q3JUL01.zip">old</a><a href="/files/MNR2026Q4OCT01.zip">new</a><a href="https://x.gov/files/MNB2026Q4OCT01.zip">b</a>
      <a href="/files/WIR2026Q4OCT01.zip">wi</a><a href="http://insecure.example/MNR2027Q1JAN01.zip">http</a>`;
    expect(findOfficialFiles(html, "MN", "https://www.example.org/r-b-files")).toEqual({ rateUrl: "https://www.example.org/files/MNR2026Q4OCT01.zip", boundaryUrl: "https://x.gov/files/MNB2026Q4OCT01.zip" });
    expect(findOfficialFiles("<p>nothing</p>", "MN", "https://www.example.org/")).toEqual({ rateUrl: null, boundaryUrl: null });
  });
  it("finds SST files behind download handlers, in link text, without a day or extension", () => {
    const base = "https://www.example.org/r-b-files";
    expect(findOfficialFiles(`<a href="/download.aspx?file=MNR2026Q4OCT01.zip&amp;v=2">Rates</a><a href="/media/88">MN B 2026 Q4 OCT</a>`, "MN", base))
      .toEqual({ rateUrl: "https://www.example.org/download.aspx?file=MNR2026Q4OCT01.zip&v=2", boundaryUrl: "https://www.example.org/media/88" });
    expect(findOfficialFiles(`<a href="/f/mnr2026q3.zip">q3</a><a href="/f/mnr2026q4.zip">q4</a>`, "MN", base).rateUrl).toBe("https://www.example.org/f/mnr2026q4.zip");
    expect(findOfficialFiles(`<a href="/f/Minnesota_MN_rates_2026.csv">x</a>`, "MN", base).rateUrl).toBe("https://www.example.org/f/Minnesota_MN_rates_2026.csv");
    // Another state's file, or "MN" inside a longer word, doesn't count.
    expect(findOfficialFiles(`<a href="/f/WIR2026Q4OCT01.zip">wi</a><a href="/f/ADMNR2026Q4.zip">x</a>`, "MN", base)).toEqual({ rateUrl: null, boundaryUrl: null });
  });
  it("describes a listing page when no file is found", () => {
    const d = describeListing(`<a href="/a">Home</a><a href="/docs/file.zip">All states</a><a href="/states/mn">MN</a>`, "MN", "https://www.example.org/");
    expect(d).toContain("Page had 3 links, 1 file links, 1 mention MN");
    expect(d).toContain("www.example.org/docs/file.zip [All states]");
  });
  it("reads a state's own rate table with an owner-set column mapping", () => {
    const t = "Level,FIPS,Name,Rate\nState,,Texas,6.25\nCity,4805000,Austin,1.0\nCounty,453,Travis,0.5";
    const r = parseStateTable(t, "TX", { level: 0, fips: 1, name: 2, rate: 3, rateUnit: "percent" }, "2026-11-18");
    expect(r.map((x) => [x.code, x.rate])).toEqual([["TX", "6.25"], ["TX-CI-4805000", "1"], ["TX-CO-453", "0.5"]]);
    expect(splitCsv('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
  });
});

describe("address → jurisdictions", () => {
  const rows = [{ county_fips: "109", place_fips: "54880", specials: [], weight: 5 }, { county_fips: "109", place_fips: "54880", specials: ["12345"], weight: 2 }, { county_fips: "039", place_fips: null, specials: [], weight: 1 }];
  it("uses the geocoded county + city, and flags a ZIP whose districts differ inside that city", () => {
    const l = pickLocation({ matched: true, state: "MN", zip5: "55901", countyFips: "109", countyName: "Olmsted County", placeFips: "54880", placeName: "Rochester city" }, rows, "MN");
    expect(l).toMatchObject({ county: { fips: "109" }, place: { fips: "54880" }, specials: [], approximate: false, ambiguous: true });
  });
  it("falls back to the most common area of the ZIP, flagged", () => {
    expect(pickLocation(null, rows, "MN")).toMatchObject({ county: { fips: "109" }, approximate: true, ambiguous: true });
    expect(pickLocation(null, [], "MN")).toMatchObject({ county: null, approximate: true });
  });
  it("notices an address that geocodes to another state", () => {
    expect(pickLocation({ matched: true, state: "WI", zip5: "54601", countyFips: "063", countyName: null, placeFips: null, placeName: null }, [], "MN").stateMismatch).toBe(true);
  });
  it("official rates beat seed rates; future versions wait for their date", () => {
    const p = pickRates([rate("MN", "MN", "state", "6.875", "seed", "2026-11-01"), rate("MN", "MN", "state", "6.875", "official", "2009-07-01"), rate("MN", "MN", "state", "7", "official", "2027-01-01")] as never, "2026-11-18");
    expect(p.get("MN")).toMatchObject({ source: "official", rate: "6.875" });
    expect(pickRates([rate("MN", "MN", "state", "7", "official", "2027-01-01")] as never, "2027-02-01").get("MN")?.rate).toBe("7");
  });
  it("reads the Census geocoder answer; the cache key never contains the address", async () => {
    const g = await censusGeocode({ line1: "1 Main St", city: "Rochester", state: "MN", zip: "55901" }, censusOk("109", "54880"));
    expect(g).toMatchObject({ matched: true, state: "MN", countyFips: "109", placeFips: "54880", placeName: "Rochester city" });
    const key = geocodeKey({ line1: "1 Main St", city: "Rochester", state: "MN", zip: "55901" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(geocodeKey({ line1: "1 main st.", city: "ROCHESTER", state: "mn", zip: "55901-1234" }));
  });
});

describe("built-in provider end to end", () => {
  const world = () => fakeDb({
    tax_rate_sources: [{ state: "MN", status: "ok", last_success_at: "2026-11-18T09:00:00Z", rates_loaded: 4, zips_loaded: 900 }, { state: "TX", status: "needs_link", rates_loaded: 0, zips_loaded: 0 }],
    tax_zip_areas: [{ state: "MN", zip5: "55901", county_fips: "109", place_fips: "54880", specials: [], weight: 5, live: true }],
    tax_jurisdiction_rates: [rate("MN", "MN", "state", "6.875"), rate("MN", "MN-CO-109", "county", "0.5"), rate("MN", "MN-CI-54880", "city", "0.75"), rate("MN", "MN-SP-12345", "special", "1"),
      rate("MN", "MN", "state", "6.875", "seed", "2026-11-01"), rate("TX", "TX", "state", "6.25", "seed", "2026-11-01"), rate("VA", "VA", "state", "4.3", "seed", "2026-11-01"),
      rate("VA", "VA-LO", "other", "1", "seed", "2026-11-01"), rate("CT", "CT", "state", "6.35", "seed", "2026-11-01")],
    tax_geocode_cache: [],
  });
  const req = (state: string, zip: string, extra: Partial<TaxRequest> = {}): TaxRequest => ({ address: { line1: "1 Main St", city: "Town", state, zip }, transactionDate: "2026-11-18", lines, contract: "lump_sum", ...extra });

  it("Minnesota: official state + county + city rates for the geocoded address; lump-sum repair isn't taxed", async () => {
    const { db } = world();
    const p = builtinProvider({ db, cache: db, fetchImpl: censusOk("109", "54880"), now: () => new Date("2026-11-18T12:00:00Z") });
    const r = await calculateTax({ request: req("MN", "55901", { lines: [{ ref: "m", amount: "1000.00", classification: "materials", taxableHint: true }], contract: "time_and_materials" }), provider: p, companyRate: "0" });
    expect(r.combinedRate).toBe("8.125");
    expect(r.jurisdictions.map((j) => j.name)).toEqual(["Minnesota", "Olmsted County", "Rochester city"]);
    expect(r.provider).toBe("builtin");
    expect(r.taxAmount).toBe("0.00");        // contractor is the consumer of materials in MN
    expect(r.status).toBe("calculated");
    expect(r.notes?.[0]).toMatch(/consumer of materials/);
  });
  it("caches the geocode by hash only (no address text stored)", async () => {
    const { db, tables } = world();
    await builtinProvider({ db, cache: db, fetchImpl: censusOk("109", "54880") }).calculate(req("MN", "55901"));
    expect(tables.tax_geocode_cache).toHaveLength(1);
    expect(JSON.stringify(tables.tax_geocode_cache)).not.toMatch(/Main|Town/i);
  });
  it("Washington-style taxable work uses the rates; a state without local rates loaded is flagged", async () => {
    const { db } = world();
    const p = builtinProvider({ db, fetchImpl: censusOk("453", "05000", "TX") });
    const r = await calculateTax({ request: req("TX", "78701", { workMix: "commercial" }), provider: p, companyRate: "8.25" });
    expect(r.combinedRate).toBe("6.25");
    expect(r.reviewReasons).toContain("local_rate_unverified");
    expect(r.taxAmount).toBe("625.00");       // TX commercial repair: materials + labor taxable, permit not
    expect(r.status).toBe("needs_review");
  });
  it("state-only states need no address lookup; Virginia includes its statewide local 1%", async () => {
    const { db } = world();
    let called = 0;
    const f = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
    const ct = await calculateTax({ request: req("CT", "06103"), provider: builtinProvider({ db, fetchImpl: f }), companyRate: "0" });
    expect(ct.combinedRate).toBe("6.35");
    expect(ct.reviewReasons).not.toContain("local_rate_unverified");
    expect(called).toBe(0);
    const va = await calculateTax({ request: req("VA", "23219"), provider: builtinProvider({ db, fetchImpl: f }), companyRate: "0" });
    expect(va.combinedRate).toBe("5.3");
  });
  it("no-sales-tax states return no tax, cleanly", async () => {
    const { db } = world();
    const r = await calculateTax({ request: req("OR", "97201"), provider: builtinProvider({ db }), companyRate: "0" });
    expect(r).toMatchObject({ taxAmount: "0.00", status: "calculated", combinedRate: "0" });
  });
  it("no rate on file: falls back to the contractor's rate and says so (never invents one)", async () => {
    const { db } = world();
    const r = await calculateTax({ request: req("UT", "84101"), provider: builtinProvider({ db, fetchImpl: censusOk("035", null, "UT") }), companyRate: "7.25" });
    expect(r.source).toBe("company_rate");
    expect(r.reviewReasons).toEqual(expect.arrayContaining(["no_verified_rate", "unverified_company_rate"]));
    expect(r.reviewReasons).not.toContain("provider_unavailable");
  });
  it("Census down: uses the ZIP's boundary data and flags the address as approximate", async () => {
    const { db } = world();
    const down = (async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
    const r = await calculateTax({ request: req("MN", "55901"), provider: builtinProvider({ db, fetchImpl: down }), companyRate: "0" });
    expect(r.combinedRate).toBe("8.125");
    expect(r.reviewReasons).toContain("address_approximate");
  });
  it("an address in another state than entered is invalid", async () => {
    const { db } = world();
    const r = await calculateTax({ request: req("MN", "55901"), provider: builtinProvider({ db, fetchImpl: censusOk("063", null, "WI") }), companyRate: "0" });
    expect(r.reviewReasons).toContain("invalid_address");
  });
  it("is the default engine outside tests, off with TAX_PROVIDER=none, and needs database access", () => {
    expect(taxProviderMode({ CONTEXT: "production" })).toBe("builtin");
    expect(taxProviderMode({ CONTEXT: "production", TAX_PROVIDER: "none" })).toBe("none");
    expect(taxProviderMode({ VITEST: "true" })).toBe("none");
    expect(taxProviderMode({ CONTEXT: "deploy-preview" }, { sandbox: true })).toBe("mock");
    expect(resolveTaxProvider({ CONTEXT: "production" })).toBeNull();
    expect(resolveTaxProvider({ CONTEXT: "production" }, { builtin: { db: world().db } })?.name).toBe("builtin");
  });
});

describe("importer (mocked downloads)", () => {
  it("imports rates + boundaries for a Streamlined state, records the source as ok", async () => {
    const { importState } = await import("@/lib/tax-banking/tax/importer");
    const imported: Row[] = []; const zips: Row[] = []; let committed = false;
    const { db, tables } = fakeDb({ tax_rate_sources: [{ state: "MN" }], tax_sync_runs: [] }, {
      tax_official_import: (a) => { imported.push(...(a.p_rows as Row[])); return { found: (a.p_rows as Row[]).length, alertIds: [] }; },
      tax_zip_areas_load: (a) => { zips.push(...(a.p_rows as Row[])); return (a.p_rows as Row[]).length; },
      tax_zip_areas_commit: () => { committed = true; return 1; },
    });
    const files: Record<string, string> = {
      "https://www.example.org/r-b": `<a href="/f/MNR2026Q4OCT01.csv">r</a><a href="/f/MNB2026Q4OCT01.csv">b</a>`,
      "https://www.example.org/f/MNR2026Q4OCT01.csv": RATE_FILE,
      "https://www.example.org/f/MNB2026Q4OCT01.csv": zline("Z", "55901", "109", "54880"),
    };
    const f = (async (u: string) => files[u] !== undefined ? new Response(files[u]) : new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const r = await importState(db, { state: "MN", kind: "sst", listing_url: "https://www.example.org/r-b", rate_url: null, boundary_url: null, format: null, status: "needs_link",
      last_rate_file: null, last_boundary_file: null, zips_loaded: 0, last_success_at: null }, { fetchImpl: f, now: new Date("2026-11-18T10:00:00Z") });
    expect(r).toMatchObject({ status: "ok", rates: 4, zips: 1 });
    expect(imported.map((x) => x.code)).toEqual(["MN", "MN-CO-109", "MN-CI-54880", "MN-SP-12345"]);
    expect(committed).toBe(true);
    expect(tables.tax_rate_sources[0]).toMatchObject({ status: "ok", rates_loaded: 4, zips_loaded: 1, last_rate_file: "MNR2026Q4OCT01.csv", last_boundary_file: "MNB2026Q4OCT01.csv" });
  });
  it("a changed file format keeps the last good rates and marks the source", async () => {
    const { importState } = await import("@/lib/tax-banking/tax/importer");
    let rpcCalled = false;
    const { db, tables } = fakeDb({ tax_rate_sources: [{ state: "MN", status: "ok", rates_loaded: 4 }], tax_sync_runs: [] }, { tax_official_import: () => { rpcCalled = true; return {}; } });
    const f = (async () => new Response("completely,different\nfile,here")) as unknown as typeof fetch;
    const r = await importState(db, { state: "MN", kind: "sst", listing_url: null, rate_url: "https://x.example.org/MNR.csv", boundary_url: null, format: null, status: "ok",
      last_rate_file: null, last_boundary_file: null, zips_loaded: 0, last_success_at: null }, { fetchImpl: f });
    expect(r.status).toBe("format_changed");
    expect(rpcCalled).toBe(false);
    expect(tables.tax_rate_sources[0]).toMatchObject({ status: "format_changed", rates_loaded: 4 });
  });
  it("follows a per-state page from the listing, and records what the page offered when nothing matches", async () => {
    const { resolveFiles } = await import("@/lib/tax-banking/tax/importer");
    const pages: Record<string, string> = {
      "https://www.example.org/r-b": `<a href="/states/minnesota">Minnesota</a><a href="/states/wi">Wisconsin</a>`,
      "https://www.example.org/states/minnesota": `<a href="/dl/MNR2026Q4OCT01.zip">Rate file</a><a href="/dl/MNB2026Q4OCT01.zip">Boundary file</a>`,
    };
    const f = (async (u: string) => pages[u] !== undefined ? new Response(pages[u]) : new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const src = { state: "MN", kind: "sst", listing_url: "https://www.example.org/r-b", rate_url: null, boundary_url: null, format: null, status: "needs_link",
      last_rate_file: null, last_boundary_file: null, zips_loaded: 0, last_success_at: null } as const;
    expect(await resolveFiles({ ...src }, f)).toMatchObject({ rateUrl: "https://www.example.org/dl/MNR2026Q4OCT01.zip", boundaryUrl: "https://www.example.org/dl/MNB2026Q4OCT01.zip" });
    const miss = await resolveFiles({ ...src, state: "IA" }, f);
    expect(miss.rateUrl).toBeNull();
    expect(miss.listing).toContain("Page had 2 links");
  });
  it("follows the site's Rate and Boundary Files page (the real SST layout seen in prod), skipping the updates page", async () => {
    const { resolveFiles } = await import("@/lib/tax-banking/tax/importer");
    const pages: Record<string, string> = {
      "https://www.example.org/quick-links/r-b-files": `<a href="/Shared-Pages/rate-and-boundary-files"></a>
        <a href="/committees/certification-committee/rate-and-boundary-file-updates">Rate and Boundary File Updates</a>
        <a href="/committees/certification-committee/rate-and-boundary-files">Rate and Boundary Files</a>`,
      "https://www.example.org/committees/certification-committee/rate-and-boundary-files": `<a href="/docs/rb/WYR2026Q4OCT01.zip">Wyoming rates</a><a href="/docs/rb/WYB2026Q4OCT01.zip">Wyoming boundaries</a>`,
    };
    const seen: string[] = [];
    const f = (async (u: string) => { seen.push(u); return pages[u] !== undefined ? new Response(pages[u]) : new Response("nope", { status: 404 }); }) as unknown as typeof fetch;
    const src = { state: "WY", kind: "sst", listing_url: "https://www.example.org/quick-links/r-b-files", rate_url: null, boundary_url: null, format: null, status: "needs_link",
      last_rate_file: null, last_boundary_file: null, zips_loaded: 0, last_success_at: null } as const;
    expect(await resolveFiles({ ...src }, f)).toMatchObject({ rateUrl: "https://www.example.org/docs/rb/WYR2026Q4OCT01.zip", boundaryUrl: "https://www.example.org/docs/rb/WYB2026Q4OCT01.zip" });
    expect(seen).not.toContain("https://www.example.org/committees/certification-committee/rate-and-boundary-file-updates");
    const miss = await resolveFiles({ ...src, state: "VT" }, f);
    expect(miss.rateUrl).toBeNull();
    expect(miss.listing).toContain("certification-committee/rate-and-boundary-files:");
  });
  it("a state with no link yet is skipped quickly, without a download", async () => {
    const { importState } = await import("@/lib/tax-banking/tax/importer");
    let fetched = false;
    const { db } = fakeDb({ tax_rate_sources: [{ state: "TX" }] });
    const r = await importState(db, { state: "TX", kind: "state_table", listing_url: null, rate_url: null, boundary_url: null, format: null, status: "needs_link",
      last_rate_file: null, last_boundary_file: null, zips_loaded: 0, last_success_at: null }, { fetchImpl: (async () => { fetched = true; return new Response(""); }) as unknown as typeof fetch });
    expect(r.status).toBe("needs_link");
    expect(fetched).toBe(false);
  });
});

describe("seed rates + online exemption form", () => {
  it("every seed rate is in the migration, and the state-only list has no local taxes in the seed", () => {
    for (const s of SEED_RATES) expect(MIG).toContain(`('${s.state}', '${s.code}', '${s.name}', '${s.level}', ${s.rate})`);
    expect(SEED_RATES.some((s) => s.state === "DC" || s.state === "UT")).toBe(false);
    for (const s of STATE_ONLY) expect(TAX_AUTHORITIES.find((a) => a.state === s)).toBeTruthy();
  });
  it("validates the certificate the customer fills in", () => {
    const ok = { states: ["MN"], reasonCode: "G", purchaser: { name: "Pat Buyer", line1: "1 Main St", city: "Rochester", state: "MN", zip: "55901", businessType: "Construction" },
      idType: "state_permit", idNumber: "1234567", signerName: "Pat Buyer", agree: true };
    expect(exemptionSchema.safeParse(ok).success).toBe(true);
    expect(exemptionSchema.safeParse({ ...ok, agree: false }).success).toBe(false);
    expect(exemptionSchema.safeParse({ ...ok, reasonCode: "L" }).success).toBe(false);
    expect(exemptionSchema.safeParse({ ...ok, states: [] }).success).toBe(false);
    expect(exemptionStatement("Acme Builders", "Pat Buyer")).toMatch(/Acme Builders.*Pat Buyer|Pat Buyer.*Acme Builders/);
  });
  it("an online certificate applies in Streamlined states and asks for a check elsewhere", async () => {
    const r = (state: string) => calculateTax({ request: { address: { state, zip: state === "MN" ? "55901" : "75001" }, transactionDate: "2026-11-18", lines }, provider: null, companyRate: "7",
      exemption: { state, reason: "resale", certificateOnFile: true, expiresOn: null, onlineForm: true } });
    expect((await r("MN")).reviewReasons).not.toContain("exemption_state_form");
    expect((await r("TX")).reviewReasons).toContain("exemption_state_form");
    expect((await r("TX")).taxAmount).toBe("0.00");
  });
});
