import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { runLifecycle, sendLifecycleSamples } from "@/lib/email/lifecycle-run";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily lifecycle email job (netlify/functions/lifecycle-cron.mts). Authorization: Bearer $EMAIL_OUTBOX_SECRET.
 *   ?dry=1      report how many of each email would go out now (counts only, sends nothing)
 *   ?samples=1  send one example of each email to LIFECYCLE_TEST_RECIPIENTS (test or live mode only)
 * Sends nothing while LIFECYCLE_EMAIL_MODE is off.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const q = new URL(req.url).searchParams;
  if (q.get("samples") === "1") return json(await sendLifecycleSamples());
  return json(await runLifecycle(createAdminClient(), { dryRun: q.get("dry") === "1" }));
}
