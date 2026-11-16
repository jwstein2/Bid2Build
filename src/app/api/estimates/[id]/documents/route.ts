import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { contractSummary, type ChangeOrderLike } from "@/lib/operations/contract";
import { missingMigration, UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Document history for one bid: every version (which one was signed), change orders and contract value. */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Bid not found.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("project_proposal_history", { p_estimate_id: id });
  if (missingMigration(error)) return json({ available: false });
  if (error || !data) {
    if (error && error.code !== "42501") logError("documents.history", error);
    return fail(404, "not_found", "Bid not found.");
  }
  const h = data as { approval: { total: number } | null; changeOrders: ChangeOrderLike[] };
  return json({ available: true, ...h, summary: h.approval ? contractSummary(h.approval.total, h.changeOrders) : null });
}
