import { describe, expect, it } from "vitest";
import { CALCULATORS, calculatorsFor, newInput, newSection, runCalculator } from "@/lib/calculators";
import { createEstimate } from "@/lib/estimate/factory";
import { getTrade } from "@/lib/trades/catalog";
import { cleanFrom, cleanPercent, cleanQuantity, marginFromMarkup, markupFromMargin, priceFrom, quantityToolForTrade, TOOLS, toolBySlug, type QuantityTool } from "@/lib/marketing/tools";
import { applyToolPricing, applyToolQuantity } from "@/lib/marketing/tool-handoff";
import { pageType } from "@/lib/analytics/track";

const quantityTools = TOOLS.filter((t): t is QuantityTool => t.kind === "quantity");

describe("V8 free calculators: catalog", () => {
  it("has unique slugs and the four batch-3 tools", () => {
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(TOOLS.length);
    expect(TOOLS.map((t) => t.slug).sort()).toEqual(["concrete-calculator", "deck-board-calculator", "markup-margin-calculator", "roofing-calculator"]);
  });

  it.each(quantityTools.map((t) => [t.slug, t] as const))("%s matches the builder calculator for its line item", (_slug, t) => {
    const def = CALCULATORS[t.calc];
    expect(def.outputs.find((o) => o.id === t.output)?.unit).toBe(t.item.unit);
    for (const s of t.shapes) expect(def.shapes.some((x) => x.id === s)).toBe(true);
    const trade = getTrade(t.trade)!;
    const item = trade.template.groups.flatMap((g) => g.items).find((i) => i.name === t.item.name);
    expect(item, "template item exists").toBeDefined();
    expect(item!.unit).toBe(t.item.unit);
    // The builder offers this same calculator on that line, so the result can be reopened there.
    expect(calculatorsFor(item!, [t.trade]).map((p) => p.calc)).toContain(t.calc);
    expect(quantityToolForTrade(t.trade)).toBe(t);
  });

  it("FAQ math is right", () => {
    // 10 × 10 ft slab at 4 in → 1.235 CY, rounded up to 1.24.
    const input = newInput({ calc: "volume", shape: "slab" });
    input.sections[0].values = { length: "10", width: "10", thickness: "4", count: "1" };
    expect(runCalculator("volume", input, "cy").quantity).toBe("1.24");
    expect(marginFromMarkup(25)).toBe(20);
    expect(markupFromMargin(20)).toBe(25);
  });
});

describe("V8 free calculators: inputs from the URL", () => {
  it("accepts only sane quantities", () => {
    expect(cleanQuantity("12.5")).toBe("12.5");
    expect(cleanQuantity("0012")).toBe("12");
    for (const bad of ["0", "-1", "abc", "1e5", "2000000", "1.23456", "", undefined, ["3"]]) expect(cleanQuantity(bad as string)).toBeNull();
  });
  it("accepts only sane percentages", () => {
    expect(cleanPercent("25", "markup")).toBe("25");
    expect(cleanPercent("96", "margin")).toBeNull();
    expect(cleanPercent("1001", "markup")).toBeNull();
    expect(cleanPercent("x", "markup")).toBeNull();
  });
  it("keeps ?from= to a short safe label", () => {
    expect(cleanFrom("Trade-Concrete")).toBe("trade-concrete");
    expect(cleanFrom("fb")).toBe("fb");
    expect(cleanFrom("a@b.com")).toBeUndefined();
    expect(cleanFrom("<script>")).toBeUndefined();
    expect(cleanFrom(undefined)).toBeUndefined();
  });
});

describe("V8 free calculators: markup math", () => {
  it("prices from markup and from margin", () => {
    expect(priceFrom(10000, "markup", 25)).toEqual({ price: 12500, profit: 2500, markup: 25, margin: 20 });
    expect(priceFrom(10000, "margin", 20)).toEqual({ price: 12500, profit: 2500, markup: 25, margin: 20 });
    expect(priceFrom(100, "margin", 100)).toBeNull();
    expect(priceFrom(-1, "markup", 10)).toBeNull();
  });
});

