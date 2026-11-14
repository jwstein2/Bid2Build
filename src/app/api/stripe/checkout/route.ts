import type Stripe from "stripe";
import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { PLAN_IDS, priceMismatch, type PlanId } from "@/lib/billing/plans";
import { BLOCKING_SUBSCRIPTION_STATUSES, converge, reusableSession, staleSessions } from "@/lib/billing/checkout-sessions";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isStripeConfigured, serverEnv } from "@/lib/env";
import { site } from "@/lib/site";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({
  plan: z.enum(PLAN_IDS),
  /** Client attempt id: repeated sends of the same attempt (double clicks, duplicate callbacks) collapse in Stripe. */
  attempt: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/** Stripe prices verified against the plan table, cached per instance for 10 minutes. */
const verified = new Map<string, number>();
async function verifyPrice(stripe: Stripe, plan: PlanId, priceId: string) {
  const at = verified.get(priceId);
  if (at && Date.now() - at < 10 * 60_000) return;
  const price = await stripe.prices.retrieve(priceId);
  const why = priceMismatch(plan, price);
  if (why) throw Object.assign(new Error(`Configured ${plan} price ${priceId} does not match the advertised plan: ${why}`), { code: "pricing_mismatch" });
  verified.set(priceId, Date.now());
}

async function expireQuietly(stripe: Stripe, sessions: Stripe.Checkout.Session[]) {
  await Promise.all(sessions.map((s) => stripe.checkout.sessions.expire(s.id).catch(() => null)));
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isStripeConfigured()) return fail(503, "billing_unavailable", "Billing is not configured yet.");
  if (!(await rateLimit("checkout", 10, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to upgrade.");
  if (!user.verified) return fail(403, "email_not_verified", "Verify your phone or email before upgrading.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a plan.");
  const plan = p.data.plan;

  try {
    assertModeAllowed();
    const stripe = getStripe();
    const admin = createAdminClient();
    const { data: active } = await admin.rpc("has_unlimited", { p_user_id: user.id });
    if (active) return fail(409, "already_subscribed", "You already have Unlimited. Manage it from Subscription settings.");

    let { data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (!bc) {
      const customer = await stripe.customers.create({ email: user.email ?? undefined, phone: user.phone ?? undefined, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
      const { error } = await admin.from("billing_customers").insert({ user_id: user.id, stripe_customer_id: customer.id });
      if (error) ({ data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle());
      else bc = { stripe_customer_id: customer.id };
    }
    const customer = bc!.stripe_customer_id;

    // Stripe is the source of truth: if a subscription exists that our database hasn't heard about yet
    // (delayed webhook), record it and send the customer to manage it instead of selling a second one.
    const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
    const existing = subs.data.find((s) => BLOCKING_SUBSCRIPTION_STATUSES.has(s.status));
    if (existing) {
      await applySubscription(admin, existing, Math.floor(Date.now() / 1000)).catch(() => null);
      return fail(409, "already_subscribed", "You already have Unlimited. Manage it from Subscription settings.");
    }

    const env = serverEnv();
    const priceId = plan === "annual" ? env.stripePriceAnnual : env.stripePriceMonthly;
    await verifyPrice(stripe, plan, priceId);

    // At most one open Checkout session per customer: reuse a live one for this plan, expire the rest.
    const now = Math.floor(Date.now() / 1000);
    const open = (await stripe.checkout.sessions.list({ customer, status: "open", limit: 20 })).data;
    const reuse = reusableSession(open, plan, now);
    await expireQuietly(stripe, staleSessions(open, plan, now));
    if (reuse?.url) return json({ url: reuse.url, plan, reused: true });

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id, plan } },
      metadata: { user_id: user.id, plan },
      allow_promotion_codes: true,
      expires_at: now + 60 * 60,
      success_url: `${site.url}/settings/billing?checkout=success&plan=${plan}`,
      cancel_url: `${site.url}/pricing?checkout=cancelled&plan=${plan}`,
    };
    const idempotencyKey = `checkout-${user.id}-${plan}-${p.data.attempt ?? `t${Math.floor(now / 60)}`}`;
    let created: Stripe.Checkout.Session;
    try {
      created = await stripe.checkout.sessions.create(params, { idempotencyKey });
    } catch (e) {
      // A concurrent identical request is still in flight; wait for it and take its result.
      if ((e as { type?: string }).type !== "StripeIdempotencyError") throw e;
      await new Promise((r) => setTimeout(r, 1200));
      created = await stripe.checkout.sessions.create(params, { idempotencyKey });
    }
    if (created.status !== "open" || !created.url) {
      return fail(409, "checkout_retry", "That checkout link expired. Please try again.");
    }

    // Concurrent requests (two tabs) converge on the same session; the others are expired.
    const after = (await stripe.checkout.sessions.list({ customer, status: "open", limit: 20 })).data;
    const { keep, expire } = converge(after.some((s) => s.id === created.id) ? after : [...after, created]);
    await expireQuietly(stripe, expire);
    if (!keep?.url) return fail(409, "checkout_retry", "Please try again.");
    if (keep.metadata?.plan !== plan) return fail(409, "checkout_in_progress", "Another checkout is already open in a different tab. Finish it there or try again in a moment.");

    await admin.from("analytics_events").insert({ user_id: user.id, event: "checkout_started" });
    return json({ url: keep.url, plan });
  } catch (e) {
    const code = (e as { code?: string }).code;
    logError("stripe.checkout", e, { user: user.id, plan });
    if (code === "pricing_mismatch") return fail(500, "pricing_mismatch", "Checkout is temporarily unavailable while we update pricing. Please try again later.");
    return fail(500, "checkout_failed", "We couldn't start checkout. Please try again.");
  }
}
