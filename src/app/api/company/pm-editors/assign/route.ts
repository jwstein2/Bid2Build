import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";

const Body = z.object({ userId: z.string().uuid(), assign: z.boolean() });

const CODES: Record<string, [number, string, string]> = {
  forbidden: [403, "forbidden", "Your company role can't manage scheduling editor seats."],
  not_member: [404, "not_member", "That person isn't an active member of your company."],
  editor_limit: [409, "editor_limit", "All scheduling editor seats are in use. Add an editor seat or remove someone first."],
};

/** Assign or remove an Enterprise schedule editor. Enforced in the database (company_pm_assign). */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isPmEnabled()) return fail(503, "pm_unavailable", "Project scheduling isn't available yet.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const { data, error } = await (await createClient()).rpc("company_pm_assign", { p_user_id: p.data.userId, p_assign: p.data.assign });
  if (error) {
    const known = Object.keys(CODES).find((k) => error.message?.includes(k));
    if (known) { const [s, c, m] = CODES[known]; return fail(s, c, m); }
    logError("pm.assign", error);
    return fail(500, "assign_failed", "Couldn't update editors. Please try again.");
  }
  return json(data ?? { ok: true });
}
