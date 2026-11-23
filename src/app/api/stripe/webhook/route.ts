import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { subscriptionListCents } from "@/lib/billing/sync";
import { createAdminClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { isLiveKey } from "@/lib/billing/test-mode";
import { logError } from "@/lib/http/api";
import { markChurned, markCustomer } from "@/lib/growth/leads";
import { isFirstPaidSubscriptionInvoice } from "@/lib/email/founder-welcome";
import { deliverFounderEmails, enqueueFounderWelcome } from "@/lib/email/outbox";
import { rewardReferrer } from "@/lib/growth/referral-server";
import { recordEvent } from "@/lib/growth/events";
import { salesChargeDispute, salesChargeRefunded, syncSalesBilling } from "@/lib/sales/billing-server";
import { affiliateChargeDispute, affiliateChargeRefunded, syncAffiliateBilling } from "@/lib/affiliates/billing-server";
import { recordChargeFact, recordInvoiceFact } from "@/lib/reconciliation/evidence";
import type { StripeInvoiceLike } from "@/lib/reconciliation/facts";

/** List value of a new subscription's first period, in USD, from its price (for ad conversion value only). */
function listValueUsd(sub: Stripe.Subscription): number | null {
  const cents = subscriptionListCents((sub.items?.data ?? []) as never, { enterpriseSeat: serverEnv().stripePriceEnterpriseSeat || undefined });
  return cents > 0 ? cents / 100 : null;
}

export const runtime = "nodejs";

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  // Reconciliation evidence only (billing_invoice_facts). Delivered once added to the endpoint in Stripe; optional.
  "invoice.voided",
  "invoice.marked_uncollectible",
  // Sales Portal: a refund can reverse a rep's commission. Only arrives once the event is added to the
  // webhook endpoint in Stripe; nothing else depends on it.
  "charge.refunded",
  // Chargebacks: stop an unpaid sales milestone / affiliate commission (a won dispute restores it). The handler
  // below existed but these events were never let through.
  "charge.dispute.created",
  "charge.dispute.closed",
]);

/**
 * Entitlements change ONLY here, from signature-verified Stripe events.
 * Idempotent: each event id is recorded once; reprocessing a completed event is a no-op.
 * Out-of-order safe: apply_subscription_update ignores events older than the stored state.
 */
