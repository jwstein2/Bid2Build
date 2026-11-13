import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reducer, type State } from "@/components/builder/state";
import { runCalculator } from "@/lib/calculators/registry";
import { calculatorsFor, newInput } from "@/lib/calculators/mapping";
import type { CalcRecord } from "@/lib/calculators/types";
import { proposalConfigFrom, worksheetFrom, worksheetToStore } from "@/lib/data/mappers";
import { computeEstimate } from "@/lib/estimate/engine";
import { createEstimate } from "@/lib/estimate/factory";
import { estimateSchema, proposalConfigSchema } from "@/lib/estimate/schema";
import { formatCurrency } from "@/lib/estimate/money";
import type { Estimate } from "@/lib/estimate/types";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { sanitizeMeasurements, tradeModel } from "@/lib/market/trade-models";
import { renderProposalPdf } from "@/lib/pdf/render";
import { buildProposal } from "@/lib/proposal/build";
import { ruleExclusions, ruleScope, guardExclusions } from "@/lib/proposal/generate-rules";
import { buildGenerationInput } from "@/lib/proposal/text-sections";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { getTrade, trades } from "@/lib/trades/catalog";
import { pickerTrades } from "@/lib/trades/picker";
import { est, item } from "./helpers";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function record(over: Partial<CalcRecord> = {}): CalcRecord {
  return { v: 1, calc: "area", output: "sf", input: { sections: [{ id: "s1", shape: "rect", values: { length: "20", width: "10" } }], options: { waste: "0" } }, result: "200", unit: "square foot", appliedAt: "2026-11-13T00:00:00Z", ...over };
}

const init = (): State => ({
  estimate: est({ items: [item("g1", "150", "4", { id: "a", unit: "square foot", name: "Decking installation" }), item("g1", "1", "20", { id: "b" }), item("g2", "1", "30", { id: "c" })] }),
  trash: [],
  dirty: 0,
});

describe("applying a calculation", () => {
  it("changes only the target item's quantity and saves the inputs", () => {
    const before = init();
    const s = reducer(before, { type: "applyCalculation", itemId: "a", record: record() });
    const a = s.estimate.items.find((i) => i.id === "a")!;
    expect(a.quantity).toBe("200");
    expect(a.unitCost).toBe("4"); // pricing untouched
    expect(s.estimate.items).toHaveLength(3); // no new line items
    expect(s.estimate.items.filter((i) => i.id !== "a")).toEqual(before.estimate.items.filter((i) => i.id !== "a"));
    expect(s.estimate.worksheet?.calcs?.a.result).toBe("200");
    expect(s.estimate.worksheet?.calcs?.a.previous).toEqual({ quantity: "150", unit: "square foot" });
    expect(s.dirty).toBe(1);
  });
  it("re-applying replaces the saved calculation instead of duplicating anything", () => {
    let s = reducer(init(), { type: "applyCalculation", itemId: "a", record: record() });
    s = reducer(s, { type: "applyCalculation", itemId: "a", record: record({ result: "220" }) });
    expect(s.estimate.items).toHaveLength(3);
    expect(Object.keys(s.estimate.worksheet!.calcs!)).toEqual(["a"]);
    expect(s.estimate.items.find((i) => i.id === "a")!.quantity).toBe("220");
    expect(s.estimate.worksheet!.calcs!.a.previous!.quantity).toBe("200");
  });
  it("can change the unit when the calculator produced a different unit", () => {
    const s = reducer(init(), { type: "applyCalculation", itemId: "a", record: record({ result: "2", unit: "square", output: "sq" }) });
    const a = s.estimate.items.find((i) => i.id === "a")!;
    expect([a.quantity, a.unit]).toEqual(["2", "square"]);
  });
  it("ignores unknown or example items", () => {
    const st = init();
    st.estimate.items.push(item("g1", "1", "0", { id: "ex", isExample: true }));
    expect(reducer(st, { type: "applyCalculation", itemId: "nope", record: record() })).toBe(st);
    expect(reducer(st, { type: "applyCalculation", itemId: "ex", record: record() })).toBe(st);
  });
  it("manual edits after applying are kept (the calculator never re-applies by itself)", () => {
    let s = reducer(init(), { type: "applyCalculation", itemId: "a", record: record() });
    s = reducer(s, { type: "updateItem", id: "a", patch: { quantity: "210" } });
    expect(s.estimate.items.find((i) => i.id === "a")!.quantity).toBe("210");
    expect(s.estimate.worksheet!.calcs!.a.result).toBe("200");
  });
  it("restore puts the previous quantity back and forgets the inputs", () => {
    let s = reducer(init(), { type: "applyCalculation", itemId: "a", record: record() });
    s = reducer(s, { type: "clearCalculation", itemId: "a", restore: true });
    expect(s.estimate.items.find((i) => i.id === "a")!.quantity).toBe("150");
    expect(s.estimate.worksheet!.calcs!.a).toBeUndefined();
    let t = reducer(init(), { type: "applyCalculation", itemId: "a", record: record() });
    t = reducer(t, { type: "clearCalculation", itemId: "a" });
    expect(t.estimate.items.find((i) => i.id === "a")!.quantity).toBe("200");
  });
  it("does not change pricing formulas: totals match an estimate edited by hand", () => {
    const viaCalc = reducer(init(), { type: "applyCalculation", itemId: "a", record: record() }).estimate;
    const byHand = reducer(init(), { type: "updateItem", id: "a", patch: { quantity: "200" } }).estimate;
    expect(computeEstimate(viaCalc).total.toFixed(2)).toBe(computeEstimate(byHand).total.toFixed(2));
    expect(computeEstimate(viaCalc).total.toFixed(2)).toBe("1062.50"); // (800 + 20 + 30) × 1.25
  });
  it("minimum charge is stored on the worksheet", () => {
    const s = reducer(init(), { type: "setMinimumCharge", value: "175" });
    expect(s.estimate.worksheet?.minimumCharge).toBe("175");
  });
});

