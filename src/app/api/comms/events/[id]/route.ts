import { fail, json, sameOrigin } from "@/lib/http/api";
import { requireComm } from "@/lib/comms/server";

export const runtime = "nodejs";

/** Mark a reply / flagged event handled (the contractor responded personally). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Not found.");
  const g = await requireComm("view_customer_replies");
  if (!g.ok) return g.res;
  const { error } = await g.admin.from("comm_events").update({ handled_at: new Date().toISOString(), handled_by: g.userId }).eq("id", id).eq("account_id", g.access.accountId);
  if (error) return fail(500, "save_failed", "Could not update.");
  return json({ ok: true });
}
