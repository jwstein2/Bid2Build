import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json } from "@/lib/http/api";
import { loadTargets } from "@/lib/workforce/server";

export const runtime = "nodejs";

/** Projects to assign to (open schedules the caller can see; RLS decides). */
export async function GET() {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const t = await loadTargets(await createClient());
  return t ? json({ projects: t }) : fail(503, "not_ready", "Contractors & Workforce hasn't been set up yet.");
}
