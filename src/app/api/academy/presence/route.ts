import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

export const dynamic = "force-dynamic";

/**
 * Academy presence. See src/lib/academy/presence.ts.
 *
 * POST: heartbeat for the signed-in caller, then fresh stats. academy_touch() only ever stamps the caller's own
 *       membership row (auth.uid(), server clock, at most one write a minute) and does nothing for someone who
 *       isn't an active Academy member, so nobody can mark another person online or pick a timestamp.
 * GET:  the public, aggregate-only stats (counts, no identities).
 */
async function stats(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("academy_stats");
  if (error) { logError("academy.presence.stats", error); return null; }
  return data;
}

export async function POST() {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isSupabaseConfigured()) return fail(503, "not_configured", "Accounts aren't configured.");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail(401, "not_authenticated", "Sign in required.");
  const { error } = await supabase.rpc("academy_touch");
  if (error) logError("academy.presence.touch", error);
  return json({ ok: !error, stats: await stats(supabase) });
}

export async function GET() {
  if (!isSupabaseConfigured()) return json({ stats: null });
  return json({ stats: await stats(await createClient()) });
}
