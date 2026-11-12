/**
 * Pure mapping from a Stripe subscription to our entitlement record. Kept free of I/O so it can be
 * unit-tested; the webhook route and reconciliation both use it.
 */
export type Plan = "monthly" | "annual";

export interface SubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  ended_at: number | null;
  metadata?: Record<string, string> | null;
  current_period_end?: number | null; // older API versions
  items: { data: { current_period_end?: number | null; price: { id: string; recurring?: { interval?: string } | null } }[] };
}

export interface SubscriptionUpdate {
  p_user_id: string;
  p_stripe_customer_id: string;
  p_stripe_subscription_id: string;
  p_status: string;
  p_plan: Plan | null;
  p_price_id: string | null;
  p_current_period_end: string | null;
  p_cancel_at_period_end: boolean;
  p_canceled_at: string | null;
  p_ended_at: string | null;
  p_event_created: string;
}

const KNOWN = new Set(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]);
const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

export function planForPrice(priceId: string | null, prices: { monthly: string; annual: string }, interval?: string): Plan | null {
  if (priceId && priceId === prices.monthly) return "monthly";
  if (priceId && priceId === prices.annual) return "annual";
  if (interval === "month") return "monthly";
  if (interval === "year") return "annual";
  return null;
}

export function subscriptionToUpdate(sub: SubscriptionLike, userId: string, eventCreatedSec: number, prices: { monthly: string; annual: string }): SubscriptionUpdate {
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
  return {
    p_user_id: userId,
    p_stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    p_stripe_subscription_id: sub.id,
    p_status: KNOWN.has(sub.status) ? sub.status : "incomplete",
    p_plan: planForPrice(priceId, prices, item?.price?.recurring?.interval),
    p_price_id: priceId,
    p_current_period_end: iso(periodEnd),
    p_cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    p_canceled_at: iso(sub.canceled_at),
    p_ended_at: iso(sub.ended_at),
    p_event_created: new Date(eventCreatedSec * 1000).toISOString(),
  };
}

/** Mirrors public.has_unlimited() for UI display; the database function is authoritative. */
export function isEntitled(u: Pick<SubscriptionUpdate, "p_status" | "p_current_period_end">, now = new Date()): boolean {
  if (!["active", "trialing", "past_due"].includes(u.p_status)) return false;
  return !u.p_current_period_end || new Date(u.p_current_period_end) > now;
}
