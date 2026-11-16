import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { runTrialJobs } from "@/lib/trial/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Facebook trial housekeeping, every 15 minutes (netlify/functions/trial-campaign-cron.mts):
 * retries failed private replies, sends the one 4-hour Messenger reminder, and sends/retries the
 * invite and check-in emails. Authorization: Bearer $EMAIL_OUTBOX_SECRET. Does nothing while the
 * campaign is paused. Returns counts only.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  return json(await runTrialJobs(createAdminClient()));
}
