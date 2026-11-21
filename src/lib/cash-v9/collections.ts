/**
 * When will a customer pay? (pure)
 *
 * Priority: a per-customer override you set > this customer's own history (when they have at least the minimum number of
 * paid invoices and history is on) > your company default (3, 5, 7, 14, 30 or any number of days).
 * Each rule says whether the days count from the invoice date ("issue") or from the due date ("due").
 * Unpaid invoices are never cash: they only move the projected balance on their projected payment date.
 */
import { addDays, diffDays, maxD, shortDate } from "./dates";
import type { CashSettings, CollectionBasis, Scenario } from "./settings";

export interface PaidInvoice { customerId: string | null; issueDate: string | null; dueDate: string | null; paidOn: string | null }
export interface CustomerHistory { n: number; afterIssue: number; afterDue: number }
export interface CollectionOverride { days: number; basis: CollectionBasis }
export interface CollectionRule { days: number; basis: CollectionBasis; source: "override" | "history" | "default"; sample: number; confidence: "high" | "medium" | "low" }

/** Average days paid after the invoice date and after the due date, per customer, from fully paid invoices. */
export function customerHistory(paid: PaidInvoice[]): Record<string, CustomerHistory> {
  const acc: Record<string, { n: number; issue: number; due: number }> = {};
  for (const p of paid) {
    if (!p.customerId || !p.paidOn || !p.issueDate) continue;
    const a = (acc[p.customerId] ??= { n: 0, issue: 0, due: 0 });
    a.n++;
    a.issue += Math.max(0, diffDays(p.paidOn, p.issueDate));
    a.due += Math.max(0, diffDays(p.paidOn, p.dueDate ?? p.issueDate));
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { n: v.n, afterIssue: Math.round(v.issue / v.n), afterDue: Math.round(v.due / v.n) }]));
}

export function collectionRule(customerId: string | null, s: Pick<CashSettings, "collectionDays" | "collectionBasis" | "useHistory" | "historyMinSample">,
  history: Record<string, CustomerHistory>, overrides: Record<string, CollectionOverride>): CollectionRule {
  const o = customerId ? overrides[customerId] : undefined;
  if (o) return { days: o.days, basis: o.basis, source: "override", sample: 0, confidence: "medium" };
  const h = customerId ? history[customerId] : undefined;
  if (s.useHistory && h && h.n >= s.historyMinSample) {
    const basis = s.collectionBasis;
    return { days: basis === "issue" ? h.afterIssue : h.afterDue, basis, source: "history", sample: h.n, confidence: h.n >= s.historyMinSample * 2 ? "high" : "medium" };
  }
  return { days: s.collectionDays, basis: s.collectionBasis, source: "default", sample: h?.n ?? 0, confidence: "low" };
}

export function scenarioRule(r: CollectionRule, scenario: Scenario, s: Pick<CashSettings, "conservativeLateDays">): CollectionRule {
  if (scenario === "conservative") return { ...r, days: r.days + s.conservativeLateDays };
  if (scenario === "optimistic") return { ...r, days: 0, basis: "due" };
  return r;
}

export function ruleText(r: CollectionRule): string {
  const when = r.basis === "issue" ? "after the invoice date" : "after the due date";
  if (r.source === "override") return `You set this customer to pay ${r.days} days ${when}`;
  if (r.source === "history") return `This customer has paid ${r.days} days ${when} on average (${r.sample} paid invoices)`;
  return `Your default: ${r.days} days ${when}${r.sample ? ` (only ${r.sample} paid invoices from this customer so far)` : ""}`;
}

/**
 * Projected payment date. An invoice already past its projected date is assumed to arrive soon (today + the rule's days,
 * at least 1), never in the past.
 */
export function projectPayment(issueDate: string, dueDate: string | null, r: CollectionRule, today: string): { date: string; late: boolean; text: string } {
  const base = r.basis === "issue" ? issueDate : (dueDate ?? issueDate);
  const projected = addDays(base, r.days);
  if (projected < today) return { date: addDays(today, Math.max(1, Math.min(r.days, 14))), late: true, text: `${ruleText(r)}. It is past that, so it is assumed in the next ${Math.max(1, Math.min(r.days, 14))} days.` };
  return { date: maxD(projected, today), late: false, text: `${ruleText(r)}: expected ${shortDate(maxD(projected, today))}.` };
}