describe("saving and reloading calculator inputs", () => {
  const withCalc = (): Estimate => {
    const e = est({ id: U(1), groups: [{ id: U(2), name: "Work", visibility: null, sortOrder: 0 }], items: [item(U(2), "200", "4", { id: U(3), unit: "square foot", name: "Deck area", sortOrder: 0 }), item(U(2), "1", "5", { id: U(4), name: "Screws", sortOrder: 1 })] });
    e.worksheet = { calcs: { [U(3)]: record(), [U(9)]: record() }, minimumCharge: "150" };
    return e;
  };
  it("the save payload validates and prunes calculations for deleted items", () => {
    const e = withCalc();
    expect(estimateSchema.safeParse(e).success).toBe(true);
    const stored = worksheetToStore(e)!;
    expect(Object.keys(stored.calcs!)).toEqual([U(3)]);
    expect(stored.minimumCharge).toBe("150");
    const cfg = proposalConfigSchema.parse({ ...defaultProposalConfig(), worksheet: stored });
    // Round-trip through the stored proposal_config JSON.
    const raw = JSON.parse(JSON.stringify(cfg));
    expect(worksheetFrom(raw)).toEqual(stored);
    expect("worksheet" in proposalConfigFrom(raw)).toBe(false);
  });
  it("empty worksheets are not stored; bad stored data is ignored", () => {
    expect(worksheetToStore({ items: [], worksheet: { calcs: {} } })).toBeNull();
    expect(worksheetToStore({ items: [], worksheet: null })).toBeNull();
    expect(worksheetFrom({ worksheet: { calcs: { "not-a-uuid": 5 } } })).toBeNull();
    expect(worksheetFrom(null)).toBeNull();
  });
  it("rejects oversized or malformed calculation payloads", () => {
    const e = withCalc();
    e.worksheet!.calcs![U(3)] = { ...record(), input: { sections: Array.from({ length: 61 }, (_, i) => ({ id: `s${i}`, shape: "rect", values: {} })), options: {} } };
    expect(estimateSchema.safeParse(e).success).toBe(false);
    const f = withCalc();
    (f.worksheet!.calcs![U(3)] as unknown as { calc: string }).calc = "rm -rf";
    expect(estimateSchema.safeParse(f).success).toBe(false);
  });
  it("saved inputs reproduce the applied quantity after reload", () => {
    const rec = withCalc().worksheet!.calcs![U(3)];
    const reloaded = JSON.parse(JSON.stringify(rec)) as CalcRecord;
    expect(runCalculator(reloaded.calc, reloaded.input, reloaded.output).quantity).toBe(rec.result);
  });
  it("calculator inputs never change the proposal version hash; quantities do", () => {
    const biz = defaultBusinessProfile();
    const cfg = defaultProposalConfig();
    const a = withCalc();
    const b = { ...withCalc(), worksheet: { calcs: {}, minimumCharge: "999" } };
    expect(contentHash(versionSnapshot(a, biz, cfg))).toBe(contentHash(versionSnapshot(b, biz, cfg)));
    const c = withCalc();
    c.items[0] = { ...c.items[0], quantity: "210" };
    expect(contentHash(versionSnapshot(c, biz, cfg))).not.toBe(contentHash(versionSnapshot(a, biz, cfg)));
    // A config that still carries a stale worksheet copy hashes the same too.
    expect(contentHash(versionSnapshot(a, biz, { ...cfg, worksheet: { minimumCharge: "1" } } as typeof cfg))).toBe(contentHash(versionSnapshot(a, biz, cfg)));
  });
});

