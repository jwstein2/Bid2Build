import { createAdminClient, getAuthUser, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { ADOPTION_VERSION, adoptionText, autoApplyText, isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { credentialSchema } from "@/lib/esign/contractor/validate";
import { normalizeSignatureImage } from "@/lib/esign/contractor/image";
import { contractorError, recentAuth, signingTenant } from "@/lib/esign/contractor/server";
import { loadSigningSettings } from "@/lib/esign/contractor/settings";
import { requestEvidence } from "@/lib/esign/server";

export const runtime = "nodejs";

/** Account Settings → My Signature: your current signature (with its image, only ever to you). */
export async function GET() {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const admin = createAdminClient();
  const [{ data: cred }, settings, auth] = await Promise.all([
    admin.from("contractor_signer_credentials").select("id, version, legal_name, title, method, signature_text, signature_image, auto_apply_authorized, auto_apply_revoked_at, created_at, verification").eq("user_id", user.id).eq("status", "active").maybeSingle(),
    loadSigningSettings(admin, user.id),
    getAuthUser(),
  ]);
  return json({ credential: cred, settings, recentAuth: recentAuth(auth?.last_sign_in_at), email: user.email });
}

/**
 * Adopt (or update) your signature. Requires a fresh sign-in within the last few minutes (identity
 * check) and an affirmative adoption; automatic application is a separate, optional authorization.
 * Updating creates a new version; contracts signed earlier keep the signature they were signed with.
 */
export async function POST(req: Request) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("signing-credential", 10, 10 * 60_000))) return fail(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!user.emailVerified) return fail(403, "email_not_verified", "Verify your email address before saving a signature.");
  const auth = recentAuth((await getAuthUser())?.last_sign_in_at);
  if (!auth.ok) return fail(403, "reauth_required", "For your security, confirm it's you with a code sent to your email, then save again.");
  const parsed = credentialSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) { const i = parsed.error.issues[0]; return fail(422, "invalid_signature", i?.message ?? "Check your signature.", { field: i?.path?.[0] ?? null }); }
  const input = parsed.data;
  if (input.adoptionVersion !== ADOPTION_VERSION) return fail(409, "wording_changed", "This page was updated. Please reload it and review the statement again.");

  let image: string | null = null, imageSha: string | null = null;
  if (input.method !== "typed") {
    const norm = await normalizeSignatureImage(input.signatureImage ?? "");
    if (!norm.ok) return fail(422, "invalid_signature", norm.message, { field: "signatureImage" });
    image = norm.dataUrl; imageSha = norm.sha256;
  }
  const admin = createAdminClient();
  const tenant = await signingTenant(admin, user.id);
  if (input.method === "typed" && input.typedAs === "company") {
    if (!tenant.companyName) return fail(422, "invalid_signature", "Add your company name in Company Profile first.", { field: "signatureText" });
    if ((input.signatureText ?? "").toLowerCase() !== tenant.companyName.toLowerCase()) return fail(422, "invalid_signature", `A company signature must be your company's name: ${tenant.companyName}.`, { field: "signatureText" });
    input.signatureText = tenant.companyName;
  }
  const wording = { legalName: input.legalName, companyName: tenant.companyName };
  const ev = await requestEvidence();
  const { error } = await admin.rpc("contractor_adopt_credential", {
    p_user: user.id, p_legal_name: input.legalName, p_title: input.title, p_method: input.method,
    p_signature_text: input.method === "typed" ? input.signatureText : null, p_signature_image: image, p_image_sha256: imageSha,
    p_adoption_version: ADOPTION_VERSION, p_adoption_text: adoptionText(wording), p_auto_apply_text: input.autoApply ? autoApplyText(wording) : null,
    p_verification: { method: "recent_sign_in", authenticatedAt: auth.at, email: user.email, withinMinutes: 15 },
    p_ip: ev.ip, p_user_agent: ev.userAgent,
  });
  if (error) { const e = contractorError(error.message); return fail(e.status, e.code, e.text); }
  return GET();
}

/** ?scope=auto_apply stops automatic use only; ?scope=all revokes the signature. Signed contracts are unchanged. */
export async function DELETE(req: Request) {
  if (!isContractorSigningEnabled()) return fail(404, "not_found", "Not found.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const scope = new URL(req.url).searchParams.get("scope") === "all" ? "all" : "auto_apply";
  const { error } = await createAdminClient().rpc("contractor_revoke_credential", { p_user: user.id, p_scope: scope });
  if (error) { const e = contractorError(error.message); return fail(e.status, e.code, e.text); }
  return GET();
}
