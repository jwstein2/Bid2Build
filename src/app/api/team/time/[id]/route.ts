import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

/** Change history of one time entry (who added, edited, approved, with reasons). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail(404, "not_found", "Entry not found.");
  const { data, error } = await g.supabase.rpc("pm_time_entry_history", { p_entry_id: id });
  if (error) return dbFail("time.history", error);
  return json({ history: data ?? [] });
}
