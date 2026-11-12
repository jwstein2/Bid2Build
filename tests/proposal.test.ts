import { describe, expect, it } from "vitest";
import { buildProposal } from "@/lib/proposal/build";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { computeEstimate } from "@/lib/estimate/engine";
import { formatCurrency } from "@/lib/estimate/money";
import { est, item } from "./helpers";

const biz = { ...defaultBusinessProfile(), companyName: "Acme Decks", phone: "555-0100", email: "hi@acme.test" };

function sample(extra = {}) {
  return est({
    taxRate: "6",
    groups: [
      { id: "g1", name: "Decking Material Package", visibility: "group_total", sortOrder: 0 },
      { id: "g2", name: "Framing Package", visibility: "names_only", sortOrder: 1 },
      { id: "g3", name: "Labor", visibility: "itemized", sortOrder: 2 },
    ],
    items: [
      item("g1", "120", "31.17", { name: "Composite Decking", notes: "Vendor: SECRET LUMBER CO quote #8812" }),
      item("g1", "6", "48.40", { name: "Hidden Fasteners" }),
      item("g2", "14", "24.50", { name: "Joists" }),
      item("g2", "30", "3.11", { name: "Joist hangers" }),
      item("g3", "40", "55", { name: "Framing installation", costType: "labor", taxable: false }),
      item("g3", "1", "999", { name: "Example placeholder", isExample: true }),
    ],
    ...extra,
  });
}

describe("7. customer visibility modes", () => {
  it("renders Mode A/B/C per group and mixes them", () => {
    const doc = buildProposal(sample(), biz, defaultProposalConfig());
    const [a, b, c] = doc.pricing.sections;
    expect(a.mode).toBe("group_total");
    expect(a.lines).toHaveLength(0);
    expect(a.amount).toMatch(/^\$/);
    expect(b.mode).toBe("names_only");
    expect(b.lines.map((l) => l.name)).toEqual(["Joists", "Joist hangers"]);
    expect(b.lines.every((l) => l.amount === undefined && l.unitPrice === undefined)).toBe(true);
    expect(c.mode).toBe("itemized");
    expect(c.lines[0].amount).toBeDefined();
    expect(c.lines.find((l) => l.name === "Example placeholder")).toBeUndefined();
  });
  it("Mode D shows a single project total only", () => {
    const doc = buildProposal(sample({ displayMode: "project_total" }), biz, defaultProposalConfig());
    expect(doc.pricing.sections).toHaveLength(0);
    expect(doc.pricing.total).toBeTruthy();
  });
  it("customer totals are identical in every display mode", () => {
    const totals = new Set<string>();
    for (const vis of ["group_total", "names_only", "itemized"] as const) {
      for (const displayMode of ["by_group", "project_total"] as const) {
        const e = sample({ displayMode, defaultGroupVisibility: vis });
        e.groups = e.groups.map((g) => ({ ...g, visibility: null }));
        const d = buildProposal(e, biz, defaultProposalConfig());
        totals.add(`${d.pricing.subtotal}|${d.pricing.tax?.amount}|${d.pricing.total}`);
      }
    }
    expect(totals.size).toBe(1);
  });
  it("itemized lines sum to the section amount", () => {
    const doc = buildProposal(sample({ defaultGroupVisibility: "itemized", groups: sample().groups.map((g) => ({ ...g, visibility: null })) }), biz, defaultProposalConfig());
    for (const sec of doc.pricing.sections) {
      const sum = sec.lines.reduce((s, l) => s + Math.round(Number(l.amount!.replace(/[$,]/g, "")) * 100), 0);
      expect(sum).toBe(Math.round(Number(sec.amount!.replace(/[$,]/g, "")) * 100));
    }
  });
});

describe("8. internal cost confidentiality", () => {
  it("never leaks costs, markup, margin, profit, or internal notes", () => {
    const e = sample({ defaultGroupVisibility: "itemized" });
    e.groups = e.groups.map((g) => ({ ...g, visibility: null }));
    const t = computeEstimate(e);
    const cfg = defaultProposalConfig();
    cfg.show = { ...cfg.show, notes: false };
    const json = JSON.stringify(buildProposal(e, biz, cfg));
    // No cost-like keys
    const forbidden = /^(unitCost|extendedCost|cost|totalCost|grossProfit|grossMargin|markup|margin|effectiveMarkup|pricingOverride|pricing_rule|appliedRule|notes_internal)$/i;
    const keys: string[] = [];
    const walk = (o: unknown) => {
      if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); }
    };
    walk(JSON.parse(json));
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
    expect(json).not.toContain("SECRET LUMBER");
    // No internal cost values
    for (const it of Object.values(t.items)) {
      expect(json).not.toContain(formatCurrency(it.unitCost));
      expect(json).not.toContain(formatCurrency(it.extendedCost));
    }
    expect(json).not.toContain(formatCurrency(t.totalCost));
    expect(json).not.toContain(formatCurrency(t.grossProfit));
  });
  it("hides contact fields the contractor turned off", () => {
    const cfg = defaultProposalConfig();
    cfg.show.phone = false;
    const doc = buildProposal(sample(), biz, cfg);
    expect(JSON.stringify(doc)).not.toContain("555-0100");
  });
});

describe("9. proposal totals match the engine", () => {
  it("document totals equal computeEstimate totals", () => {
    const e = sample({ fixedAdjustment: "-100" });
    const t = computeEstimate(e);
    const d = buildProposal(e, biz, defaultProposalConfig());
    expect(d.pricing.subtotal).toBe(formatCurrency(t.subtotal));
    expect(d.pricing.tax!.amount).toBe(formatCurrency(t.tax));
    expect(d.pricing.total).toBe(formatCurrency(t.total));
    expect(d.pricing.adjustment!.label).toBe("Discount");
  });
  it("payment schedule sums exactly to the total", () => {
    const d = buildProposal(sample(), biz, defaultProposalConfig());
    const cents = d.paymentSchedule.reduce((s, p) => s + Math.round(Number(p.amount.replace(/[$,]/g, "")) * 100), 0);
    expect(cents).toBe(Math.round(Number(d.pricing.total.replace(/[$,]/g, "")) * 100));
  });
});
