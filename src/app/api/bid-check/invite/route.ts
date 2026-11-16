import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { trialConfig } from "@/lib/trial/config";
import { requestPassFromQuestionnaire } from "@/lib/bid-check/server";

export const runtime = "nodejs";

/**
 * "Email me my 7-day Unlimited pass" from the bid-check result. Uses the existing trial invite (same
 * email, same activation page, same one-pass-per-email/account rules). Always answers the same way for
 * a valid address, so it can't be used to learn whether an email has an account or a past trial.
 * Paused (503) until FB_TRIAL_ENABLED=true, the same switch as the rest of the Facebook trial.
 */
const Body = z.object({
  email: z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  checkins: z.boolean().optional(),
  sid: z.string().uuid().nullable().optional(),
  // Honeypot: real people never fill it.
  company: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "forbidden", "Not allowed.");
  if (!trialConfig().enabled || !isSupabaseConfigured()) return fail(503, "paused", "Free passes are paused right now. You can still start a free bid.");
  if (!(await rateLimit("bid-check-invite", 5, 15 * 60_000))) return fail(429, "rate_limited", "Too many tries. Please wait a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_email", "Enter a valid email address.");
  if (parsed.data.company) return json({ ok: true });
  try {
    await requestPassFromQuestionnaire(createAdminClient(), { sessionId: parsed.data.sid ?? null, email: parsed.data.email, checkins: Boolean(parsed.data.checkins) });
    return json({ ok: true });
  } catch (e) {
    if ((e as Error).message === "invalid_email") return fail(400, "invalid_email", "Enter a valid email address.");
    logError("bid_check.invite", e);
    return fail(500, "error", "Something went wrong. Please try again.");
  }
}
