import { fail, json } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { loadFinState, loadJob } from "@/lib/financials/loaders";

export const runtime = "nodejs";

/** Everything the project's Financials tab shows. Reads with the user's client: RLS decides what is visible. */
export async function GET(_req: Request, ctx: { params: Promise<{ estimateId: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-job-read", limit: 600 });
  if ("error" in g) return g.error;
  const { estimateId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(estimateId)) return fail(404, "not_found", "Not found.");
  const state = await loadFinState(g.db);
  if (state.kind !== "ready") return fail(403, state.kind, state.kind === "not_installed" ? "Financials turns on after the database update is installed." : "Financials isn't part of your access.");
  const data = await loadJob(g.db, estimateId, state.ctx);
  if (!data) return fail(404, "not_found", "Project not found.");
  const { access, ai } = state.ctx;
  return json({ ...data, access: { permissions: access.permissions, readOnly: access.readOnly, active: access.active, role: access.role, sandbox: Boolean(access.sandbox) }, ai, bookName: access.name });
}
