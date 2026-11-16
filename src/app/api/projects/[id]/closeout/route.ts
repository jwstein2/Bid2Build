import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { workspaceDbError } from "@/lib/projects/server";

export const runtime = "nodejs";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), baseRevision: z.number().int().min(1), actualFinish: day, overrideReason: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal("reopen"), baseRevision: z.number().int().min(1) }),
]);

/** Project closeout (never needs payment; unfinished tasks need a recorded reason) and reopen. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("projects-closeout", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !p.success) return fail(400, "invalid", "Check the details and try again.");
  const supabase = await createClient();
  const b = p.data;
  const { data, error } = b.action === "complete"
    ? await supabase.rpc("schedule_closeout", { p_schedule_id: id, p_base_revision: b.baseRevision, p_actual_finish: b.actualFinish, p_override_reason: b.overrideReason || null })
    : await supabase.rpc("schedule_reopen", { p_schedule_id: id, p_base_revision: b.baseRevision });
  if (error) {
    const m = workspaceDbError(error);
    if (m.status === 500) logError("projects.closeout", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ revision: data as number });
}
