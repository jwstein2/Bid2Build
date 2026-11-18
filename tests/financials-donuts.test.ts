import { describe, expect, it } from "vitest";
import { costSlices, invoiceSlices, revenueSlices, MAX_SLICES } from "@/lib/financials/donuts";
import { compact } from "@/components/financials/donut";
import type { PlRow } from "@/lib/financials/reports";

const C = (type: string | null, amount: string, job: string | null = "j1"): PlRow => ({ m: "2026-03", dir: "cost", job, trade: null, type, amount });

describe("circle chart data", () => {
  it("costs: by category, fixed category order and colors, percents, links", () => {
    const r = costSlices([C("labor", "300.00"), C("material", "600.00"), C("delivery", "100.00"), C(null, "0.00"), { ...C("x", "999"), dir: "income" }], (c) => `/r?cat=${c}`);
    expect(r.total).toBe("1000.00");
    expect(r.slices.map((s) => [s.key, s.amount, s.pct, s.tone])).toEqual([["materials", "700.00", "70", "c1"], ["labor", "300.00", "30", "c2"]]);
    expect(r.slices[0].href).toBe("/r?cat=materials");
  });

  it("costs: more than six categories fold the smallest into Everything else", () => {
    const types = ["material", "labor", "subcontractor", "equipment", "permit", "labor_material", "overhead"];
    const r = costSlices([...types.map((t, i) => C(t, String((i + 1) * 100) + ".00")), C(null, "50.00")], () => "/r", "/all");
    expect(r.slices.length).toBe(MAX_SLICES);
    const other = r.slices.find((s) => s.key === "rest")!;
    expect(other).toMatchObject({ label: "Everything else", amount: "350.00", href: "/all", tone: "rest" });   // 100 + 200 + 50
    expect(r.total).toBe("2850.00");
  });

  it("revenue: job costs + overhead + profit add up to revenue; a loss is reported, not drawn", () => {
    const r = revenueSlices({ revenue: "1000.00", jobCosts: "600.00", overhead: "100.00", netProfit: "300.00" }, { jobCosts: "/a", overhead: "/b", profit: "/c" })!;
    expect(r.total).toBe("1000.00");
    expect(r.slices.map((s) => [s.key, s.pct])).toEqual([["job_costs", "60"], ["overhead", "10"], ["profit", "30"]]);
    expect(r.loss).toBeNull();
    const l = revenueSlices({ revenue: "1000.00", jobCosts: "1100.00", overhead: "100.00", netProfit: "-200.00" }, { jobCosts: "/a", overhead: "/b", profit: "/c" })!;
    expect(l.loss).toBe("200.00");
    expect(l.slices.map((s) => s.key)).toEqual(["job_costs", "overhead"]);
    expect(revenueSlices({ revenue: "0", jobCosts: "5", overhead: "0", netProfit: "-5" }, { jobCosts: "", overhead: "", profit: "" })).toBeNull();
  });

  it("invoices: paid (with credits), not due, overdue in status order; JSON numbers work", () => {
    const r = invoiceSlices([
      { total: 1000, paid: 400, credited: 100, balance: 500, days_overdue: 12 },
      { total: "300.00", paid: "300.00", credited: "0", balance: "0.00", days_overdue: 0 },
      { total: "200.00", paid: "0", credited: "0", balance: "200.00", days_overdue: 0 },
    ], { paid: "/p", open: "/o", overdue: "/d" });
    expect(r.slices.map((s) => [s.key, s.amount, s.tone])).toEqual([["paid", "800.00", "ok"], ["open", "200.00", "info"], ["overdue", "500.00", "danger"]]);
    expect(r.total).toBe("1500.00");
  });

  it("compact center labels", () => {
    expect(compact("950.4")).toBe("$950");
    expect(compact("1234.5")).toBe("$1.2K");
    expect(compact("45250")).toBe("$45K");
    expect(compact("2500000")).toBe("$2.5M");
    expect(compact("-1500")).toBe("-$1.5K");
  });
});
