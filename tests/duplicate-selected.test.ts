import { describe, expect, it } from "vitest";
import { reducer, type State } from "@/components/builder/state";
import { computeEstimate } from "@/lib/estimate/engine";
import { est, item } from "./helpers";
import type { CalcRecord } from "@/lib/calculators/types";

const calc = { calculatorId: "area", inputs: { length: "10", width: "12" }, result: "120", unit: "square foot" } as unknown as CalcRecord;

const init = (): State => ({
  estimate: est({
    pricing: { mode: "markup", percent: "30" },
    items: [
      item("g1", "2", "10", { id: "a", name: "Joists", description: "2x10 PT", category: "Framing", costType: "labor_material", unit: "linear foot", pricingOverride: { mode: "margin", percent: "40" }, taxable: false, notes: "n" }),
      item("g1", "1", "20", { id: "b", name: "Footings" }),
      item("g2", "3", "30", { id: "c", name: "Railing" }),
      item("g2", "1", "0", { id: "x", name: "Example", isExample: true }),
    ],
    worksheet: { calcs: { a: calc } },
  }),
  trash: [],
  dirty: 0,
});

const order = (s: State, g: string) => s.estimate.items.filter((i) => i.groupId === g).sort((p, q) => p.sortOrder - q.sortOrder);

describe("Duplicate Selected", () => {
  it("duplicates one row directly below its original with a new id and every field kept", () => {
    const before = init();
    const s = reducer(before, { type: "duplicateItems", ids: ["a"] });
    const g1 = order(s, "g1");
    expect(g1.map((i) => i.name)).toEqual(["Joists", "Joists", "Footings"]);
    const [orig, copy] = g1;
    expect(orig.id).toBe("a");
    expect(copy.id).not.toBe("a");
    const { id: _a, sortOrder: _s1, ...origRest } = orig;
    const { id: _b, sortOrder: _s2, ...copyRest } = copy;
    void _a; void _b; void _s1; void _s2;
    expect(copyRest).toEqual(origRest);
    // The override is a separate object, so editing one row can't change the other.
    expect(copy.pricingOverride).not.toBe(orig.pricingOverride);
    expect(s.dirty).toBe(1); // autosave picks it up
  });

  it("duplicates several rows across sections, each below its own original, originals unchanged", () => {
    const before = init();
    const s = reducer(before, { type: "duplicateItems", ids: ["a", "b", "c"] });
    expect(order(s, "g1").map((i) => i.name)).toEqual(["Joists", "Joists", "Footings", "Footings"]);
    expect(order(s, "g2").map((i) => i.name)).toEqual(["Railing", "Railing", "Example"]);
    expect(new Set(s.estimate.items.map((i) => i.id)).size).toBe(s.estimate.items.length);
    for (const o of before.estimate.items) expect(s.estimate.items.find((i) => i.id === o.id)).toMatchObject({ ...o, sortOrder: expect.any(Number) });
  });

  it("keeps pricing accurate: each copy prices exactly like its original", () => {
    const before = init();
    const t0 = computeEstimate(before.estimate);
    const s = reducer(before, { type: "duplicateItems", ids: ["a", "c"] });
    const t1 = computeEstimate(s.estimate);
    const copyA = order(s, "g1")[1];
    expect(t1.items[copyA.id].extendedPrice.toFixed(2)).toBe(t0.items.a.extendedPrice.toFixed(2));
    expect(t1.items[copyA.id].appliedRule).toEqual({ mode: "margin", percent: "40" });
    const expected = t0.subtotal.plus(t0.items.a.extendedPrice).plus(t0.items.c.extendedPrice);
    expect(t1.subtotal.toFixed(2)).toBe(expected.toFixed(2));
  });

  it("copies a quantity calculation to the new row only", () => {
    const s = reducer(init(), { type: "duplicateItems", ids: ["a"] });
    const copy = order(s, "g1")[1];
    expect(s.estimate.worksheet?.calcs?.[copy.id]).toEqual(calc);
    expect(s.estimate.worksheet?.calcs?.[copy.id]).not.toBe(s.estimate.worksheet?.calcs?.a);
    expect(s.estimate.worksheet?.calcs?.a).toEqual(calc);
  });

  it("skips example rows and ignores an empty selection", () => {
    const st = init();
    expect(reducer(st, { type: "duplicateItems", ids: ["x"] })).toBe(st);
    expect(reducer(st, { type: "duplicateItems", ids: [] })).toBe(st);
  });

  it("Remove Override returns selected rows to the estimate pricing", () => {
    const s = reducer(init(), { type: "bulkOverride", ids: ["a", "b"], rule: null });
    expect(s.estimate.items.find((i) => i.id === "a")!.pricingOverride).toBeNull();
    expect(computeEstimate(s.estimate).items.a.appliedRule).toEqual({ mode: "markup", percent: "30" });
  });
});
