import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { trialConfig } from "@/lib/trial/config";
import { requestTrialInvite } from "@/lib/trial/service";

export const runtime = "nodejs";

/**
 * Claim page (/trial) submits here. Always answers the same way for a valid address, so the page
 * can't be used to learn whether an email has an account or already had a trial.
 */
const Body = z.object({
  email: z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  checkins: z.boolean().optional(),
  // Honeypot: real people never fill it.
  company: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "forbidden", "Not allowed.");
  if (!trialConfig().enabled || !isSupabaseConfigured()) return fail(503, "paused", "Invites are paused right now. Please check back soon.");
  if (!(await rateLimit("trial-request", 5, 15 * 60_000))) return fail(429, "rate_limited", "Too many tries. Please wait a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_email", "Enter a valid email address.");
  if (parsed.data.company) return json({ ok: true });
  try {
    await requestTrialInvite(createAdminClient(), { email: parsed.data.email, source: "claim_page", checkins: parsed.data.checkins });
    return json({ ok: true });
  } catch (e) {
    if ((e as Error).message === "invalid_email") return fail(400, "invalid_email", "Enter a valid email address.");
    logError("trial.request", e);
    return fail(500, "error", "Something went wrong. Please try again.");
  }
}
