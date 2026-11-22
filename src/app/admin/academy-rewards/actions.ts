"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { getStripe } from "@/lib/billing/stripe";
import { deliverReward, stripeCreditsEnabled } from "@/lib/academy/rewards-server";

/**
 * Admin → Academy rewards. Every action goes through the same database state machine as automatic delivery, so a
 * reward can never be applied twice: a delivered or declined reward is final, and only one caller can hold it in
 * "applying". Each action is written to the audit log and the reward's own event trail.
 */
const id = z.string().uuid();
const PAGE = "/admin/academy-rewards";
const done = (msg: string) => redirect(`${PAGE}?msg=${encodeURIComponent(msg)}`);

export async function retryReward(form: FormData) {
  const { user, db } = await requireAdmin();
  const rid = String(form.get("id") ?? "");
  const choice = String(form.get("action") ?? "");
  if (!id.safeParse(rid).success) done("Unknown reward.");
  const force = choice === "comp_days" || choice === "stripe_credit" ? choice : null;
  if (force === "stripe_credit" && !stripeCreditsEnabled()) done("Stripe credits are switched off (ACADEMY_REWARD_STRIPE_CREDITS). Nothing was changed.");
  await audit(db, user.id, "academy.reward.retry", "academy_reward", rid, { force });
  const out = await deliverReward(db, rid, { actor: user.id, force, stripe: getStripe });
  revalidatePath(PAGE);
  done({
    comp_days: "Applied: 30 days of Individual Unlimited.",
    stripe_credit: "Applied: one-month Stripe credit.",
    review: "Still needs review: see the reason on the row.",
    none: "Nothing to do: it is already applied, declined or being applied.",
    failed: "Could not apply. The error is shown on the row.",
  }[out]);
}

export async function declineReward(form: FormData) {
  const { user, db } = await requireAdmin();
  const rid = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!id.safeParse(rid).success) done("Unknown reward.");
  await audit(db, user.id, "academy.reward.decline", "academy_reward", rid, { note });
  const { error } = await db.rpc("academy_reward_decline", { p_caller: user.id, p_id: rid, p_note: note || "Declined by admin" });
  revalidatePath(PAGE);
  done(error ? "Could not decline (already applied or in progress)." : "Declined.");
}

export async function markManual(form: FormData) {
  const { user, db } = await requireAdmin();
  const rid = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!id.safeParse(rid).success) done("Unknown reward.");
  if (note.length < 3) done("Add a short note saying what you applied (e.g. annual renewal moved one month in Stripe).");
  await audit(db, user.id, "academy.reward.manual", "academy_reward", rid, { note });
  const { error } = await db.rpc("academy_reward_mark_manual", { p_caller: user.id, p_id: rid, p_note: note });
  revalidatePath(PAGE);
  done(error ? "Could not record (only rewards in review or failed can be marked)." : "Recorded as applied by hand.");
}
