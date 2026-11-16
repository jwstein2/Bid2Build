import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { normalizeLabels } from "@/lib/operations/photo-labels";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
const schema = z.object({
  caption: z.string().max(500).optional(), takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
  labels: z.array(z.string().max(60)).max(20).optional(), scopeSectionId: z.string().regex(UUID).or(z.literal("")).optional(), archived: z.boolean().optional(),
});

/** Edit caption / date / labels (accepting or correcting AI suggestions) / scope section, or archive. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("photo-edit", 240, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Photo not found.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the photo details.");
  const body = { ...p.data, ...(p.data.labels ? { labels: normalizeLabels(p.data.labels) } : {}) };
  const { error } = await (await createClient()).rpc("photo_update", { p_id: id, p: body });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("photos.update", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ ok: true });
}
