import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { getStripe } from "@/lib/billing/stripe";
import { serverEnv } from "@/lib/env";
import { runReconciliation } from "@/lib/reconciliation/run";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * Daily Revenue & Commission Reconciliation (netlify/functions/reconcile-cron.mts). Bearer $EMAIL_OUTBOX_SECRET.
 * Never moves money. Answers 200 even when it finds discrepancies (they're in the exception queue); 500 only if the run broke.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  try {
    const stripe = serverEnv().stripeSecretKey ? getStripe() : null;
    const r = await runReconciliation(createAdminClient(), { kind: "daily", stripe });
    if (r.status === "failed") return fail(500, "run_failed", "Reconciliation run failed.");
    return json(r);
  } catch (e) {
    logError("recon.cron", e);
    return fail(500, "run_failed", "Reconciliation run failed.");
  }
}
