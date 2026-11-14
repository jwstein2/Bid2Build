import { z } from "zod";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { site } from "@/lib/site";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";
import { PERMISSION_KEYS } from "@/lib/enterprise/permissions";

const perm = z.enum(PERMISSION_KEYS);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), userId: z.string().uuid(), role: z.enum(["manager", "estimator", "viewer"]), granted: z.array(perm).max(20).default([]), revoked: z.array(perm).max(20).default([]) }),
  z.object({ action: z.literal("status"), userId: z.string().uuid(), status: z.enum(["active", "deactivated"]) }),
  z.object({ action: z.literal("team_create"), name: z.string().trim().min(1).max(120), trade: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal("team_member"), teamId: z.string().uuid(), userId: z.string().uuid(), isManager: z.boolean().default(false), remove: z.boolean().default(false) }),
  z.object({ action: z.literal("recovery"), userId: z.string().uuid() }),
]);

/**
 * Company user administration. Every rule (who may change whom, owner-only grants, seat limits, no
 * self-changes) is enforced inside the database functions; this route only forwards and translates.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("company-members", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That change isn't valid.");
  const supabase = await createClient();
  const b = p.data;
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  try {
    switch (b.action) {
      case "update": await call("update_company_member", { p_user_id: b.userId, p_role: b.role, p_granted: b.granted, p_revoked: b.revoked }); break;
      case "status": await call("set_company_member_status", { p_user_id: b.userId, p_status: b.status }); break;
      case "team_create": return json({ id: await call("create_company_team", { p_name: b.name, p_trade: b.trade ?? null }) });
      case "team_member": await call("set_company_team_member", { p_team_id: b.teamId, p_user_id: b.userId, p_is_manager: b.isManager, p_remove: b.remove }); break;
      case "recovery": {
        // Sends the normal sign-in email to the member's own verified address. The admin sees nothing secret.
        const email = (await call("company_member_recovery_email", { p_user_id: b.userId })) as string;
        const { error } = await createAdminClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${site.url}/auth/callback?next=/dashboard` } });
        if (error) throw Object.assign(new Error(error.message), { code: "recovery_send_failed" });
        return json({ ok: true, sentTo: email.replace(/^(.).*@/, "$1•••@") });
      }
    }
    return json({ ok: true });
  } catch (error) {
    const e = companyRpcError(error as { message?: string; code?: string });
    if (e.status >= 500) logError("company.members", error, { action: b.action });
    return fail(e.status, e.code, e.message);
  }
}
