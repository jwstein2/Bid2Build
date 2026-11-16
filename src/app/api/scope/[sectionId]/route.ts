import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
const t = (n: number) => z.string().max(n).optional();
const schema = z.object({
  baseRevision: z.number().int().min(1), title: t(200), workDescription: t(8000), technicalInstructions: t(8000), installationNotes: t(8000),
  internalNotes: t(8000), customerInfo: t(4000), resourceId: z.string().regex(UUID).or(z.literal("")).nullable().optional(), summary: t(300),
});

/** Save one scope section (revision-checked; each save is kept in its revision history). */
export async function PATCH(req: Request, ctx: { params: Promise<{ sectionId: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("scope-save", 240, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { sectionId } = await ctx.params;
  if (!UUID.test(sectionId)) return fail(404, "not_found", "Section not found.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the section and try again.");
  const { baseRevision, ...fields } = p.data;
  const { data, error } = await (await createClient()).rpc("project_scope_save", { p_section_id: sectionId, p_base_revision: baseRevision, p: fields });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("scope.save", error);
    return fail(m.status, m.code, m.message);
  }
  return json({ revision: data as number });
}
