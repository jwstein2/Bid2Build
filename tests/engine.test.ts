import { describe, expect, it } from "vitest";
import { computeEstimate, pricingFactor, priceFromCost, grossMarginPct, markupPct } from "@/lib/estimate/engine";
import { D, formatCurrency, toDec } from "@/lib/estimate/money";
import { createEstimate } from "@/lib/estimate/factory";
import { est, item } from "./helpers";

const s = (d: { toFixed: (n: number) => string }) => d.toFixed(2);

describe("1. markup calculations", () => {
  it("applies Cost × (1 + markup/100)", () => {
    expect(s(priceFromCost(new D(100), { mode: "markup", percent: "25" }))).toBe("125.00");
    expect(s(priceFromCost(new D(80), { mode: "markup", percent: "0" }))).toBe("80.00");
    expect(s(priceFromCost(new D(50), { mode: "markup", percent: "100" }))).toBe("100.00");
  });
  it("25% markup is a 20% margin, not 25%", () => {
    const e = est({ items: [item("g1", "1", "100")] });
    const t = computeEstimate(e);
    expect(s(t.subtotal)).toBe("125.00");
    expect(s(t.grossProfit)).toBe("25.00");
    expect(t.grossMargin!.toFixed(2)).toBe("20.00");
    expect(t.effectiveMarkup!.toFixed(2)).toBe("25.00");
  });
  it("rejects markup below -100%", () => {
    expect(pricingFactor({ mode: "markup", percent: "-150" }).valid).toBe(false);
  });
});

describe("2. margin calculations", () => {
  it("applies Cost / (1 - margin/100)", () => {
    expect(s(priceFromCost(new D(100), { mode: "margin", percent: "20" }))).toBe("125.00");
    expect(s(priceFromCost(new D(60), { mode: "margin", percent: "40" }))).toBe("100.00");
    expect(s(priceFromCost(new D(60), { mode: "margin", percent: "0" }))).toBe("60.00");
  });
  it("achieves the target margin on the estimate", () => {
    const e = est({ pricing: { mode: "margin", percent: "35" }, items: [item("g1", "10", "65")] });
    const t = computeEstimate(e);
    expect(s(t.subtotal)).toBe("1000.00");
    expect(t.grossMargin!.toFixed(2)).toBe("35.00");
  });
  it("100% margin is rejected instead of dividing by zero", () => {
    const f = pricingFactor({ mode: "margin", percent: "100" });
    expect(f.valid).toBe(false);
    const t = computeEstimate(est({ pricing: { mode: "margin", percent: "100" }, items: [item("g1", "1", "10")] }));
    expect(t.issues.some((i) => i.code === "margin_too_high")).toBe(true);
    expect(t.subtotal.isFinite()).toBe(true);
  });
  it("markup and margin are mutually exclusive modes (one rule per item)", () => {
    const t = computeEstimate(est({ pricing: { mode: "margin", percent: "20" }, items: [item("g1", "1", "100")] }));
    expect(s(t.subtotal)).toBe("125.00"); // not 100*1.2/0.8
  });
  it("metric helpers handle division by zero", () => {
    expect(grossMarginPct(new D(0), new D(0))).toBeNull();
    expect(markupPct(new D(10), new D(0))).toBeNull();
  });
});

describe("3. group totals", () => {
  it("each group has its own cost, price and profit; project = sum", () => {
    const e = est({
      items: [item("g1", "3", "10"), item("g1", "2", "7.5"), item("g2", "4", "50")],
    });
    const t = computeEstimate(e);
    expect(s(t.groups.g1.cost)).toBe("45.00");
    expect(s(t.groups.g1.price)).toBe("56.26"); // 3×12.50 + 2×9.38
    expect(s(t.groups.g2.price)).toBe("250.00");
    expect(s(t.itemsPrice)).toBe(s(t.groups.g1.price.plus(t.groups.g2.price)));
    expect(s(t.totalCost)).toBe("245.00");
  });
  it("extended price = qty × printed unit price (rounding rule)", () => {
    const t = computeEstimate(est({ items: [item("g1", "3", "0.333", { id: "x" })] }));
    expect(s(t.items.x.unitPrice)).toBe("0.42");
    expect(s(t.items.x.extendedPrice)).toBe("1.26");
  });
});