export async function POST(req: Request) {
  const secret = serverEnv().stripeWebhookSecret;
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
  // A test-mode event must never change a live deploy's data, and the other way round (every Netlify context
  // shares one database). Signing secrets are per endpoint, so this only trips on a misconfigured secret.
  if (typeof event.livemode === "boolean" && event.livemode !== isLiveKey(serverEnv().stripeSecretKey)) {
    return new Response("ignored: mode mismatch", { status: 200 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (existing?.processed_at) return new Response("duplicate", { status: 200 });
  if (!existing) {
    await admin.from("stripe_events").insert({ id: event.id, type: event.type, event_created: new Date(event.created * 1000).toISOString() });
  }

  let welcomeQueued = false;
  try {
    const stripe = getStripe();
    let subscriptionId: string | null = null;
    const obj = event.data.object as unknown as Record<string, unknown>;
    if (event.type === "charge.refunded") {
      // Reconciliation evidence first (never throws), then the existing commission handlers.
      await recordChargeFact(admin, stripe, obj as unknown as Stripe.Charge);
      await salesChargeRefunded(admin, stripe, obj as unknown as Stripe.Charge);
      await affiliateChargeRefunded(admin, stripe, obj as unknown as Stripe.Charge);
    } else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
      const d = obj as unknown as Stripe.Dispute;
      const chargeId = typeof d.charge === "string" ? d.charge : d.charge?.id;
      if (chargeId) {
        const status = event.type === "charge.dispute.created" ? "open" : d.status === "won" ? "won" : "lost";
        await recordChargeFact(admin, stripe, await stripe.charges.retrieve(chargeId), { status }).catch(() => "failed");
      }
      await salesChargeDispute(admin, stripe, obj as unknown as Stripe.Dispute, event.type === "charge.dispute.closed");
      await affiliateChargeDispute(admin, stripe, obj as unknown as Stripe.Dispute, event.type === "charge.dispute.closed");
    } else if (event.type.startsWith("customer.subscription.")) {
      // Re-fetch so we always store the latest state, not a possibly stale event payload.
      subscriptionId = obj.id as string;
    } else if (event.type === "checkout.session.completed") {
      const s = obj as unknown as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.subscription) subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      if (s.customer && s.client_reference_id) {
        await admin.from("billing_customers").upsert({ user_id: s.client_reference_id, stripe_customer_id: typeof s.customer === "string" ? s.customer : s.customer.id }, { onConflict: "user_id", ignoreDuplicates: true });
      }
    } else if (event.type.startsWith("invoice.")) {
      const inv = obj as { parent?: { subscription_details?: { subscription?: string | { id: string } } }; subscription?: string | { id: string } };
      const ref = inv.parent?.subscription_details?.subscription ?? inv.subscription;
      if (ref) subscriptionId = typeof ref === "string" ? ref : ref.id;
      // Stripe's record of the invoice for reconciliation (payment verification). Never throws.
      else await recordInvoiceFact(admin, obj as unknown as StripeInvoiceLike, { failed: event.type === "invoice.payment_failed" });
    }

    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const res = await applySubscription(admin, sub, event.created);
      if (!res.userId) throw new Error(`No user for subscription ${subscriptionId}`);
      if (event.type.startsWith("invoice.")) {
        await recordInvoiceFact(admin, obj as unknown as StripeInvoiceLike, { userId: res.userId, failed: event.type === "invoice.payment_failed" });
      }
      // Sales Portal: keep a rep-attributed customer's plan and commission basis current, and create the
      // sale-month / anniversary commission from a paid invoice. Idempotent in the database; never throws.
      await syncSalesBilling(admin, stripe, sub, res.userId, {
        plan: res.plan ?? null, companyId: res.companyId ?? null,
        invoice: event.type === "invoice.paid" ? (obj as { id?: string; billing_reason?: string | null; amount_paid?: number | null; status?: string | null; status_transitions?: { paid_at?: number | null } | null; created?: number }) : null,
      });
      // Affiliate Hub: same for an affiliate-referred customer (annual ledger from actual paid invoices). Never throws.
      await syncAffiliateBilling(admin, stripe, sub, res.userId, {
        plan: res.plan ?? null, invoice: event.type === "invoice.paid" ? (obj as never) : null,
      });
      if (event.type === "checkout.session.completed") {
        // Once per subscription (webhook retries and duplicate events can't double count).
        await recordEvent(admin, { userId: res.userId, event: "subscribed", eventId: `subscribed:${subscriptionId}`, value: listValueUsd(sub) });
        // Paying customers leave prospecting: mark the lead and add them to the Instantly block list.
        const email = (obj as { customer_details?: { email?: string | null } }).customer_details?.email ?? null;
        await markCustomer(admin, res.userId, email);
      }
      // Growth OS Phase 3: a cancellation scheduled for the period end (once per scheduled end date; a
      // resumed-then-rescheduled subscription records again). Not churn until the subscription is deleted.
      if (event.type === "customer.subscription.updated" && sub.cancel_at_period_end && sub.status !== "canceled") {
        const at = sub.cancel_at ?? (sub as { current_period_end?: number }).current_period_end ?? event.created;
        await recordEvent(admin, { userId: res.userId, event: "subscription_cancel_scheduled", eventId: `subscription_cancel_scheduled:${subscriptionId}:${at}` });
      }
      if (event.type === "customer.subscription.deleted") {
        await markChurned(admin, res.userId);
        await recordEvent(admin, { userId: res.userId, event: "subscription_canceled", eventId: `subscription_canceled:${subscriptionId}` });
      }
      // Founder welcome email: only for the first paid invoice of a subscription. Recording the job is
      // idempotent (one per user, ever) and never throws, so it can't affect billing or retries.
      if (event.type === "invoice.paid") {
        const inv = obj as { id?: string; billing_reason?: string | null; amount_paid?: number | null; status?: string | null; customer_email?: string | null };
        // Renewal = a paid recurring-cycle invoice (not the first one, not a proration).
        if (inv.billing_reason === "subscription_cycle" && (inv.amount_paid ?? 0) > 0 && inv.id) {
          await recordEvent(admin, { userId: res.userId, event: "subscription_renewed", eventId: `subscription_renewed:${inv.id}` });
        }
        if (isFirstPaidSubscriptionInvoice(inv)) {
          welcomeQueued = (await enqueueFounderWelcome(admin, { userId: res.userId, email: inv.customer_email ?? null, sourceRef: inv.id ?? event.id })) === "queued";
        }
        // Referral program: the first non-zero paid invoice of a referred account earns the referrer one
        // free month. Claimed once in the database, so Stripe retries never reward twice; never throws.
        if ((inv.amount_paid ?? 0) > 0 && (inv.status == null || inv.status === "paid")) {
          await rewardReferrer(admin, stripe, res.userId, inv.id ?? event.id);
        }
      }
    }
    await admin.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    // Entitlements are saved; now try the email (off unless FOUNDER_EMAIL_ENABLED). Failures are
    // recorded on the job for a later retry and never change this response.
    if (welcomeQueued) await deliverFounderEmails(admin, { limit: 1 }).catch((e) => logError("email.deliver", e, { event: event.id }));
    return new Response("ok", { status: 200 });
  } catch (e) {
    logError("stripe.webhook", e, { event: event.id, type: event.type });
    await admin.from("stripe_events").update({ error: String((e as Error).message).slice(0, 500) }).eq("id", event.id);
    return new Response("error", { status: 500 }); // Stripe will retry
  }
}
