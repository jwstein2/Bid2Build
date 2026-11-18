import "server-only";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { recordsDbError, recordsMissing } from "./records";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Common guard for team-records writes: feature on, same origin, rate limit, signed in. */
export async function guardWrite(key: string, limit = 120): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { ok: false; res: Response }> {
  if (!isPmEnabled()) return { ok: false, res: fail(404, "not_found", "Not found.") };
  if (!(await sameOrigin())) return { ok: false, res: fail(403, "bad_origin", "Cross-site request refused.") };
  if (!(await rateLimit(key, limit, 10 * 60_000))) return { ok: false, res: fail(429, "rate_limited", "Please wait a moment and try again.") };
  const user = await getUser();
  if (!user) return { ok: false, res: fail(401, "not_authenticated", "Sign in required.") };
  return { ok: true, supabase: await createClient(), userId: user.id };
}
export async function guardRead(): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { ok: false; res: Response }> {
  if (!isPmEnabled()) return { ok: false, res: fail(404, "not_found", "Not found.") };
  const user = await getUser();
  if (!user) return { ok: false, res: fail(401, "not_authenticated", "Sign in required.") };
  return { ok: true, supabase: await createClient(), userId: user.id };
}

export function dbFail(where: string, error: { message?: string; code?: string }) {
  if (recordsMissing(error)) return fail(503, "not_ready", "This part of Team & Subcontractors is still being set up.");
  const m = recordsDbError(error);
  if (m.status === 500) logError(where, error);
  return fail(m.status, m.code, m.message);
}
