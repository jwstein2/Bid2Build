import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { previewTaxParams } from "@/lib/billing/tax";
import { planInterval, type PmItem } from "@/lib/pm/billing";
import { individualSubscription, pmPrices, prorationCents } from "@/lib/pm/server";
import { ensureFinSoloPrice, FIN_SOLO_CENTS, isFinItem, type FinItem } from "@/lib/financials/billing";
import { loadMyCompany } from "@/lib/enterprise/server";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isFinBillingConfigured } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["preview", "add", "remove"]),
  /** Unix seconds from the preview, so the confirmed proration equals the previewed one. */
  prorationDate: z.number().int().optional(),
  attempt: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/**
 * Solo Financials add-on ($21.99/month on the person's Standard subscription). Preview shows the exact
 * charge from Stripe; add charges the prorated amount now; remove takes it off with no refund and keeps
 * recording on until the end of the paid period (then the books stay readable). Company Financials is
 * not sold here.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isFinBillingConfigured()) return fail(503, "fin_unavailable", "The Financials add-on isn't available yet.");
  if (!(await rateLimit("fin-addon", 20, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const supabase = await createClient();
  if (await loadMyCompany(supabase)) return fail(409, "enterprise_member", "Financials for your company is set up by your company owner.");

  try {
    assertModeAllowed();
    const admin = createAdminClient();
    const row = await individualSubscription(admin, user.id);
    if (!row) return fail(409, "no_subscription", "The Financials add-on is for Unlimited subscribers. Start a plan first.");
    if (row.status !== "active" && row.status !== "trialing") return fail(409, "subscription_not_active", "Update your payment method before changing add-ons.");
    if (row.cancel_at_period_end && p.data.action !== "remove") return fail(409, "subscription_ending", "Your subscription is set to end. Resume it before adding Financials.");

    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const items = sub.items.data as unknown as (FinItem & PmItem)[];
    const existing = items.find(isFinItem);
    const on = p.data.action !== "remove";
    if (on && existing) return fail(409, "already_active", "Financials is already on your plan.");
    if (!on && !existing) return fail(409, "not_active", "Financials isn't on your plan.");
    if (on && planInterval(items, pmPrices()) !== "month") return fail(409, "annual_unavailable", "The Financials add-on is available on monthly plans now; annual plans are coming soon.");
    const updates = on ? [{ price: await ensureFinSoloPrice(stripe), quantity: 1 }] : [{ id: existing!.id, deleted: true }];
    const periodEnd = row.current_period_end;

    if (p.data.action === "preview") {
      const prorationDate = p.data.prorationDate ?? Math.floor(Date.now() / 1000);
      const preview = await stripe.invoices.createPreview({
        customer: row.stripe_customer_id,
        subscription: row.stripe_subscription_id,
        subscription_details: { items: updates, proration_behavior: "always_invoice", proration_date: prorationDate },
        ...previewTaxParams(sub),
      });
      return json({ monthlyCents: FIN_SOLO_CENTS, interval: "month", effective: new Date(prorationDate * 1000).toISOString(), dueNowCents: Math.max(0, prorationCents(preview.lines.data as never)), nextInvoiceAt: periodEnd, prorationDate });
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      items: updates,
      proration_behavior: on ? "always_invoice" : "none",
      proration_date: on ? p.data.prorationDate : undefined,
      payment_behavior: on ? "error_if_incomplete" : undefined,
    }, { idempotencyKey: `fin-addon-${row.stripe_subscription_id}-${p.data.action}-${p.data.attempt ?? p.data.prorationDate ?? Date.now()}` });
    // Stripe accepted it; local sync failures are retried by the webhook.
    await applySubscription(admin, updated, Math.floor(Date.now() / 1000)).catch((e2) => logError("fin.addon.sync", e2, { user: user.id }));
    return json({ ok: true, addon: on, recordUntil: on ? null : periodEnd });
  } catch (e) {
    const err = e as { type?: string; code?: string };
    logError("fin.addon", e, { user: user.id, action: p.data.action });
    if (err.type === "StripeCardError" || err.code === "card_declined") return fail(402, "payment_failed", "Your card was declined, so Financials wasn't added. Update your payment method and try again.");
    return fail(500, "fin_addon_failed", "We couldn't change your add-on. Nothing was charged. Please try again.");
  }
}
