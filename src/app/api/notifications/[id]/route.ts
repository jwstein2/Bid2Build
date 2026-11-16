import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
const schema = z.object({ action: z.enum(["read", "later", "confirm"]) });

/** Notice actions: Confirm Complete (never automatic), Review Later (next morning, project time zone), read. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("notification-act", 120, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Notice not found.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose an action.");
  const { data, error } = await (await createClient()).rpc("notification_act", { p_id: id, p_action: p.data.action });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("notifications.act", error);
    return fail(m.status, m.code, m.message);
  }
  return json(data);
}
