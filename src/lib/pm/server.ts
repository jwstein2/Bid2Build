import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type Stripe from "stripe";
import { pmPriceMismatch, type PmPrices } from "./billing";

export type PmAccess = {
  scope: "company" | "individual" | "none";
  companyId: string | null;
  editorLimit: number;
  editorsAssigned: number;
  canEdit: boolean;
  source: string | null;
  editUntil: string | null;
  addon: boolean;
  addonUntil: string | null;
  extraEditors: number;
};

export const pmPrices = (): PmPrices => {
  const e = serverEnv();
  return { addonMonthly: e.stripePricePmAddon || undefined, addonAnnual: e.stripePricePmAddonAnnual || undefined, editor: e.stripePricePmEditor || undefined };
};

/** The signed-in person's PM access (null when the PM migration isn't applied yet). */
export async function loadPmAccess(supabase: SupabaseClient): Promise<PmAccess | null> {
  const { data, error } = await supabase.rpc("my_pm_access");
  if (error || !data) return null;
  return data as PmAccess;
}

/** The person's own (non-Enterprise) Stripe subscription that the add-on attaches to. */
export async function individualSubscription(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, status, plan, current_period_end, cancel_at_period_end")
    .eq("user_id", userId).neq("plan", "enterprise")
    .in("status", ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data as null | { stripe_subscription_id: string; stripe_customer_id: string; status: string; plan: string | null; current_period_end: string | null; cancel_at_period_end: boolean };
}

/** Sum of proration lines on a Stripe invoice preview. */
export function prorationCents(lines: { amount: number; parent?: unknown }[]): number {
  return lines
    .filter((l) => (l as { parent?: { subscription_item_details?: { proration?: boolean } } }).parent?.subscription_item_details?.proration)
    .reduce((s, l) => s + l.amount, 0);
}

/** Refuse to charge if the configured Stripe price doesn't match the advertised amount (cached 10 min). */
const verifiedAt = new Map<string, number>();
export async function verifyPmPrice(stripe: Stripe, priceId: string, cents: number, interval: "month" | "year") {
  if ((verifiedAt.get(priceId) ?? 0) > Date.now() - 10 * 60_000) return;
  const why = pmPriceMismatch(await stripe.prices.retrieve(priceId), cents, interval);
  if (why) throw Object.assign(new Error(`PM Stripe price ${priceId} does not match the advertised pricing: ${why}`), { code: "pricing_mismatch" });
  verifiedAt.set(priceId, Date.now());
}