describe("existing trades keep working (regression)", () => {
  it("every trade still builds a priced-free template and an estimate", () => {
    for (const t of trades) {
      const e = createEstimate(t.slug, { now: new Date("2026-11-13") });
      expect(e.items).toHaveLength(0);
      expect(computeEstimate(e).total.toFixed(2)).toBe("0.00");
      for (const g of t.template.groups) for (const it of g.items) expect(it.unit).toBeTruthy();
    }
  });
  it("every template item maps only to calculators that can produce its unit", () => {
    for (const t of trades) for (const g of t.template.groups) for (const it of g.items) {
      for (const p of calculatorsFor(it, [t.slug])) {
        const r = runCalculator(p.calc, newInput(p), p.output!);
        // A blank calculator never crashes; its unit is the item's unit.
        expect(r.unit === it.unit || r.ok === false).toBe(true);
      }
    }
  });
});

describe("Pressure Washing and Soft Washing trades", () => {
  it("are registered with templates, icons, picker entries and project models", () => {
    for (const slug of ["pressure-washing", "soft-washing"]) {
      const t = getTrade(slug)!;
      expect(t).toBeTruthy();
      expect(t.family).toBe("Exterior");
      expect(t.template.groups.length).toBeGreaterThan(2);
      expect(pickerTrades().some((p) => p.slug === slug)).toBe(true);
      expect(tradeModel(slug).trade).toBe(slug);
    }
    expect(sanitizeMeasurements("soft-washing", { stories: "2", material: "stucco", roof_included: true, junk: "x" })).toEqual({ stories: "2", material: "stucco", roof_included: true });
  });
  it("templates contain no prices", () => {
    for (const slug of ["pressure-washing", "soft-washing"]) {
      const e = createEstimate(slug);
      expect(e.items.every((i) => !i.unitCost)).toBe(true);
    }
  });
  it("scope clarifications: roof cleaning gets a method & safety note, soft washing never specifies chemicals", () => {
    const e = createEstimate("soft-washing");
    const wall = e.groups.find((g) => g.name === "Wall & Siding Cleaning")!;
    const roof = e.groups.find((g) => g.name === "Roof Cleaning")!;
    e.items = [item(wall.id, "2400", "0.2", { name: "House siding soft wash", unit: "square foot" }), item(roof.id, "1800", "0.25", { name: "Roof soft wash", unit: "square foot" })];
    const input = buildGenerationInput(e, { kind: "exclusions", style: "professional" });
    const ex = ruleExclusions(input);
    const cats = ex.map((x) => x.category);
    expect(cats).toContain("roof_method");
    expect(cats).toContain("cleaning_method");
    expect(cats).toContain("water_access");
    expect(cats).not.toContain("demolition");
    expect(ex.every((x) => x.status === "suggested")).toBe(true);
    // The guard keeps clarifications even though the bid includes the roof work.
    expect(guardExclusions(ex, input).kept.map((x) => x.category)).toContain("roof_method");
    const all = ex.map((x) => x.text).join(" ").toLowerCase();
    expect(all).not.toMatch(/\bpsi\b|\d+\s*%|bleach|sodium hypochlorite|mix (ratio )?of \d/);
  });
  it("no roof clarification when the bid has no roof work; included water hauling isn't excluded", () => {
    const e = createEstimate("pressure-washing");
    const g = e.groups.find((x) => x.name === "Cleaning Areas")!;
    const s = e.groups.find((x) => x.name === "Setup & Travel")!;
    e.items = [item(g.id, "600", "0.15", { name: "Driveway cleaning", unit: "square foot" }), item(s.id, "1", "40", { name: "Water supply or hauling", unit: "lump sum" })];
    const cats = ruleExclusions(buildGenerationInput(e, { kind: "exclusions", style: "professional" })).map((x) => x.category);
    expect(cats).not.toContain("roof_method");
    expect(cats).not.toContain("water_access");
    expect(cats).toContain("stain_results");
  });

  for (const slug of ["pressure-washing", "soft-washing"] as const) {
    it(`${slug}: trade selection → calculator → pricing → minimum charge → proposal PDF`, async () => {
      let s: State = { estimate: { ...createEstimate(slug, { now: new Date("2026-11-13"), number: "EST-WASH-1" }), title: slug === "soft-washing" ? "Two-story house wash and roof cleaning" : "Driveway, walkway and patio cleaning", customer: { name: "Jordan Homeowner", projectAddress: "12 Oak Lane" } }, trash: [], dirty: 0 };
      const groupId = s.estimate.groups[0].id;
      const name = slug === "soft-washing" ? "House siding soft wash" : "Driveway cleaning";
      s = reducer(s, { type: "addItem", groupId, newId: "11111111-1111-4111-8111-111111111111", from: { name, unit: "square foot", costType: "labor", quantity: "", description: "Surface: concrete · Condition: heavy buildup" } });
      const it = s.estimate.items[0];
      const preset = calculatorsFor(it, s.estimate.trades)[0];
      const input = newInput(preset);
      if (slug === "soft-washing") {
        // perimeter × height + 2 gables − garage door
        input.sections[0].values = { length: "160", height: "18", count: "1" };
        input.sections[1].values = { base: "28", height: "8", count: "2" };
        input.sections[2].values = { width: "16", height: "7", count: "1" };
      } else {
        input.sections[0].values = { length: "40", width: "20", count: "1" };
        input.sections.push({ id: "walk", shape: "rect", values: { length: "30", width: "4", count: "1" } });
      }
      const r = runCalculator(preset.calc, input, preset.output!);
      expect(r.ok).toBe(true);
      s = reducer(s, { type: "applyCalculation", itemId: it.id, record: { v: 1, calc: preset.calc, output: preset.output!, input, result: r.quantity!, unit: r.unit, appliedAt: "2026-11-13T00:00:00Z" } });
      const qty = slug === "soft-washing" ? "2992" : "920"; // 2880 + 224 − 112 ; 800 + 120
      expect(s.estimate.items[0].quantity).toBe(qty);
      // Contractor-defined rate, quoted directly (0% markup on the section).
      s = reducer(s, { type: "updateItem", id: it.id, patch: { unitCost: "0.15" } });
      s = reducer(s, { type: "updateGroup", id: groupId, patch: { pricingOverride: { mode: "markup", percent: "0" } } });
      s = reducer(s, { type: "addItem", groupId: s.estimate.groups.find((g) => g.name === "Setup & Travel")!.id, from: { name: "Travel charge", unit: "each", costType: "other", quantity: "1", unitCost: "20" } });
      let t = computeEstimate(s.estimate);
      const itemsPrice = Number(qty) * 0.15 + 25; // travel marked up 25%
      expect(Number(t.itemsPrice.toFixed(2))).toBeCloseTo(itemsPrice, 2);
      // Minimum job charge, applied deliberately as a labeled adjustment.
      const minimum = 600;
      s = reducer(s, { type: "setMinimumCharge", value: String(minimum) });
      if (itemsPrice < minimum) {
        s = reducer(s, { type: "patch", patch: { fixedAdjustment: (minimum - itemsPrice).toFixed(2), adjustmentLabel: "Minimum job charge" } });
      }
      t = computeEstimate(s.estimate);
      expect(Number(t.subtotal.toFixed(2))).toBe(Math.max(minimum, itemsPrice));
      expect(estimateSchema.safeParse(s.estimate).success).toBe(true);

      const ex = ruleExclusions(buildGenerationInput(s.estimate, { kind: "exclusions", style: "professional" })).map((x) => ({ ...x, status: "approved" as const }));
      const scope = ruleScope(buildGenerationInput(s.estimate, { kind: "scope", style: "professional" }));
      expect(scope).toContain(name);
      const cfg = { ...defaultProposalConfig(), scopeOfWork: scope, exclusionList: { ...defaultProposalConfig().exclusionList, items: ex } };
      const biz = { ...defaultBusinessProfile(), companyName: "Clearwater Exterior Cleaning", phone: "555-0142" };
      const doc = buildProposal(s.estimate, biz, cfg);
      const pdf = await renderProposalPdf(doc);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loaded = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
      let text = "";
      for (let p = 1; p <= loaded.numPages; p++) text += (await (await loaded.getPage(p)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ") + "\n";
      expect(text).toContain(name);
      expect(text).toContain(formatCurrency(t.total));
      expect(text).not.toMatch(/worksheet|calculator|appliedAt/i);
      if (process.env.CALC_PDF_DIR) {
        mkdirSync(process.env.CALC_PDF_DIR, { recursive: true });
        writeFileSync(`${process.env.CALC_PDF_DIR}/${slug}-proposal.pdf`, pdf);
      }
    }, 30_000);
  }
});
