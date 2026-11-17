import { describe, expect, it } from "vitest";
import {
  bucketRange, bucketsBetween, byJob, byTrade, categoryOf, filterRows, grainFor, periodRange, series, statement, totalsOf, NO_JOB, NO_TRADE, type PlRow,
} from "@/lib/financials/reports";

const R = (m: string, dir: "income" | "cost", amount: string, job: string | null = "j1", trade: string | null = "decks", type: string | null = null): PlRow => ({ m, dir, amount, job, trade, type });
const rows: PlRow[] = [
  R("2026-01", "income", "10000.00", "j1", "decks"),
  R("2026-01", "income", "2500.10", "j1", "electrical"),
  R("2026-02", "income", "4000.00", "j2", "roofing"),
  R("2026-01", "cost", "3000.00", "j1", "decks", "material"),
  R("2026-01", "cost", "1200.55", "j1", "decks", "labor"),
  R("2026-02", "cost", "900.00", "j2", "roofing", "subcontractor"),
  R("2026-02", "cost", "100.00", "j2", null, null),
  R("2026-02", "cost", "750.00", null, null, "overhead"),
  R("2026-02", "income", "-50.00", null, null),   // refund of a payment with no project
];
const jobs = [
  { id: "j1", estimateId: "e1", number: "J-1", name: "Deck", status: "open", customer: "Pat", trades: ["decks", "electrical"] },
  { id: "j2", estimateId: "e2", number: "J-2", name: "Roof", status: "open", customer: "Sam", trades: ["roofing"] },
];

describe("company P&L roll-ups", () => {
  it("totals: revenue, job costs, gross, overhead, net, labor and margins (numbers as JSON numbers still work)", () => {
    const t = totalsOf(rows);
    expect(t).toMatchObject({ revenue: "16450.10", jobCosts: "5200.55", grossProfit: "11249.55", overhead: "750.00", netProfit: "10499.55", labor: "1200.55" });
    expect(t.grossMarginPct).toBe("68.4");
    expect(t.netMarginPct).toBe("63.8");
    expect(totalsOf([]).grossMarginPct).toBeNull();
  });

  it("statement: lines per bucket add up to the totals; categories in fixed order", () => {
    const g = grainFor("2026-01-01", "2026-02-28");
    const b = bucketsBetween("2026-01-01", "2026-02-28", g);
    expect(b).toEqual(["2026-01", "2026-02"]);
    const s = statement(rows, b, g);
    expect(s.map((l) => l.key)).toEqual(["revenue", "job:materials", "job:labor", "job:subcontractors", "job:uncategorized", "job_total", "gross", "oh:other", "oh_total", "net"]);
    const by = Object.fromEntries(s.map((l) => [l.key, l]));
    expect(by.revenue.cells).toEqual({ "2026-01": "12500.10", "2026-02": "3950.00" });
    expect(by.net.total).toBe(totalsOf(rows).netProfit);
    expect(by.gross.cells["2026-02"]).toBe("2950.00");
  });

  it("by project: every project plus one overhead row; the column sums equal net profit", () => {
    const g = byJob(rows, jobs);
    expect(g.map((x) => x.key)).toEqual(["j1", "j2", NO_JOB]);
    expect(g[0]).toMatchObject({ label: "Deck", revenue: "12500.10", costs: "4200.55", profit: "8299.55", href: "/financials/jobs/e1", sub: "J-1 · Pat" });
    expect(g[2]).toMatchObject({ revenue: "-50.00", costs: "750.00" });
    const net = g.reduce((t, x) => t + Math.round(Number(x.profit) * 100), 0);
    expect(net).toBe(Math.round(Number(totalsOf(rows).netProfit) * 100));
  });

  it("by trade: overhead excluded, uncoded costs are General", () => {
    const g = byTrade(rows, [{ slug: "decks", name: "Decks" }, { slug: "electrical", name: "Electrical" }, { slug: "roofing", name: "Roofing" }]);
    expect(Object.fromEntries(g.map((x) => [x.key, [x.revenue, x.costs]]))).toEqual({
      decks: ["10000.00", "4200.55"], electrical: ["2500.10", "0.00"], roofing: ["4000.00", "900.00"], [NO_TRADE]: ["-50.00", "100.00"],
    });
    expect(g.find((x) => x.key === "decks")!.byCategory).toEqual({ materials: "3000.00", labor: "1200.55" });
  });

  it("series and filters", () => {
    const s = series(rows, ["2026-01", "2026-02"], "month");
    expect(s[1]).toMatchObject({ label: "Feb 26", moneyIn: "3950.00", moneyOut: "1750.00", net: "2200.00" });
    expect(filterRows(rows, { dir: "cost", overhead: true }).map((r) => r.amount)).toEqual(["750.00"]);
    expect(filterRows(rows, { category: "labor" }).length).toBe(1);
    expect(filterRows(rows, { job: NO_JOB }).length).toBe(2);
    expect(categoryOf("labor_burden")).toBe("labor");
    expect(categoryOf(null)).toBe("uncategorized");
  });
});

describe("periods and buckets", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("presets", () => {
    expect(periodRange("ytd", now)).toEqual({ period: "ytd", from: "2026-01-01", to: "2026-11-17" });
    expect(periodRange("last_month", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("this_quarter", now)).toMatchObject({ from: "2026-10-01", to: "2026-11-17" });
    expect(periodRange("last_quarter", now)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange("last_year", now)).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodRange("last_12", now)).toMatchObject({ from: "2025-12-01", to: "2026-11-17" });
  });
  it("custom dates are validated; bad ones fall back to year to date", () => {
    expect(periodRange("custom", now, { from: "2026-03-05", to: "2026-04-10" })).toEqual({ period: "custom", from: "2026-03-05", to: "2026-04-10" });
    expect(periodRange("custom", now, { from: "2026-04-10", to: "2026-03-05" }).period).toBe("ytd");
    expect(periodRange("custom", now, { from: "2026-02-30", to: "2026-03-05" }).period).toBe("ytd");
  });
  it("grain and bucket ranges", () => {
    expect(grainFor("2026-01-01", "2026-12-31")).toBe("month");
    expect(grainFor("2024-01-01", "2026-06-30")).toBe("quarter");
    expect(grainFor("2020-01-01", "2026-06-30")).toBe("year");
    expect(bucketsBetween("2025-11-15", "2026-03-01", "quarter")).toEqual(["2025-Q4", "2026-Q1"]);
    expect(bucketRange("2026-Q1", "quarter", "2026-02-10", "2026-12-31")).toEqual({ from: "2026-02-10", to: "2026-03-31" });
    expect(bucketRange("2026-02", "month", "2026-01-01", "2026-12-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
