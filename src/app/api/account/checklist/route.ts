import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { CHECKLIST_DISMISSED_KEY } from "@/lib/growth/activation";

/** Hide the dashboard "Get your first bid out" checklist for this account (stored in Auth user metadata). */
export async function POST() {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { error } = await (await createClient()).auth.updateUser({ data: { [CHECKLIST_DISMISSED_KEY]: new Date().toISOString() } });
  if (error) { logError("checklist.dismiss", error, { user: user.id }); return fail(500, "save_failed", "Could not save that. Try again."); }
  return json({ ok: true });
}
