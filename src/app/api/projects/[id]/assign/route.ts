import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { teamDbError } from "@/lib/projects/server";

export const runtime = "nodejs";
const body = z.object({
  baseRevision: z.number().int().min(0),
  items: z.array(z.object({
    taskId: z.string().uuid(),
    resourceId: z.string().uuid().nullable(),
    status: z.enum(["tentative", "requested", "confirmed", "declined"]).nullish(),
  })).min(1).max(500),
  summary: z.string().trim().max(300).optional(),
});

/**
 * Assign who's doing the work on sections/tasks. A section assignment flows into its tasks unless a task
 * has its own. Revision-checked like every schedule save. Never notifies anyone.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("projects-assign", 240, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !p.success) return fail(400, "invalid", "Check the assignments and try again.");
  const { data, error } = await (await createClient()).rpc("schedule_assign", {
    p_schedule_id: id, p_base_revision: p.data.baseRevision, p_items: p.data.items, p_summary: p.data.summary ?? null,
  });
  if (error) {
    const m = teamDbError(error);
    if (m.status === 500) logError("projects.assign", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ revision: data as number });
}
