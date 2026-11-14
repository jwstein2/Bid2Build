import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { site } from "@/lib/site";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";

const Create = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(["manager", "estimator", "viewer"]),
  teamId: z.string().uuid().nullable().optional(),
});
const Revoke = z.object({ id: z.string().uuid() });

/**
 * Invite a teammate. Uses a seat the company already pays for (never buys one). Returns the one-time
 * invite link: only its hash is stored, so this response is the only time the link exists.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("company-invite", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Create.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Enter a valid email address and role.");
  const { data, error } = await (await createClient()).rpc("create_company_invitation", { p_email: p.data.email, p_role: p.data.role, p_team_id: p.data.teamId ?? null });
  if (error) {
    const e = companyRpcError(error);
    if (e.status >= 500) logError("company.invite", error);
    return fail(e.status, e.code, e.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { invitation_id: string; token: string; expires_at: string };
  return json({ id: row.invitation_id, expiresAt: row.expires_at, inviteUrl: `${site.url}/company/join?token=${encodeURIComponent(row.token)}` });
}

export async function DELETE(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Revoke.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Unknown invitation.");
  const { error } = await (await createClient()).rpc("revoke_company_invitation", { p_invitation_id: p.data.id });
  if (error) { const e = companyRpcError(error); return fail(e.status, e.code, e.message); }
  return json({ ok: true });
}
