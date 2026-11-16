import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { teamDbError } from "@/lib/projects/server";

export const runtime = "nodejs";
const body = z.object({ status: z.enum(["active", "archived"]) });

/** Archive or restore an entry. Archived entries keep past assignments but aren't offered for new work. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("team-status", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !p.success) return fail(400, "invalid", "Check the request and try again.");
  const { error } = await (await createClient()).rpc("pm_resource_set_status", { p_id: id, p_status: p.data.status });
  if (error) {
    const m = teamDbError(error);
    if (m.status === 500) logError("team.status", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ ok: true });
}
