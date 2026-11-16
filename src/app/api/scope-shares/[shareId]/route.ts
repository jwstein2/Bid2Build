import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";

/** Stop sharing: the link stops working immediately. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ shareId: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { shareId } = await ctx.params;
  if (!UUID.test(shareId)) return fail(404, "not_found", "Share not found.");
  const { error } = await (await createClient()).rpc("scope_share_revoke", { p_share_id: shareId });
  if (error) { const m = opsDbError(error); if (m.status === 500) logError("scope.revoke", error); return fail(m.status, m.code, m.message); }
  return json({ ok: true });
}
