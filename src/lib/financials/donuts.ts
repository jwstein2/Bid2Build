/**
 * Data for the circle (donut) overviews on Financials home and the Profit & Loss page (pure, unit-tested).
 * Every slice is a real amount from recorded records, and every slice links to the records behind it.
 * At most 6 slices: smaller ones fold into "Everything else" so the colors stay tellable apart.
 */
import { add, cmp, sub, D } from "./money";
import { CATEGORIES, CATEGORY_LABELS, categoryOf, type Category, type PlRow } from "./reports";

export interface Slice { key: string; label: string; amount: string; pct: string; tone: SliceTone; href?: string }
/** Categorical slots 1-6 (fixed order, never cycled) or a reserved status meaning. */
export type SliceTone = "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "ok" | "info" | "danger" | "muted" | "rest";
/** Each cost category keeps one fixed slot (color follows the category, never its size). */
const CAT_TONE: Record<Category, SliceTone> = { materials: "c1", labor: "c2", subcontractors: "c3", equipment: "c4", permits: "c5", labor_material: "c6", other: "rest", uncategorized: "muted" };
export const MAX_SLICES = 6;

const pctOf = (part: string, total: string) => (cmp(total, 0) > 0 ? new D(part).div(total).times(100).toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0) : "0");

/** Positive slices only, largest first, folded to MAX_SLICES; tones follow the slice's fixed category slot, never its rank. */
function finish(parts: { key: string; label: string; amount: string; href?: string; tone?: SliceTone }[], otherHref?: string, keepOrder = false): { slices: Slice[]; total: string } {
  const pos = parts.filter((p) => cmp(p.amount, 0) > 0);
  if (!keepOrder) pos.sort((a, b) => cmp(b.amount, a.amount));
  const total = add(0, ...pos.map((p) => p.amount));
  let keep = pos;
  if (pos.length > MAX_SLICES) {
    const ranked = [...pos].sort((a, b) => cmp(b.amount, a.amount));
    const top = new Set(ranked.slice(0, MAX_SLICES - 1).map((p) => p.key));
    keep = pos.filter((p) => top.has(p.key));
    const rest = pos.filter((p) => !top.has(p.key));
    keep.push({ key: "rest", label: "Everything else", amount: add(0, ...rest.map((p) => p.amount)), href: otherHref, tone: "rest" });
  }
  return { slices: keep.map((p) => ({ key: p.key, label: p.label, amount: p.amount, pct: pctOf(p.amount, total), tone: p.tone ?? "muted", href: p.href })), total };
}

/** Where the money goes: costs by category (job costs and overhead together). */
export function costSlices(rows: PlRow[], href: (c: Category) => string, otherHref?: string) {
  const by = new Map<Category, string>();
  for (const r of rows) if (r.dir === "cost") { const c = categoryOf(r.type); by.set(c, add(by.get(c) ?? "0", r.amount)); }
  const parts = CATEGORIES.filter((c) => by.has(c)).map((c) => ({ key: c, label: CATEGORY_LABELS[c], amount: by.get(c)!, href: href(c), tone: CAT_TONE[c] }));
  // Fixed category order around the ring: neighbouring colors stay the validated pairs.
  return finish(parts, otherHref, true);
}

/** Where each revenue dollar went: job costs, overhead, and what was left as profit. Null when there is no revenue. */
export function revenueSlices(t: { revenue: string; jobCosts: string; overhead: string; netProfit: string }, hrefs: { jobCosts: string; overhead: string; profit: string }) {
  if (cmp(t.revenue, 0) <= 0) return null;
  const loss = cmp(t.netProfit, 0) < 0;
  const parts = [
    { key: "job_costs", label: "Job costs", amount: t.jobCosts, href: hrefs.jobCosts, tone: "c1" as const },
    { key: "overhead", label: "Overhead", amount: t.overhead, href: hrefs.overhead, tone: "muted" as const },
    { key: "profit", label: "Net profit", amount: loss ? "0.00" : t.netProfit, href: hrefs.profit, tone: "ok" as const },
  ];
  const r = finish(parts, undefined, true);
  return { ...r, loss: loss ? sub(0, t.netProfit) : null };
}

export interface InvoiceRow { total: string | number; paid: string | number; credited: string | number; balance: string | number; days_overdue: number | string }
/** Issued invoices: paid (incl. credits), open and not yet due, overdue. Status colors, always with labels. */
export function invoiceSlices(rows: InvoiceRow[], hrefs: { paid: string; open: string; overdue: string }) {
  const m = (v: string | number) => (typeof v === "number" ? v.toFixed(2) : v || "0");
  const paid = add(0, ...rows.map((r) => add(m(r.paid), m(r.credited))));
  const open = add(0, ...rows.filter((r) => Number(r.days_overdue) <= 0).map((r) => m(r.balance)));
  const overdue = add(0, ...rows.filter((r) => Number(r.days_overdue) > 0).map((r) => m(r.balance)));
  const r = finish([
    { key: "paid", label: "Paid", amount: paid, href: hrefs.paid, tone: "ok" },
    { key: "open", label: "Not due yet", amount: open, href: hrefs.open, tone: "info" },
    { key: "overdue", label: "Overdue", amount: overdue, href: hrefs.overdue, tone: "danger" },
  ]);
  // Keep the status order (paid, not due, overdue), not size order.
  const order = ["paid", "open", "overdue"];
  return { ...r, slices: r.slices.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) };
}

/** The calendar day n days before now (YYYY-MM-DD, UTC). */
export const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 864e5).toISOString().slice(0, 10);