describe("4. tax", () => {
  it("taxes only taxable items and separates tax from revenue", () => {
    const e = est({
      taxRate: "7",
      items: [item("g1", "1", "100", { taxable: true }), item("g2", "1", "100", { taxable: false })],
    });
    const t = computeEstimate(e);
    expect(s(t.subtotal)).toBe("250.00");
    expect(s(t.taxableBase)).toBe("125.00");
    expect(s(t.tax)).toBe("8.75");
    expect(s(t.total)).toBe("258.75");
    expect(s(t.grossProfit)).toBe("50.00"); // tax is not profit
  });
  it("allocates a discount proportionally to the taxable base", () => {
    const e = est({
      taxRate: "10",
      fixedAdjustment: "-50",
      items: [item("g1", "1", "100", { taxable: true }), item("g2", "1", "100", { taxable: false })],
    });
    const t = computeEstimate(e);
    expect(s(t.subtotal)).toBe("200.00");
    expect(s(t.taxableBase)).toBe("100.00");
    expect(s(t.tax)).toBe("10.00");
  });
  it("rejects invalid tax rates", () => {
    const t = computeEstimate(est({ taxRate: "150", items: [item("g1", "1", "10")] }));
    expect(t.issues.some((i) => i.code === "invalid_tax")).toBe(true);
    expect(t.tax.isZero()).toBe(true);
  });
  it("discount can never make the price negative", () => {
    const t = computeEstimate(est({ fixedAdjustment: "-1000", items: [item("g1", "1", "10")] }));
    expect(s(t.subtotal)).toBe("0.00");
  });
});

describe("5. percentage overrides", () => {
  it("item override beats group override beats estimate rule", () => {
    const e = est({
      pricing: { mode: "markup", percent: "10" },
      groups: [
        { id: "g1", name: "A", visibility: null, sortOrder: 0, pricingOverride: { mode: "margin", percent: "50" } },
        { id: "g2", name: "B", visibility: null, sortOrder: 1 },
      ],
      items: [
        item("g1", "1", "100", { id: "a" }),
        item("g1", "1", "100", { id: "b", pricingOverride: { mode: "markup", percent: "0" } }),
        item("g2", "1", "100", { id: "c" }),
      ],
    });
    const t = computeEstimate(e);
    expect(s(t.items.a.extendedPrice)).toBe("200.00");
    expect(s(t.items.b.extendedPrice)).toBe("100.00");
    expect(s(t.items.c.extendedPrice)).toBe("110.00");
  });
  it("pass-through charges are billed at cost", () => {
    const t = computeEstimate(est({ items: [item("g1", "1", "250", { id: "p", treatment: "pass_through", costType: "permit" })] }));
    expect(s(t.items.p.extendedPrice)).toBe("250.00");
    expect(t.items.p.grossProfit.isZero()).toBe(true);
  });
});

describe("6. example rows", () => {
  it("never contribute to totals", () => {
    const e = est({ items: [item("g1", "1", "100"), item("g1", "10", "999", { isExample: true })] });
    const t = computeEstimate(e);
    expect(s(t.totalCost)).toBe("100.00");
    expect(s(t.subtotal)).toBe("125.00");
  });
  it("new trade estimates start with empty groups (suggestions are not auto-added)", () => {
    const e = createEstimate("decks");
    expect(e.groups.length).toBeGreaterThan(2);
    expect(e.items).toHaveLength(0);
    expect(computeEstimate(e).total.isZero()).toBe(true);
  });
});

describe("input validation", () => {
  it("flags negative and invalid numbers without crashing", () => {
    const t = computeEstimate(est({ items: [item("g1", "-2", "10", { id: "n" }), item("g1", "abc", "10", { id: "b" }), item("g1", "1", "-5", { id: "c" })] }));
    expect(t.issues.map((i) => i.code).sort()).toEqual(["invalid_number", "negative_cost", "negative_quantity"]);
    expect(t.total.isZero()).toBe(true);
  });
  it("parses currency-formatted input", () => {
    expect(toDec("$1,234.50").value.toFixed(2)).toBe("1234.50");
    expect(toDec("1.2.3").valid).toBe(false);
  });
  it("formats currency with commas and negatives", () => {
    expect(formatCurrency(new D("1234567.005"))).toBe("$1,234,567.01");
    expect(formatCurrency(new D("-50"))).toBe("-$50.00");
  });
  it("is deterministic", () => {
    const e = est({ taxRate: "6.25", items: [item("g1", "7", "13.37"), item("g2", "2.5", "45")] });
    expect(JSON.stringify(computeEstimate(e))).toBe(JSON.stringify(computeEstimate(e)));
  });
});

describe("19. multi-trade estimates", () => {
  it("prices groups from several trades in one estimate", () => {
    const e = est({
      trades: ["kitchens", "electrical", "plumbing"],
      groups: [
        { id: "k", name: "Cabinetry", visibility: null, sortOrder: 0 },
        { id: "el", name: "Electrical", visibility: "group_total", sortOrder: 1 },
        { id: "pl", name: "Plumbing", visibility: "itemized", sortOrder: 2 },
      ],
      items: [item("k", "10", "200"), item("el", "1", "1500", { costType: "subcontractor" }), item("pl", "8", "95", { costType: "labor" })],
    });
    const t = computeEstimate(e);
    expect(t.groupOrder).toEqual(["k", "el", "pl"]);
    expect(s(t.totalCost)).toBe("4260.00");
    expect(s(t.subtotal)).toBe("5325.00");
  });
});
