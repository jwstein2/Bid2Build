import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { loadReviewQueue } from "@/lib/operations/queue-server";
import { opsDbError } from "@/lib/operations/server";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const items = await loadReviewQueue(await createClient());
  return json({ available: items !== null, items: items ?? [] });
}

const schema = z.object({ estimateId: z.string().uuid(), note: z.string().max(1000).optional() });

/** Mark Reviewed (records who and when). The next step, scheduling, is the wizard. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("project-review", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a project to review.");
  const { data, error } = await (await createClient()).rpc("project_mark_reviewed", { p_estimate_id: p.data.estimateId, p_note: p.data.note ?? null });
  if (error) {
    if (error.message.includes("already_scheduled")) return fail(409, "already_scheduled", "This project is already scheduled.");
    const m = opsDbError(error);
    if (m.status === 500) logError("project.review", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "Your company role can't review approved jobs." : m.message);
  }
  return json(data);
}
