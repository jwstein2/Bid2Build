/**
 * Chart widgets: what each dataset is, which chart types it may be drawn as, and the numbers behind it.
 * Pure and unit-tested. Everything comes from the same P&L roll-up as the Profit & Loss report
 * (fin_report_pl) or the receivables view, so a chart always reconciles with the report its slices open.
 *
 * Two data shapes, and chart types never cross between them:
 *  - category: parts of one total (donut, pie, bar, table). Never drawn as a line: a category isn't a time.
 *  - series: amounts per month / quarter / year (bar, line, area, table). Always aggregated by period.
 */
import { add, cmp, sub } from "@/lib/financials/money";
import { formatCurrency } from "@/lib/estimate/money";
import { bucketRange, bucketsBetween, CATEGORIES, CATEGORY_LABELS, categoryOf, grainFor, periodRange, series, totalsOf, type Category, type Period, type PlRow, type ReportBasis } from "@/lib/financials/reports";
import { costSlices, invoiceSlices, revenueSlices, type InvoiceRow, type Slice } from "@/lib/financials/donuts";

export const DATASETS = ["expenses", "job_costs", "revenue_breakdown", "invoice_status", "cash_flow", "profit_trend", "labor_costs", "sub_costs"] as const;
export type Dataset = (typeof DATASETS)[number];

export const CATEGORY_TYPES = ["donut", "pie", "bar", "table"] as const;
export const SERIES_TYPES = ["bar", "line", "area", "table"] as const;
export type ChartType = (typeof CATEGORY_TYPES)[number] | (typeof SERIES_TYPES)[number];
export const CHART_TYPE_LABELS: Record<ChartType, string> = { donut: "Donut", pie: "Pie", bar: "Bar", line: "Line", area: "Area", table: "Table" };

export const DATASET_INFO: Record<Dataset, { label: string; shape: "category" | "series"; source: "pl" | "ar"; categories: boolean; filters: boolean; hint: string }> = {
  expenses: { label: "Expenses by category", shape: "category", source: "pl", categories: true, filters: true, hint: "All money out (job costs and overhead), by type." },
  job_costs: { label: "Job costs by category", shape: "category", source: "pl", categories: true, filters: true, hint: "Costs recorded on a project, by type. Overhead is left out." },
  revenue_breakdown: { label: "Revenue breakdown", shape: "category", source: "pl", categories: false, filters: false, hint: "Where each revenue dollar went: job costs, overhead and profit." },
  invoice_status: { label: "Invoices: paid, not due, overdue", shape: "category", source: "ar", categories: false, filters: false, hint: "Issued invoices in the period by payment status." },
  cash_flow: { label: "Cash in vs cash out", shape: "series", source: "pl", categories: false, filters: true, hint: "Money in and money out per period." },
  profit_trend: { label: "Profit and loss over time", shape: "series", source: "pl", categories: false, filters: true, hint: "Net (money in minus money out) per period." },
  labor_costs: { label: "Labor costs over time", shape: "series", source: "pl", categories: false, filters: true, hint: "Labor and labor burden recorded per period (from bills and expenses; Built2Bid has no payroll system)." },
  sub_costs: { label: "Subcontractor costs over time", shape: "series", source: "pl", categories: false, filters: true, hint: "Subcontractor bills and expenses per period." },
};

export const chartTypesFor = (d: Dataset): readonly ChartType[] => (DATASET_INFO[d].shape === "category" ? CATEGORY_TYPES : SERIES_TYPES);
export const isDataset = (v: unknown): v is Dataset => typeof v === "string" && (DATASETS as readonly string[]).includes(v);

/** Periods a chart may use (custom ranges stay on the report page). */
export const CHART_PERIODS = ["this_month", "last_month", "this_quarter", "last_quarter", "ytd", "last_year", "last_12"] as const satisfies readonly Period[];
export type ChartPeriod = (typeof CHART_PERIODS)[number];

export interface ChartSettings { dataset: Dataset; chart: ChartType; period: ChartPeriod; basis: ReportBasis; categories: Category[] | null; job: string | null; trade: string | null }

export interface SeriesPoint { key: string; label: string; values: { key: string; label: string; amount: string }[]; href: string }
export type ChartData =
  | { shape: "category"; slices: Slice[]; total: string; selectedOnly: { shown: number; of: number } | null; note?: string }
  | { shape: "series"; points: SeriesPoint[]; seriesKeys: { key: string; label: string; tone: "in" | "out" | "c1" }[] };

/** The Profit & Loss report link for a drill-down (same params the report page reads). */
export function reportHref(s: Pick<ChartSettings, "period" | "basis" | "job" | "trade">, drill: Record<string, string | undefined> = {}): string {
  const u = new URLSearchParams({ period: s.period, basis: s.basis });
  if (s.job) u.set("job", s.job);
  if (s.trade) u.set("trade", s.trade);
  for (const [k, v] of Object.entries(drill)) if (v) u.set(k, v);
  u.set("show", "records");
  return `/financials/reports?${u.toString()}#records`;
}

