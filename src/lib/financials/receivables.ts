/**
 * Accounts Receivable math (pure, unit-tested). Inputs are rows from fin_ar_invoices_v (issued invoices
 * only) and fin_payment_balances_v. Only issued invoices with an open balance count as receivables; future
 * milestones never do. Money stays as decimal strings.
 */
import { add, cmp, sub } from "./money";

export type Bucket = "current" | "1_30" | "31_60" | "61_90" | "over_90";
export const BUCKETS: Bucket[] = ["current", "1_30", "31_60", "61_90", "over_90"];
export const BUCKET_LABELS: Record<Bucket, string> = { current: "Current (not due)", "1_30": "1–30 days overdue", "31_60": "31–60 days overdue", "61_90": "61–90 days overdue", over_90: "Over 90 days overdue" };

export interface ArRow {
  invoice_id: string; job_id: string; estimate_id: string; job_number: string; job_name: string;
  customer_id: string | null; customer_name: string | null; number: string; kind: string; status: string;
  issue_date: string; due_date: string; total: string; paid: string; credited: string; balance: string;
  days_overdue: number; aging_bucket: string; sales_rep_id: string | null; project_manager_id: string | null;
}
export interface PayRow { payment_id: string; received_on: string; amount: string; refunded: string; unapplied: string; status: string; customer_id: string | null; job_id: string | null }

export interface ArFilters {
  bucket?: Bucket | "open" | "overdue" | "paid" | "due_soon" | "all";
  customer?: string; job?: string; rep?: string; pm?: string;
  from?: string; to?: string;   // due-date range
  q?: string;
}

export const isOpen = (r: ArRow) => cmp(r.balance, 0) > 0;

export function filterAr(rows: ArRow[], f: ArFilters, today: string, soon: string): ArRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.customer && r.customer_id !== f.customer) return false;
    if (f.job && r.job_id !== f.job) return false;
    if (f.rep && r.sales_rep_id !== f.rep) return false;
    if (f.pm && r.project_manager_id !== f.pm) return false;
    if (f.from && r.due_date < f.from) return false;
    if (f.to && r.due_date > f.to) return false;
    if (q && !`${r.number} ${r.customer_name ?? ""} ${r.job_name} ${r.job_number}`.toLowerCase().includes(q)) return false;
    const b = f.bucket ?? "open";
    if (b === "all") return true;
    if (b === "paid") return !isOpen(r);
    if (!isOpen(r)) return false;
    if (b === "open") return true;
    if (b === "overdue") return r.days_overdue > 0;
    if (b === "due_soon") return r.days_overdue === 0 && r.due_date >= today && r.due_date <= soon;
    return r.aging_bucket === b;
  });
}

export interface ArTotals { outstanding: string; buckets: Record<Bucket, string>; counts: Record<Bucket, number>; overdue: string; openCount: number; dueSoon: string; dueSoonCount: number }

/** Aging totals over the rows passed in (callers pass rows already filtered by customer / job / rep / PM). */
export function arTotals(rows: ArRow[], today: string, soon: string): ArTotals {
  const open = rows.filter(isOpen);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, add(0, ...open.filter((r) => r.aging_bucket === b).map((r) => r.balance))])) as Record<Bucket, string>;
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, open.filter((r) => r.aging_bucket === b).length])) as Record<Bucket, number>;
  const soonRows = open.filter((r) => r.days_overdue === 0 && r.due_date >= today && r.due_date <= soon);
  return {
    outstanding: add(0, ...open.map((r) => r.balance)), buckets, counts,
    overdue: add(0, ...open.filter((r) => r.days_overdue > 0).map((r) => r.balance)), openCount: open.length,
    dueSoon: add(0, ...soonRows.map((r) => r.balance)), dueSoonCount: soonRows.length,
  };
}

/** Cash collected in [from, to]: active payments received in the period, net of their refunds. */
export function collectedIn(pays: PayRow[], from: string, to: string): string {
  const inRange = pays.filter((p) => p.status === "active" && p.received_on >= from && p.received_on <= to);
  return sub(add(0, ...inRange.map((p) => p.amount)), add(0, ...inRange.map((p) => p.refunded || "0")));
}

export const unappliedTotal = (pays: PayRow[]) => add(0, ...pays.filter((p) => p.status === "active").map((p) => p.unapplied || "0"));

/** The next step for an open invoice, in contractor words. */
export function nextAction(r: ArRow): string {
  if (!isOpen(r)) return "Paid";
  if (r.days_overdue > 60) return "Call the customer";
  if (r.days_overdue > 0) return "Send a reminder";
  if (cmp(r.paid, 0) > 0) return "Partial payment received";
  return "Waiting for payment";
}

/** Today, today + 14 days, and the collection period window, as YYYY-MM-DD (UTC). */
export function arDates(period: "month" | "last_month" | "year", now = new Date()) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = iso(now);
  const soon = iso(new Date(now.getTime() + 14 * 864e5));
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const range: [string, string] = period === "year" ? [`${y}-01-01`, today]
    : period === "last_month" ? [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))]
    : [iso(new Date(Date.UTC(y, m, 1))), today];
  return { today, soon, from: range[0], to: range[1] };
}
