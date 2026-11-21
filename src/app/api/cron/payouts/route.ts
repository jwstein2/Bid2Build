import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { runPayouts } from "@/lib/payouts/run";
import { checkPaidBills } from "@/lib/quickbooks/platform";

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
    const db = createAdminClient();
    // QuickBooks payouts: bills the owner paid in QuickBooks mark their statements / commissions paid.
    // Missing before 20270219001000 or not connected: skipped without failing the run.
    const quickbooks = await checkPaidBills(db).catch((e) => { logError("payouts.cron.quickbooks", e); return { skipped: "error" }; });
    const r = await runPayouts(db);
    if (r.error && /payout_plan|payout_settings/.test(r.error)) return json({ skipped: "not_installed", quickbooks });
    return json({ ...r, quickbooks });
  } catch (e) {
    logError("payouts.cron", e);
    return fail(500, "run_failed", "Payout run failed.");
  }
}
