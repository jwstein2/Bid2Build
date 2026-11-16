import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

const Body = z.object({ from: z.string().uuid(), to: z.string().uuid() }).strict();

const CODES: Record<string, [number, string, string]> = {
  forbidden: [403, "forbidden", "Your company role can't manage scheduling editor seats."],
  same_user: [400, "same_user", "Choose a different person to take over this seat."],
  not_editor: [409, "not_editor", "That person no longer holds a seat. Refresh and try again."],
  not_member: [404, "not_member", "That person isn't an active member of your company."],
  already_editor: [409, "already_editor", "That person already has a scheduling editor seat."],
};

/**
 * Move one scheduling editor seat from one member to another (V4 Phase 9). The seat keeps its place and
 * kind, so nothing is bought or billed again; the previous holder becomes view-only and every schedule
 * stays exactly as it was. Enforced in the database (company_pm_reassign, needs manage_pm_seats).
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isPmEnabled()) return fail(503, "pm_unavailable", "Project Command Center isn't available yet.");
  if (!(await rateLimit("pm-reassign", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const { data, error } = await (await createClient()).rpc("company_pm_reassign", { p_from: p.data.from, p_to: p.data.to });
  if (error) {
    const known = Object.keys(CODES).find((k) => error.message?.includes(k));
    if (known) { const [s, c, m] = CODES[known]; return fail(s, c, m); }
    logError("pm.reassign", error);
    return fail(500, "reassign_failed", "Couldn't move the seat. Nothing was changed.");
  }
  return json(data ?? { ok: true });
}
