import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { runComms } from "@/lib/comms/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Customer communications job (netlify/functions/comms-cron.mts). Authorization: Bearer $EMAIL_OUTBOX_SECRET. Counts only. */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  return json(await runComms(createAdminClient()));
}
