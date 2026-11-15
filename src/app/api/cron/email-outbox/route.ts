import { timingSafeEqual } from "node:crypto";
import { deliverFounderEmails } from "@/lib/email/outbox";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Retries waiting founder welcome emails. Call with `Authorization: Bearer $EMAIL_OUTBOX_SECRET`
 * (e.g. from a scheduled job every 15 minutes). Does nothing while sending is disabled.
 * Returns counts only.
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  const res = await deliverFounderEmails(createAdminClient(), { limit: 25 });
  return json(res);
}