describe("V8 free calculators: Send this as a bid", () => {
  const concrete = toolBySlug("concrete-calculator") as QuantityTool;
  const slabInput = () => {
    const input = newInput({ calc: "volume", shape: "slab" });
    input.sections[0].values = { length: "20", width: "24", thickness: "4", count: "1" };
    return input;
  };

  it("adds one unpriced line with the quantity in the matching section", () => {
    const trade = getTrade("concrete")!;
    const e = applyToolQuantity(createEstimate("concrete"), trade.template, concrete, "5.93");
    expect(e.items).toHaveLength(1);
    const line = e.items[0];
    expect(line).toMatchObject({ name: "Ready-mix concrete", unit: "cubic yard", quantity: "5.93", unitCost: "", costType: "material" });
    expect(e.groups.find((g) => g.id === line.groupId)?.name).toBe("Concrete");
    expect(e.worksheet?.calcs).toBeUndefined();
  });

  it("keeps the measurements on the line when they produce the same quantity", () => {
    const trade = getTrade("concrete")!;
    const input = slabInput();
    const q = runCalculator("volume", input, "cy").quantity!;
    const e = applyToolQuantity(createEstimate("concrete"), trade.template, concrete, q, { tool: concrete.slug, quantity: q, input });
    const rec = e.worksheet?.calcs?.[e.items[0].id];
    expect(rec).toMatchObject({ v: 1, calc: "volume", output: "cy", result: q, unit: "cubic yard" });
  });

  it("drops measurements that don't match the quantity or are malformed", () => {
    const trade = getTrade("concrete")!;
    const input = slabInput();
    const a = applyToolQuantity(createEstimate("concrete"), trade.template, concrete, "99", { tool: concrete.slug, quantity: "99", input });
    expect(a.worksheet?.calcs).toBeUndefined();
    const b = applyToolQuantity(createEstimate("concrete"), trade.template, concrete, "1", { tool: concrete.slug, quantity: "1", input: { sections: "x" } as never });
    expect(b.worksheet?.calcs).toBeUndefined();
    const extra = { ...input, sections: [...input.sections, newSection("slab")] };
    const c = applyToolQuantity(createEstimate("concrete"), trade.template, concrete, "1", { tool: "roofing-calculator", quantity: "1", input: extra });
    expect(c.worksheet?.calcs).toBeUndefined();
    expect(c.items[0].quantity).toBe("1");
  });

  it("falls back to a same-unit item when a published template renamed it", () => {
    const trade = getTrade("concrete")!;
    const renamed = { ...trade.template, groups: trade.template.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.name === "Ready-mix concrete" ? { ...i, name: "Concrete, 4000 psi" } : i)) })) };
    const e = applyToolQuantity(createEstimate("concrete", { template: renamed }), renamed, concrete, "3");
    // Excavation is also in cubic yards and comes first; either way the unit and quantity are right and no price is set.
    expect(e.items[0]).toMatchObject({ unit: "cubic yard", quantity: "3", unitCost: "" });
  });

  it("starts with the chosen markup or margin", () => {
    expect(applyToolPricing(createEstimate("general-contracting"), "margin", "20").pricing).toEqual({ mode: "margin", percent: "20" });
  });

  it("reports /tools as its own page family", () => {
    expect(pageType("/tools")).toBe("tools");
    expect(pageType("/tools/roofing-calculator")).toBe("tools");
  });
});

const PROHIBITED = [/win \d+% more/i, /increase revenue by/i, /reduce estimating time by/i, /save \d+ hours/i, /guaranteed/i, /pay for itself/i, /trusted by (thousands|\d)/i, /\d[\d,]*\+? (contractors|users|customers)/i, /5[- ]star/i, /award/i, /aggregateRating/i];
describe("V8 free calculators make no unsupported claims", () => {
  it("contains none of the prohibited claim patterns", () => {
    const text = JSON.stringify(TOOLS);
    for (const re of PROHIBITED) expect(text, String(re)).not.toMatch(re);
  });
});
