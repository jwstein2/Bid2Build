import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { previewTaxParams } from "@/lib/billing/tax";
import { addonItemUpdates, pmFromItems, PM_ADDON_ANNUAL_CENTS, PM_ADDON_CENTS, planInterval, type PmItem } from "@/lib/pm/billing";
import { individualSubscription, loadPmAccess, pmPrices, prorationCents, verifyPmPrice } from "@/lib/pm/server";
import { loadMyCompany } from "@/lib/enterprise/server";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmBillingConfigured } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["preview", "add", "remove"]),
  /** Unix seconds from the preview, so the confirmed proration equals the previewed one. */
  prorationDate: z.number().int().optional(),
  attempt: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

const ERRORS: Record<string, [number, string]> = {
  annual_unavailable: [409, "Project Command Center isn't available on annual plans yet. It's coming soon."],
  not_configured: [503, "Project Command Center isn't available yet."],
  unknown_interval: [409, "We couldn't match the add-on to your plan. Please contact support."],
};

/**
 * Standard Unlimited PM add-on ($4.99/month, one editor). Preview shows the exact charge from Stripe
 * (new monthly amount, billing interval, effective date, today's prorated charge, next invoice); add
 * charges the prorated amount now; remove takes it off with no refund and keeps editing until the end
 * of the paid period. Nothing changes without an explicit confirm from the account holder.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isPmBillingConfigured("addon")) return fail(503, "pm_unavailable", "Project Command Center isn't available yet.");
  if (!(await rateLimit("pm-addon", 20, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const supabase = await createClient();
  if (await loadMyCompany(supabase)) return fail(409, "enterprise_member", "Scheduling for your company is managed on the company Billing & Licenses page.");

  try {
    assertModeAllowed();
    const admin = createAdminClient();
    const row = await individualSubscription(admin, user.id);
    if (!row) {
      const pm = await loadPmAccess(supabase);
      return fail(409, "no_subscription", pm?.source === "complimentary"
        ? "Scheduling is included in your complimentary access."
        : "Project Command Center is for Unlimited subscribers. Complimentary plans don't include it; contact Built2Bid if you'd like it added.");
    }
    if (row.status !== "active" && row.status !== "trialing") return fail(409, "subscription_not_active", "Update your payment method before changing add-ons.");
    if (row.cancel_at_period_end && p.data.action !== "remove") return fail(409, "subscription_ending", "Your subscription is set to end. Resume it before adding scheduling.");

    const stripe = getStripe();
    const prices = pmPrices();
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const items = sub.items.data as unknown as PmItem[];
    const has = pmFromItems(items, prices).addon;
    const interval = planInterval(items, prices);
    const on = p.data.action !== "remove";
    if (on && has) return fail(409, "already_active", "Project Command Center is already on your plan.");
    if (!on && !has) return fail(409, "not_active", "Project Command Center isn't on your plan.");
    const updates = addonItemUpdates(items, prices, on);
    if ("error" in updates) { const [s, m] = ERRORS[updates.error] ?? [409, "Not available."]; return fail(s, updates.error, m); }
    const periodEnd = row.current_period_end;
    if (on) for (const u of updates) if (u.price) await verifyPmPrice(stripe, u.price, interval === "year" ? PM_ADDON_ANNUAL_CENTS : PM_ADDON_CENTS, interval === "year" ? "year" : "month");

    if (p.data.action === "preview") {
      const prorationDate = p.data.prorationDate ?? Math.floor(Date.now() / 1000);
      const preview = await stripe.invoices.createPreview({
        customer: row.stripe_customer_id,
        subscription: row.stripe_subscription_id,
        subscription_details: { items: updates, proration_behavior: "always_invoice", proration_date: prorationDate },
        ...previewTaxParams(sub),
      });
      const now = prorationCents(preview.lines.data as never);
      return json({
        monthlyCents: interval === "year" ? PM_ADDON_ANNUAL_CENTS : PM_ADDON_CENTS, interval, effective: new Date(prorationDate * 1000).toISOString(),
        dueNowCents: Math.max(0, now), nextInvoiceAt: periodEnd, prorationDate,
      });
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      items: updates,
      proration_behavior: on ? "always_invoice" : "none",
      proration_date: on ? p.data.prorationDate : undefined,
      payment_behavior: on ? "error_if_incomplete" : undefined,
    }, { idempotencyKey: `pm-addon-${row.stripe_subscription_id}-${p.data.action}-${p.data.attempt ?? p.data.prorationDate ?? Date.now()}` });
    // Stripe accepted it; local sync failures are retried by the webhook.
    await applySubscription(admin, updated, Math.floor(Date.now() / 1000)).catch((e2) => logError("pm.addon.sync", e2, { user: user.id }));
    return json({ ok: true, addon: on, editUntil: on ? null : periodEnd });
  } catch (e) {
    const err = e as { type?: string; code?: string };
    logError("pm.addon", e, { user: user.id, action: p.data.action });
    if (err.type === "StripeCardError" || err.code === "card_declined") return fail(402, "payment_failed", "Your card was declined, so scheduling wasn't added. Update your payment method and try again.");
    return fail(500, "pm_addon_failed", "We couldn't change your add-on. Nothing was charged. Please try again.");
  }
}
