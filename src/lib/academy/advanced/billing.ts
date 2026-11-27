import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { invoiceIdForCharge } from "@/lib/affiliates/billing-server";
import { ACADEMY_PRODUCT_LINE, isAcademyMeta, isAdvPlan, type Access, type AdvPlan, NO_ACCESS } from "./plans";

/**
 * Academy Advanced billing on the existing Stripe account, customer records and webhook.
 *
 * Academy subscriptions are mirrored ONLY into academy_adv_memberships, never into public.subscriptions, so an
 * Academy package can never be mistaken for an Individual Unlimited plan. The one software entitlement (All Access)
 * comes from user_entitlement() reading the membership, and ends when the membership does.
 */

type Db = SupabaseClient;
type SubLike = {
  id: string; customer: string | { id: string }; status: string; livemode?: boolean; cancel_at_period_end: boolean; canceled_at: number | null; ended_at: number | null;
  metadata?: Record<string, string> | null; current_period_end?: number | null;
  items: { data: { id?: string; current_period_end?: number | null; price: { id: string; unit_amount?: number | null } }[] };
};

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/** Academy price ids, cached briefly per server instance (the table is tiny). Missing table = none. */
let priceCache: { at: number; ids: Set<string> } | null = null;
export async function academyPriceIds(db: Db): Promise<Set<string>> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.ids;
  const { data, error } = await db.from("academy_adv_prices").select("stripe_price_id");
  const ids = new Set(error ? [] : (data ?? []).map((r) => r.stripe_price_id as string));
  priceCache = { at: Date.now(), ids };
  return ids;
}

/** Pure: is this an Academy subscription (metadata marker, or any item on a mapped Academy price)? */
export function isAcademySubscriptionWith(sub: Pick<SubLike, "metadata" | "items">, ids: Set<string>): boolean {
  return isAcademyMeta(sub.metadata) || sub.items.data.some((i) => ids.has(i.price?.id));
}

export async function isAcademySubscription(db: Db, sub: Pick<SubLike, "metadata" | "items">): Promise<boolean> {
  if (isAcademyMeta(sub.metadata)) return true;
  return isAcademySubscriptionWith(sub, await academyPriceIds(db));
}

/** Pure: the payload academy_adv_apply_subscription() expects. */
export function academySubscriptionPayload(sub: SubLike, userId: string, eventCreatedSec: number) {
  const item = sub.items.data[0];
  const meta = sub.metadata ?? {};
  return {
    user_id: userId,
    mode: sub.livemode ? "live" : "test",
    customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    subscription_id: sub.id,
    price_id: item?.price?.id ?? null,
    amount_cents: item?.price?.unit_amount ?? null,
    plan: isAdvPlan(meta.plan) ? meta.plan : null,
    stage: meta.stage ?? null,
    subjects: (meta.subjects ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    quote_id: /^[0-9a-f-]{36}$/i.test(meta.quote_id ?? "") ? meta.quote_id : null,
    status: sub.status,
    current_period_end: iso(item?.current_period_end ?? sub.current_period_end ?? null),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    canceled_at: iso(sub.canceled_at),
    ended_at: iso(sub.ended_at),
    event_created: new Date(eventCreatedSec * 1000).toISOString(),
  };
}

async function userFor(db: Db, sub: SubLike): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id;
  if (fromMeta && /^[0-9a-f-]{36}$/i.test(fromMeta)) return fromMeta;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await db.from("billing_customers").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}

/** Mirror an Academy subscription. Called from applySubscription() so the webhook and every reconcile path agree. */
export async function applyAcademySubscription(db: Db, sub: SubLike, eventCreatedSec: number): Promise<{ applied: boolean; userId: string | null; plan: string | null; academy: true; live?: boolean }> {
  const userId = await userFor(db, sub);
  if (!userId) return { applied: false, userId: null, plan: null, academy: true };
  const { data, error } = await db.rpc("academy_adv_apply_subscription", { p: academySubscriptionPayload(sub, userId, eventCreatedSec) });
  if (error) throw error;
  const r = (data ?? {}) as { applied?: boolean; plan?: string; live?: boolean };
  return { applied: Boolean(r.applied), userId, plan: r.plan ? `academy_${r.plan}` : null, academy: true, live: r.live };
}

/** Record an Academy invoice (paid or failed). The first paid one makes the customer a founding member. Never throws. */
export async function recordAcademyInvoice(db: Db, inv: { id?: string; amount_paid?: number | null; amount_due?: number | null; billing_reason?: string | null; livemode?: boolean; status_transitions?: { paid_at?: number | null } | null; created?: number },
  ctx: { userId: string; subscriptionId: string; failed: boolean }): Promise<number | null> {
  try {
    if (!inv.id) return null;
    const { data, error } = await db.rpc("academy_adv_record_invoice", {
      p: {
        invoice_id: inv.id, user_id: ctx.userId, mode: inv.livemode ? "live" : "test", subscription_id: ctx.subscriptionId,
        status: ctx.failed ? "failed" : "paid", amount_paid: inv.amount_paid ?? 0, amount_due: inv.amount_due ?? 0, billing_reason: inv.billing_reason ?? null,
        occurred_at: iso(inv.status_transitions?.paid_at ?? inv.created ?? null),
      },
    });
    if (error) { logError("academy.invoice", error, { invoice: inv.id }); return null; }
    return ((data ?? {}) as { founding?: number | null }).founding ?? null;
  } catch (e) {
    logError("academy.invoice", e, { invoice: inv.id });
    return null;
  }
}

