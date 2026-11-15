import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { createAdminClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { markChurned, markCustomer } from "@/lib/growth/leads";
import { isFirstPaidSubscriptionInvoice } from "@/lib/email/founder-welcome";
import { deliverFounderEmails, enqueueFounderWelcome } from "@/lib/email/outbox";
import { rewardReferrer } from "@/lib/growth/referral-server";

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
    if (event.type.startsWith("customer.subscription.")) {
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
    }

    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const res = await applySubscription(admin, sub, event.created);
      if (!res.userId) throw new Error(`No user for subscription ${subscriptionId}`);
      if (event.type === "checkout.session.completed") {
        await admin.from("analytics_events").insert({ user_id: res.userId, event: "subscribed" });
        // Paying customers leave prospecting: mark the lead and add them to the Instantly block list.
        const email = (obj as { customer_details?: { email?: string | null } }).customer_details?.email ?? null;
        await markCustomer(admin, res.userId, email);
      }
      if (event.type === "customer.subscription.deleted") await markChurned(admin, res.userId);
      // Founder welcome email: only for the first paid invoice of a subscription. Recording the job is
      // idempotent (one per user, ever) and never throws, so it can't affect billing or retries.
      if (event.type === "invoice.paid") {
        const inv = obj as { id?: string; billing_reason?: string | null; amount_paid?: number | null; status?: string | null; customer_email?: string | null };
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
