import { createClient, getUser } from "@/lib/supabase/server";
import { loadEstimate } from "@/lib/data/server";
import { fail, json, logError } from "@/lib/http/api";
import { missingMigration, UUID } from "@/lib/operations/server";
import { compareQuotes, type SubQuoteBundle } from "@/lib/operations/sub-quotes";

export const runtime = "nodejs";

/**
 * Project internal costs: original estimate vs subcontractor bids, applied cost adjustments, and the
 * quotes themselves (so "Update internal project cost" / "Prepare change order" can act on a revision).
 * Only for people allowed to see subcontractor costs; the RPC answers canView=false otherwise.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Project not found.");
  const supabase = await createClient();
  const [data, sq] = await Promise.all([loadEstimate(supabase, id), supabase.rpc("sub_quotes_for_estimate", { p_estimate_id: id })]);
  if (!data) return fail(404, "not_found", "Project not found.");
  if (missingMigration(sq.error)) return json({ available: false });
  if (sq.error) { logError("costs.quotes", sq.error); return fail(500, "server_error", "We couldn't load internal costs."); }
  const b = sq.data as SubQuoteBundle | null;
  if (!b?.canView) return json({ available: true, canView: false });
  return json({
    available: true, canView: true, canApply: b.canApply, canRecord: b.canRecord,
    comparison: compareQuotes(data.estimate, b), quotes: b.quotes, adjustments: b.adjustments,
  });
}
