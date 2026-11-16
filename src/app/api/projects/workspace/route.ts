import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, rateLimit } from "@/lib/http/api";
import { isIsoDate } from "@/lib/schedule/calendar";
import { loadWorkspace } from "@/lib/projects/server";

export const runtime = "nodejs";

/** Projects workspace data for a date window. Only projects the caller may already read (RLS). */
export async function GET(req: Request) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await rateLimit("projects-workspace", 240, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const u = new URL(req.url);
  const from = u.searchParams.get("from"), to = u.searchParams.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return fail(400, "invalid", "Pick a valid date range.");
  const ws = await loadWorkspace(await createClient(), from, to);
  return ws ? json(ws) : fail(503, "not_ready", "The Projects workspace update hasn't been applied yet.");
}
