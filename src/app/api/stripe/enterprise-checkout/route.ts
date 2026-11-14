import type Stripe from "stripe";
import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { BLOCKING_SUBSCRIPTION_STATUSES } from "@/lib/billing/checkout-sessions";
import { ENTERPRISE_INCLUDED_USERS, ENTERPRISE_MAX_USERS, enterpriseBaseMismatch, enterpriseSeatMismatch } from "@/lib/enterprise/pricing";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isEnterpriseConfigured, serverEnv } from "@/lib/env";
import { site } from "@/lib/site";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({
  companyName: z.string().trim().min(1).max(200),
  users: z.number().int().min(ENTERPRISE_INCLUDED_USERS).max(ENTERPRISE_MAX_USERS).default(ENTERPRISE_INCLUDED_USERS),
  attempt: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/** Verified Stripe prices, cached per instance for 10 minutes. */
const verifiedAt = new Map<string, number>();
async function verifyPrices(stripe: Stripe, baseId: string, seatId: string) {
  const fresh = (id: string) => (verifiedAt.get(id) ?? 0) > Date.now() - 10 * 60_000;
  if (fresh(baseId) && fresh(seatId)) return;
  const [base, seat] = await Promise.all([stripe.prices.retrieve(baseId), stripe.prices.retrieve(seatId, { expand: ["tiers"] })]);
  const why = enterpriseBaseMismatch(base) ?? enterpriseSeatMismatch(seat as Parameters<typeof enterpriseSeatMismatch>[0]);
  if (why) throw Object.assign(new Error(`Enterprise Stripe prices do not match the advertised pricing: ${why}`), { code: "pricing_mismatch" });
  verifiedAt.set(baseId, Date.now());
  verifiedAt.set(seatId, Date.now());
}

/**
 * Starts Enterprise checkout for the signed-in person, who becomes the company owner. The company
 * itself is created by the webhook once Stripe confirms the subscription (never on an abandoned
 * checkout). Prices are checked against src/lib/enterprise/pricing.ts before Checkout opens.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isEnterpriseConfigured()) return fail(503, "enterprise_unavailable", "Enterprise checkout isn't open yet. Contact us to get started.");
  if (!(await rateLimit("enterprise-checkout", 10, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to start Enterprise.");
  if (!user.verified) return fail(403, "email_not_verified", "Verify your phone or email before upgrading.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Enter your company name and number of users.");
  const { companyName, users } = p.data;

  try {
    assertModeAllowed();
    const stripe = getStripe();
    const admin = createAdminClient();

    // Already on a team (someone else's company): they can't also buy one.
    const { data: membership } = await admin.from("company_members").select("company_id, role").eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (membership && membership.role !== "owner") return fail(409, "already_in_company", "You're already a member of a company account. Ask its owner about seats.");

    let { data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (!bc) {
      const customer = await stripe.customers.create({ email: user.email ?? undefined, phone: user.phone ?? undefined, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
      const { error } = await admin.from("billing_customers").insert({ user_id: user.id, stripe_customer_id: customer.id });
      if (error) ({ data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle());
      else bc = { stripe_customer_id: customer.id };
    }
    const customer = bc!.stripe_customer_id;

    // Stripe is the source of truth for existing subscriptions (Unlimited or Enterprise).
    const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
    const existing = subs.data.find((s) => BLOCKING_SUBSCRIPTION_STATUSES.has(s.status));
    if (existing) {
      await applySubscription(admin, existing, Math.floor(Date.now() / 1000)).catch(() => null);
      return fail(409, "already_subscribed", "You already have a paid subscription. Manage or cancel it from Subscription settings before switching to Enterprise.");
    }

    const env = serverEnv();
    await verifyPrices(stripe, env.stripePriceEnterpriseBase, env.stripePriceEnterpriseSeat);

    const now = Math.floor(Date.now() / 1000);
    // One open checkout per customer: expire any other open sessions first.
    const open = (await stripe.checkout.sessions.list({ customer, status: "open", limit: 20 })).data;
    await Promise.all(open.map((s) => stripe.checkout.sessions.expire(s.id).catch(() => null)));

    const extra = users - ENTERPRISE_INCLUDED_USERS;
    const metadata = { user_id: user.id, plan: "enterprise", company_name: companyName, users: String(users) };
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [
        { price: env.stripePriceEnterpriseBase, quantity: 1 },
        ...(extra > 0 ? [{ price: env.stripePriceEnterpriseSeat, quantity: extra }] : []),
      ],
      subscription_data: { metadata },
      metadata,
      allow_promotion_codes: true,
      expires_at: now + 60 * 60,
      success_url: `${site.url}/company/billing?checkout=success`,
      cancel_url: `${site.url}/pricing?checkout=cancelled&plan=enterprise`,
    };
    const created = await stripe.checkout.sessions.create(params, { idempotencyKey: `ent-checkout-${user.id}-${users}-${p.data.attempt ?? `t${Math.floor(now / 60)}`}` });
    if (created.status !== "open" || !created.url) return fail(409, "checkout_retry", "That checkout link expired. Please try again.");
    await admin.from("analytics_events").insert({ user_id: user.id, event: "checkout_started" });
    return json({ url: created.url, plan: "enterprise" });
  } catch (e) {
    const code = (e as { code?: string }).code;
    logError("stripe.enterprise_checkout", e, { user: user.id, users });
    if (code === "pricing_mismatch") return fail(500, "pricing_mismatch", "Enterprise checkout is temporarily unavailable while we update pricing.");
    return fail(500, "checkout_failed", "We couldn't start checkout. Please try again.");
  }
}
