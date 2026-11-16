/**
 * Internal Estimate Report: the contractor's private cost, markup, margin and profit view of an
 * estimate. Built only from the estimator's own engine (computeEstimate), so every number matches
 * the builder. Never used for customer-facing documents.
 *
 * Definitions (documented on the report):
 *   extended cost   = round2(quantity × unit cost)
 *   unit price      = round2(unit cost × pricing factor)   (markup: 1 + m; margin: 1 / (1 − m))
 *   extended price  = round2(quantity × unit price)
 *   gross profit    = selling price − direct cost
 *   markup %        = gross profit ÷ direct cost   (blank when cost is 0)
 *   gross margin %  = gross profit ÷ selling price (blank when price is 0)
 *   Selling price is before sales tax. The project adjustment (discount or fee) changes selling price
 *   and profit but not cost. Percentages are rounded to 0.1%; money to the cent, half up.
 */
import { computeEstimate, itemsForGroup, sortedGroups } from "@/lib/estimate/engine";
import { D, ZERO, type Dec } from "@/lib/estimate/money";
import type { CostType, Estimate } from "@/lib/estimate/types";
import type { QuoteComparison } from "@/lib/operations/sub-quotes";

export const COST_TYPE_LABELS: Record<CostType, string> = {
  material: "Materials", labor: "Labor", labor_material: "Labor & materials", equipment: "Equipment", subcontractor: "Subcontractors",
  overhead: "Overhead", contingency: "Contingency", permit: "Permits & fees", delivery: "Delivery", labor_burden: "Labor burden", other: "Other direct costs",
};

export interface ReportLine {
  name: string; costType: CostType; costTypeLabel: string; passThrough: boolean;
  quantity: string; unit: string; unitCost: string; extendedCost: string; unitPrice: string; extendedPrice: string;
  grossProfit: string; markupPct: string | null; marginPct: string | null; rule: string;
}
export interface ReportSection {
  name: string; trade: string | null; lines: ReportLine[];
  cost: string; price: string; grossProfit: string; markupPct: string | null; marginPct: string | null;
}
export interface InternalReport {
  title: string; number: string; customer: string; projectAddress: string; estimateDate: string; generatedAt: string;
  version: { number: number; createdAt: string } | null;
  pricingRule: string;
  sections: ReportSection[];
  costBreakdown: { costType: CostType; label: string; cost: string; share: string }[];
  totals: {
    directCost: string; itemsPrice: string; adjustment: string; adjustmentLabel: string | null; sellingPrice: string;
    tax: string; taxRate: string; rounding: string; customerTotal: string;
    grossProfit: string; markupPct: string | null; marginPct: string | null;
  };
  /** Components that exist on this estimate only (allowances/contingency/pass-through are never invented). */
  notes: string[];
  /**
   * V4.3: original estimate financials vs subcontractor bid financials (only when quotes exist and the
   * reader may see subcontractor costs). The estimate's own numbers above are never changed by quotes.
   */
  subQuotes?: QuoteComparison | null;
  issues: string[];
}

const money = (d: Dec) => d.toFixed(2);
const pct = (d: Dec | null) => (d === null ? null : d.toDecimalPlaces(1, D.ROUND_HALF_UP).toFixed(1));
const ratio = (num: Dec, den: Dec) => (den.isZero() ? null : num.div(den).times(100));
const ruleLabel = (r: { mode: string; percent: string } | null) => (r ? `${r.percent}% ${r.mode}` : "Billed at cost");

export function buildInternalReport(e: Estimate, opts: { version?: { number: number; createdAt: string } | null; now?: Date; subQuotes?: QuoteComparison | null } = {}): InternalReport {
  const t = computeEstimate(e);
  const breakdown = new Map<CostType, Dec>();
  const sections: ReportSection[] = [];
  let passThrough = 0;
  for (const g of sortedGroups(e)) {
    const gt = t.groups[g.id];
    const lines: ReportLine[] = [];
    for (const it of itemsForGroup(e, g.id)) {
      const x = t.items[it.id];
      if (!x) continue;
      if (it.treatment === "pass_through") passThrough++;
      breakdown.set(it.costType, (breakdown.get(it.costType) ?? ZERO).plus(x.extendedCost));
      lines.push({
        name: it.name || "Untitled item", costType: it.costType, costTypeLabel: COST_TYPE_LABELS[it.costType] ?? it.costType, passThrough: it.treatment === "pass_through",
        quantity: x.quantity.toString(), unit: it.unit, unitCost: money(x.unitCost), extendedCost: money(x.extendedCost),
        unitPrice: money(x.unitPrice), extendedPrice: money(x.extendedPrice), grossProfit: money(x.grossProfit),
        markupPct: pct(ratio(x.grossProfit, x.extendedCost)), marginPct: pct(ratio(x.grossProfit, x.extendedPrice)), rule: ruleLabel(x.appliedRule),
      });
    }
    if (!gt) continue;
    sections.push({
      name: g.name || "Untitled section", trade: g.trade ?? null, lines,
      cost: money(gt.cost), price: money(gt.price), grossProfit: money(gt.grossProfit),
      markupPct: pct(ratio(gt.grossProfit, gt.cost)), marginPct: pct(gt.grossMargin),
    });
  }
  const notes: string[] = [];
  if (passThrough) notes.push(`${passThrough} line item${passThrough === 1 ? " is" : "s are"} billed at cost (pass-through): no markup or profit.`);
  if (breakdown.has("contingency")) notes.push("Contingency is included as a direct cost line, as entered in the estimate.");
  if (!t.adjustment.isZero()) notes.push(`A project ${t.adjustment.isNegative() ? "discount" : "adjustment"} of $${money(t.adjustment.abs())} changes selling price and profit, not cost.`);
  if (!t.rounding.isZero()) notes.push(`The customer total is rounded to the whole dollar (${t.rounding.isNegative() ? "−" : "+"}$${money(t.rounding.abs())}).`);
  const totalCost = t.totalCost;
  return {
    title: e.title || "Untitled bid", number: e.estimateNumber, customer: e.customer.name, projectAddress: e.customer.projectAddress ?? "",
    estimateDate: e.estimateDate, generatedAt: (opts.now ?? new Date()).toISOString(), version: opts.version ?? null,
    pricingRule: ruleLabel(e.pricing),
    sections,
    costBreakdown: [...breakdown.entries()].filter(([, v]) => !v.isZero()).sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v]) => ({ costType: k, label: COST_TYPE_LABELS[k] ?? k, cost: money(v), share: pct(ratio(v, totalCost)) ?? "0.0" })),
    totals: {
      directCost: money(totalCost), itemsPrice: money(t.itemsPrice), adjustment: money(t.adjustment), adjustmentLabel: e.adjustmentLabel || null,
      sellingPrice: money(t.subtotal), tax: money(t.tax), taxRate: t.taxRate.toString(), rounding: money(t.rounding), customerTotal: money(t.total),
      grossProfit: money(t.grossProfit), markupPct: pct(t.effectiveMarkup), marginPct: pct(t.grossMargin),
    },
    notes,
    issues: t.issues.map((i) => i.message),
    subQuotes: opts.subQuotes?.lines.length ? opts.subQuotes : null,
  };
}

export function internalReportFilename(r: Pick<InternalReport, "title" | "number">) {
  const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "estimate";
  return `INTERNAL_${slug(r.title)}_${slug(r.number)}_cost-report.pdf`;
}
