import { fail, json } from "@/lib/http/api";
import { dbFail, guardRead, UUID_RE } from "@/lib/team/route-helpers";
import { loadPayProjection } from "@/lib/workforce/hub/server";

export const runtime = "nodejs";

/** Estimated gross pay for one worker: HR admins always; the worker only when the company turned it on for them. */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const u = new URL(req.url);
  const id = u.searchParams.get("resourceId") ?? "";
  const day = u.searchParams.get("day") ?? undefined;
  if (!UUID_RE.test(id) || (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))) return fail(400, "invalid", "Pick a person.");
  const r = await loadPayProjection(g.supabase, id, day);
  if (!r.ok) return dbFail("hub.pay", r.error);
  return json(r.data);
}
