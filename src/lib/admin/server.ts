import "server-only";
import { notFound } from "next/navigation";
import { createAdminClient, createClient, getUser, type SessionUser } from "../supabase/server";
import { isSupabaseConfigured } from "../env";

/**
 * Authorize an admin request. Non-admins get a 404 (the area's existence is not disclosed).
 * Returns a service-role client: callers must only use it after this check.
 */
export async function requireAdmin(): Promise<{ user: SessionUser; db: ReturnType<typeof createAdminClient> }> {
  if (!isSupabaseConfigured()) notFound();
  const user = await getUser();
  if (!user || !user.emailVerified) notFound();
  const { data: isAdmin } = await (await createClient()).rpc("is_admin", { p_user_id: user.id });
  if (!isAdmin) notFound();
  return { user, db: createAdminClient() };
}

/** Append-only audit trail of admin actions. Never include bid contents in details. */
export async function audit(db: ReturnType<typeof createAdminClient>, actorId: string, action: string, targetType: string, targetId: string, details?: Record<string, unknown>) {
  const { error } = await db.from("audit_logs").insert({ actor_id: actorId, action, target_type: targetType, target_id: targetId, details: details ?? null });
  if (error) throw new Error("Audit log write failed; action aborted");
}
