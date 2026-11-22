import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { invoiceIdForCharge } from "@/lib/affiliates/billing-server";
import { invoiceFact, type StripeInvoiceLike } from "./facts";

type Db = SupabaseClient;

/** Stripe invoice evidence from the webhook. Best effort: never throws, so billing never depends on it. */
export async function recordInvoiceFact(db: Db, inv: StripeInvoiceLike, opts: { userId?: string | null; failed?: boolean; source?: "webhook" | "reconcile" } = {}): Promise<string> {
  try {
    const fact = invoiceFact(inv, { source: opts.source ?? "webhook", userId: opts.userId ?? null, failedAt: opts.failed ? new Date() : null });
    if (!fact) return "none";
    const { data, error } = await db.rpc("billing_invoice_record", { p: fact });
    if (error) return "none"; // migration not applied yet
    return String((data as { action?: string })?.action ?? "none");
  } catch (e) {
    logError("recon.invoice_fact", e, { invoice: inv?.id });
    return "failed";
  }
}

/** Refund / chargeback evidence for the invoice a charge paid. Returns 'changed' when this is news to us. */
export async function recordChargeFact(db: Db, stripe: Stripe, charge: Stripe.Charge, dispute?: { status: "open" | "won" | "lost" }): Promise<string> {
  try {
    const invoiceId = await invoiceIdForCharge(stripe, charge);
    if (!invoiceId) return "none";
    const call = () => dispute
      ? db.rpc("billing_invoice_dispute", { p_invoice: invoiceId, p_status: dispute.status })
      : db.rpc("billing_invoice_refund", { p_invoice: invoiceId, p_refunded_cents: charge.amount_refunded ?? 0, p_at: new Date().toISOString() });
    let r = await call();
    if (r.data === "unknown") {
      await recordInvoiceFact(db, (await stripe.invoices.retrieve(invoiceId)) as unknown as StripeInvoiceLike, { source: "reconcile" });
      r = await call();
    }
    return r.error ? "none" : String(r.data ?? "none");
  } catch (e) {
    logError("recon.charge_fact", e, { charge: charge.id });
    return "failed";
  }
}

