import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { acceptanceText, consentText, CONSENT_VERSION, isEsignEnabled } from "@/lib/esign/config";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { acceptSchema } from "@/lib/esign/validate";
import { ensureSignedPdf, loadRequestByToken, requestEvidence } from "@/lib/esign/server";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { ensureExecutedPdf } from "@/lib/esign/contractor/server";
import { recordSigningEvent } from "@/lib/esign/events";
import { sendSignerCopy } from "@/lib/esign/signer-copy";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHASE_ERRORS = {
  expired: [410, "link_expired", "This signing link has expired. Please ask the contractor for a new one."],
  revoked: [410, "link_revoked", "This signing link is no longer active. Please contact the contractor."],
} as const;

/**
 * Accept & Sign. No account: possession of the secret link is the only check (recorded as such, never
 * described as identity verification). The consent and acceptance wording is rebuilt on the server
 * from the frozen proposal, so the stored statement is exactly what the page showed for this version.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sign/[token]">) {
  if (!isEsignEnabled()) return fail(404, "not_found", "Not found.");
  const { token } = await ctx.params;
  if (!isSigningToken(token)) return fail(404, "link_invalid", "This signing link isn't valid.");
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("sign-accept", 8, 10 * 60_000))) return fail(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");

  const parsed = acceptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(422, "invalid_signature", first?.message ?? "Check the highlighted fields.", { field: first?.path?.[0] ?? null });
  }
  const input = parsed.data;
  if (input.consentVersion !== CONSENT_VERSION) return fail(409, "consent_changed", "This page was updated. Please reload it and review the proposal again.");

  const admin = createAdminClient();
  const r = await loadRequestByToken(admin, token);
  if (!r) return fail(404, "link_invalid", "This signing link isn't valid.");
  if (r.phase === "expired" || r.phase === "revoked") {
    const [status, code, message] = PHASE_ERRORS[r.phase];
    return fail(status, code, message);
  }

  const company = r.doc.brand.companyName;
  const { ip, userAgent } = await requestEvidence();
  const { data, error } = await admin.rpc("accept_signing_request", {
    p_token_hash: hashSigningToken(token),
    p_signer_name: input.signerName,
    p_signer_email: input.signerEmail,
    p_method: input.method,
    p_signature_text: input.method === "typed" ? input.signatureText : null,
    p_signature_image: input.method === "drawn" ? input.signatureImage : null,
    p_consent_version: CONSENT_VERSION,
    p_consent_text: consentText(company),
    p_acceptance_text: acceptanceText({ companyName: company, proposalNumber: r.doc.meta.number, projectTitle: r.doc.meta.title, total: r.doc.pricing.total }),
    p_consented_at: input.consentedAt ?? new Date().toISOString(),
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) {
    for (const [k, [status, code, message]] of [
      ["already_signed", [409, "already_signed", "This proposal has already been signed."]],
      ["link_expired", PHASE_ERRORS.expired], ["link_revoked", PHASE_ERRORS.revoked],
      ["link_invalid", [404, "link_invalid", "This signing link isn't valid."]],
    ] as const) if (error.message.includes(k)) return fail(status, code, message);
    logError("esign.accept", error, { request: r.id });
    return fail(500, "sign_failed", "We couldn't record your signature. Nothing was signed. Please try again.");
  }
  const row = (Array.isArray(data) ? data[0] : data) as { signature_id: string; created: boolean };
  if (row.created) await recordSigningEvent(admin, r.id, "signed", { ip, userAgent });

  // V5.3: contractor side. Contractor-first opens the executed record; automatic application after the
  // customer signs happens here when the policy allows it; otherwise the contract waits for a person to
  // countersign. Nothing is emailed to anyone and nothing is charged. Never blocks the acceptance.
  let execution: string | null = null;
  if (isContractorSigningEnabled()) {
    const { data: after, error: afterErr } = await admin.rpc("contractor_after_customer_signed", { p_signature_id: row.signature_id });
    if (afterErr) logError("contractor.after_customer", afterErr, { signature: row.signature_id });
    execution = (after as { state?: string } | null)?.state ?? null;
  }
  // Acceptance is committed. The signed copy is best effort: a failure is retried on download.
  const pdf = await ensureSignedPdf(admin, row.signature_id);
  if (execution === "fully_executed") await ensureExecutedPdf(admin, row.signature_id);
  // The signer gets a copy by email (like other e-signature services) when ESIGN_SIGNER_COPY_EMAIL=on.
  if (row.created) {
    const sent = await sendSignerCopy({ to: input.signerEmail, signerName: input.signerName, token, doc: r.doc, signatureId: row.signature_id });
    if (sent) await recordSigningEvent(admin, r.id, "copy_emailed", { ip: null, userAgent: null });
  }
  return json({ signed: true, signatureId: row.signature_id, pdfReady: pdf.ok, execution });
}
