import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { workspaceDbError } from "@/lib/projects/server";

export const runtime = "nodejs";
const body = z.object({ salesRepId: z.string().uuid().nullable(), projectManagerId: z.string().uuid().nullable() });

/** Sets the project's salesperson and project manager (separate roles). Checked again in SQL. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("projects-people", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !p.success) return fail(400, "invalid", "Check the people and try again.");
  const { error } = await (await createClient()).rpc("schedule_set_people", { p_schedule_id: id, p_sales_rep: p.data.salesRepId, p_project_manager: p.data.projectManagerId });
  if (error) {
    const m = workspaceDbError(error);
    if (m.status === 500) logError("projects.people", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ ok: true });
}