/** Refund / chargeback on an Academy invoice: updates the payment record and the founding-member status. Never throws. */
export async function academyChargeEvent(db: Db, stripe: Stripe, charge: Stripe.Charge, dispute?: "open" | "won" | "lost"): Promise<string> {
  try {
    const invoiceId = await invoiceIdForCharge(stripe, charge);
    if (!invoiceId) return "none";
    const { data, error } = await db.rpc("academy_adv_payment_event", { p_invoice: invoiceId, p_refunded_cents: dispute ? null : (charge.amount_refunded ?? 0), p_dispute: dispute ?? null });
    return error ? "none" : String(data ?? "none");
  } catch (e) {
    logError("academy.charge", e, { charge: charge.id });
    return "failed";
  }
}

/** Record a reconciliation problem for admins (Manage → Advanced). Never throws. */
export async function academyIssue(db: Db, kind: string, ref: string | null, userId: string | null, details: Record<string, unknown> = {}) {
  await db.from("academy_adv_issues").insert({ kind, ref, user_id: userId, details }).then(() => null, () => null);
}

/**
 * Individual Unlimited -> All Access conversion: once the All Access subscription is paid, cancel the old monthly
 * Individual Unlimited subscription now and credit its unused time to the customer's Stripe balance (applied to the
 * next Academy invoice), so nobody pays twice for the same seat. Idempotent; never throws.
 */
export async function finishConversion(db: Db, stripe: Stripe, academySub: SubLike, apply: (sub: Stripe.Subscription) => Promise<unknown>): Promise<string> {
  const target = academySub.metadata?.convert_subscription_id;
  if (!target || !/^sub_[A-Za-z0-9]+$/.test(target)) return "none";
  if (!["active", "trialing"].includes(academySub.status)) return "waiting";
  try {
    const old = await stripe.subscriptions.retrieve(target);
    const sameCustomer = (typeof old.customer === "string" ? old.customer : old.customer.id) === (typeof academySub.customer === "string" ? academySub.customer : academySub.customer.id);
    if (!sameCustomer || isAcademyMeta(old.metadata)) {
      await academyIssue(db, "convert_mismatch", academySub.id, academySub.metadata?.user_id ?? null, { target });
      return "mismatch";
    }
    if (!["active", "trialing", "past_due"].includes(old.status)) return "already_ended";
    const canceled = await stripe.subscriptions.cancel(target, { prorate: true, invoice_now: true }, { idempotencyKey: `academy-convert-${academySub.id}` });
    await apply(canceled);
    return "converted";
  } catch (e) {
    logError("academy.convert", e, { academy: academySub.id, target });
    await academyIssue(db, "convert_failed", academySub.id, academySub.metadata?.user_id ?? null, { target, error: String((e as Error).message).slice(0, 300) });
    return "failed";
  }
}

/** The person's Advanced access (server-side, service role). */
export async function accessFor(db: Db, userId: string | null): Promise<Access> {
  if (!userId) return NO_ACCESS;
  const { data, error } = await db.rpc("academy_adv_access", { p_user_id: userId });
  if (error || !data) return NO_ACCESS;
  return { ...NO_ACCESS, ...(data as Access) };
}

/** Metadata stamped on Academy Checkout sessions and subscriptions. */
export function academyMetadata(q: { id: string; plan: AdvPlan; subjects: string[]; stage: number; convert_subscription_id?: string | null }, userId: string): Record<string, string> {
  const m: Record<string, string> = { product_line: ACADEMY_PRODUCT_LINE, user_id: userId, plan: q.plan, subjects: q.subjects.join(","), stage: String(q.stage), quote_id: q.id };
  if (q.convert_subscription_id) m.convert_subscription_id = q.convert_subscription_id;
  return m;
}

/** Readable messages for academy_adv_* errors. */
export function advancedErrorMessage(raw: string | undefined | null): { code: string; message: string } {
  const m = String(raw ?? "");
  const map: [string, string][] = [
    ["enrollment_paused", "New Academy memberships are paused for a moment. Please check back soon."],
    ["subject_unavailable", "That subject isn't open for enrollment yet."],
    ["bad_subjects", "Please pick a subject first."],
    ["price_not_configured", "Checkout for this package isn't set up yet. Please try again later."],
    ["quote_expired", "That price hold expired. Please review the current price and try again."],
    ["not_found", "That checkout isn't available anymore. Please start again."],
  ];
  for (const [code, message] of map) if (m.includes(code)) return { code, message };
  return { code: "failed", message: "Something went wrong. Please try again." };
}
