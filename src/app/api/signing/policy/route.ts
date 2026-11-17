import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { policySchema } from "@/lib/esign/contractor/validate";
import { contractorError, signingTenant } from "@/lib/esign/contractor/server";
import { loadSigningSettings } from "@/lib/esign/contractor/settings";

export const runtime = "nodejs";

/** Company Profile → Proposal Signing: the policy, and (for managers) who may sign. */
export async function GET() {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  return json(await loadSigningSettings(createAdminClient(), user.id));
}

export async function PUT(req: Request) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("signing-policy", 20, 60_000))) return fail(429, "rate_limited", "Too many changes at once. Please wait a moment.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!user.verified) return fail(403, "email_not_verified", "Please verify your email first.");
  const parsed = policySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_policy", parsed.error.issues[0]?.message ?? "Check the signing settings.");
  const admin = createAdminClient();
  const tenant = await signingTenant(admin, user.id);
  if (!tenant.canManage) return fail(403, "forbidden", "Only the company owner or an administrator they trusted can change the signing policy.");
  const { error } = await admin.rpc("contractor_save_policy", { p_actor: user.id, p_company: tenant.companyId, p_settings: parsed.data });
  if (error) { const e = contractorError(error.message); return fail(e.status, e.code, e.text); }
  return json(await loadSigningSettings(admin, user.id));
}
