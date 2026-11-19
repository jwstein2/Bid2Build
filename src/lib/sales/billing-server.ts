import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { serverEnv } from "../env";
import { commissionBasis, DEFAULT_POLICY, type BasisItem, type SalesPolicy } from "./basis";
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

type InvoiceLike = { id?: string; amount_paid?: number | null; status?: string | null; status_transitions?: { paid_at?: number | null } | null; created?: number };

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
    const basis = commissionBasis(sub.items.data as unknown as BasisItem[], policy, {
      monthly: e.stripePriceMonthly, annual: e.stripePriceAnnual, enterpriseBase: e.stripePriceEnterpriseBase || undefined,
      enterpriseSeat: e.stripePriceEnterpriseSeat || undefined, monthlyListCents,
    });
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
    return String((data as { action?: string })?.action ?? "synced");
  } catch (err) {
    logError("sales.sync_billing", err, { user: userId, subscription: sub.id });
    return "failed";
  }
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
    if (error) return "none";
    return String((data as { action?: string })?.action ?? "none");
  } catch (err) {
    logError("sales.refund", err, { charge: charge.id });
    return "failed";
  }
}
