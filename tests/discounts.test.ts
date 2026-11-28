import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/lib/estimate/engine";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { estimateOptionsToStore, projectDiscountFrom, proposalConfigFrom } from "@/lib/data/mappers";
import { lineItemSchema } from "@/lib/estimate/schema";
import { buildInternalReport } from "@/lib/reports/internal-estimate";
import { est, item } from "./helpers";

const biz = { ...defaultBusinessProfile(), companyName: "Acme" };
const G = [
  { id: "g1", name: "Site Preparation", visibility: null, sortOrder: 0 },
  { id: "g2", name: "Labor", visibility: null, sortOrder: 1 },
];

// Markup 0% so price = cost and the arithmetic is easy to read.
function base(extra = {}) {
  return est({
    pricing: { mode: "markup", percent: "0" },
    taxRate: "10",
    defaultGroupVisibility: "itemized",
    groups: G,
    items: [
      item("g1", "1", "1000", { id: "a", name: "Excavation" }), // taxable
      item("g2", "1", "1000", { id: "b", name: "Install", costType: "labor", taxable: false }),
    ],
    ...extra,
  });
}

describe("discount line items", () => {
  it("a $ discount lowers its section price, is never marked up and has no cost", () => {
    const e = base({
      pricing: { mode: "markup", percent: "50" },
      items: [
        item("g1", "1", "1000", { id: "a" }),
        item("g1", "1", "200", { id: "d", name: "Discount", costType: "discount", unit: "lump sum" }),
      ],
    });
    const t = computeEstimate(e);
    expect(t.items.d.extendedPrice.toString()).toBe("-200");
    expect(t.items.d.extendedCost.toString()).toBe("0");
    expect(t.items.d.appliedRule).toBeNull();
    expect(t.groups.g1.price.toString()).toBe("1300"); // 1500 - 200
    expect(t.groups.g1.cost.toString()).toBe("1000");
    expect(t.lineDiscounts.toString()).toBe("200");
    expect(t.totalCost.toString()).toBe("1000");
  });

  it("a % discount is a percent of the other lines in its section", () => {
    const e = base({
      items: [
        item("g1", "1", "1000", { id: "a" }),
        item("g1", "1", "500", { id: "a2" }),
        item("g1", "1", "10", { id: "d", name: "Loyalty", costType: "discount", unit: "percent" }),
        item("g2", "1", "1000", { id: "b", taxable: false }),
      ],
    });
    const t = computeEstimate(e);
    expect(t.items.d.extendedPrice.toString()).toBe("-150");
    expect(t.groups.g1.price.toString()).toBe("1350");
    expect(t.groups.g2.price.toString()).toBe("1000");
  });

  it("tax is figured on the discounted price", () => {
    const e = base({
      items: [
        item("g1", "1", "1000", { id: "a" }),
        item("g1", "1", "100", { id: "d", costType: "discount", unit: "lump sum" }),
      ],
    });
    const t = computeEstimate(e);
    expect(t.taxableBase.toString()).toBe("900");
    expect(t.tax.toString()).toBe("90");
    expect(t.total.toString()).toBe("990");
  });

  it("a discount only reduces the taxable share of a mixed section", () => {
    const e = base({
      items: [
        item("g1", "1", "600", { id: "a" }),
        item("g1", "1", "400", { id: "b", taxable: false }),
        item("g1", "1", "100", { id: "d", costType: "discount", unit: "lump sum" }),
      ],
    });
    const t = computeEstimate(e);
    expect(t.groups.g1.taxableBase.toString()).toBe("540"); // 600 - 100 × 60%
    expect(t.tax.toString()).toBe("54");
  });

  it("discounts cannot take a section below zero", () => {
    const e = base({
      items: [
        item("g1", "1", "100", { id: "a" }),
        item("g1", "1", "500", { id: "d", costType: "discount", unit: "lump sum" }),
        item("g1", "1", "50", { id: "d2", costType: "discount", unit: "percent" }),
      ],
    });
    const t = computeEstimate(e);
    expect(t.items.d.extendedPrice.toString()).toBe("-100");
    expect(t.items.d2.extendedPrice.toString()).toBe("0");
    expect(t.groups.g1.price.toString()).toBe("0");
  });

  it("is accepted by the save schema", () => {
    const d = item("11111111-1111-4111-8111-111111111111", "1", "50", { id: "22222222-2222-4222-8222-222222222222", costType: "discount", unit: "percent" });
    expect(lineItemSchema.safeParse({ ...d, groupId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });
});

describe("project discount", () => {
  it("percent of the line items, before tax", () => {
    const e = base({ projectDiscount: { kind: "percent", value: "10" } });
    const t = computeEstimate(e);
    expect(t.itemsPrice.toString()).toBe("2000");
    expect(t.projectDiscount.toString()).toBe("200");
    expect(t.subtotal.toString()).toBe("1800");
    // Taxable share is 50%: 1000 - 200 × 50% = 900.
    expect(t.taxableBase.toString()).toBe("900");
    expect(t.tax.toString()).toBe("90");
    expect(t.total.toString()).toBe("1890");
    expect(t.grossProfit.toString()).toBe("-200");
  });

  it("dollar amount, combined with the adjustment, never below zero", () => {
    expect(computeEstimate(base({ projectDiscount: { kind: "amount", value: "250" }, fixedAdjustment: "-50" })).subtotal.toString()).toBe("1700");
    const huge = computeEstimate(base({ projectDiscount: { kind: "amount", value: "5000" } }));
    expect(huge.projectDiscount.toString()).toBe("2000");
    expect(huge.subtotal.toString()).toBe("0");
  });

  it("flags a negative or non-numeric value and ignores it", () => {
    const t = computeEstimate(base({ projectDiscount: { kind: "amount", value: "-5" } }));
    expect(t.projectDiscount.toString()).toBe("0");
    expect(t.issues.some((i) => i.field === "projectDiscount")).toBe(true);
  });

  it("round-trips through proposal_config without leaking into proposal settings", () => {
    const stored = { ...defaultProposalConfig(), ...estimateOptionsToStore({ projectDiscount: { kind: "percent", value: "5", label: "Veteran discount" } }) };
    expect(projectDiscountFrom(stored)).toEqual({ kind: "percent", value: "5", label: "Veteran discount" });
    expect("projectDiscount" in proposalConfigFrom(stored)).toBe(false);
    expect(estimateOptionsToStore({ projectDiscount: { kind: "amount", value: " " } })).toEqual({});
    expect(projectDiscountFrom({ projectDiscount: { kind: "bogus", value: "5" } })).toBeNull();
  });
});

describe("proposal shows discounts", () => {
  const withLine = () =>
    base({
      defaultGroupVisibility: "names_only",
      items: [
        item("g1", "1", "1000", { id: "a", name: "Excavation" }),
        item("g1", "1", "100", { id: "d", name: "Discount", costType: "discount", unit: "lump sum" }),
        item("g2", "1", "1000", { id: "b", taxable: false }),
      ],
    });

  it("a discount line shows its amount even in a names-only section", () => {
    const doc = buildProposal(withLine(), biz, defaultProposalConfig());
    const line = doc.pricing.sections[0].lines.find((l) => l.discount)!;
    expect(line.name).toBe("Discount");
    expect(line.amount).toBe("-$100.00");
    expect(doc.pricing.sections[0].lines.find((l) => l.name === "Excavation")!.amount).toBeUndefined();
    expect(doc.pricing.sections[0].amount).toBe("$900.00");
    expect(doc.pricing.savings).toBe("$100.00");
  });

  it("a percent line is labelled with its percent; total-only sections still list the discount", () => {
    const e = withLine();
    e.items[1] = { ...e.items[1], unit: "percent", unitCost: "10", name: "Spring special" };
    e.groups = e.groups.map((g) => (g.id === "g1" ? { ...g, visibility: "group_total" } : g));
    const doc = buildProposal(e, biz, defaultProposalConfig());
    expect(doc.pricing.sections[0].lines).toEqual([expect.objectContaining({ name: "Spring special (10%)", amount: "-$100.00", discount: true })]);
  });

  it("a project discount gets its own row between the line items and the subtotal", () => {
    const doc = buildProposal(base({ projectDiscount: { kind: "percent", value: "10" } }), biz, defaultProposalConfig());
    expect(doc.pricing.beforeDiscount).toEqual({ label: "Price before discount", amount: "$2,000.00" });
    expect(doc.pricing.discounts).toEqual([{ label: "Discount (10%)", amount: "-$200.00" }]);
    expect(doc.pricing.subtotal).toBe("$1,800.00");
    expect(doc.pricing.tax?.amount).toBe("$90.00");
    expect(doc.pricing.total).toBe("$1,890.00");
  });

  it("a negative adjustment is shown as a discount with the price before it", () => {
    const doc = buildProposal(base({ fixedAdjustment: "-300" }), biz, defaultProposalConfig());
    expect(doc.pricing.beforeDiscount?.amount).toBe("$2,000.00");
    expect(doc.pricing.adjustment).toEqual({ label: "Discount", amount: "-$300.00" });
    expect(doc.pricing.subtotal).toBe("$1,700.00");
  });

  it("single-total proposals show the price before discounts and every discount", () => {
    const e = withLine();
    e.displayMode = "project_total";
    e.projectDiscount = { kind: "amount", value: "100", label: "Referral credit" };
    const doc = buildProposal(e, biz, defaultProposalConfig());
    expect(doc.pricing.projectAmount).toBe("$2,000.00");
    expect(doc.pricing.discounts).toEqual([
      { label: "Discount", amount: "-$100.00" },
      { label: "Referral credit", amount: "-$100.00" },
    ]);
    expect(doc.pricing.subtotal).toBe("$1,800.00");
    expect(doc.pricing.savings).toBe("$200.00");
  });

  it("single-total proposals keep a positive adjustment inside the project price", () => {
    const e = base({ displayMode: "project_total", fixedAdjustment: "150" });
    const doc = buildProposal(e, biz, defaultProposalConfig());
    expect(doc.pricing.projectAmount).toBe("$2,150.00");
    expect(doc.pricing.adjustment).toBeUndefined();
    expect(doc.pricing.subtotal).toBe("$2,150.00");
  });

  it("no discount, no new rows", () => {
    const doc = buildProposal(base(), biz, defaultProposalConfig());
    expect(doc.pricing.beforeDiscount).toBeUndefined();
    expect(doc.pricing.discounts).toBeUndefined();
    expect(doc.pricing.savings).toBeUndefined();
  });

  it("the internal report keeps discounts out of direct cost and lists the project discount", () => {
    const e = withLine();
    e.projectDiscount = { kind: "amount", value: "50" };
    const r = buildInternalReport(e);
    expect(r.costBreakdown.some((c) => c.costType === "discount")).toBe(false);
    expect(r.totals.projectDiscount).toBe("-50.00");
    expect(r.totals.sellingPrice).toBe("1850.00");
  });
});
