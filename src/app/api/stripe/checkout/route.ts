import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isStripeConfigured, serverEnv } from "@/lib/env";
import { site } from "@/lib/site";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isStripeConfigured()) return fail(503, "billing_unavailable", "Billing is not configured yet.");
  if (!(await rateLimit("checkout", 10, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to upgrade.");
  if (!user.emailVerified) return fail(403, "email_not_verified", "Verify your email before upgrading.");
  const p = z.object({ plan: z.enum(["monthly", "annual"]) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a plan.");

  try {
    assertModeAllowed();
    const stripe = getStripe();
    const admin = createAdminClient();
    const { data: active } = await admin.rpc("has_unlimited", { p_user_id: user.id });
    if (active) return fail(409, "already_subscribed", "You already have an active plan. Manage it from Subscription settings.");

    let { data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (!bc) {
      const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
      const { error } = await admin.from("billing_customers").insert({ user_id: user.id, stripe_customer_id: customer.id });
      if (error) ({ data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle());
      else bc = { stripe_customer_id: customer.id };
    }
    const env = serverEnv();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: bc!.stripe_customer_id,
      client_reference_id: user.id,
      line_items: [{ price: p.data.plan === "annual" ? env.stripePriceAnnual : env.stripePriceMonthly, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id, plan: p.data.plan } },
      metadata: { user_id: user.id },
      allow_promotion_codes: true,
      success_url: `${site.url}/settings/billing?checkout=success`,
      cancel_url: `${site.url}/pricing?checkout=cancelled`,
    });
    await admin.from("analytics_events").insert({ user_id: user.id, event: "checkout_started" });
    return json({ url: session.url });
  } catch (e) {
    logError("stripe.checkout", e, { user: user.id });
    return fail(500, "checkout_failed", "We couldn't start checkout. Please try again.");
  }
}
