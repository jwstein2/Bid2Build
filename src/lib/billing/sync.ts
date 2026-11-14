/**
 * Pure mapping from a Stripe subscription to our entitlement record. Kept free of I/O so it can be
 * unit-tested; the webhook route and reconciliation both use it.
 */
export type Plan = "monthly" | "annual" | "enterprise";

/** Configured Stripe price ids. Enterprise ids are optional until the Enterprise prices exist. */
export type PriceIds = { monthly: string; annual: string; enterpriseBase?: string; enterpriseSeat?: string };

export interface SubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  ended_at: number | null;
  metadata?: Record<string, string> | null;
  current_period_end?: number | null; // older API versions
  items: { data: { current_period_end?: number | null; quantity?: number | null; price: { id: string; recurring?: { interval?: string } | null } }[] };
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
  p_company_id: string | null;
  p_seat_quantity: number | null;
}

const KNOWN = new Set(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]);
const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

export function planForPrice(priceId: string | null, prices: PriceIds, interval?: string): Plan | null {
  if (priceId && priceId === prices.monthly) return "monthly";
  if (priceId && priceId === prices.annual) return "annual";
  if (interval === "month") return "monthly";
  if (interval === "year") return "annual";
  return null;
}

/**
 * Enterprise subscriptions carry two items: the flat base price and the graduated seat price, whose
 * quantity is the number of users beyond the 3 included. Licensed seats = 3 + that quantity.
 */
export function enterpriseSeats(sub: SubscriptionLike, prices: PriceIds): number | null {
  if (!prices.enterpriseBase || !sub.items.data.some((i) => i.price?.id === prices.enterpriseBase)) return null;
  const extra = sub.items.data.find((i) => prices.enterpriseSeat && i.price?.id === prices.enterpriseSeat)?.quantity ?? 0;
  return 3 + Math.max(0, extra);
}

export function subscriptionToUpdate(sub: SubscriptionLike, userId: string, eventCreatedSec: number, prices: PriceIds, companyId: string | null = null): SubscriptionUpdate {
  const seats = enterpriseSeats(sub, prices);
  const item = seats !== null ? sub.items.data.find((i) => i.price?.id === prices.enterpriseBase)! : sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
  return {
    p_user_id: userId,
    p_stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    p_stripe_subscription_id: sub.id,
    p_status: KNOWN.has(sub.status) ? sub.status : "incomplete",
    p_plan: seats !== null ? "enterprise" : planForPrice(priceId, prices, item?.price?.recurring?.interval),
    p_price_id: priceId,
    p_current_period_end: iso(periodEnd),
    p_cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    p_canceled_at: iso(sub.canceled_at),
    p_ended_at: iso(sub.ended_at),
    p_event_created: new Date(eventCreatedSec * 1000).toISOString(),
    p_company_id: seats !== null ? companyId : null,
    p_seat_quantity: seats,
  };
}

/** Mirrors public.has_unlimited() for UI display; the database function is authoritative. */
export function isEntitled(u: Pick<SubscriptionUpdate, "p_status" | "p_current_period_end">, now = new Date()): boolean {
  if (!["active", "trialing", "past_due"].includes(u.p_status)) return false;
  return !u.p_current_period_end || new Date(u.p_current_period_end) > now;
}
