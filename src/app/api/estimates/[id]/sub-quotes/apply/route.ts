import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { opsDbError, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ quoteId: z.string().regex(UUID), revisionId: z.string().regex(UUID), note: z.string().max(1000).optional() });

/**
 * "Update internal project cost": the explicit, permission-checked step that moves the internal cost
 * forecast for a line to a quote revision. Customer prices and signed documents are never changed;
 * customer price changes go through a change order.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("sub-quote-apply", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Bid not found.");
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose a quote revision.");
  const supabase = await createClient();
  const { data: q } = await supabase.from("subcontractor_quotes").select("id").eq("id", p.data.quoteId).eq("estimate_id", id).maybeSingle();
  if (!q) return fail(404, "not_found", "Quote not found.");
  const { data, error } = await supabase.rpc("sub_quote_apply_cost", { p_quote_id: p.data.quoteId, p_revision_id: p.data.revisionId, p_note: p.data.note ?? null });
  if (error) {
    const m = opsDbError(error);
    if (m.status === 500) logError("sub_quote.apply", error);
    return fail(m.status, m.code, m.code === "forbidden" ? "You need “Edit internal project costs” to update the internal cost." : m.message);
  }
  return json(data);
}
