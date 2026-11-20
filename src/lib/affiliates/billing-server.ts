import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { serverEnv } from "../env";
import type { BasisItem } from "../sales/basis";
import { decodeAffiliateCookie } from "./link";
import { invoiceFacts, type AffiliateInvoiceLike } from "./billing";

/**
 * Affiliate Hub hooks for the Stripe webhook and the signed-in layout. Best effort and never throw: billing and
 * sign-in never depend on affiliate bookkeeping. The database decides eligibility and keeps every write idempotent
 * (see 20270211001000_affiliate_hub.sql). Customers with no affiliate return after one cheap lookup.
 */

export async function recordAffiliateAttribution(db: SupabaseClient, userId: string, rawCookie: string | null | undefined): Promise<string | null> {
  const c = decodeAffiliateCookie(rawCookie);
  if (!c) return null;
  try {
    const { data, error } = await db.rpc("affiliate_record_attribution", { p_user: userId, p_code: c.code, p_visit_at: c.visitAt?.toISOString() ?? null, p_click: c.clickId });
    if (error) return null; // migration not applied yet
    return data as string;
  } catch (e) {
    logError("affiliate.attribution", e, { user: userId });
    return null;
  }
}

async function referred(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from("affiliate_referrals").select("user_id").eq("user_id", userId).maybeSingle();
  return !error && !!data;
}

/** Keep the referred customer's subscription state current and record a paid invoice for the annual ledger. */
export async function syncAffiliateBilling(db: SupabaseClient, stripe: Stripe, sub: Stripe.Subscription, userId: string, opts: { invoice?: AffiliateInvoiceLike | null; plan?: string | null } = {}): Promise<string> {
  try {
    if (!(await referred(db, userId))) return "none";
    const e = serverEnv();
    const monthlyListCents = e.stripePriceMonthly ? (await stripe.prices.retrieve(e.stripePriceMonthly).catch(() => null))?.unit_amount ?? null : null;
    const items = sub.items.data as unknown as BasisItem[];
    const prices = { monthly: e.stripePriceMonthly, annual: e.stripePriceAnnual, enterpriseBase: e.stripePriceEnterpriseBase || undefined, enterpriseSeat: e.stripePriceEnterpriseSeat || undefined, monthlyListCents };
    const facts = invoiceFacts(opts.invoice, items, prices);
    const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : sub.cancel_at_period_end || sub.cancel_at ? new Date().toISOString() : null;
    await db.rpc("affiliate_sync_subscription", {
      p_user: userId, p_subscription_id: sub.id, p_status: sub.status, p_plan: opts.plan ?? null,
      p_list_basis_cents: facts?.listDivideCents ?? null, p_canceled_at: canceledAt,
    });
    if (!facts) return "synced";
    const { data, error } = await db.rpc("affiliate_record_invoice", {
      p_user: userId, p_invoice_id: facts.invoiceId, p_subscription_id: sub.id, p_billing_reason: facts.billingReason, p_paid_at: facts.paidAt,
      p_period_start: facts.periodStart, p_period_end: facts.periodEnd, p_period_months: facts.periodMonths, p_gross_cents: facts.grossCents,
      p_pretax_cents: facts.pretaxCents, p_list_divide_cents: facts.listDivideCents, p_list_monthly_cents: facts.listMonthlyCents,
      p_detail: { plan: opts.plan ?? null, items: items.map((i) => ({ price: i.price?.id, qty: i.quantity ?? 1 })) },
    });
    if (error) throw error;
    return String((data as { action?: string })?.action ?? "recorded");
  } catch (err) {
    logError("affiliate.sync_billing", err, { user: userId, subscription: sub.id });
    return "failed";
  }
}

/** The invoice a charge paid (legacy charge.invoice, else the invoice-payment lookup). */
export async function invoiceIdForCharge(stripe: Stripe, charge: Pick<Stripe.Charge, "payment_intent"> & { invoice?: unknown }): Promise<string | null> {
  const legacy = (charge as { invoice?: string | { id: string } | null }).invoice;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return null;
  const list = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
  const inv = list.data[0]?.invoice;
  return inv ? (typeof inv === "string" ? inv : inv.id ?? null) : null;
}

/** charge.refunded: the refunded amount reduces (or reverses) an unpaid commission; after payout it is flagged only. */
export async function affiliateChargeRefunded(db: SupabaseClient, stripe: Stripe, charge: Stripe.Charge): Promise<string> {
  try {
    const invoiceId = await invoiceIdForCharge(stripe, charge);
    if (!invoiceId) return "none";
    const { data, error } = await db.rpc("affiliate_invoice_refunded", { p_invoice_id: invoiceId, p_refunded_cents: charge.amount_refunded ?? 0 });
    if (error) return "none";
    return String((data as { action?: string })?.action ?? "none");
  } catch (err) {
    logError("affiliate.refund", err, { charge: charge.id });
    return "failed";
  }
}

/** charge.dispute.created / closed: an open or lost chargeback stops an unpaid commission; a won one restores it. */
export async function affiliateChargeDispute(db: SupabaseClient, stripe: Stripe, dispute: Pick<Stripe.Dispute, "id" | "charge" | "status">, closed: boolean): Promise<string> {
  try {
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
    if (!chargeId) return "none";
    const invoiceId = await invoiceIdForCharge(stripe, await stripe.charges.retrieve(chargeId));
    if (!invoiceId) return "none";
    const status = !closed ? "open" : dispute.status === "won" ? "won" : "lost";
    const { data, error } = await db.rpc("affiliate_invoice_disputed", { p_invoice_id: invoiceId, p_status: status });
    if (error) return "none";
    return String((data as { action?: string })?.action ?? "none");
  } catch (err) {
    logError("affiliate.dispute", err, { dispute: dispute.id });
    return "failed";
  }
}
