/**
 * Company Reports + Profit & Loss (pure, unit-tested). Input is the roll-up from public.fin_report_pl
 * (month x project x trade x cost type, already reconciled to the cent). Everything here only regroups
 * those rows, so every view adds up to the same totals. Money stays as decimal strings.
 *
 * Bases (never mixed in one report):
 *   cash    money in = payments received - refunds; money out = bill payments + approved expenses
 *   billed  money in = issued invoices - credit memos; money out = approved bills + approved expenses
 * Neither is a GAAP accrual statement (that waits for the general ledger and a CPA review).
 */
import { add, cmp, sub, D } from "./money";

export type ReportBasis = "cash" | "billed";
export const BASIS_LABELS: Record<ReportBasis, string> = { cash: "Cash basis", billed: "Billed basis" };
export const BASIS_HINTS: Record<ReportBasis, string> = {
  cash: "Money in = payments received minus refunds. Money out = bills you paid plus approved expenses, on the day the money moved.",
  billed: "Money in = invoices you issued minus credits. Money out = approved bills plus approved expenses, on the invoice or bill date. Not a CPA accrual statement.",
};

export interface PlRow { m: string; job: string | null; trade: string | null; type: string | null; dir: "income" | "cost"; amount: string }
export interface PlJob { id: string; estimateId: string; number: string; name: string; status: string; customer: string | null; trades: string[] }
export interface PlTrade { slug: string; name: string }
export interface PlData { basis: ReportBasis; from: string; to: string; rows: PlRow[]; jobs: PlJob[]; trades: PlTrade[] }

// ---- Cost categories ------------------------------------------------------------------------------------------
export const CATEGORIES = ["materials", "labor", "labor_material", "subcontractors", "equipment", "permits", "other", "uncategorized"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  materials: "Materials", labor: "Labor", labor_material: "Labor & material", subcontractors: "Subcontractors", equipment: "Equipment",
  permits: "Permits & fees", other: "Other costs", uncategorized: "Not categorized yet",
};
const TYPE_TO_CATEGORY: Record<string, Category> = {
  material: "materials", delivery: "materials", labor: "labor", labor_burden: "labor", labor_material: "labor_material",
  subcontractor: "subcontractors", equipment: "equipment", permit: "permits", overhead: "other", contingency: "other", other: "other",
};
export const categoryOf = (type: string | null): Category => (type && TYPE_TO_CATEGORY[type]) || "uncategorized";
/** Cost types behind a category (for drill-down filters). Uncategorized = no cost code. */
export const typesOf = (c: Category): string[] => Object.entries(TYPE_TO_CATEGORY).filter(([, v]) => v === c).map(([k]) => k);

// ---- Periods --------------------------------------------------------------------------------------------------
export const PERIODS = ["this_month", "last_month", "this_quarter", "last_quarter", "ytd", "last_year", "last_12", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  this_month: "This month", last_month: "Last month", this_quarter: "This quarter", last_quarter: "Last quarter",
  ytd: "Year to date", last_year: "Last year", last_12: "Last 12 months", custom: "Custom dates",
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s?: string) => Boolean(s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && iso(new Date(`${s}T00:00:00Z`)) === s);

/** The date range for a period preset (UTC calendar days; `to` never passes today for "to date" periods). */
export function periodRange(p: Period, now = new Date(), custom?: { from?: string; to?: string }): { period: Period; from: string; to: string } {
  const today = iso(now), y = now.getUTCFullYear(), m = now.getUTCMonth(), q = Math.floor(m / 3) * 3;
  const U = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  switch (p) {
    case "this_month": return { period: p, from: U(y, m, 1), to: today };
    case "last_month": return { period: p, from: U(y, m - 1, 1), to: U(y, m, 0) };
    case "this_quarter": return { period: p, from: U(y, q, 1), to: today };
    case "last_quarter": return { period: p, from: U(y, q - 3, 1), to: U(y, q, 0) };
    case "last_year": return { period: p, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "last_12": return { period: p, from: U(y, m - 11, 1), to: today };
    case "custom": {
      if (validDay(custom?.from) && validDay(custom?.to) && custom!.from! <= custom!.to!) {
        const days = (Date.parse(custom!.to!) - Date.parse(custom!.from!)) / 864e5;
        if (days <= 3650) return { period: p, from: custom!.from!, to: custom!.to! };
      }
      return { period: "ytd", from: `${y}-01-01`, to: today };
    }
    default: return { period: "ytd", from: `${y}-01-01`, to: today };
  }
}

export type Grain = "month" | "quarter" | "year";
/** Months up to 13 columns, quarters up to 3 years, years beyond. */
export function grainFor(from: string, to: string): Grain {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  return months <= 13 ? "month" : months <= 36 ? "quarter" : "year";
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const bucketOf = (m: string, g: Grain) => g === "month" ? m : g === "quarter" ? `${m.slice(0, 4)}-Q${Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1}` : m.slice(0, 4);
export function bucketLabel(b: string, g: Grain) {
  if (g === "month") return `${MON[Number(b.slice(5, 7)) - 1]} ${b.slice(2, 4)}`;
  if (g === "quarter") return `${b.slice(5)} ${b.slice(0, 4)}`;
  return b;
}
/** First and last calendar day of a bucket, clipped to the report range (for drill-down links). */
export function bucketRange(b: string, g: Grain, from: string, to: string): { from: string; to: string } {
  let s: string, e: string;
  const U = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  if (g === "month") { const y = Number(b.slice(0, 4)), m = Number(b.slice(5, 7)) - 1; s = U(y, m, 1); e = U(y, m + 1, 0); }
  else if (g === "quarter") { const y = Number(b.slice(0, 4)), q = (Number(b.slice(6)) - 1) * 3; s = U(y, q, 1); e = U(y, q + 3, 0); }
  else { s = `${b}-01-01`; e = `${b}-12-31`; }
  return { from: s < from ? from : s, to: e > to ? to : e };
}
/** Every bucket between from and to (so empty months still show as columns). */
export function bucketsBetween(from: string, to: string, g: Grain): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4)), endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const b = bucketOf(`${y}-${String(m).padStart(2, "0")}`, g);
    if (out[out.length - 1] !== b) out.push(b);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---- Roll-ups -------------------------------------------------------------------------------------------------
