import "server-only";
import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient, getUser, type SessionUser } from "../supabase/server";
import { isSupabaseConfigured } from "../env";
import { ADMIN_HOME, ADMIN_LOGIN, ADMIN_TWO_STEP_SETUP, adminStepUpTarget, adminTwoStepRequired } from "../auth/admin-gate";

/** True for a signed-in owner: verified email and an admin_roles row (public.is_admin, by immutable user id). */
export async function isAdminUser(user: SessionUser | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  const { data } = await (await createClient()).rpc("is_admin", { p_user_id: user.id });
  return data === true;
}

/**
 * Authorize an admin request. Signed-out visitors go to the admin sign-in; signed-in accounts that aren't the
 * owner's go there too and see "this account isn't an admin account". The owner must also have passed the
 * authenticator step (aal2) unless ADMIN_REQUIRE_TWO_STEP=false (see src/lib/auth/admin-gate.ts).
 * Returns a service-role client: callers must only use it after this check.
 */
export async function requireAdmin(): Promise<{ user: SessionUser; db: ReturnType<typeof createAdminClient> }> {
  if (!isSupabaseConfigured()) notFound();
  const user = await getUser();
  if (!user) redirect(ADMIN_LOGIN);
  if (!(await isAdminUser(user))) redirect(`${ADMIN_LOGIN}?denied=1`);
  await requireAdminTwoStep();
  return { user, db: createAdminClient() };
}

/** Sends an owner session without the authenticator step to /auth/mfa (or to set one up). No-op when switched off. */
export async function requireAdminTwoStep(next: string = ADMIN_HOME): Promise<void> {
  if (!adminTwoStepRequired(process.env)) return;
  const { data: level } = await (await createClient()).auth.mfa.getAuthenticatorAssuranceLevel();
  const to = adminStepUpTarget(level, next);
  if (to) redirect(to);
}

export { adminTwoStepRequired };
export const ADMIN_TWO_STEP_REDIRECT = ADMIN_TWO_STEP_SETUP;

/** Append-only audit trail of admin actions. Never include bid contents in details. */
export async function audit(db: ReturnType<typeof createAdminClient>, actorId: string, action: string, targetType: string, targetId: string, details?: Record<string, unknown>) {
  const { error } = await db.from("audit_logs").insert({ actor_id: actorId, action, target_type: targetType, target_id: targetId, details: details ?? null });
  if (error) throw new Error("Audit log write failed; action aborted");
}
