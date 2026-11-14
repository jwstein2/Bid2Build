import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { checkSeatTarget, licensedUsers, monthlyChange, seatItemUpdates, type SeatItem } from "@/lib/enterprise/seats";
import { can, companySubscription, loadMyCompany } from "@/lib/enterprise/server";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isEnterpriseConfigured, serverEnv } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["preview", "confirm"]),
  users: z.number().int(),
  /** Licensed users the admin saw when previewing; a mismatch means someone else changed seats. */
  fromUsers: z.number().int(),
  /** Unix seconds from the preview, so the confirmed proration equals the previewed one. */
  prorationDate: z.number().int().optional(),
  attempt: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/**
 * Buy or remove Enterprise licensed users. Preview first (exact new monthly price + today's prorated
 * charge or credit from Stripe), then confirm. Only people with manage_billing in an Enterprise company
 * with a paid subscription can do this. Adding users is invoiced immediately; removing users credits
 * the next invoice. The database is updated right away and again by the webhook.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isEnterpriseConfigured()) return fail(503, "enterprise_unavailable", "Enterprise billing isn't available yet.");
  if (!(await rateLimit("company-seats", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a number of licensed users.");
  const company = await loadMyCompany(await createClient());
  if (!company || !can(company, "manage_billing")) return fail(403, "forbidden", "Only your company's billing administrator can change licenses.");

  try {
    assertModeAllowed();
    const admin = createAdminClient();
    const stripe = getStripe();
    const env = serverEnv();
    const row = await companySubscription(admin, company.id);
    if (!row) return fail(409, "no_subscription", company.entitlement.source === "complimentary"
      ? "Your company is on complimentary Enterprise access. Additional seats are arranged with Built2Bid."
      : "Your company doesn't have an active Enterprise subscription.");
    if (row.status !== "active" && row.status !== "trialing") return fail(409, "subscription_not_active", "Update your payment method before changing licenses.");

    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const items = sub.items.data as unknown as SeatItem[];
    const current = licensedUsers(items, env.stripePriceEnterpriseSeat);
    if (p.data.fromUsers !== current) return fail(409, "seats_changed", "Your licenses changed since you opened this page. Refresh and try again.");
    const check = checkSeatTarget(p.data.users, current, company.seatsUsed);
    if (!check.ok) return fail(400, check.code, check.message);

    const updates = seatItemUpdates(items, env.stripePriceEnterpriseSeat, p.data.users);
    const adding = p.data.users > current;
    const prorationDate = p.data.prorationDate ?? Math.floor(Date.now() / 1000);
    const change = monthlyChange(current, p.data.users);

    if (p.data.action === "preview") {
      const preview = await stripe.invoices.createPreview({
        customer: row.stripe_customer_id,
        subscription: row.stripe_subscription_id,
        subscription_details: { items: updates, proration_behavior: "always_invoice", proration_date: prorationDate },
      });
      const prorationCents = preview.lines.data
        .filter((l) => (l as { parent?: { subscription_item_details?: { proration?: boolean } } }).parent?.subscription_item_details?.proration)
        .reduce((s, l) => s + l.amount, 0);
      return json({
        fromUsers: current, toUsers: p.data.users, ...change,
        prorationCents, dueNowCents: adding ? Math.max(0, preview.amount_due) : 0,
        creditCents: adding ? 0 : Math.max(0, -prorationCents),
        prorationDate, currentPeriodEnd: row.current_period_end,
      });
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      items: updates,
      proration_behavior: adding ? "always_invoice" : "create_prorations",
      proration_date: prorationDate,
      payment_behavior: adding ? "error_if_incomplete" : undefined,
      metadata: { ...sub.metadata, users: String(p.data.users) },
    }, { idempotencyKey: `seats-${row.stripe_subscription_id}-${current}-${p.data.users}-${p.data.attempt ?? prorationDate}` });
    // Stripe has accepted the change; local sync failures are retried by the webhook, never reported as a failed charge.
    await applySubscription(admin, updated, Math.floor(Date.now() / 1000)).catch((e2) => logError("company.seats.sync", e2, { company: company.id }));
    await admin.from("company_audit_log").insert({
      company_id: company.id, actor_id: user.id, action: adding ? "billing.seats_added" : "billing.seats_removed",
      target_type: "subscription", target_id: row.stripe_subscription_id,
      details: { from: current, to: p.data.users, monthly_before_cents: change.beforeCents, monthly_after_cents: change.afterCents },
    });
    return json({ ok: true, users: licensedUsers(updated.items.data as unknown as SeatItem[], env.stripePriceEnterpriseSeat), ...change });
  } catch (e) {
    const err = e as { type?: string; code?: string; message?: string };
    logError("company.seats", e, { company: company.id, users: p.data.users, action: p.data.action });
    if (err.type === "StripeCardError" || err.code === "card_declined") return fail(402, "payment_failed", "Your card was declined, so no licenses were added. Update your payment method and try again.");
    return fail(500, "seats_failed", "We couldn't change your licenses. Nothing was charged. Please try again.");
  }
}
