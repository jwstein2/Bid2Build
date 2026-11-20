import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { refreshChannels } from "@/lib/affiliates/channels-server";

export const runtime = "nodejs";

/**
 * Affiliate Hub daily job (netlify/functions/affiliates-cron.mts). Bearer $EMAIL_OUTBOX_SECRET.
 * affiliate_daily: creates due annual commission events from recorded invoices, marks missed anniversaries after the
 * grace days, and moves lines whose 30-day hold ended to payable (after re-checking refunds, chargebacks and status).
 * Idempotent and locked in the database. Moves no money (payouts run in /api/cron/payouts). Also refreshes up to 25
 * YouTube channels when YOUTUBE_API_KEY is set (1 quota unit each).
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("affiliate_daily");
    if (error) return /affiliate_daily/.test(error.message) ? json({ skipped: "not_installed" }) : fail(500, "run_failed", "Affiliate run failed.");
    const channels = await refreshChannels(db, 25).catch((e) => { logError("affiliates.youtube", e); return { refreshed: 0 }; });
    return json({ ...(data as object), channels });
  } catch (e) {
    logError("affiliates.cron", e);
    return fail(500, "run_failed", "Affiliate run failed.");
  }
}
