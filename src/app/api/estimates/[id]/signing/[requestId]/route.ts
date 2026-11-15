import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { isEsignEnabled } from "@/lib/esign/config";

export const runtime = "nodejs";

/** Revoke a pending signing link (bid owner only). A signed request can't be revoked. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/estimates/[id]/signing/[requestId]">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { id, requestId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return fail(404, "not_found", "Signing link not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { data, error } = await createAdminClient().rpc("revoke_signing_request", { p_user_id: user.id, p_request_id: requestId });
  if (error) {
    if (error.message.includes("request_not_found")) return fail(404, "not_found", "Signing link not found.");
    logError("esign.revoke", error, { user: user.id });
    return fail(500, "revoke_failed", "Couldn't revoke the link. Please try again.");
  }
  const r = (Array.isArray(data) ? data[0] : data) as { status: string; estimate_id: string };
  if (r.estimate_id !== id) return fail(404, "not_found", "Signing link not found.");
  return json({ status: r.status });
}
