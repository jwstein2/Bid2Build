import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/lib/estimate/engine";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { buildObservation, scrubText } from "@/lib/market/capture";
import { classifyItem, PRECISE_CONFIDENCE } from "@/lib/market/classify";
import { parseFilters } from "@/lib/market/filters";
import { resolveGeo, zip3State } from "@/lib/market/geo";
import { generateSyntheticDataset } from "@/lib/market/synthetic";
import { sanitizeMeasurements, tradeModel } from "@/lib/market/trade-models";
import { normalizeUnit, suspectedUnitConfusion, toBase } from "@/lib/market/units";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

const cls = (name: string, costType: "material" | "labor" | "other" = "material", unit = "square foot", trade = "decks") =>
  classifyItem({ name, costType, unit, trade });

describe("market: unit normalization", () => {
  it("maps spellings to one canonical unit and base", () => {
    for (const s of ["SF", "sq ft", "sq. ft.", "square feet", "ft²", "per sf"]) expect(normalizeUnit(s).unit).toBe("square foot");
    expect(normalizeUnit("LF").unit).toBe("linear foot");
    expect(normalizeUnit("CY").unit).toBe("cubic yard");
    expect(normalizeUnit("hrs").unit).toBe("hour");
  });
  it("converts within a family to the base unit", () => {
    expect(normalizeUnit("square")).toMatchObject({ base: "square foot", factor: 100, family: "area" });
    expect(normalizeUnit("sq yd")).toMatchObject({ base: "square foot", factor: 9 });
    const r = toBase(30, 450, "square"); // 30 roofing squares at $450/square
    expect(r.quantity).toBe(3000);
    expect(r.unitPrice).toBe(4.5);
    expect(toBase(27, 6, "cubic foot").quantity).toBeCloseTo(1);
  });
  it("never converts days to hours or packages to anything", () => {
    expect(normalizeUnit("day")).toMatchObject({ base: "day", family: "time_day", factor: 1 });
    expect(normalizeUnit("bundles")).toMatchObject({ base: "bundle", family: "package" });
    expect(normalizeUnit("widgets").recognized).toBe(false);
  });
  it("spots common unit mix-ups", () => {
    expect(suspectedUnitConfusion(40.5, 4.5)).toBe(9);
    expect(suspectedUnitConfusion(4.4, 440)).toBe(100);
    expect(suspectedUnitConfusion(6, 4.5)).toBeNull();
  });
});

describe("market: trade and material classification", () => {
  it("extracts brand, product line and specs from free text", () => {
    const c = cls("Trex Enhance Basics 1×6");
    expect(c).toMatchObject({ component: "decking", material: "composite", brand: "Trex", productLine: "Enhance Basics" });
    expect(c.specs.nominal).toBe("1x6");
    expect(c.confidence).toBeGreaterThanOrEqual(PRECISE_CONFIDENCE);
  });
  it("does not pool materials with different price tiers", () => {
    const keys = ["Trex decking", "Trex composite boards", "Trex Enhance", "Trex Enhance Basics 1x6", "Composite deck board", "Trex Transcend decking"].map((n) => cls(n).materialKey);
    expect(keys[0]).toBe("decking.composite.trex");
    expect(keys[1]).toBe("decking.composite.trex"); // same evidence -> same key
    expect(keys[2]).toBe("decking.composite.trex.enhance");
    expect(keys[3]).toBe("decking.composite.trex.enhance-basics.1x6");
    expect(keys[4]).toBe("decking.composite"); // generic stays generic
    expect(new Set([keys[2], keys[3], keys[4], keys[5]]).size).toBe(4);
  });
  it("keeps PVC, composite and pressure-treated separate", () => {
    expect(cls("TimberTech AZEK Vintage decking").category).toBe("decking.pvc");
    expect(cls("Pressure-treated 5/4x6 deck boards").category).toBe("decking.pressure_treated");
    expect(cls("Fiberon Good Life decking").category).toBe("decking.composite");
  });
  it("classifies roofing, countertops and labor", () => {
    expect(cls("GAF Timberline HDZ shingles", "material", "square", "roofing")).toMatchObject({ category: "shingles.architectural_asphalt", productLine: "Timberline HDZ" });
    expect(cls("3-tab shingles", "material", "square", "roofing").category).toBe("shingles.three_tab_asphalt");
    expect(cls("Quartz countertop 3cm", "material", "square foot", "kitchens")).toMatchObject({ category: "countertops.quartz", specs: { thickness_cm: 3 } });
    const labor = cls("Deck installation labor", "labor", "hour");
    expect(labor.costClass).toBe("labor");
    expect(labor.materialKey).toBe("labor.decks.general");
  });
  it("flags a cost class that contradicts the text and lowers confidence", () => {
    const c = cls("Installation labor", "material", "hour");
    expect(c.classConflict).toBe(true);
    expect(c.confidence).toBeLessThan(PRECISE_CONFIDENCE);
  });
  it("routes vague text below the precise threshold", () => {
    expect(cls("Misc").category).toBe("unclassified");
    expect(cls("Misc").confidence).toBeLessThanOrEqual(0.3);
    expect(cls("Decking").confidence).toBeLessThan(PRECISE_CONFIDENCE);
  });
  it("fingerprints by trade, normalized text and cost class", () => {
    expect(cls("Trex  Decking").fingerprint).toBe(cls("trex decking").fingerprint);
    expect(cls("Trex decking", "labor").fingerprint).not.toBe(cls("Trex decking").fingerprint);
  });
});

