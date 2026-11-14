import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";
import { enterpriseSeats, subscriptionToUpdate, type PriceIds, type SubscriptionLike } from "./sync";

export const prices = (): PriceIds => {
  const e = serverEnv();
  return { monthly: e.stripePriceMonthly, annual: e.stripePriceAnnual, enterpriseBase: e.stripePriceEnterpriseBase || undefined, enterpriseSeat: e.stripePriceEnterpriseSeat || undefined };
};

/** Find our user for a Stripe subscription: metadata first, then the stored customer mapping. */
export async function resolveUserId(admin: SupabaseClient, sub: SubscriptionLike): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id;
  if (fromMeta && /^[0-9a-f-]{36}$/i.test(fromMeta)) return fromMeta;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await admin.from("billing_customers").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}

export async function applySubscription(admin: SupabaseClient, sub: Stripe.Subscription | SubscriptionLike, eventCreatedSec: number): Promise<{ applied: boolean; userId: string | null }> {
  const s = sub as unknown as SubscriptionLike;
  const userId = await resolveUserId(admin, s);
  if (!userId) return { applied: false, userId: null };
  const p = prices();
  let companyId: string | null = null;
  if (enterpriseSeats(s, p) !== null) {
    // The company is created (idempotently) from the paid Enterprise subscription itself, so an
    // abandoned checkout never leaves an empty company behind.
    const { data: id, error: ce } = await admin.rpc("create_company", { p_owner: userId, p_name: s.metadata?.company_name ?? "" });
    if (ce) throw ce;
    companyId = id as string;
  }
  const update = subscriptionToUpdate(s, userId, eventCreatedSec, p, companyId);
  // Older database (Enterprise billing migration not applied): send only the original arguments.
  const args: Record<string, unknown> = { ...update };
  if (update.p_plan !== "enterprise") { delete args.p_company_id; delete args.p_seat_quantity; }
  const { data, error } = await admin.rpc("apply_subscription_update", args);
  if (error) throw error;
  return { applied: Boolean(data), userId };
}

/** Pull the current truth from Stripe for one user (used after checkout and by admins). */
export async function reconcileUser(admin: SupabaseClient, stripe: Stripe, userId: string): Promise<number> {
  const { data } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (!data) return 0;
  const subs = await stripe.subscriptions.list({ customer: data.stripe_customer_id, status: "all", limit: 20 });
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  for (const sub of subs.data) if ((await applySubscription(admin, sub, now)).applied) n++;
  return n;
}
