import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { activateTrial } from "@/lib/trial/service";

export const runtime = "nodejs";

/**
 * Activates the 7-day pass. POST only, from a signed-in session whose verified email matches the
 * invite (checked in Postgres). A link preview or scanner can't do this: it only GETs the page and
 * has no session. Idempotent: repeating it returns the same expiry.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "forbidden", "Not allowed.");
  if (!(await rateLimit("trial-activate", 20, 15 * 60_000))) return fail(429, "rate_limited", "Too many tries. Please wait a few minutes.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in first.");
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const r = await activateTrial(createAdminClient(), user.id, body?.token);
  return r.ok ? json({ ok: true, expiresAt: r.expiresAt, repeat: r.repeat }) : json({ ok: false, reason: r.reason, hint: r.hint ?? null }, r.reason === "error" ? 500 : 200);
}
