import { z } from "zod";
import { assertModeAllowed, getStripe } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/apply";
import { previewTaxParams } from "@/lib/billing/tax";
import { checkEditorTarget, editorItemUpdates, editorMonthlyCents, pmFromItems, PM_EDITOR_CENTS, type PmItem } from "@/lib/pm/billing";
import { loadPmAccess, pmPrices, prorationCents, verifyPmPrice } from "@/lib/pm/server";
import { can, companySubscription, loadMyCompany } from "@/lib/enterprise/server";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmBillingConfigured } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["preview", "confirm"]),
  /** Paid editors beyond the one included. */
  extra: z.number().int(),
  /** Extra editors the admin saw when previewing; a mismatch means someone else changed them. */
  fromExtra: z.number().int(),
  prorationDate: z.number().int().optional(),
  attempt: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/**
 * Enterprise PM editors beyond the included one, $1.99/month each, on the company's Enterprise
 * subscription. Preview first (Stripe's exact prorated amount), then confirm. Adding is invoiced now;
 * removing credits the next invoice. Licensed users are never changed here.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isPmBillingConfigured("editor")) return fail(503, "pm_unavailable", "Scheduling editors aren't available yet.");
  if (!(await rateLimit("pm-editors", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a number of editors.");
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company || !can(company, "manage_billing")) return fail(403, "forbidden", "Only your company's billing administrator can change scheduling editors.");

  try {
    assertModeAllowed();
    const admin = createAdminClient();
    const row = await companySubscription(admin, company.id);
    if (!row) return fail(409, "no_subscription", company.entitlement.source === "complimentary"
      ? "Your company is on complimentary Enterprise access. Additional scheduling editors are arranged with Built2Bid."
      : "Your company doesn't have an active Enterprise subscription.");
    if (row.status !== "active" && row.status !== "trialing") return fail(409, "subscription_not_active", "Update your payment method before changing editors.");

    const stripe = getStripe();
    const prices = pmPrices();
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const items = sub.items.data as unknown as PmItem[];
    const current = pmFromItems(items, prices).extraEditors;
    if (p.data.fromExtra !== current) return fail(409, "editors_changed", "Your editors changed since you opened this page. Refresh and try again.");
    const access = await loadPmAccess(supabase);
    const check = checkEditorTarget(p.data.extra, current, access?.editorsAssigned ?? 0);
    if (!check.ok) return fail(400, check.code, check.message);

    const updates = editorItemUpdates(items, prices, p.data.extra);
    const adding = p.data.extra > current;
    if (adding && prices.editor) await verifyPmPrice(stripe, prices.editor, PM_EDITOR_CENTS, "month");
    const prorationDate = p.data.prorationDate ?? Math.floor(Date.now() / 1000);
    const change = { beforeCents: editorMonthlyCents(current), afterCents: editorMonthlyCents(p.data.extra), deltaCents: editorMonthlyCents(p.data.extra) - editorMonthlyCents(current) };

    if (p.data.action === "preview") {
      const preview = await stripe.invoices.createPreview({
        customer: row.stripe_customer_id,
        subscription: row.stripe_subscription_id,
        subscription_details: { items: updates, proration_behavior: "always_invoice", proration_date: prorationDate },
        ...previewTaxParams(sub),
      });
      const pr = prorationCents(preview.lines.data as never);
      return json({
        fromExtra: current, toExtra: p.data.extra, ...change, interval: "month",
        dueNowCents: adding ? Math.max(0, pr) : 0, creditCents: adding ? 0 : Math.max(0, -pr),
        effective: new Date(prorationDate * 1000).toISOString(), prorationDate, nextInvoiceAt: row.current_period_end,
      });
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      items: updates,
      proration_behavior: adding ? "always_invoice" : "create_prorations",
      proration_date: prorationDate,
      payment_behavior: adding ? "error_if_incomplete" : undefined,
    }, { idempotencyKey: `pm-editors-${row.stripe_subscription_id}-${current}-${p.data.extra}-${p.data.attempt ?? prorationDate}` });
    await applySubscription(admin, updated, Math.floor(Date.now() / 1000)).catch((e2) => logError("pm.editors.sync", e2, { company: company.id }));
    await admin.from("company_audit_log").insert({
      company_id: company.id, actor_id: user.id, action: adding ? "billing.pm_editors_added" : "billing.pm_editors_removed",
      target_type: "subscription", target_id: row.stripe_subscription_id,
      details: { from: current, to: p.data.extra, monthly_before_cents: change.beforeCents, monthly_after_cents: change.afterCents },
    });
    return json({ ok: true, extra: pmFromItems(updated.items.data as unknown as PmItem[], prices).extraEditors, ...change });
  } catch (e) {
    const err = e as { type?: string; code?: string };
    logError("pm.editors", e, { company: company.id, extra: p.data.extra, action: p.data.action });
    if (err.type === "StripeCardError" || err.code === "card_declined") return fail(402, "payment_failed", "Your card was declined, so no editors were added. Update your payment method and try again.");
    return fail(500, "pm_editors_failed", "We couldn't change your editors. Nothing was charged. Please try again.");
  }
}
