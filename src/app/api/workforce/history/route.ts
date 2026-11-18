import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json } from "@/lib/http/api";

export const runtime = "nodejs";

/** Assignment history for one directory entry (and a company's workers), limited to projects the caller can see. */
export async function GET(req: Request) {
  if (!isPmEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid", "Check the link and try again.");
  const supabase = await createClient();
  const [{ data, error }, people] = await Promise.all([
    supabase.rpc("pm_resource_history", { p_resource: id }),
    supabase.rpc("pm_people").then((r) => (r.error ? [] : ((r.data as { id: string; name: string }[]) ?? []))),
  ]);
  if (error) return fail(503, "not_ready", "History isn't available yet.");
  const names = new Map(people.map((p) => [p.id, p.name]));
  const events = ((data as Record<string, unknown>[]) ?? []).map((e) => ({ ...e, actor: e.actorId ? names.get(String(e.actorId)) ?? "Team member" : null }));
  return json({ events });
}
