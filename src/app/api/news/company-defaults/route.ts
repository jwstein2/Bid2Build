import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { prefsSchema } from "@/lib/news/prefs";

/**
 * Company news defaults (Enterprise owners/managers). Members start from these until they save their own.
 * The database function checks the caller's company permission; platform source/copyright rules can't be changed here.
 */
export async function PUT(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const parsed = prefsSchema.pick({ followedTrades: true, topics: true, mutedTopics: true, geoEmphasis: true, radiusMiles: true, serviceCounties: true }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, "invalid", "Some defaults weren't valid.");
  const { error } = await (await createClient()).rpc("news_company_defaults_save", { p: parsed.data });
  if (error) {
    if (error.code === "42501") return fail(403, "forbidden", "Only company owners and managers can set news defaults.");
    logError("news.company_defaults", error);
    return fail(500, "server_error", "Couldn't save company defaults.");
  }
  return json({ ok: true });
}
