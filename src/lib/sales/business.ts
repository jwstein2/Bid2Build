/**
 * V8.4 P3 "My Business" helpers. Pure functions. Illustrations are clearly labeled scenarios from the
 * rep's own inputs, never forecasts of customers the rep doesn't have.
 */
import type { RepCustomer } from "./types";

export const GOAL_KINDS: Record<string, { label: string; unit: "count" | "cents"; help: string }> = {
  new_sales: { label: "New sales", unit: "count", help: "Customers whose first payment lands this month" },
  onboardings: { label: "Customer onboardings", unit: "count", help: "Customers who build a real estimate and send a proposal" },
  follow_ups: { label: "Follow-ups completed", unit: "count", help: "Follow-up tasks you check off" },
  prospects: { label: "Prospects contacted", unit: "count", help: "Different leads you call, text, email or meet" },
  earnings: { label: "Commission earned", unit: "cents", help: "Commission dated this month, before holds clear" },
};

export type Attention = "past_due" | "canceling" | "not_onboarded" | null;

/** Why a customer relationship might need a check-in. */
export function attentionFor(c: RepCustomer, onboarded: boolean, now = new Date()): Attention {
  if (c.ended) return null;
  if (c.sub_status === "past_due" || c.sub_status === "unpaid") return "past_due";
  if (c.sub_status === "canceled") return "canceling";
  if (c.first_paid_at && !onboarded && now.getTime() - new Date(c.first_paid_at).getTime() > 14 * 86_400_000) return "not_onboarded";
  return null;
}
export const ATTENTION_TEXT: Record<Exclude<Attention, null>, string> = {
  past_due: "Payment is past due", canceling: "Subscription canceled", not_onboarded: "Paid over 2 weeks ago, not onboarded yet",
};

/**
 * A 12-month illustration: N new customers a month at a given monthly price, with the sale-month
 * commission in each month. Anniversaries fall after month 12, so they aren't in this view.
 */
export function scenario(perMonth: number, priceCents: number, months = 12): { month: number; cents: number; customers: number }[] {
  const n = Math.max(0, Math.min(100, Math.floor(perMonth))), p = Math.max(0, Math.min(100_000, Math.round(priceCents)));
  return Array.from({ length: months }, (_, i) => ({ month: i + 1, cents: n * p, customers: n * (i + 1) }));
}

export function retention(customers: RepCustomer[]): { acquired: number; active: number; pct: number | null } {
  const paid = customers.filter((c) => c.first_paid_at);
  const active = paid.filter((c) => !c.ended && ["active", "trialing", "past_due"].includes(c.sub_status ?? ""));
  // Too few customers to say anything meaningful: no percentage.
  return { acquired: paid.length, active: active.length, pct: paid.length >= 3 ? Math.round((active.length / paid.length) * 100) : null };
}
