import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { deliverMetaConversions } from "@/lib/growth/conversions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends queued Meta conversions (netlify/functions/conversions-cron.mts, every 10 minutes).
 * Authorization: Bearer $EMAIL_OUTBOX_SECRET. Does nothing while META_CAPI_ENABLED is not "true".
 */
export async function POST(req: Request) {
  const secret = process.env.EMAIL_OUTBOX_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "unauthorized", "Not allowed.");
  return json(await deliverMetaConversions(createAdminClient()));
}
