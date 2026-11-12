import { createClient, getUser } from "@/lib/supabase/server";
import { loadEstimate } from "@/lib/data/server";
import { fail, json } from "@/lib/http/api";

export async function GET(_req: Request, ctx: RouteContext<"/api/estimates/[id]">) {
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Estimate not found.");
  const data = await loadEstimate(await createClient(), id);
  if (!data) return fail(404, "not_found", "Estimate not found.");
  return json(data);
}