export interface Totals { revenue: string; jobCosts: string; grossProfit: string; overhead: string; netProfit: string; labor: string; grossMarginPct: string | null; netMarginPct: string | null }

const pct = (num: string, den: string) => (cmp(den, 0) > 0 ? new D(num).div(den).times(100).toDecimalPlaces(1, D.ROUND_HALF_UP).toFixed(1) : null);
const isOverhead = (r: PlRow) => r.dir === "cost" && r.job === null;

export function totalsOf(rows: PlRow[]): Totals {
  const revenue = add(0, ...rows.filter((r) => r.dir === "income").map((r) => r.amount));
  const jobCosts = add(0, ...rows.filter((r) => r.dir === "cost" && r.job !== null).map((r) => r.amount));
  const overhead = add(0, ...rows.filter(isOverhead).map((r) => r.amount));
  const labor = add(0, ...rows.filter((r) => r.dir === "cost" && categoryOf(r.type) === "labor").map((r) => r.amount));
  const grossProfit = sub(revenue, jobCosts);
  const netProfit = sub(grossProfit, overhead);
  return { revenue, jobCosts, grossProfit, overhead, netProfit, labor, grossMarginPct: pct(grossProfit, revenue), netMarginPct: pct(netProfit, revenue) };
}

export type LineKey = "revenue" | `job:${Category}` | "job_total" | "gross" | `oh:${Category}` | "oh_total" | "net";
export interface StatementLine { key: LineKey; label: string; kind: "income" | "cost" | "subtotal" | "total"; indent: boolean; cells: Record<string, string>; total: string }

/** The P&L statement: revenue, job costs by category, gross profit, overhead by category, net profit; one column per bucket. */
export function statement(rows: PlRow[], buckets: string[], g: Grain): StatementLine[] {
  const zero = () => Object.fromEntries(buckets.map((b) => [b, "0.00"])) as Record<string, string>;
  const acc = new Map<LineKey, Record<string, string>>();
  const put = (k: LineKey, b: string, v: string) => { const c = acc.get(k) ?? zero(); c[b] = add(c[b] ?? "0", v); acc.set(k, c); };
  for (const r of rows) {
    const b = bucketOf(r.m, g);
    if (r.dir === "income") put("revenue", b, r.amount);
    else if (r.job === null) { put(`oh:${categoryOf(r.type)}`, b, r.amount); put("oh_total", b, r.amount); }
    else { put(`job:${categoryOf(r.type)}`, b, r.amount); put("job_total", b, r.amount); }
  }
  const get = (k: LineKey) => acc.get(k) ?? zero();
  const diff = (a: Record<string, string>, c: Record<string, string>) => Object.fromEntries(buckets.map((b) => [b, sub(a[b] ?? "0", c[b] ?? "0")]));
  const gross = diff(get("revenue"), get("job_total"));
  const net = diff(gross, get("oh_total"));
  const line = (key: LineKey, label: string, kind: StatementLine["kind"], indent: boolean, cells: Record<string, string>): StatementLine =>
    ({ key, label, kind, indent, cells, total: add(0, ...buckets.map((b) => cells[b] ?? "0")) });
  const out: StatementLine[] = [line("revenue", "Revenue", "income", false, get("revenue"))];
  for (const c of CATEGORIES) if (acc.has(`job:${c}`)) out.push(line(`job:${c}`, CATEGORY_LABELS[c], "cost", true, get(`job:${c}`)));
  out.push(line("job_total", "Total job costs", "subtotal", false, get("job_total")));
  out.push(line("gross", "Gross profit", "total", false, gross));
  for (const c of CATEGORIES) if (acc.has(`oh:${c}`)) out.push(line(`oh:${c}`, CATEGORY_LABELS[c], "cost", true, get(`oh:${c}`)));
  out.push(line("oh_total", "Overhead (not tied to a project)", "subtotal", false, get("oh_total")));
  out.push(line("net", "Net profit", "total", false, net));
  return out;
}

