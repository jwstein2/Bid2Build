import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { runPayouts } from "@/lib/payouts/run";

export const runtime = "nodejs";

/**
 * Automatic contractor payouts (netlify/functions/payouts-cron.mts, daily). Bearer $EMAIL_OUTBOX_SECRET.
 * Does nothing while payout automation is off (the default) or paused. In test mode it only uses the practice
 * provider or a provider sandbox. Live sends need the owner's activation in the database and PAYOUTS_ALLOW_LIVE=true.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  try {
    const r = await runPayouts(createAdminClient());
    if (r.error && /payout_plan|payout_settings/.test(r.error)) return json({ skipped: "not_installed" });
    return json(r);
  } catch (e) {
    logError("payouts.cron", e);
    return fail(500, "run_failed", "Payout run failed.");
  }
}
