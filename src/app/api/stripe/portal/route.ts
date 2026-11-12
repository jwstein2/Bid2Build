import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isStripeConfigured } from "@/lib/env";
import { site } from "@/lib/site";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

/** Stripe Customer Portal: payment methods, invoices/billing history, plan changes, cancellation. */
export async function POST() {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isStripeConfigured()) return fail(503, "billing_unavailable", "Billing is not configured yet.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data: bc } = await createAdminClient().from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (!bc) return fail(404, "no_customer", "You don't have billing history yet.");
  try {
    const session = await getStripe().billingPortal.sessions.create({ customer: bc.stripe_customer_id, return_url: `${site.url}/settings/billing` });
    return json({ url: session.url });
  } catch (e) {
    logError("stripe.portal", e, { user: user.id });
    return fail(500, "portal_failed", "We couldn't open the billing portal.");
  }
}
