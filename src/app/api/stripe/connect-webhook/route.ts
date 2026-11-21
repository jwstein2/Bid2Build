import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { isLiveKey } from "@/lib/billing/test-mode";
import { createAdminClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { flagByPaymentIntent, markSession, settleSession, syncAccount } from "@/lib/financials/connect-server";
import { fromCents } from "@/lib/financials/connect";

export const runtime = "nodejs";

/**
 * Stripe Connect webhook: events from CONTRACTORS' connected accounts (a separate Stripe endpoint with
 * "Listen to events on Connected accounts", secret STRIPE_CONNECT_WEBHOOK_SECRET). Invoice payments are recorded
 * ONLY here, from signature-verified events. Idempotent per event id; settling is idempotent per Checkout session.
 */
const HANDLED = new Set([
  "account.updated",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

const isInvoicePayment = (s: Stripe.Checkout.Session) => s.metadata?.b2b_kind === "invoice_payment";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "";
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (!HANDLED.has(event.type)) return new Response("ignored", { status: 200 });
  if (typeof event.livemode === "boolean" && event.livemode !== isLiveKey(serverEnv().stripeSecretKey)) return new Response("ignored: mode mismatch", { status: 200 });
  const account = event.account;
  if (!account) return new Response("ignored: not a connected-account event", { status: 200 });

  const admin = createAdminClient();
  const { data: existing } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (existing?.processed_at) return new Response("duplicate", { status: 200 });
  if (!existing) await admin.from("stripe_events").insert({ id: event.id, type: event.type, event_created: new Date(event.created * 1000).toISOString() });

  try {
    const obj = event.data.object as unknown;
    switch (event.type) {
      case "account.updated":
        await syncAccount(obj as Stripe.Account);
        break;
      case "checkout.session.completed": {
        const s = obj as Stripe.Checkout.Session;
        if (!isInvoicePayment(s)) break;
        if (s.payment_status === "paid") await settleSession(s, account);
        else await markSession(s.id, "processing");   // ACH: the bank debit is on its way (3-5 business days)
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const s = obj as Stripe.Checkout.Session;
        if (isInvoicePayment(s)) await settleSession(s, account);
        break;
      }
      case "checkout.session.async_payment_failed": {
        const s = obj as Stripe.Checkout.Session;
        if (isInvoicePayment(s)) await markSession(s.id, "failed", "The bank payment didn't go through.");
        break;
      }
      case "checkout.session.expired": {
        const s = obj as Stripe.Checkout.Session;
        if (isInvoicePayment(s)) await markSession(s.id, "expired");
        break;
      }
      case "charge.refunded": {
        const c = obj as Stripe.Charge;
        const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
        if (pi) await flagByPaymentIntent(pi, { status: c.amount_refunded >= c.amount ? "refunded" : "partially_refunded", refunded_amount: fromCents(c.amount_refunded) });
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const d = obj as Stripe.Dispute;
        const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
        if (pi) await flagByPaymentIntent(pi, { status: event.type === "charge.dispute.created" || d.status === "lost" ? "disputed" : "succeeded" });
        break;
      }
    }
    await admin.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return new Response("ok", { status: 200 });
  } catch (e) {
    logError("stripe.connect_webhook", e, { event: event.id, type: event.type });
    await admin.from("stripe_events").update({ error: String((e as Error).message).slice(0, 500) }).eq("id", event.id);
    return new Response("error", { status: 500 });
  }
}
