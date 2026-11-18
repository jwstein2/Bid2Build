import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { companyRpcError } from "@/lib/enterprise/errors";
import { PERMISSION_KEYS } from "@/lib/enterprise/permissions";
import { parseProfile } from "@/lib/access/effective";

export const runtime = "nodejs";

const perm = z.enum(PERMISSION_KEYS);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"), userId: z.string().uuid(), role: z.enum(["manager", "estimator", "viewer"]),
    granted: z.array(perm).max(PERMISSION_KEYS.length).default([]), revoked: z.array(perm).max(PERMISSION_KEYS.length).default([]),
    profile: z.record(z.string(), z.unknown()).nullable().default(null), reason: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("policy"), denied: z.array(perm).max(PERMISSION_KEYS.length).default([]), locked: z.array(perm).max(PERMISSION_KEYS.length).default([]), reason: z.string().trim().max(500).optional() }),
]);

/**
 * Team & Access (V6.7). Every rule (manage_users, never self or the owner, owner-only grants, owner locks,
 * company-wide restrictions, can't hand out what you don't hold) is enforced in the database functions;
 * this route validates shape and forwards. It never touches seats, subscriptions or Stripe.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("company-access", 60, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That change isn't valid.");
  const db = await createClient();
  const b = p.data;
  try {
    if (b.action === "save") {
      const { data, error } = await db.rpc("company_member_access_save", {
        p_user_id: b.userId, p_role: b.role, p_granted: b.granted, p_revoked: b.revoked,
        p_profile: b.profile ? parseProfile(b.profile) : null, p_reason: b.reason ?? null,
      });
      if (error) throw error;
      return json({ ok: true, result: data });
    }
    const { data, error } = await db.rpc("company_access_policy_save", { p_denied: b.denied, p_locked: b.locked, p_reason: b.reason ?? null });
    if (error) throw error;
    return json({ ok: true, policy: data });
  } catch (error) {
    const e = companyRpcError(error as { message?: string; code?: string });
    if (e.status >= 500) logError("company.access", error, { action: b.action });
    return fail(e.status, e.code, e.message);
  }
}

/** Access change history: ?user=<id> for one person, or the whole company. */
export async function GET(req: Request) {
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  const u = new URL(req.url).searchParams.get("user");
  const userId = u && z.string().uuid().safeParse(u).success ? u : null;
  const db = await createClient();
  const { data, error } = await db.rpc("company_access_history", { p_user_id: userId, p_limit: 50 });
  if (error) {
    const e = companyRpcError(error);
    if (e.status >= 500) logError("company.access.history", error);
    return fail(e.status, e.code, e.message);
  }
  return json({ entries: data ?? [] });
}
