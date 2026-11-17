import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { authorizationSchema } from "@/lib/esign/contractor/validate";
import { contractorError, signingTenant } from "@/lib/esign/contractor/server";
import { loadSigningSettings } from "@/lib/esign/contractor/settings";

export const runtime = "nodejs";

/** Authorize a company member to sign for the company (owner / trusted administrator only, never yourself). */
export async function POST(req: Request) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("signing-auth", 30, 60_000))) return fail(429, "rate_limited", "Too many changes at once. Please wait a moment.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const parsed = authorizationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid", parsed.error.issues[0]?.message ?? "Check the authorization.");
  const admin = createAdminClient();
  const tenant = await signingTenant(admin, user.id);
  if (!tenant.companyId) return fail(409, "no_company", "Signing authorizations are for Enterprise companies.");
  const { error } = await admin.rpc("contractor_grant_authorization", { p_actor: user.id, p_company: tenant.companyId, p_user: parsed.data.userId, p_scope: parsed.data.scope, p_auto: parsed.data.autoApplyAllowed, p_title: parsed.data.title });
  if (error) { const e = contractorError(error.message); return fail(e.status, e.code, e.text); }
  return json(await loadSigningSettings(admin, user.id));
}

/** Revoke a member's signing authority. Stops future use; executed documents are unchanged. */
export async function DELETE(req: Request) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(422, "invalid", "Choose a member.");
  const admin = createAdminClient();
  const tenant = await signingTenant(admin, user.id);
  if (!tenant.companyId) return fail(409, "no_company", "Signing authorizations are for Enterprise companies.");
  const { error } = await admin.rpc("contractor_revoke_authorization", { p_actor: user.id, p_company: tenant.companyId, p_user: userId });
  if (error) { const e = contractorError(error.message); return fail(e.status, e.code, e.text); }
  return json(await loadSigningSettings(admin, user.id));
}