const narrow = (rows: PlRow[], s: ChartSettings) => rows.filter((r) => (!s.job || r.job === s.job) && (!s.trade || r.trade === s.trade));

/** Compute a P&L-based dataset. `rows` is the whole period's roll-up (shared across chart widgets with the same period/basis). */
export function plChart(rows: PlRow[], s: ChartSettings, range: { from: string; to: string }): ChartData {
  const info = DATASET_INFO[s.dataset];
  const base = info.filters ? narrow(rows, s) : rows;
  if (s.dataset === "expenses" || s.dataset === "job_costs") {
    const costs = base.filter((r) => r.dir === "cost" && (s.dataset === "expenses" || r.job !== null));
    const present = CATEGORIES.filter((c) => costs.some((r) => categoryOf(r.type) === c));
    const selected = s.categories ? present.filter((c) => s.categories!.includes(c)) : present;
    const kept = costs.filter((r) => selected.includes(categoryOf(r.type)));
    const oh = s.dataset === "job_costs" ? "0" : undefined;
    const { slices, total } = costSlices(kept, (c) => reportHref(s, { dir: "cost", cat: c, oh }), reportHref(s, { dir: "cost", oh }));
    return { shape: "category", slices, total, selectedOnly: s.categories && selected.length < present.length ? { shown: selected.length, of: present.length } : null };
  }
  if (s.dataset === "revenue_breakdown") {
    const t = totalsOf(base);
    const r = revenueSlices(t, { jobCosts: reportHref(s, { dir: "cost", oh: "0" }), overhead: reportHref(s, { dir: "cost", oh: "1" }), profit: `/financials/reports?period=${s.period}&basis=${s.basis}&view=jobs` });
    if (!r) return { shape: "category", slices: [], total: "0.00", selectedOnly: null };
    return { shape: "category", slices: r.slices, total: r.total, selectedOnly: null, note: r.loss ? `Net loss of ${formatCurrency(r.loss)} in this period.` : undefined };
  }
  const g = grainFor(range.from, range.to);
  const buckets = bucketsBetween(range.from, range.to, g);
  const link = (b: string, extra: Record<string, string | undefined>) => { const r = bucketRange(b, g, range.from, range.to); return reportHref(s, { ...extra, df: r.from, dt: r.to }); };
  if (s.dataset === "cash_flow" || s.dataset === "profit_trend") {
    const pts = series(base, buckets, g);
    if (s.dataset === "cash_flow") {
      return { shape: "series", seriesKeys: [{ key: "in", label: "Money in", tone: "in" }, { key: "out", label: "Money out", tone: "out" }],
        points: pts.map((p) => ({ key: p.bucket, label: p.label, href: link(p.bucket, {}), values: [{ key: "in", label: "Money in", amount: p.moneyIn }, { key: "out", label: "Money out", amount: p.moneyOut }] })) };
    }
    return { shape: "series", seriesKeys: [{ key: "net", label: "Net profit", tone: "c1" }],
      points: pts.map((p) => ({ key: p.bucket, label: p.label, href: link(p.bucket, {}), values: [{ key: "net", label: "Net profit", amount: p.net }] })) };
  }
  const cat: Category = s.dataset === "labor_costs" ? "labor" : "subcontractors";
  const label = CATEGORY_LABELS[cat];
  const costRows = base.filter((r) => r.dir === "cost" && categoryOf(r.type) === cat);
  const pts = series(costRows, buckets, g);
  return { shape: "series", seriesKeys: [{ key: "cost", label, tone: "c1" }],
    points: pts.map((p) => ({ key: p.bucket, label: p.label, href: link(p.bucket, { dir: "cost", cat }), values: [{ key: "cost", label, amount: p.moneyOut }] })) };
}

/** Invoice status for the period (issued invoices dated in range), drilling into Receivables. */
export function invoiceChart(rows: InvoiceRow[]): ChartData {
  const r = invoiceSlices(rows, { paid: "/financials/receivables?bucket=paid", open: "/financials/receivables?bucket=current", overdue: "/financials/receivables?bucket=overdue" });
  return { shape: "category", slices: r.slices, total: r.total, selectedOnly: null };
}

export const chartRange = (p: ChartPeriod, now = new Date()) => periodRange(p, now);

/** Sum of every value in a dataset (used to reconcile a chart with its report in tests). */
export function chartTotal(d: ChartData): string {
  if (d.shape === "category") return d.total;
  return add(0, ...d.points.flatMap((p) => p.values.map((v) => (v.key === "out" ? sub(0, v.amount) : v.amount))));
}

export const positive = (v: string) => cmp(v, 0) > 0;
