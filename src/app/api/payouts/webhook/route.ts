import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { afterPayoutEvent } from "@/lib/payouts/run";
import { destinationProblem } from "@/lib/payouts/events";

export const runtime = "nodejs";

const KIND: Record<string, "processing" | "posted" | "failed" | "returned" | "canceled"> = {
  "v2.money_management.outbound_payment.created": "processing",
  "v2.money_management.outbound_payment.updated": "processing",
  "v2.money_management.outbound_payment.under_review": "processing",
  "v2.money_management.outbound_payment.posted": "posted",
  "v2.money_management.outbound_payment.failed": "failed",
  "v2.money_management.outbound_payment.returned": "returned",
  "v2.money_management.outbound_payment.canceled": "canceled",
};

/**
 * Stripe Global Payouts event destination (thin v2 events). Verified with STRIPE_PAYOUTS_WEBHOOK_SECRET; an
 * unverified request changes nothing. Each event id is applied once (public.payout_events), and status only moves
 * forward, so retries and out-of-order deliveries are safe. Only a verified "posted" event marks a payout paid.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_PAYOUTS_WEBHOOK_SECRET ?? "";
  const key = process.env.PAYOUTS_PROVIDER_KEY ?? "";
  if (!secret || !key) return fail(503, "not_configured", "Payout webhooks aren't configured.");
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const stripe = new Stripe(key);
  let n: { id: string; type: string; created: string; livemode: boolean; related_object: { id: string } | null; fetchRelatedObject: () => Promise<unknown> };
  try {
    n = stripe.parseEventNotification(raw, sig, secret) as unknown as typeof n;
  } catch {
    return fail(400, "bad_signature", "Signature check failed.");
  }
  const kind = KIND[n.type];
  if (!kind || !n.related_object?.id) return json({ ignored: n.type });
  // A test-mode event can never settle a live payout and vice versa (provider refs are mode-specific; checked again here).
  const db = createAdminClient();
  const { data: p } = await db.from("payouts").select("mode").eq("provider_ref", n.related_object.id).maybeSingle();
  if (p && (p.mode === "live") !== n.livemode) return fail(400, "mode_mismatch", "Event mode doesn't match the payout.");
  let reason: string | null = null;
  if (kind === "failed" || kind === "returned") {
    const op = (await n.fetchRelatedObject().catch(() => null)) as { status_details?: { failed?: { reason?: string }; returned?: { reason?: string } } } | null;
    reason = destinationProblem(op?.status_details?.[kind]?.reason);
  }
  const { data, error } = await db.rpc("payout_apply_event", { p_event_id: n.id, p_provider_ref: n.related_object.id, p_kind: kind, p_occurred_at: n.created,
    p_failure_code: reason, p_verified: true, p_source: "webhook" });
  if (error) { logError("payouts.webhook", error); return fail(500, "apply_failed", "Couldn't record the event."); }
  await afterPayoutEvent(db, data as { status: string }).catch((e) => logError("payouts.notify", e));
  return json({ ok: true, result: (data as { status: string }).status });
}
