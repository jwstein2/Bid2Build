/**
 * Product activation: what counts as a meaningful first bid, the 7-day activation rule and the
 * dashboard "first bid" checklist. Pure functions (no I/O) shared by the server, the owner reports
 * and tests. Definitions are written out in docs/growth/ACTIVATION.md.
 *
 * Two activation measures are reported side by side and never merged:
 *  - "Activated business" (existing, unchanged): the account finalized at least one bid, at any time.
 *  - "Activated within 7 days" (new): within 7 days of signup the account saved an estimate with at
 *    least 3 meaningful line items, finalized (exported) a bid, or sent one for signature.
 */
import type { Estimate, LineItem } from "@/lib/estimate/types";

export const MEANINGFUL_ITEMS = 3;
export const ACTIVATION_WINDOW_DAYS = 7;
const DAY = 86_400_000;

/** A line item a contractor actually priced: named, quantity above zero and a unit cost above zero. Example rows never count. */
export function isMeaningfulItem(i: Pick<LineItem, "name" | "quantity" | "unitCost" | "isExample">): boolean {
  if (i.isExample) return false;
  const q = Number(i.quantity), c = Number(i.unitCost);
  return i.name.trim().length > 0 && Number.isFinite(q) && q > 0 && Number.isFinite(c) && c > 0;
}

export function meaningfulItemCount(e: Pick<Estimate, "items">): number {
  return e.items.reduce((n, i) => (isMeaningfulItem(i) ? n + 1 : n), 0);
}

export const isMeaningfulEstimate = (e: Pick<Estimate, "items">) => meaningfulItemCount(e) >= MEANINGFUL_ITEMS;

/**
 * When an account met the 7-day activation rule, or null. Each input is the first time that thing
 * happened (ISO), or null. The earliest qualifying action inside the window wins.
 */
export function activatedAt(createdAt: string, firsts: { meaningful?: string | null; exported?: string | null; sent?: string | null }): string | null {
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return null;
  const end = start + ACTIVATION_WINDOW_DAYS * DAY;
  let best: number | null = null;
  for (const iso of [firsts.meaningful, firsts.exported, firsts.sent]) {
    if (!iso) continue;
    const v = Date.parse(iso);
    // Small negative skew (clock differences between Auth and the database) still counts.
    if (Number.isFinite(v) && v >= start - 60_000 && v <= end && (best === null || v < best)) best = v;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Whether the account is still inside its activation window (so an activation event can still be earned). */
export const inActivationWindow = (createdAt: string, now = Date.now()) => {
  const s = Date.parse(createdAt);
  return Number.isFinite(s) && now <= s + ACTIVATION_WINDOW_DAYS * DAY;
};

// ---------------------------------------------------------------------------------------------
// Dashboard checklist
// ---------------------------------------------------------------------------------------------
export type ChecklistKey = "company" | "project" | "items" | "preview" | "deliver";
export interface ChecklistFacts {
  companyName: boolean;
  estimates: number;
  meaningfulEstimates: number;
  previewed: boolean;
  /** Finalized (exported) a bid or sent one for signature. */
  delivered: boolean;
  /** Most recently updated bid, to continue where the contractor left off. */
  latestEstimateId?: string | null;
}
export interface ChecklistStep { key: ChecklistKey; label: string; hint: string; done: boolean; href: string; cta: string }

export function checklistSteps(f: ChecklistFacts): ChecklistStep[] {
  const bid = f.latestEstimateId ? `/estimates/${f.latestEstimateId}` : "/new-bid";
  const delivered = f.delivered;
  return [
    { key: "company", label: "Add your company name", hint: "It goes on every proposal. Logo and contact details can come later.", done: f.companyName, href: "/settings/company", cta: "Add company" },
    { key: "project", label: "Start your first project", hint: "Pick your trade and the estimate opens with the usual sections in place.", done: f.estimates > 0, href: "/new-bid", cta: "Pick a trade" },
    { key: "items", label: `Price at least ${MEANINGFUL_ITEMS} line items`, hint: "Enter quantities and your own costs. The calculators can work out quantities.", done: f.meaningfulEstimates > 0 || delivered, href: bid, cta: "Continue estimate" },
    { key: "preview", label: "Preview the customer proposal", hint: "See exactly what your customer will see. Your costs and markup stay hidden.", done: f.previewed || delivered, href: f.latestEstimateId ? `/estimates/${f.latestEstimateId}?step=proposal` : bid, cta: "Preview" },
    { key: "deliver", label: "Download or send your first bid", hint: "Download a branded PDF or send it for e-signature.", done: delivered, href: f.latestEstimateId ? `/estimates/${f.latestEstimateId}?step=proposal` : bid, cta: "Finish bid" },
  ];
}

/** Show the checklist only while something is left to do and the contractor hasn't hidden it. */
export function showChecklist(steps: ChecklistStep[], dismissed: boolean): boolean {
  return !dismissed && steps.some((s) => !s.done);
}

/** Auth user_metadata key that records "hide the getting-started checklist" (no schema change). */
export const CHECKLIST_DISMISSED_KEY = "b2b_checklist_dismissed_at";