export interface GroupRow { key: string; label: string; sub?: string; href?: string; revenue: string; costs: string; profit: string; marginPct: string | null; byCategory: Partial<Record<Category, string>> }

function group(rows: PlRow[], keyOf: (r: PlRow) => string): Map<string, { revenue: string; costs: string; byCategory: Partial<Record<Category, string>> }> {
  const m = new Map<string, { revenue: string; costs: string; byCategory: Partial<Record<Category, string>> }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { revenue: "0.00", costs: "0.00", byCategory: {} };
    if (r.dir === "income") g.revenue = add(g.revenue, r.amount);
    else { g.costs = add(g.costs, r.amount); const c = categoryOf(r.type); g.byCategory[c] = add(g.byCategory[c] ?? "0", r.amount); }
    m.set(k, g);
  }
  return m;
}
const finish = (key: string, label: string, g: { revenue: string; costs: string; byCategory: Partial<Record<Category, string>> }, extra: Partial<GroupRow> = {}): GroupRow => {
  const profit = sub(g.revenue, g.costs);
  return { key, label, revenue: g.revenue, costs: g.costs, profit, marginPct: pct(profit, g.revenue), byCategory: g.byCategory, ...extra };
};
const byProfit = (a: GroupRow, b: GroupRow) => cmp(b.revenue, a.revenue) || a.label.localeCompare(b.label);

export const NO_JOB = "none";
/** Profit by project. Overhead (costs with no project) and money received with no project are one row at the end. */
export function byJob(rows: PlRow[], jobs: PlJob[]): GroupRow[] {
  const names = new Map(jobs.map((j) => [j.id, j]));
  const g = group(rows, (r) => r.job ?? NO_JOB);
  const out = [...g.entries()].filter(([k]) => k !== NO_JOB).map(([k, v]) => {
    const j = names.get(k);
    return finish(k, j?.name ?? "Project", v, { sub: [j?.number, j?.customer].filter(Boolean).join(" · "), href: j ? `/financials/jobs/${j.estimateId}` : undefined });
  }).sort(byProfit);
  const none = g.get(NO_JOB);
  if (none) out.push(finish(NO_JOB, "Overhead & no project", none, { sub: "Company costs and payments not tied to a project" }));
  return out;
}

export const NO_TRADE = "general";
/** Profit by trade. Revenue is split by each project's estimated cost per trade (in the SQL); uncoded costs are "General". */
export function byTrade(rows: PlRow[], trades: PlTrade[]): GroupRow[] {
  const names = new Map(trades.map((t) => [t.slug, t.name]));
  const g = group(rows.filter((r) => !isOverhead(r)), (r) => r.trade ?? NO_TRADE);
  return [...g.entries()].map(([k, v]) => finish(k, k === NO_TRADE ? "General / not coded to a trade" : names.get(k) ?? k, v)).sort(byProfit);
}

/** Money in vs money out per bucket (for the bar chart). */
export function series(rows: PlRow[], buckets: string[], g: Grain): { bucket: string; label: string; moneyIn: string; moneyOut: string; net: string }[] {
  return buckets.map((b) => {
    const rs = rows.filter((r) => bucketOf(r.m, g) === b);
    const moneyIn = add(0, ...rs.filter((r) => r.dir === "income").map((r) => r.amount));
    const moneyOut = add(0, ...rs.filter((r) => r.dir === "cost").map((r) => r.amount));
    return { bucket: b, label: bucketLabel(b, g), moneyIn, moneyOut, net: sub(moneyIn, moneyOut) };
  });
}

/** Rows narrowed to one project / trade / category (used by the drill-down and the CSV). */
export interface Drill { dir?: "income" | "cost"; job?: string; trade?: string; category?: Category; overhead?: boolean }
export function filterRows(rows: PlRow[], f: Drill): PlRow[] {
  return rows.filter((r) =>
    (!f.dir || r.dir === f.dir)
    && (!f.job || (f.job === NO_JOB ? r.job === null : r.job === f.job))
    && (!f.trade || (f.trade === NO_TRADE ? r.trade === null : r.trade === f.trade))
    && (!f.category || (r.dir === "cost" && categoryOf(r.type) === f.category))
    && (f.overhead === undefined || (r.dir === "cost" && (r.job === null) === f.overhead)));
}
