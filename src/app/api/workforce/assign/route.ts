import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { teamDbError } from "@/lib/projects/server";

export const runtime = "nodejs";
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const body = z.object({
  taskId: z.string().uuid(),
  resourceId: z.string().uuid(),
  status: z.enum(["tentative", "requested", "confirmed", "declined", "cancelled"]).default("tentative"),
  notes: z.string().trim().max(2000).nullish(),
  hours: z.number().positive().max(10000).nullish(),
  startTime: hhmm.nullish(),
  endTime: hhmm.nullish(),
  baseRevision: z.number().int().min(0).optional(),
  overrideReason: z.string().trim().max(500).nullish(),
  allowSameProject: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

/**
 * Assign a directory entry to a project section/task: the same schedule_tasks assignment PM Hub uses.
 * The database checks permission, company, revision, duplicates and conflicts (override needs a reason
 * and edit-all rights, and is audited). Nothing is rescheduled, deleted or sent to anyone.
 */
export async function POST(req: Request) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("workforce-assign", 300, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the assignment details and try again.");
  const { data, error } = await (await createClient()).rpc("pm_assign_resource", { p: p.data });
  if (error) {
    const m = teamDbError(error);
    if (m.status === 500) logError("workforce.assign", error);
    return fail(m.status, m.code, m.message);
  }
  return json(data as Record<string, unknown>);
}
