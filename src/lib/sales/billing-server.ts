import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { serverEnv } from "../env";
import { commissionBasis, DEFAULT_POLICY, invoicePeriodMonths, listMrr, type BasisItem, type SalesPolicy } from "./basis";
import { decodeRepCookie } from "./link";

/**
 * Sales Portal hooks for the Stripe webhook and the signed-in layout. Every function here is best
 * effort and never throws: billing and sign-in must never depend on sales bookkeeping. The database
 * decides eligibility and makes every write idempotent (see 20270107001000_sales_portal.sql).
 */

/** Link a signed-in account to the rep whose link it arrived through (only new, never-paid accounts). */
export async function recordRepAttribution(db: SupabaseClient, userId: string, rawCookie: string | null | undefined): Promise<string | null> {
  const c = decodeRepCookie(rawCookie);
  if (!c) return null;
  try {
    const { data, error } = await db.rpc("sales_record_attribution", { p_user: userId, p_code: c.code, p_visit_at: c.visitAt?.toISOString() ?? null });
    if (error) return null; // migration not applied yet
    return data as string;
  } catch (e) {
    logError("sales.attribution", e, { user: userId });
    return null;
  }
}

async function loadPolicy(db: SupabaseClient): Promise<SalesPolicy | null> {
  const { data, error } = await db.rpc("sales_policy");
  if (error) return null; // migration not applied: nothing to do
  return { ...DEFAULT_POLICY, ...(data as Partial<SalesPolicy>) };
}

type InvoiceLike = { id?: string; billing_reason?: string | null; amount_paid?: number | null; total?: number | null; total_excluding_tax?: number | null; status?: string | null; status_transitions?: { paid_at?: number | null } | null; created?: number };

/**
 * Keep the attributed customer's plan, status and commission basis current, and (for a paid invoice)
 * let the database create the sale-month or anniversary commission. Accounts with no rep attribution
 * return immediately after one cheap database call.
 */
export async function syncSalesBilling(db: SupabaseClient, stripe: Stripe, sub: Stripe.Subscription, userId: string, opts: { invoice?: InvoiceLike | null; companyId?: string | null; plan?: string | null } = {}): Promise<string> {
  try {
    const { data: exists, error: ee } = await db.from("sales_attributions").select("user_id").eq("user_id", userId).maybeSingle();
    if (ee || !exists) return "none";
    const policy = await loadPolicy(db);
    if (!policy) return "none";
    const e = serverEnv();
    let monthlyListCents: number | null = null;
    if (policy.annual_basis === "monthly_list" && e.stripePriceMonthly) {
      monthlyListCents = (await stripe.prices.retrieve(e.stripePriceMonthly).catch(() => null))?.unit_amount ?? null;
    }
    const items = sub.items.data as unknown as BasisItem[];
    const prices = {
      monthly: e.stripePriceMonthly, annual: e.stripePriceAnnual, enterpriseBase: e.stripePriceEnterpriseBase || undefined,
      enterpriseSeat: e.stripePriceEnterpriseSeat || undefined, monthlyListCents,
    };
    const basis = commissionBasis(items, policy, prices);
    const inv = opts.invoice;
    const paid = inv && (inv.amount_paid ?? 0) > 0 && (inv.status == null || inv.status === "paid");
    const paidAtSec = inv?.status_transitions?.paid_at ?? inv?.created ?? null;
    const { data, error } = await db.rpc("sales_sync_billing", {
      p_user: userId, p_subscription_id: sub.id, p_status: sub.status, p_plan: opts.plan ?? null, p_company_id: opts.companyId ?? null,
      p_basis_cents: basis.cents, p_basis_detail: basis,
      p_invoice_id: paid ? inv!.id ?? null : null, p_amount_paid: paid ? inv!.amount_paid ?? 0 : 0,
      p_paid_at: paid && paidAtSec ? new Date(paidAtSec * 1000).toISOString() : null,
    });
    if (error) throw error;
    // Compensation V3: list MRR (annual / 12, every recurring item). Missing before 20270202001000: ignored.
    const mrr = listMrr(items, prices);
    await db.rpc("sales_set_mrr", { p_user: userId, p_mrr_cents: mrr.cents, p_detail: mrr }).then(() => null, () => null);
    // Collected revenue (before tax) for milestone bonuses, with the billing period and reason so the
    // database can tell a second billing cycle from a mid-period proration.
    if (paid && inv!.id) {
      const rev = {
        p_user: userId, p_invoice_id: inv!.id, p_gross_cents: inv!.amount_paid ?? 0, p_revenue_cents: revenueBeforeTax(inv!),
        p_paid_at: paidAtSec ? new Date(paidAtSec * 1000).toISOString() : null,
      };
      const v3 = await db.rpc("sales_record_revenue_v3", { ...rev, p_period_months: invoicePeriodMonths(items), p_billing_reason: inv!.billing_reason ?? null });
      if (v3.error) await db.rpc("sales_record_revenue", rev);
    }
    // First-month cancellation rule (V8): a cancel request, or a canceled subscription, is reported so the
    // database can cancel an unpaid sale-month commission when it came within the first month.
    const canceledAt = cancellationTime(sub);
    if (canceledAt) await db.rpc("sales_customer_canceled", { p_user: userId, p_canceled_at: canceledAt });
    return String((data as { action?: string })?.action ?? "synced");
  } catch (err) {
    logError("sales.sync_billing", err, { user: userId, subscription: sub.id });
    return "failed";
  }
}

