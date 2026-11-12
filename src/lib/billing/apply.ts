import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";
import { subscriptionToUpdate, type SubscriptionLike } from "./sync";

export const prices = () => ({ monthly: serverEnv().stripePriceMonthly, annual: serverEnv().stripePriceAnnual });

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
  const { data, error } = await admin.rpc("apply_subscription_update", subscriptionToUpdate(s, userId, eventCreatedSec, prices()));
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
