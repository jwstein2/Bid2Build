/**
 * Pure helpers for Revenue & Commission Reconciliation (no server imports, unit tested).
 * Stripe stays the source of truth for whether a customer paid; these only reshape what Stripe says.
 */

export interface StripeInvoiceLike {
  id?: string; livemode?: boolean; status?: string | null; customer?: string | { id: string } | null; billing_reason?: string | null; currency?: string | null;
  amount_due?: number | null; amount_paid?: number | null; total?: number | null; total_excluding_tax?: number | null; created?: number | null;
  period_start?: number | null; period_end?: number | null; status_transitions?: { paid_at?: number | null } | null;
  subscription?: string | { id: string } | null; parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
}

const iso = (s: number | null | undefined) => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);
const ref = (v: string | { id: string } | null | undefined) => (v ? (typeof v === "string" ? v : v.id) : null);

/** What the customer paid before tax: amount paid scaled by the invoice's pre-tax share (same rule as Sales/Affiliates). */
export function pretaxPaidCents(inv: Pick<StripeInvoiceLike, "amount_paid" | "total" | "total_excluding_tax">): number {
  const paid = Math.max(0, inv.amount_paid ?? 0);
  const total = inv.total ?? null, pre = inv.total_excluding_tax ?? null;
  if (total == null || pre == null || total <= 0 || pre >= total) return paid;
  return Math.max(0, Math.round((paid * pre) / total));
}

/** The JSON billing_invoice_record() takes. `failed` marks an invoice.payment_failed event. */
export function invoiceFact(inv: StripeInvoiceLike, opts: { source: "webhook" | "reconcile"; userId?: string | null; failedAt?: Date | null }): Record<string, unknown> | null {
  if (!inv?.id) return null;
  const paid = inv.status === "paid";
  return {
    invoice_id: inv.id, livemode: inv.livemode === true, status: inv.status ?? "open", customer: ref(inv.customer),
    subscription_id: ref(inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null), user_id: opts.userId ?? null,
    billing_reason: inv.billing_reason ?? null, currency: (inv.currency ?? "usd").toLowerCase(),
    amount_due: Math.max(0, inv.amount_due ?? 0), amount_paid: paid ? Math.max(0, inv.amount_paid ?? 0) : 0, pretax_paid: paid ? pretaxPaidCents(inv) : 0,
    paid_at: paid ? iso(inv.status_transitions?.paid_at ?? null) ?? iso(inv.created) : null,
    failed_at: opts.failedAt ? opts.failedAt.toISOString() : null,
    period_start: iso(inv.period_start), period_end: iso(inv.period_end), created: iso(inv.created), source: opts.source,
  };
}

export interface Finding { fingerprint: string; scope: string; kind: string; severity: "material" | "action" | "info"; entity_type?: string; entity_id?: string; period_month?: string | null; amount_cents?: number | null; summary: string; detail?: unknown }

export const usd = (cents: number | null | undefined) =>
  ((cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Plain-language labels for the payment checks shown on the dashboard and in alerts. */
export const PROBLEM: Record<string, string> = {
  no_invoice: "No Stripe invoice linked", invoice_not_verified: "Stripe hasn't confirmed this invoice yet", not_live_payment: "Test-mode payment",
  invoice_not_paid: "Invoice not paid", zero_payment: "Nothing was paid", currency_mismatch: "Not in USD", customer_mismatch: "Invoice belongs to a different customer",
  dispute_open: "Chargeback open", dispute_lost: "Chargeback lost", fully_refunded: "Refunded", partial_refund: "Partly refunded (review)",
  in_refund_hold: "Inside the 30-day refund hold", bonus_line: "Bonus line (review)", above_auto_limit: "Above the automatic approval limit", own_statement: "Your own statement",
};

/** One email for everything that needs the owner (never sent when nothing does). */
export function alertDigest(items: { kind: string; severity: string; summary: string; amount_cents: number | null; repeat?: boolean }[]): { subject: string; body: string } | null {
  if (!items.length) return null;
  const material = items.filter((i) => i.severity === "material").length;
  const subject = material ? `Reconciliation: ${material} discrepanc${material === 1 ? "y" : "ies"} need${material === 1 ? "s" : ""} review` : `Reconciliation: ${items.length} item${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} action`;
  const lines = items.slice(0, 25).map((i) => `- ${i.severity === "material" ? "[Discrepancy]" : "[Action]"} ${i.summary}${i.amount_cents ? ` (${usd(Math.abs(i.amount_cents))})` : ""}${i.repeat ? " (still open)" : ""}`);
  if (items.length > 25) lines.push(`- and ${items.length - 25} more`);
  return { subject, body: ["Built2Bid's daily reconciliation found something that needs you. Everything else ran automatically.", "", ...lines, "",
    "Nothing was changed to make the books balance. Unrelated payouts keep running; affected ones wait until this is resolved or acknowledged."].join("\n") };
}

/** Monthly report as CSV rows (section, metric, value in dollars or count). */
export function reportCsv(report: Record<string, unknown>): string {
  const rows: string[][] = [["section", "metric", "value"]];
  const money = (k: string) => k.endsWith("_cents");
  for (const [section, v] of Object.entries(report)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "items" && Array.isArray(x)) {
          for (const it of x as Record<string, unknown>[]) rows.push(["discrepancy", String(it.kind ?? ""), `${it.severity ?? ""} ${it.status ?? ""}: ${it.summary ?? ""}${it.amount_cents != null ? ` (${usd(Math.abs(Number(it.amount_cents)))})` : ""}${it.ack_note ? ` | note: ${it.ack_note}` : ""}`]);
        } else rows.push([section, money(k) ? k.replace(/_cents$/, "_usd") : k, money(k) ? (Number(x ?? 0) / 100).toFixed(2) : String(x ?? "")]);
      }
    } else if (!Array.isArray(v)) rows.push(["report", section, String(v ?? "")]);
  }
  // Numbers stay numbers; any other cell starting like a formula is neutralized for spreadsheets.
  const esc = (c: string) => {
    if (/^-?\d+(\.\d+)?$/.test(c)) return c;
    const safe = /^[=+\-@]/.test(c) ? `'${c}` : c;
    return /[",\n']/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
