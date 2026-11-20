import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, UUID_RE } from "@/lib/team/route-helpers";
import { mapWorkerWeek } from "@/lib/workforce/hub/model";

export const runtime = "nodejs";

/** One worker's week (the worker themself, or someone who approves their time). Never includes pay amounts. */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const u = new URL(req.url);
  const id = u.searchParams.get("resourceId") ?? "";
  const week = u.searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
  if (!UUID_RE.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return fail(400, "invalid", "Pick a person and a week.");
  const { data, error } = await g.supabase.rpc("pm_worker_week", { p_resource: id, p_week: week });
  if (error) return dbFail("hub.week", error);
  return json(mapWorkerWeek(data));
}