describe("market: geography", () => {
  it("derives state and metro from the ZIP prefix", () => {
    expect(zip3State("606")).toBe("IL");
    expect(zip3State("100")).toBe("NY");
    expect(zip3State("995")).toBe("AK");
    expect(resolveGeo({ zip: "60614-1234" })).toMatchObject({ zip5: "60614", zip3: "606", state: "IL", metro: "Chicago, IL" });
    expect(resolveGeo({ zip: "61701" }).metro).toBe("Rest of IL");
  });
  it("prefers the ZIP over a conflicting typed state and flags the conflict", () => {
    expect(resolveGeo({ zip: "60614", state: "Texas" })).toMatchObject({ state: "IL", stateConflict: true });
    expect(resolveGeo({ state: "texas" })).toMatchObject({ state: "TX", zip3: null, metro: null });
  });
});

function deck(extra: Partial<ReturnType<typeof est>> = {}) {
  return est({
    location: { zip: "60614", state: "IL" },
    taxRate: "10",
    customer: { name: "Pat Customer", email: "pat@example.com", phone: "555-123-4567", projectAddress: "12 Oak St" },
    items: [
      item("g1", "400", "8", { name: "Trex Enhance Basics deck boards", unit: "square foot" }),
      item("g1", "1", "999", { name: "Example", isExample: true }),
      item("g2", "40", "60", { name: "Deck installation labor", costType: "labor", unit: "hour", taxable: false }),
    ],
    projectProfile: { sector: "residential", workType: "new_construction", projectType: "new_deck", measurements: { area_sqft: 400, height_ft: 2, railing_lf: 20, stair_count: 0, notes: "call Pat" } as Record<string, number | string> },
    ...extra,
  });
}

