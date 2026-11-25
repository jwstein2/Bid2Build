import { describe, expect, it } from "vitest";
import { STARTER_ASSEMBLIES, calculatorMeasures, convertMeasure, perFromQuantities, perLabel, scaleStack, scaledQuantity, starterStack, startersFor } from "@/lib/library/assemblies";
import { libraryOpSchema, savedStackSchema } from "@/lib/library/saved-items";
import { getTrade } from "@/lib/trades/catalog";

describe("scaling assemblies", () => {
  it("scales by measure, adds waste, rounds up to whole units only when asked", () => {
    expect(scaledQuantity({ quantity: "1", per: "3", wastePct: "10", roundUp: true }, "24")).toBe("80"); // 79.2 bundles
    expect(scaledQuantity({ quantity: "1", per: "1" }, "24.5")).toBe("24.5");
    expect(scaledQuantity({ quantity: "1", per: "0.012346", wastePct: "5" }, "400")).toBe("5.19");
    // Ratio noise never adds a unit: 350 SF at 1/350 per SF is exactly 1 gallon.
    expect(scaledQuantity({ quantity: "1", per: "0.0028571428", roundUp: true }, "350")).toBe("1");
    // Fixed rows keep their quantity; a bad measure gives 0, never NaN.
    expect(scaledQuantity({ quantity: "2" }, "100")).toBe("2");
    expect(scaledQuantity({ quantity: "1", per: "1" }, "abc")).toBe("0");
  });

  it("converts area units and refuses mismatched ones", () => {
    expect(convertMeasure("2450", "square foot", "square")).toBe("24.5");
    expect(convertMeasure("24.5", "square", "square foot")).toBe("2450");
    expect(convertMeasure("9", "square foot", "square yard")).toBe("1");
    expect(convertMeasure("10", "linear foot", "square foot")).toBeNull();
    expect(convertMeasure("-1", "square", "square")).toBeNull();
  });

  it("derives per-unit amounts from saved quantities", () => {
    expect(perFromQuantities([{ quantity: "72" }, { quantity: "24" }, { quantity: "" }], "24")).toEqual(["3", "1", "0.041667"]);
    expect(perFromQuantities([{ quantity: "5" }], "0")).toEqual([undefined]);
  });

  it("offers measurements already worked out by calculators in this estimate, converted", () => {
    const estimate = {
      items: [{ id: "a", name: "Architectural shingles" }, { id: "b", name: "Siding panels" }, { id: "c", name: "Ridge" }],
      worksheet: { calcs: {
        a: { v: 1 as const, calc: "roof" as const, output: "sq", input: { sections: [], options: {} }, result: "24.5", unit: "square", appliedAt: "" },
        b: { v: 1 as const, calc: "area" as const, output: "sf", input: { sections: [], options: {} }, result: "1800", unit: "square foot", appliedAt: "" },
        c: { v: 1 as const, calc: "linear" as const, output: "lf", input: { sections: [], options: {} }, result: "40", unit: "linear foot", appliedAt: "" },
      } },
    };
    const sq = calculatorMeasures(estimate, "square");
    expect(sq.map((m) => m.converted)).toEqual(["24.5", "18"]);
    expect(sq[0].label).toMatch(/Roof planes on “Architectural shingles”/);
    expect(calculatorMeasures(estimate, "cubic yard")).toEqual([]);
  });

  it("starter assemblies use real trade sections, have no prices, and pass the stack schema", () => {
    expect(STARTER_ASSEMBLIES.map((s) => s.trade)).toEqual(["roofing", "siding", "painting", "decks", "concrete", "tree-removal", "tree-trimming", "pest-control"]);
    for (const s of STARTER_ASSEMBLIES) {
      const sections = getTrade(s.trade!)!.template.groups.map((g) => g.name);
      const stack = starterStack(s);
      expect(stack.items.every((i) => i.unitCost === "")).toBe(true);
      expect(stack.items.every((i) => sections.includes(i.category!))).toBe(true);
      expect(savedStackSchema.safeParse(stack).success).toBe(true);
      const rows = scaleStack(stack, "100");
      expect(rows.every((r) => Number(r.quantity) >= 0)).toBe(true);
    }
    expect(startersFor("concrete")[0].trade).toBe("concrete");
  });

  it("labels rows and validates scale ops", () => {
    expect(perLabel({ quantity: "1", unit: "bundle", per: "3", wastePct: "10", roundUp: true }, { unit: "square", label: "Roof area" })).toBe("3 bdl per sq (+10% waste, round up)");
    expect(perLabel({ quantity: "1", unit: "each" }, { unit: "square", label: "Roof area" })).toBe("1 ea (fixed)");
    const id = "00000000-0000-4000-8000-000000000001";
    expect(libraryOpSchema.safeParse({ kind: "stack", action: "scale", payload: { id, scale: { unit: "square", label: "Roof" }, items: [{ id, per: "3", wastePct: "10", roundUp: true }] } }).success).toBe(true);
    expect(libraryOpSchema.safeParse({ kind: "stack", action: "scale", payload: { id, scale: { unit: "acre", label: "x" }, items: [] } }).success).toBe(false);
    expect(libraryOpSchema.safeParse({ kind: "stack", action: "scale", payload: { id, scale: null, items: [{ id, wastePct: "150" }] } }).success).toBe(false);
    expect(libraryOpSchema.safeParse({ kind: "item", action: "favorite", payload: { id, on: true } }).success).toBe(true);
  });
});

