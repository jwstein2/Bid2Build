import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";

/**
 * Reset to Company Default: clears this bid's own presentation choices (template, show options,
 * style overrides). Prices, items and sent/signed versions are untouched. The bid's author may reset
 * their own bid; template managers and the owner may reset any company bid they can see.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("style-reset", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Bid not found.");
  const { error } = await (await createClient()).rpc("proposal_style_reset", { p_estimate_id: id });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("style.reset", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "Only the bid's author or a template manager can reset this bid's style." : m.message);
  }
  return json({ ok: true });
}
