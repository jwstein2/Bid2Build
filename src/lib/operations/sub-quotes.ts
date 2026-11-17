/**
 * Subcontractor quotes start on an estimate line item (V4.3 amendment). Quotes and revisions are
 * unapproved values: they never change the estimate, its prices, or the internal cost forecast until
 * someone with permission explicitly chooses "Update internal project cost" (or prepares a change
 * order). This module only compares numbers for display and reports.
 */
import { computeEstimate } from "@/lib/estimate/engine";
import { D, ZERO, type Dec } from "@/lib/estimate/money";
import type { Estimate } from "@/lib/estimate/types";

export interface SubQuoteRevision {
  id: string; revision: number; amount: number | string; quoteDate: string | null; note: string | null;
  documentPath: string | null; documentName: string | null; createdAt: string; createdBy: string | null;
}
export interface SubQuote {
  id: string; itemId: string; groupId: string | null; itemName: string; resourceId: string | null; vendorName: string;
  estimatedCost: number | string; status: "received" | "under_review" | "accepted" | "rejected"; internalNotes: string | null;
  appliedRevisionId: string | null; createdAt: string; revisions: SubQuoteRevision[];
}
export interface CostAdjustment {
  id: string; itemId: string | null; groupId: string | null; quoteId: string | null; revisionId: string | null;
  amount: number | string; forecastCost: number | string; note: string | null; createdAt: string; createdBy: string | null;
}
export interface SubQuoteBundle {
  canView: boolean; canRecord: boolean; canApply: boolean; quotes: SubQuote[]; adjustments: CostAdjustment[];
}

export const SUB_QUOTE_STATUS_LABELS: Record<SubQuote["status"], string> = {
  received: "Received", under_review: "Under review", accepted: "Accepted", rejected: "Rejected",
};

const dec = (v: number | string | null | undefined): Dec => { try { return new D(v ?? 0); } catch { return ZERO; } };
const money = (d: Dec) => d.toFixed(2);
const pct = (num: Dec, den: Dec) => (den.isZero() ? null : num.div(den).times(100).toDecimalPlaces(1, D.ROUND_HALF_UP).toFixed(1));

export const originalRevision = (q: SubQuote) => q.revisions[0] ?? null;
export const latestRevision = (q: SubQuote) => q.revisions[q.revisions.length - 1] ?? null;

/** The quote that represents a line: the accepted/applied one, else the newest non-rejected one. */
export function primaryQuote(quotes: SubQuote[]): SubQuote | null {
  const live = quotes.filter((q) => q.status !== "rejected" && q.revisions.length);
  return live.find((q) => q.appliedRevisionId) ?? live.find((q) => q.status === "accepted") ?? live[live.length - 1] ?? null;
}

/**
 * V6-15: the accepted amount for one scope section, to share with the subcontractor who quoted it.
 * Counts quotes in the section's group that were accepted (or applied), for that resource when one is
 * named; the applied revision wins, else the newest. Null when nothing is accepted.
 */
export function approvedSubAmount(quotes: SubQuote[], groupId: string, resourceId: string | null): string | null {
  let sum = ZERO, n = 0;
  for (const q of quotes) {
    if (q.groupId !== groupId || q.status === "rejected" || !(q.status === "accepted" || q.appliedRevisionId)) continue;
    if (resourceId && q.resourceId !== resourceId) continue;
    const r = q.revisions.find((x) => x.id === q.appliedRevisionId) ?? latestRevision(q);
    if (!r) continue;
    sum = sum.plus(dec(r.amount)); n++;
  }
  return n ? money(sum) : null;
}

export interface LineComparison {
  itemId: string; itemName: string; groupId: string | null; vendorName: string; quoteCount: number; status: SubQuote["status"];
  originalCost: string;            // the estimate's own cost for the line (today's estimate)
  originalQuote: string | null;    // first amount recorded for the primary quote
  revisedQuote: string | null;     // newest amount (null when never revised)
  latestQuote: string | null;
  difference: string | null;       // latest quote − original cost
  sellingPrice: string;            // what the customer pays for the line (unchanged by quotes)
  originalProfit: string; originalMargin: string | null;
  forecastProfit: string | null; forecastMargin: string | null;
  appliedForecast: string | null;  // the internal forecast someone approved (null = not applied)
  unapproved: boolean;             // the latest quote differs from the approved forecast
}

export interface QuoteComparison {
  lines: LineComparison[];
  totals: {
    originalCost: string; forecastCost: string; sellingPrice: string; difference: string;
    originalProfit: string; originalMargin: string | null; forecastProfit: string; forecastMargin: string | null;
    appliedAdjustments: string; unapprovedLines: number;
  };
}

/**
 * Original estimate financials vs subcontractor bid financials. The estimate (and so the selling
 * price) is never modified: the forecast only swaps a line's cost for its latest quote.
 */
export function compareQuotes(estimate: Estimate, bundle: Pick<SubQuoteBundle, "quotes" | "adjustments">): QuoteComparison {
  const t = computeEstimate(estimate);
  const byItem = new Map<string, SubQuote[]>();
  for (const q of bundle.quotes) byItem.set(q.itemId, [...(byItem.get(q.itemId) ?? []), q]);
  const applied = new Map<string, Dec>();
  for (const a of bundle.adjustments) if (a.itemId) applied.set(a.itemId, dec(a.forecastCost));

  const lines: LineComparison[] = [];
  let delta = ZERO, adj = ZERO, unapprovedLines = 0;
  for (const [itemId, qs] of byItem) {
    const q = primaryQuote(qs);
    if (!q) continue;
    const it = t.items[itemId];
    const item = estimate.items.find((i) => i.id === itemId);
    const cost = it ? it.extendedCost : dec(q.estimatedCost);
    const price = it ? it.extendedPrice : ZERO;
    const first = originalRevision(q), last = latestRevision(q);
    const latest = last ? dec(last.amount) : null;
    const diff = latest ? latest.minus(cost) : null;
    if (diff && it) delta = delta.plus(diff);
    const ap = applied.get(itemId) ?? null;
    if (ap) adj = adj.plus(ap.minus(cost));
    const unapproved = latest !== null && (ap === null || !ap.eq(latest));
    if (unapproved) unapprovedLines++;
    const gp = price.minus(cost);
    const fgp = latest ? price.minus(latest) : null;
    lines.push({
      itemId, itemName: item?.name || q.itemName || "Line item", groupId: item?.groupId ?? q.groupId, vendorName: q.vendorName, quoteCount: qs.length, status: q.status,
      originalCost: money(cost), originalQuote: first ? money(dec(first.amount)) : null,
      revisedQuote: last && first && last.id !== first.id ? money(dec(last.amount)) : null,
      latestQuote: latest ? money(latest) : null, difference: diff ? money(diff) : null, sellingPrice: money(price),
      originalProfit: money(gp), originalMargin: pct(gp, price),
      forecastProfit: fgp ? money(fgp) : null, forecastMargin: fgp ? pct(fgp, price) : null,
      appliedForecast: ap ? money(ap) : null, unapproved,
    });
  }
  const price = t.subtotal; // selling price before tax (includes the project adjustment)
  const cost = t.totalCost;
  const fcost = cost.plus(delta);
  return {
    lines,
    totals: {
      originalCost: money(cost), forecastCost: money(fcost), sellingPrice: money(price), difference: money(delta),
      originalProfit: money(price.minus(cost)), originalMargin: pct(price.minus(cost), price),
      forecastProfit: money(price.minus(fcost)), forecastMargin: pct(price.minus(fcost), price),
      appliedAdjustments: money(adj), unapprovedLines,
    },
  };
}
