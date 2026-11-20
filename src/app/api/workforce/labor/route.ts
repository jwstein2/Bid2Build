import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead } from "@/lib/team/route-helpers";
import { mapProjectLabor } from "@/lib/workforce/gps/model";

export const runtime = "nodejs";

/** Estimated vs actual labor for one project (cost only for people who may see pay rates). */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const id = new URL(req.url).searchParams.get("scheduleId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid", "Pick a project.");
  const { data, error } = await g.supabase.rpc("pm_project_labor", { p_schedule_id: id });
  if (error) return dbFail("gps.labor", error);
  return json(mapProjectLabor(data));
}
