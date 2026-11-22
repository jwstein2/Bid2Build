import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { oneMonthCents, pickPlanItem } from "@/lib/growth/referral";
import { assertModeAllowed } from "@/lib/billing/stripe";
import type { ChallengeStatus } from "./rewards";

/**
 * Academy monthly challenge: reading a learner's status and delivering the one lifetime free month.
 * Eligibility, the once-per-account rule and routing live in Postgres; this file only carries out a delivery the
 * database has already approved (academy_reward_begin moves a reward to "applying" exactly once).
 *
 *   comp_days      30 days of complimentary Individual Unlimited (a complimentary_grants row). No Stripe call.
 *   stripe_credit  renewing monthly subscribers: one Stripe customer balance credit worth one month, at most $19.99,
 *                  applied to their next invoice. OFF until the owner sets ACADEMY_REWARD_STRIPE_CREDITS=on; while off
 *                  those rewards wait in Admin → Academy rewards. Never a refund, coupon, price or plan change.
 */

export const REWARD_CAP_CENTS = 1999;

export function stripeCreditsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.ACADEMY_REWARD_STRIPE_CREDITS ?? "").trim().toLowerCase() === "on";
}

/** The signed-in learner's challenge status, or null when signed out or before the migration is applied. */
export async function loadChallenge(): Promise<ChallengeStatus | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("academy_challenge_status");
  if (error || !data) return null;
  return data as ChallengeStatus;
}

type Begin =
  | { action: "none"; reason?: string }
  | { action: "review"; reason?: string }
  | { action: "comp_days"; id: string; starts_at: string }
  | { action: "stripe_credit"; id: string; customer: string; subscription: string };

export type DeliveryOutcome = "none" | "review" | "comp_days" | "stripe_credit" | "failed";

/**
 * Deliver one reward. Safe to call any number of times, from any number of places at once: only the caller that moves
 * the row to "applying" acts, a delivered reward is final, and the Stripe credit carries an idempotency key plus a
 * lookup of earlier credits for this reward. Never throws.
 */
export async function deliverReward(
  db: SupabaseClient, id: string,
  opts: { actor?: string | null; force?: "comp_days" | "stripe_credit" | null; stripe?: () => Stripe; env?: Record<string, string | undefined> } = {},
): Promise<DeliveryOutcome> {
  const env = opts.env ?? process.env;
  if (opts.force === "stripe_credit" && !stripeCreditsEnabled(env)) return "none";
  let begin: Begin;
  try {
    const { data, error } = await db.rpc("academy_reward_begin", { p_id: id, p_actor: opts.actor ?? null, p_force: opts.force ?? null });
    if (error || !data) { if (error) logError("academy.reward.begin", error, { reward: id }); return "failed"; }
    begin = data as Begin;
  } catch (e) {
    logError("academy.reward.begin", e, { reward: id });
    return "failed";
  }
  if (begin.action === "none") return "none";
  if (begin.action === "review") return "review";

  if (begin.action === "comp_days") {
    const { data, error } = await db.rpc("academy_reward_grant_comp", { p_id: id, p_starts: begin.starts_at, p_actor: opts.actor ?? null });
    if (error || !(data as { ok?: boolean } | null)?.ok) {
      logError("academy.reward.comp", error ?? new Error(String((data as { error?: string } | null)?.error)), { reward: id });
      await db.rpc("academy_reward_finish", { p_id: id, p_ok: false, p_error: error?.message ?? "Complimentary grant failed", p_actor: opts.actor ?? null });
      return "failed";
    }
    return "comp_days";
  }

  // Monthly subscriber. Without the owner's switch, park it for review instead of touching Stripe.
  if (!stripeCreditsEnabled(env) || !opts.stripe) {
    await db.rpc("academy_reward_set_review", { p_id: id, p_reason: "monthly_credit_needs_approval", p_actor: opts.actor ?? null });
    return "review";
  }
  try {
    assertModeAllowed(); // live keys only where the owner allowed live billing (Production)
    const stripe = opts.stripe();
    // A credit made by an earlier try (even one older than Stripe's 24-hour idempotency window) is reused.
    const earlier = await stripe.customers.listBalanceTransactions(begin.customer, { limit: 100 });
    const found = earlier.data.find((t) => t.metadata?.academy_reward_id === id);
    if (found) {
      await db.rpc("academy_reward_finish", { p_id: id, p_ok: true, p_ref: found.id, p_cents: Math.abs(found.amount), p_actor: opts.actor ?? null });
      return "stripe_credit";
    }
    const sub = await stripe.subscriptions.retrieve(begin.subscription);
    const item = pickPlanItem(sub.items.data);
    const month = item?.price ? oneMonthCents(item.price) : null;
    if (!item || !month) throw new Error("Could not price one month of the subscriber's plan");
    const cents = Math.min(month, REWARD_CAP_CENTS);
    const txn = await stripe.customers.createBalanceTransaction(
      begin.customer,
      { amount: -cents, currency: item.price.currency, description: "Academy reward: 1 free month (monthly challenge)", metadata: { academy_reward_id: id } },
      { idempotencyKey: `academy-reward-${id}` },
    );
    await db.rpc("academy_reward_finish", { p_id: id, p_ok: true, p_ref: txn.id, p_cents: cents, p_actor: opts.actor ?? null });
    return "stripe_credit";
  } catch (e) {
    logError("academy.reward.stripe_credit", e, { reward: id });
    await db.rpc("academy_reward_finish", { p_id: id, p_ok: false, p_error: String((e as Error)?.message ?? e).slice(0, 500), p_actor: opts.actor ?? null });
    return "failed";
  }
}

/**
 * After a learner's own activity (quiz submitted, lesson completed, Academy page opened): make sure a reward they
 * earned is delivered. Uses the service role only for this learner's own reward row. Best effort, never throws.
 */
export async function deliverMyReward(userId: string): Promise<DeliveryOutcome> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("academy_rewards").select("id, status").eq("user_id", userId).maybeSingle();
    const row = data as { id: string; status: string } | null;
    if (!row || !["pending", "failed", "applying"].includes(row.status)) return "none";
    if (row.status === "failed") return "none"; // failed deliveries are retried by an admin, not in a loop
    const { getStripe } = await import("@/lib/billing/stripe");
    return await deliverReward(admin, row.id, { stripe: getStripe });
  } catch (e) {
    logError("academy.reward.deliver_mine", e, { user: userId });
    return "none";
  }
}
