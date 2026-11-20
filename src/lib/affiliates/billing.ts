/**
 * Affiliate invoice facts. Pure: turns a Stripe invoice + its subscription items into the numbers the database
 * ledger stores (affiliate_record_invoice). The database applies the commission rule; this only measures.
 */
import { invoicePeriodMonths, listMrr, commissionBasis, type BasisItem, type BasisPrices } from "../sales/basis";

export interface InvoiceLineLike { amount?: number | null; period?: { start?: number | null; end?: number | null } | null }
export interface AffiliateInvoiceLike {
  id?: string; billing_reason?: string | null; amount_paid?: number | null; total?: number | null; total_excluding_tax?: number | null; status?: string | null;
  status_transitions?: { paid_at?: number | null } | null; created?: number; period_start?: number | null; period_end?: number | null;
  lines?: { data?: InvoiceLineLike[] } | null;
}

export interface InvoiceFacts {
  invoiceId: string; billingReason: string | null; paidAt: string; periodStart: string; periodEnd: string; periodMonths: number;
  grossCents: number; pretaxCents: number; listDivideCents: number; listMonthlyCents: number;
}

/** What the customer paid before tax: amount paid scaled by the invoice's pre-tax share of its total. */
export function pretaxPaid(inv: Pick<AffiliateInvoiceLike, "amount_paid" | "total" | "total_excluding_tax">): number {
  const paid = Math.max(0, inv.amount_paid ?? 0);
  const total = inv.total ?? null, pre = inv.total_excluding_tax ?? null;
  if (total == null || pre == null || total <= 0 || pre >= total) return paid;
  return Math.max(0, Math.round((paid * pre) / total));
}

/**
 * The service period the invoice pays for: the period of its largest positive line (the subscription line; a
 * proration credit is negative). Falls back to the invoice's own period, then to paid date + recurring months.
 */
export function servicePeriod(inv: AffiliateInvoiceLike, months: number): { start: number; end: number } | null {
  const lines = (inv.lines?.data ?? []).filter((l) => (l.amount ?? 0) > 0 && l.period?.start && l.period?.end && l.period.end > l.period.start);
  const best = lines.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
  if (best) return { start: best.period!.start!, end: best.period!.end! };
  if (inv.period_start && inv.period_end && inv.period_end > inv.period_start) return { start: inv.period_start, end: inv.period_end };
  const at = inv.status_transitions?.paid_at ?? inv.created;
  if (!at) return null;
  const d = new Date(at * 1000);
  const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + Math.max(1, Math.round(months)));
  return { start: at, end: Math.floor(e.getTime() / 1000) };
}

/** Invoice facts for a paid invoice, or null when the invoice isn't a paid, positive subscription invoice. */
export function invoiceFacts(inv: AffiliateInvoiceLike | null | undefined, items: BasisItem[], prices: BasisPrices): InvoiceFacts | null {
  if (!inv?.id || (inv.amount_paid ?? 0) <= 0 || (inv.status != null && inv.status !== "paid")) return null;
  const months = invoicePeriodMonths(items) ?? 1;
  const period = servicePeriod(inv, months);
  if (!period) return null;
  const spanMonths = Math.max(0.001, Math.round(((period.end - period.start) / (86400 * 30.4375)) * 1000) / 1000);
  const paidAt = inv.status_transitions?.paid_at ?? inv.created ?? period.start;
  return {
    invoiceId: inv.id, billingReason: inv.billing_reason ?? null, paidAt: new Date(paidAt * 1000).toISOString(),
    periodStart: new Date(period.start * 1000).toISOString(), periodEnd: new Date(period.end * 1000).toISOString(),
    // A full billing period uses the price's months exactly (annual = 12); a partial one its actual span.
    periodMonths: Math.abs(spanMonths - months) < 0.6 ? months : spanMonths,
    grossCents: inv.amount_paid ?? 0, pretaxCents: pretaxPaid(inv),
    listDivideCents: listMrr(items, prices).cents,
    listMonthlyCents: commissionBasis(items, { annual_basis: "monthly_list", value_scope: "all_items" }, prices).cents,
  };
}
