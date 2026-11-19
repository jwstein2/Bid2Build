import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Sales Portal month-end close (netlify/functions/sales-close-cron.mts, daily). Authorization:
 * Bearer $EMAIL_OUTBOX_SECRET (the existing scheduled-job secret). Idempotent: on the first run of a new
 * month it earns last month's pending commissions and puts them on each rep's statement; other days it
 * only catches late changes. Never pays anyone: payouts are approved and recorded by the owner.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const { data, error } = await createAdminClient().rpc("sales_close_month", {});
  if (error) {
    // Migration not applied yet: nothing to close.
    if (/sales_close_month/.test(error.message ?? "")) return json({ skipped: "not_installed" });
    logError("sales.close_month", error);
    return fail(500, "close_failed", "Month-end close failed.");
  }
  return json(data);
}
