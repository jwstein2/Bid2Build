import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isStripeConfigured } from "@/lib/env";
import { site } from "@/lib/site";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Stripe Customer Portal: payment methods, invoices/billing history, plan changes, cancellation.
 * Optional { intent: "cancel" | "annual" } opens straight on Stripe's cancel or plan-change page for
 * the person's active subscription. If Stripe refuses that (for example the portal configuration
 * doesn't allow it), the regular portal opens instead. Nothing changes until the person confirms on Stripe.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isStripeConfigured()) return fail(503, "billing_unavailable", "Billing is not configured yet.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const body = (await req.json().catch(() => null)) as { intent?: unknown } | null;
  const intent = body?.intent === "cancel" || body?.intent === "annual" ? body.intent : null;
  const admin = createAdminClient();
  const { data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (!bc) return fail(404, "no_customer", "You don't have billing history yet.");
  const base = { customer: bc.stripe_customer_id, return_url: `${site.url}/settings/billing` };
  const stripe = getStripe();
  if (intent) {
    const { data: sub } = await admin.from("subscriptions").select("stripe_subscription_id, status, cancel_at_period_end").eq("user_id", user.id).in("status", ["active", "trialing", "past_due"]).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (sub && !(intent === "cancel" && sub.cancel_at_period_end)) {
      try {
        const session = await stripe.billingPortal.sessions.create({
          ...base,
          flow_data: intent === "cancel"
            ? { type: "subscription_cancel", subscription_cancel: { subscription: sub.stripe_subscription_id } }
            : { type: "subscription_update", subscription_update: { subscription: sub.stripe_subscription_id } },
        });
        return json({ url: session.url });
      } catch (e) {
        logError("stripe.portal.flow", e, { user: user.id, intent });
      }
    }
  }
  try {
    const session = await stripe.billingPortal.sessions.create(base);
    return json({ url: session.url });
  } catch (e) {
    logError("stripe.portal", e, { user: user.id });
    return fail(500, "portal_failed", "We couldn't open the billing portal.");
  }
}