describe("market: pricing observation capture", () => {
  it("records project, group and line facts with normalized units", () => {
    const e = deck();
    const o = buildObservation(e, computeEstimate(e), e.projectProfile, { sharePrices: true, shareCosts: true });
    expect(o).toMatchObject({
      schema: 1, trade: "decks", zip3: "606", state: "IL", metro: "Chicago, IL", status: "quoted", project_type: "new_deck",
      work_type: "new_construction", sector: "residential", complexity: "standard", size_value: 400, size_unit: "square foot", size_source: "entered",
      price_subtotal: 7000, cost_total: 5600, gross_margin_pct: 20, markup_pct: 25, line_count: 2, group_count: 2, costs_shared: true,
    });
    expect(o.price_per_unit).toBe(17.5);
    expect(o.tax_amount).toBe(400); // only the taxable decking line
    const boards = o.lines.find((l) => l.material_key.startsWith("decking"))!;
    expect(boards).toMatchObject({ unit_norm: "square foot", qty_norm: 400, unit_price: 10, unit_cost: 8, markup_pct: 25, brand: "Trex" });
    expect(o.groups[0]).toMatchObject({ std_category: "decking", price: 4000, cost: 3200 });
  });
  it("never includes customer, business or free-text details", () => {
    const e = deck();
    const json = JSON.stringify(buildObservation(e, computeEstimate(e), e.projectProfile, { sharePrices: true, shareCosts: true }));
    for (const s of ["Pat", "pat@example.com", "555-123-4567", "Oak St", "EST-1", "call Pat"]) expect(json).not.toContain(s);
    expect(json).not.toContain("Example"); // example rows never count
  });
  it("strips internal costs, markups and margins without cost consent", () => {
    const e = deck();
    const o = buildObservation(e, computeEstimate(e), e.projectProfile, { sharePrices: true, shareCosts: false });
    expect(o.costs_shared).toBe(false);
    expect(o).not.toHaveProperty("cost_total");
    expect(o).not.toHaveProperty("gross_margin_pct");
    for (const l of o.lines) { expect(l).not.toHaveProperty("unit_cost"); expect(l).not.toHaveProperty("markup_pct"); }
    for (const g of o.groups) expect(g).not.toHaveProperty("cost");
  });
  it("infers project size from line items when not entered, and marks it inferred", () => {
    const e = deck({ projectProfile: null });
    const o = buildObservation(e, computeEstimate(e), null, { sharePrices: true, shareCosts: false });
    expect(o).toMatchObject({ size_value: 400, size_source: "inferred", complexity: null, project_type: null });
  });
  it("reports price per unit only for single-trade projects", () => {
    const e = deck({ trades: ["decks", "electrical"] });
    expect(buildObservation(e, computeEstimate(e), e.projectProfile, { sharePrices: true, shareCosts: false }).price_per_unit).toBeNull();
  });
  it("classifies elevated decks as complex so they aren't compared with ground-level platforms", () => {
    expect(tradeModel("decks").complexity({ height_ft: 8, stair_count: 1 })).toBe("complex");
    expect(tradeModel("decks").complexity({ height_ft: 1, railing_lf: 0 })).toBe("standard");
  });
  it("keeps only defined measurement fields with valid types", () => {
    expect(sanitizeMeasurements("decks", { area_sqft: "320", height_ft: -1, decking_material: "composite", note: "x", stair_count: "a" })).toEqual({ area_sqft: 320, decking_material: "composite" });
    expect(sanitizeMeasurements("roofing", { pitch: "vertical" })).toEqual({});
  });
  it("scrubs contact details from names", () => {
    expect(scrubText("Smith job call 555-867-5309 or bob@x.com")).toBe("Smith job call [number] or [email]");
  });
  it("editing the benchmarking profile never creates a new proposal version", () => {
    const biz = defaultBusinessProfile();
    const cfg = defaultProposalConfig();
    const a = deck();
    const b = { ...a, projectProfile: { ...a.projectProfile, outcome: "accepted" as const } };
    expect(contentHash(versionSnapshot(a, biz, cfg))).toBe(contentHash(versionSnapshot(b, biz, cfg)));
  });
});

describe("market: admin filters and synthetic data", () => {
  it("whitelists filter keys and validates formats", () => {
    expect(parseFilters({ state: "IL", date_from: "2026-01-01", dataset: "synthetic", evil: "1", price_min: "abc", status: "accepted" }))
      .toEqual({ state: "IL", date_from: "2026-01-01", dataset: "synthetic", status: "accepted" });
    expect(parseFilters({ state: "Illinois'; drop" })).toEqual({});
  });
  it("generates a deterministic synthetic dataset", () => {
    const a = generateSyntheticDataset({ contributors: 5, bidsPerContributor: 3, seed: 7, now: new Date("2026-11-12T00:00:00Z") });
    const b = generateSyntheticDataset({ contributors: 5, bidsPerContributor: 3, seed: 7, now: new Date("2026-11-12T00:00:00Z") });
    expect(a).toEqual(b);
    expect(a).toHaveLength(15);
    expect(new Set(a.map((r) => r.contributor)).size).toBe(5);
    expect(a.every((r) => r.payload.schema === 1 && r.payload.price_subtotal > 0)).toBe(true);
  });
});
