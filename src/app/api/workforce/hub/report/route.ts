import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead } from "@/lib/team/route-helpers";
import { mapLaborReport } from "@/lib/workforce/hub/model";

export const runtime = "nodejs";

/** Employer labor report: scheduled vs actual hours by job and by non-project category (cost only for cost viewers). */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail(400, "invalid", "Pick a date range.");
  const { data, error } = await g.supabase.rpc("pm_labor_report", { p_from: from, p_to: to });
  if (error) return dbFail("hub.report", error);
  return json(mapLaborReport(data));
}
