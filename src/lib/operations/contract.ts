/**
 * Contract value (V4.3): Original Contract + Approved Additions − Approved Deductions = Current
 * Approved Contract Value. Pending change orders (draft or sent) are reported separately and never
 * counted. Customer-facing prices only: no cost or margin.
 */
import { D, ZERO, type Dec } from "@/lib/estimate/money";

export type ChangeOrderStatus = "draft" | "sent" | "approved" | "signed" | "declined" | "void";
export interface ChangeOrderLine { kind: "add" | "remove" | "modify"; description: string; amount: number | string }
export interface ChangeOrderLike { status: ChangeOrderStatus; amount: number | string; lines?: ChangeOrderLine[] }

export interface ContractSummary {
  original: string;
  approvedAdditions: string;
  approvedDeductions: string;
  current: string;
  pendingAdditions: string;
  pendingDeductions: string;
  pendingNet: string;
  approvedCount: number;
  pendingCount: number;
}

const dec = (v: number | string | null | undefined): Dec => { try { return new D(v ?? 0); } catch { return ZERO; } };
export const isApproved = (s: ChangeOrderStatus) => s === "approved" || s === "signed";
export const isPending = (s: ChangeOrderStatus) => s === "draft" || s === "sent";

/** Additions and deductions of one change order, line by line (a change order can do both). */
export function splitChangeOrder(co: ChangeOrderLike): { additions: Dec; deductions: Dec } {
  const lines = co.lines?.length ? co.lines.map((l) => dec(l.amount)) : [dec(co.amount)];
  let additions = ZERO, deductions = ZERO;
  for (const a of lines) { if (a.isNegative()) deductions = deductions.plus(a.abs()); else additions = additions.plus(a); }
  return { additions, deductions };
}

export function contractSummary(original: number | string | null | undefined, changeOrders: ChangeOrderLike[]): ContractSummary {
  let aa = ZERO, ad = ZERO, pa = ZERO, pd = ZERO, approvedCount = 0, pendingCount = 0;
  for (const co of changeOrders) {
    const { additions, deductions } = splitChangeOrder(co);
    if (isApproved(co.status)) { aa = aa.plus(additions); ad = ad.plus(deductions); approvedCount++; }
    else if (isPending(co.status)) { pa = pa.plus(additions); pd = pd.plus(deductions); pendingCount++; }
  }
  const o = dec(original);
  const f = (d: Dec) => d.toFixed(2);
  return {
    original: f(o), approvedAdditions: f(aa), approvedDeductions: f(ad), current: f(o.plus(aa).minus(ad)),
    pendingAdditions: f(pa), pendingDeductions: f(pd), pendingNet: f(pa.minus(pd)), approvedCount, pendingCount,
  };
}

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: "Draft", sent: "Sent", approved: "Approved", signed: "Signed", declined: "Declined", void: "Void",
};
