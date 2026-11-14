import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/lib/estimate/engine";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { estimateOptionsToStore, proposalConfigFrom, roundTotalFrom } from "@/lib/data/mappers";
import { lineItemSchema } from "@/lib/estimate/schema";
import { classifyItem, fingerprintOf } from "@/lib/market/classify";
import { COST_TYPES } from "@/lib/trades/catalog";
import { reducer } from "@/components/builder/state";
import {
  categoryOptions, findSameItem, libraryOpSchema, lineContext, lineFromSaved, matchesQuery, organizeLibrary, savedItemFromLine, type SavedItem,
} from "@/lib/library/saved-items";
import { est, item } from "./helpers";

const saved = (p: Partial<SavedItem>): SavedItem => ({ id: crypto.randomUUID(), name: "Item", costType: "labor", treatment: "marked_up", unit: "square foot", unitCost: "", taxable: false, ...p });

describe("final bid rounding", () => {
  // 4,900.02 calculated: 4,083.35 cost at 20% markup = 4,900.02.
  const base = () => est({ pricing: { mode: "markup", percent: "20" }, items: [item("g1", "1", "4083.35")] });

  it("off: keeps the exact total to the cent", () => {
    const t = computeEstimate(base());
    expect(t.total.toFixed(2)).toBe("4900.02");
    expect(t.calculatedTotal.toFixed(2)).toBe("4900.02");
    expect(t.rounding.isZero()).toBe(true);
  });

  it("on: $4,900.02 becomes $4,900.00 with a -$0.02 rounding adjustment, nothing else changes", () => {
    const off = computeEstimate(base());
    const on = computeEstimate({ ...base(), roundTotal: true });
    expect(on.total.toFixed(2)).toBe("4900.00");
    expect(on.rounding.toFixed(2)).toBe("-0.02");
    expect(on.calculatedTotal.toFixed(2)).toBe("4900.02");
    for (const k of ["totalCost", "subtotal", "tax", "grossProfit", "itemsPrice"] as const) expect(on[k].toFixed(2), k).toBe(off[k].toFixed(2));
    expect(Object.values(on.items).map((i) => i.extendedPrice.toFixed(2))).toEqual(Object.values(off.items).map((i) => i.extendedPrice.toFixed(2)));
  });

  it("rounds half up after tax", () => {
    const e = { ...est({ taxRate: "10", items: [item("g1", "1", "100", { taxable: true })] }), pricing: { mode: "markup" as const, percent: "0.5" }, roundTotal: true };
    const t = computeEstimate(e); // 100.50 + 10.05 tax = 110.55
    expect(t.calculatedTotal.toFixed(2)).toBe("110.55");
    expect(t.total.toFixed(2)).toBe("111.00");
    expect(t.rounding.toFixed(2)).toBe("0.45");
  });

  it("the proposal (and so the PDF) shows the rounding line and the rounded total; payment schedule sums to it", () => {
    const cfg = { ...defaultProposalConfig(), paymentSchedule: [{ label: "Deposit", percent: "50" }, { label: "Completion", percent: "50" }] };
    const doc = buildProposal({ ...base(), roundTotal: true }, defaultBusinessProfile(), cfg);
    expect(doc.pricing.total).toBe("$4,900.00");
    expect(doc.pricing.rounding).toEqual({ label: "Rounding", amount: "-$0.02" });
    expect(doc.pricing.subtotal).toBe("$4,900.02");
    expect(doc.paymentSchedule.map((m) => m.amount)).toEqual(["$2,450.00", "$2,450.00"]);
    const plain = buildProposal(base(), defaultBusinessProfile(), cfg);
    expect(plain.pricing.rounding).toBeUndefined();
    expect(plain.pricing.total).toBe("$4,900.02");
  });

  it("existing estimates keep their version hash (rounding off = no change to the snapshot)", () => {
    const e = base();
    const cfg = defaultProposalConfig();
    const h = contentHash(versionSnapshot(e, defaultBusinessProfile(), cfg));
    expect(contentHash(versionSnapshot({ ...e, roundTotal: undefined }, defaultBusinessProfile(), cfg))).toBe(h);
    expect(contentHash(versionSnapshot({ ...e, roundTotal: true }, defaultBusinessProfile(), cfg))).not.toBe(h);
  });

  it("is stored per project in proposal_config and defaults to off", () => {
    expect(estimateOptionsToStore({ roundTotal: true })).toEqual({ roundTotal: true });
    expect(estimateOptionsToStore({})).toEqual({});
    expect(roundTotalFrom({ roundTotal: true })).toBe(true);
    expect(roundTotalFrom({ template: "classic" })).toBe(false);
    expect(roundTotalFrom(null)).toBe(false);
    expect("roundTotal" in proposalConfigFrom({ roundTotal: true })).toBe(false);
  });
});