/** What the customer paid before tax: amount paid scaled by the invoice's pre-tax share of its total. */
export function revenueBeforeTax(inv: Pick<InvoiceLike, "amount_paid" | "total" | "total_excluding_tax">): number {
  const paid = Math.max(0, inv.amount_paid ?? 0);
  const total = inv.total ?? null, pre = inv.total_excluding_tax ?? null;
  if (total == null || pre == null || total <= 0 || pre >= total) return paid;
  return Math.max(0, Math.round((paid * pre) / total));
}

/** When the customer asked to cancel (Stripe canceled_at), or now if the subscription is set to cancel. */
export function cancellationTime(sub: Pick<Stripe.Subscription, "status" | "cancel_at_period_end" | "cancel_at" | "canceled_at">): string | null {
  if (sub.canceled_at) return new Date(sub.canceled_at * 1000).toISOString();
  if (sub.status === "canceled" || sub.cancel_at_period_end || sub.cancel_at) return new Date().toISOString();
  return null;
}

/**
 * charge.refunded: find the invoice the charge paid and let the database apply the refund policy.
 * (Add "charge.refunded" to the Stripe webhook's events for this to run.)
 */
export async function salesChargeRefunded(db: SupabaseClient, stripe: Stripe, charge: Stripe.Charge): Promise<string> {
  try {
    let invoiceId: string | null = null;
    const legacy = (charge as unknown as { invoice?: string | { id: string } | null }).invoice;
    if (legacy) invoiceId = typeof legacy === "string" ? legacy : legacy.id;
    const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!invoiceId && pi) {
      const list = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
      const inv = list.data[0]?.invoice;
      invoiceId = inv ? (typeof inv === "string" ? inv : inv.id ?? null) : null;
    }
    if (!invoiceId) return "none";
    const full = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);
    const { data, error } = await db.rpc("sales_invoice_refunded", { p_invoice_id: invoiceId, p_full: full, p_refunded_at: new Date().toISOString() });
    await db.rpc("sales_revenue_refunded", { p_invoice_id: invoiceId, p_refunded_gross_cents: charge.amount_refunded ?? 0 });
    if (error) return "none";
    return String((data as { action?: string })?.action ?? "none");
  } catch (err) {
    logError("sales.refund", err, { charge: charge.id });
    return "failed";
  }
}

/**
 * Chargebacks (charge.dispute.created / charge.dispute.closed): a disputed invoice stops counting toward
 * milestone qualification and MRR; a won dispute restores it. Already-earned awards are never changed.
 * (Add both events to the Stripe webhook for this to run.)
 */
export async function salesChargeDispute(db: SupabaseClient, stripe: Stripe, dispute: Pick<Stripe.Dispute, "id" | "charge" | "status">, closed: boolean): Promise<string> {
  try {
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
    if (!chargeId) return "none";
    const charge = await stripe.charges.retrieve(chargeId);
    let invoiceId: string | null = null;
    const legacy = (charge as unknown as { invoice?: string | { id: string } | null }).invoice;
    if (legacy) invoiceId = typeof legacy === "string" ? legacy : legacy.id;
    const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!invoiceId && pi) {
      const list = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
      const inv = list.data[0]?.invoice;
      invoiceId = inv ? (typeof inv === "string" ? inv : inv.id ?? null) : null;
    }
    if (!invoiceId) return "none";
    const disputed = !closed || dispute.status !== "won";
    const { data, error } = await db.rpc("sales_revenue_disputed", { p_invoice_id: invoiceId, p_disputed: disputed });
    if (error) return "none";
    return String((data as { action?: string })?.action ?? "none");
  } catch (err) {
    logError("sales.dispute", err, { dispute: dispute.id });
    return "failed";
  }
}
