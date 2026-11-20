import { describe, expect, it } from "vitest";
import { DEFAULT_MILESTONES, isMilestone, milestoneRule, milestoneSchedule, nextMilestone, payExample, roundCents, v3Bonus } from "@/lib/sales/goals";
import { commissionBasis, invoicePeriodMonths, listMrr, type BasisItem } from "@/lib/sales/basis";
import { revenueBeforeTax } from "@/lib/sales/billing-server";

// Compensation Model V3 (James, 2026-11-19): pure display math. The database (sales_comp_v3.sql) is the
// only place awards are calculated; tests/db/sales-comp-v3.test.ts checks the real engine.
const r = DEFAULT_MILESTONES;

describe("V3 milestone schedule", () => {
  it("has every approved threshold and nothing else up to 400", () => {
    const at = milestoneSchedule(r, 400).map((m) => m.at);
    expect(at).toEqual([10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400]);
    expect(isMilestone(r, 30)).toBe(false);
    expect(isMilestone(r, 0)).toBe(false);
  });
  it("pays $25 and $75 flat, then 3%, 4% and 5%", () => {
    expect(milestoneRule(r, 10)).toMatchObject({ flat_cents: 2500 });
    expect(milestoneRule(r, 25)).toMatchObject({ flat_cents: 7500 });
    for (const n of [50, 75]) expect(milestoneRule(r, n)).toEqual({ at: n, pct: 3 });
    for (const n of [100, 125, 150, 175, 200, 225]) expect(milestoneRule(r, n)).toEqual({ at: n, pct: 4 });
    for (const n of [250, 275, 300, 1000]) expect(milestoneRule(r, n)).toEqual({ at: n, pct: 5 });
  });
  it("has no minimum on percentage boxes", () => {
    expect(r.min_cents).toBe(0);
    expect(v3Bonus(r, 50, 1000)).toBe(30); // 3% of $10.00 = $0.30
  });
});

describe("V3 bonus formula", () => {
  it("matches the spec example: $2,400 MRR at 100 customers = $96.00", () => {
    expect(v3Bonus(r, 100, 240000)).toBe(9600);
  });
  it("report examples: 50 x $19.99 at 3% = $29.99; $4,000 at 5% = $200", () => {
    expect(v3Bonus(r, 50, 50 * 1999)).toBe(2999); // 2998.5 cents, half up
    expect(v3Bonus(r, 250, 400000)).toBe(20000);
  });
  it("rounds half up to the cent", () => {
    expect(v3Bonus(r, 50, 1650)).toBe(50); // 3% of $16.50 = 49.5 cents -> 50
    expect(v3Bonus(r, 100, 1662)).toBe(66); // 66.48 -> 66
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(2.4999)).toBe(2);
  });
  it("returns null off-schedule and the flat amount at flat thresholds regardless of MRR", () => {
    expect(v3Bonus(r, 60, 999999)).toBeNull();
    expect(v3Bonus(r, 10, 0)).toBe(2500);
  });
  it("shows the next milestone and what it pays", () => {
    expect(nextMilestone(r, 112)).toMatchObject({ at: 125, prev: 100, label: "4% of active MRR" });
    expect(nextMilestone(r, 0)).toMatchObject({ at: 10, prev: 0, label: "$25 bonus" });
    expect(nextMilestone(r, 250)).toMatchObject({ at: 275, prev: 250, label: "5% of active MRR" });
  });
  it("account 300 example: one award per threshold", () => {
    const e = payExample(r);
    expect(e.boxes.map((b) => b.milestone)).toEqual([10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300]);
    const box100 = e.boxes.find((b) => b.milestone === 100)!;
    expect(box100.revenueCents).toBe(80 * 1999);
    expect(box100.bonusCents).toBe(roundCents(80 * 1999 * 0.04));
  });
});

describe("V3 MRR definition (list side)", () => {
  const prices = { monthly: "price_m", annual: "price_y", enterpriseBase: "price_eb", enterpriseSeat: "price_es", monthlyListCents: 1999 };
  const monthly: BasisItem = { quantity: 1, price: { id: "price_m", unit_amount: 1999, recurring: { interval: "month" } } };
  const annual: BasisItem = { quantity: 1, price: { id: "price_y", unit_amount: 19900, recurring: { interval: "year" } } };
  it("normalizes annual to a monthly equivalent ($199/yr = $16.58), unlike the commission basis", () => {
    expect(listMrr([annual], prices).cents).toBe(1658);
    expect(commissionBasis([annual], { annual_basis: "monthly_list", value_scope: "all_items" }, prices).cents).toBe(1999);
  });
  it("includes Enterprise base and paid seats", () => {
    const ent: BasisItem[] = [
      { quantity: 1, price: { id: "price_eb", unit_amount: 4999, recurring: { interval: "month" } } },
      { quantity: 2, price: { id: "price_es", unit_amount: 1999, recurring: { interval: "month" } } },
    ];
    const m = listMrr(ent, prices);
    expect(m.lines.map((l) => l.kind)).toEqual(["plan", "seat"]);
    expect(m.cents).toBeGreaterThan(4999);
  });
  it("reports the invoice's billing period", () => {
    expect(invoicePeriodMonths([monthly])).toBe(1);
    expect(invoicePeriodMonths([annual])).toBe(12);
    expect(invoicePeriodMonths([])).toBeNull();
  });
  it("collected revenue excludes tax", () => {
    expect(revenueBeforeTax({ amount_paid: 2149, total: 2149, total_excluding_tax: 1999 })).toBe(1999);
  });
});