describe("Labor / Material line-item type", () => {
  it("is offered after Labor and keeps every existing type", () => {
    const values = COST_TYPES.map((c) => c.value);
    expect(values).toEqual(["material", "labor", "labor_material", "equipment", "subcontractor", "overhead", "contingency", "permit", "delivery", "labor_burden", "other"]);
    expect(COST_TYPES.find((c) => c.value === "labor_material")?.label).toBe("Labor / Material");
  });

  it("validates, and changing Type never changes the price", () => {
    const row = item("g1", "20", "95", { name: "Tear Off Existing Roofing", costType: "labor" });
    expect(lineItemSchema.shape.costType.safeParse("labor_material").success).toBe(true);
    const before = computeEstimate(est({ items: [row] }));
    const after = computeEstimate(est({ items: [{ ...row, costType: "labor_material" }] }));
    expect(after.total.toFixed(2)).toBe(before.total.toFixed(2));
    expect(after.totalCost.toFixed(2)).toBe(before.totalCost.toFixed(2));
  });

  it("is counted once and kept out of both the labor and material benchmarks", () => {
    const c = classifyItem({ name: "Tear off and install shingles labor", costType: "labor_material", unit: "square" });
    expect(c.costClass).toBe("other");
    expect(fingerprintOf({ name: "x", costType: "labor_material" })).toContain("::other");
    // "Other" is still re-guessed from the wording; a deliberate Labor / Material choice is not.
    expect(classifyItem({ name: "Install labor", costType: "other", unit: "hour" }).costClass).toBe("labor");
  });

  it("survives Save Item and comes back with the same classification", () => {
    const row = item("g1", "20", "95", { name: "Tear Off Existing Roofing", costType: "labor_material" });
    const s = savedItemFromLine(row, { trade: "roofing", category: "Tear Off" }, crypto.randomUUID());
    expect(s.costType).toBe("labor_material");
    expect(lineFromSaved(s).costType).toBe("labor_material");
  });
});

describe("Saved Items library helpers", () => {
  it("Save Item files a row under its section's trade and category with its rate and quantity", () => {
    const e = est({ trades: ["framing"], groups: [{ id: "g1", name: "Framing Labor", visibility: null, sortOrder: 0, trade: "framing" }] });
    const row = item("g1", "300", "8", { name: "Framing Labor" });
    const ctx = lineContext(e, e.groups[0]);
    expect(ctx).toEqual({ trade: "framing", category: "Framing Labor" });
    const s = savedItemFromLine(row, ctx, "id1");
    expect(s).toMatchObject({ name: "Framing Labor", trade: "framing", category: "Framing Labor", unitCost: "8", quantity: "300", unit: row.unit });
  });

  it("Complete Framing at $18/sq. ft. fills in automatically when added; the row is a copy", () => {
    const s = saved({ name: "Complete Framing", unitCost: "18", unit: "square foot", trade: "framing", category: "Complete Framing" });
    const from = lineFromSaved(s);
    expect(from).toMatchObject({ name: "Complete Framing", unitCost: "18", unit: "square foot", quantity: "1" });
    const e1 = reducer({ estimate: est({ items: [] }), trash: [], dirty: 0 }, { type: "addItem", groupId: "g1", from }).estimate;
    const added = e1.items[0];
    expect(added.unitCost).toBe("18");
    // Later library edits can't reach the estimate: nothing references the saved item.
    s.unitCost = "25";
    expect(e1.items[0].unitCost).toBe("18");
    expect(JSON.stringify(added)).not.toContain(s.id);
  });

  it("re-saving the same name in the same trade updates instead of duplicating", () => {
    const items = [saved({ name: "Tear Off", trade: "roofing" }), saved({ name: "Tear Off", trade: "decks" })];
    expect(findSameItem(items, { name: " tear off ", trade: "roofing" })).toBe(items[0]);
    expect(findSameItem(items, { name: "Tear Off", trade: null })).toBeUndefined();
  });

  it("organizes by trade, then category in the trade's section order", () => {
    const list = [
      saved({ name: "Shingles bundle", trade: "roofing", category: "Shingles" }),
      saved({ name: "Tear off", trade: "roofing", category: "Tear-off" }),
      saved({ name: "Ice shield", trade: "roofing", category: "Underlayment" }),
      saved({ name: "Mileage", trade: null }),
      saved({ name: "Deck boards", trade: "decks", category: "Decking" }),
    ];
    const org = organizeLibrary(list, ["roofing"]);
    expect(org.map((t) => t.name)).toEqual(["Roofing", "Decks", "General"].map((n) => org.find((t) => t.name.startsWith(n.slice(0, 4)))!.name));
    expect(org[0].trade).toBe("roofing");
    expect(org.at(-1)!.name).toBe("General");
    expect(org.at(-1)!.categories[0].name).toBe("Uncategorized");
  });

  it("category suggestions reuse the trade's existing sections", () => {
    const opts = categoryOptions("roofing");
    expect(opts.length).toBeGreaterThan(2);
    expect(opts).toContain("Labor");
    expect(new Set(opts.map((o) => o.toLowerCase())).size).toBe(opts.length);
  });

  it("search matches name, category and trade", () => {
    const s = saved({ name: "Ridge vent", trade: "roofing", category: "Ventilation" });
    expect(matchesQuery(s, "vent")).toBe(true);
    expect(matchesQuery(s, "roof")).toBe(true);
    expect(matchesQuery(s, "deck")).toBe(false);
  });

  it("API payloads are validated (Type, rate, names)", () => {
    const ok = { kind: "item", action: "add", payload: saved({ name: "Complete Framing", unitCost: "18", costType: "labor_material" }) };
    expect(libraryOpSchema.safeParse(ok).success).toBe(true);
    expect(libraryOpSchema.safeParse({ ...ok, payload: { ...ok.payload, costType: "bogus" } }).success).toBe(false);
    expect(libraryOpSchema.safeParse({ ...ok, payload: { ...ok.payload, unitCost: "-5" } }).success).toBe(false);
    expect(libraryOpSchema.safeParse({ ...ok, payload: { ...ok.payload, name: "  " } }).success).toBe(false);
    expect(libraryOpSchema.safeParse({ kind: "stack", action: "add", payload: { id: crypto.randomUUID(), name: "S", items: [] } }).success).toBe(false);
  });
});
