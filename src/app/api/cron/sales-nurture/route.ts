import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { runSalesNurture } from "@/lib/sales/nurture/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sales Hub follow-up and nurture scheduler (netlify/functions/sales-nurture-cron.mts, every 15 minutes).
 * Authorization: Bearer $EMAIL_OUTBOX_SECRET. Does nothing until an administrator turns the feature on,
 * approves the templates and picks test or live sending in Admin Sales Hub → Follow-up emails.
 * Returns counts only.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  try {
    return json(await runSalesNurture(createAdminClient()));
  } catch (e) {
    logError("sales_nurture.run", e);
    return fail(500, "failed", "Sales nurture run failed.");
  }
}
