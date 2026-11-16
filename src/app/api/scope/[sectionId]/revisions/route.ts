import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { UUID } from "@/lib/operations/server";

export const runtime = "nodejs";

/** Revision history of one scope section (RLS: anyone who can read the project's scope). */
export async function GET(_req: Request, ctx: { params: Promise<{ sectionId: string }> }) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { sectionId } = await ctx.params;
  if (!UUID.test(sectionId)) return fail(404, "not_found", "Section not found.");
  const { data } = await (await createClient()).from("project_scope_revisions").select("revision, summary, content, created_at, actor_id").eq("section_id", sectionId).order("revision", { ascending: false }).limit(50);
  return json({ revisions: data ?? [] });
}
