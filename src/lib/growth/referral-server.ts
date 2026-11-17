import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../http/api";
import { normalizeReferralCode, oneMonthCents, pickPlanItem, REFERRAL_REWARD_DAYS } from "./referral";

/**
 * Record that a newly created account arrived through a member's referral link. Best effort and
 * idempotent: the database decides eligibility (new account, not self, not test/internal).
 */
export async function recordReferral(db: SupabaseClient, userId: string, rawCode: string | null | undefined): Promise<string | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  try {
    const { data, error } = await db.rpc("record_referral", { p_referee: userId, p_code: code });
    if (error) return null; // migration not applied yet
    return data as string;
  } catch (e) {
    logError("referral.record", e, { user: userId });
    return null;
  }
}

type Claim =
  | { action: "none"; reason?: string }
  | { action: "stripe_credit"; id: string; customer: string; subscription: string }
  | { action: "comp_days"; id: string };

/**
 * The referred account paid a non-zero invoice: give the referrer their free month, at most once.
 * Paying referrers get a Stripe customer balance credit worth one month of their plan (applied to
 * their next invoice; no price, coupon or subscription is changed). Everyone else gets 30 days of
 * complimentary Unlimited. Never throws: billing must not depend on this.
 */
export async function rewardReferrer(db: SupabaseClient, stripe: Stripe, refereeId: string, invoiceId: string): Promise<string> {
  let claim: Claim;
  try {
    const { data, error } = await db.rpc("referral_claim_reward", { p_referee: refereeId, p_invoice_id: invoiceId });
    if (error || !data) return "none";
    claim = data as Claim;
  } catch (e) {
    logError("referral.claim", e, { user: refereeId });
    return "none";
  }
  if (claim.action === "none") return claim.reason ? `none:${claim.reason}` : "none";

  if (claim.action === "comp_days") {
    const { data, error } = await db.rpc("referral_grant_comp_days", { p_id: claim.id, p_days: REFERRAL_REWARD_DAYS });
    if (error || !(data as { ok?: boolean })?.ok) {
      logError("referral.comp_days", error ?? new Error(String((data as { error?: string })?.error)), { referral: claim.id });
      return "failed";
    }
    return "comp_days";
  }

  try {
    const sub = await stripe.subscriptions.retrieve(claim.subscription);
    // The plan item: the per-unit recurring item worth the most per month. This skips add-ons (PM
    // $4.99, editors $1.99) and the graduated Enterprise seat price, whose unit_amount is null.
    const item = pickPlanItem(sub.items.data);
    const cents = item?.price ? oneMonthCents(item.price) : null;
    if (!item || !cents) throw new Error("Could not price one month of the referrer's plan");
    const txn = await stripe.customers.createBalanceTransaction(
      claim.customer,
      { amount: -cents, currency: item.price.currency, description: "Referral reward: 1 free month (thanks for referring a contractor)", metadata: { referral_id: claim.id } },
      { idempotencyKey: `referral-reward-${claim.id}` },
    );
    await db.rpc("referral_finish_reward", { p_id: claim.id, p_ok: true, p_ref: txn.id, p_cents: cents });
    return "stripe_credit";
  } catch (e) {
    logError("referral.stripe_credit", e, { referral: claim.id });
    await db.rpc("referral_finish_reward", { p_id: claim.id, p_ok: false, p_error: String((e as Error).message ?? e).slice(0, 500) });
    return "failed";
  }
}
