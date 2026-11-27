import { z } from "zod";
import { getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isStripeConfigured } from "@/lib/env";
import { site } from "@/lib/site";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({ action: z.enum(["cancel", "resume", "portal"]), membership: z.string().uuid().optional() });

/**
 * Self-service for an Academy membership: cancel at the end of the paid period, undo that, or open Stripe's
 * portal for cards and invoices. Works even when new enrollments are switched off, so nobody is ever stuck.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isStripeConfigured()) return fail(503, "billing_unavailable", "Billing is not configured yet.");
  if (!(await rateLimit("academy-manage", 20, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Unknown action.");
  const db = createAdminClient();
  const stripe = getStripe();
  try {
    if (p.data.action === "portal") {
      const { data: bc } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
      if (!bc) return fail(404, "no_customer", "You don't have billing history yet.");
      const s = await stripe.billingPortal.sessions.create({ customer: bc.stripe_customer_id, return_url: `${site.url}/academy/advanced/membership` });
      return json({ url: s.url });
    }
    const { data: m } = await db.from("academy_adv_memberships").select("id, user_id, stripe_subscription_id").eq("id", p.data.membership ?? "").maybeSingle();
    if (!m || m.user_id !== user.id) return fail(404, "not_found", "Membership not found.");
    const sub = await stripe.subscriptions.update(m.stripe_subscription_id, { cancel_at_period_end: p.data.action === "cancel" }, { idempotencyKey: `academy-${p.data.action}-${m.id}-${Math.floor(Date.now() / 60_000)}` });
    await applySubscription(db, sub, Math.floor(Date.now() / 1000));
    return json({ ok: true, cancel_at_period_end: sub.cancel_at_period_end });
  } catch (e) {
    logError("academy.manage", e, { user: user.id, action: p.data.action });
    return fail(500, "manage_failed", "We couldn't update your membership. Please try again or email support@built2bid.org.");
  }
}