describe("stacks built on Saved Items & Pricing", () => {
  const item = { id: "11111111-1111-4111-8111-111111111111", name: "Dumpster", trade: "roofing", category: "Tear-Off", costType: "other" as const, treatment: "pass_through" as const, unit: "each", unitCost: "450", taxable: false, quantity: "", pricingOverride: { mode: "markup" as const, percent: "10" } };

  it("copies a saved item into a stack row with quantity 1 by default and no markup on billed-at-cost items", async () => {
    const { stackRowFromSaved } = await import("@/lib/library/saved-items");
    const r = stackRowFromSaved(item, "22222222-2222-4222-8222-222222222222");
    expect(r).toMatchObject({ id: "22222222-2222-4222-8222-222222222222", name: "Dumpster", unit: "each", unitCost: "450", quantity: "1", pricingOverride: null });
    expect(stackRowFromSaved({ ...item, quantity: " 2 " }).quantity).toBe("2");
  });

  it("lists what stops a stack from saving", async () => {
    const { stackDraftProblems } = await import("@/lib/library/saved-items");
    expect(stackDraftProblems({ name: "", items: [] })).toEqual(["Give the stack a name.", "Add at least one saved item."]);
    expect(stackDraftProblems({ name: "Demo", items: [{ quantity: "2" }] })).toEqual([]);
    expect(stackDraftProblems({ name: "Demo", items: [{ quantity: "0" }] })).toContain("Quantities must be numbers above 0.");
    expect(stackDraftProblems({ name: "Demo", items: [{ quantity: "1", per: "x" }], scale: { unit: "square", label: "Roof" } }).length).toBe(1);
    expect(stackDraftProblems({ name: "Demo", items: [{ quantity: "1", per: "3", wastePct: "10" }], scale: { unit: "square", label: "Roof" } })).toEqual([]);
  });

  it("accepts a stack update and never lets it change sharing", () => {
    const payload = { id: "33333333-3333-4333-8333-333333333333", name: "Demo", trade: null, scale: null, items: [{ ...item, quantity: "1" }], company: true };
    const parsed = libraryOpSchema.parse({ kind: "stack", action: "update", payload });
    expect(parsed.action).toBe("update");
    expect("company" in parsed.payload).toBe(false);
  });
});
