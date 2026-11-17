import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposalDocument } from "@/lib/proposal/types";
import { formatCurrency } from "@/lib/estimate/money";
import { logError } from "@/lib/http/api";
import { sha256 } from "@/lib/export/finalize";
import { renderSignedPdf, type ContractorCertificate } from "@/lib/pdf/signed-pdf";
import type { ViewContractorSignature } from "@/components/proposal/proposal-view";
import { loadLogo, signedFilename } from "../server";
import { RECENT_AUTH_MINUTES } from "./config";
import { pngBuffer } from "./image";
import { applicationLabel, executionState, type ExecutionState } from "./status";

/** Full contractor_signatures row as stored. */
export interface ContractorSignature {
  id: string; estimate_id: string; version_id: string; user_id: string; company_id: string | null; customer_signature_id: string | null;
  signer_id: string | null; signer_name: string; signer_title: string | null; company_name: string; authority: string; authorization_id: string | null;
  credential_id: string | null; credential_version: number; signature_method: "drawn" | "typed" | "uploaded"; signature_text: string | null; signature_image: string | null;
  application: "auto_policy" | "interactive"; trigger: string; triggered_by: string | null; sequence: "contractor_first" | "customer_first"; corrective: boolean;
  policy_revision: number | null; policy_snapshot: Record<string, unknown>; statement_text: string; authorization_given_at: string | null; content_hash: string;
  ip_address: string | null; user_agent: string | null; session_authenticated_at: string | null; applied_at: string;
}

export interface Resolution {
  required: boolean;
  policy: { configured: boolean; mode: string; autoApplyAllowed: boolean; autoApplyTiming: string; repSignaturesAllowed: boolean; revision: number | null };
  signerId?: string; via?: string; authority?: string | null; credentialId?: string | null; signerName?: string | null; signerTitle?: string | null;
  autoEligible?: boolean; autoTiming?: string; missing?: string | null;
}

/** The caller's active company (if any) and whether they manage its signing policy. */
export async function signingTenant(admin: SupabaseClient, userId: string): Promise<{ companyId: string | null; companyName: string | null; role: string | null; isOwner: boolean; canManage: boolean }> {
  const { data: m } = await admin.from("company_members").select("company_id, role").eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!m) return { companyId: null, companyName: null, role: null, isOwner: false, canManage: true };
  const [{ data: c }, { data: can }] = await Promise.all([
    admin.from("companies").select("name, owner_user_id").eq("id", m.company_id).maybeSingle(),
    admin.rpc("contractor_can_manage_signing", { p_actor: userId, p_company: m.company_id }),
  ]);
  return { companyId: m.company_id, companyName: c?.name ?? null, role: m.role, isOwner: c?.owner_user_id === userId, canManage: Boolean(can) };
}

/**
 * When the person last proved who they are (Auth server's last_sign_in_at, i.e. the last email-code or
 * link sign-in). Used as the identity check before storing a signature. Never a made-up time.
 */
export function recentAuth(lastSignInAt: string | null | undefined, now = new Date()): { ok: boolean; at: string | null } {
  if (!lastSignInAt) return { ok: false, at: null };
  const at = new Date(lastSignInAt);
  return { ok: now.getTime() - at.getTime() <= RECENT_AUTH_MINUTES * 60_000 && at.getTime() <= now.getTime() + 60_000, at: at.toISOString() };
}

export async function resolveSigner(admin: SupabaseClient, estimateId: string): Promise<Resolution | null> {
  const { data, error } = await admin.rpc("contractor_resolve_signer", { p_estimate_id: estimateId });
  if (error) { logError("contractor.resolve", error, { estimate: estimateId }); return null; }
  return (data ?? null) as Resolution | null;
}

export async function contractorForVersion(db: SupabaseClient, versionId: string): Promise<ContractorSignature | null> {
  const { data } = await db.from("contractor_signatures").select("*").eq("version_id", versionId).maybeSingle();
  return (data ?? null) as ContractorSignature | null;
}

export function certificateFor(k: ContractorSignature): ContractorCertificate {
  return {
    id: k.id, signerName: k.signer_name, signerTitle: k.signer_title, companyName: k.company_name, authority: k.authority,
    application: k.application, applicationLabel: applicationLabel(k), method: k.signature_method, signatureText: k.signature_text,
    signatureImage: k.signature_method === "typed" ? null : pngBuffer(k.signature_image), appliedAt: k.applied_at,
    credentialVersion: k.credential_version, policyRevision: k.policy_revision, authorizationGivenAt: k.authorization_given_at,
    statementText: k.statement_text, ipAddress: k.ip_address, userAgent: k.user_agent, corrective: k.corrective,
  };
}

export function viewSignature(k: ContractorSignature): ViewContractorSignature {
  return {
    name: k.signer_name, title: k.signer_title, company: k.company_name, date: k.applied_at.slice(0, 10),
    image: k.signature_method === "typed" ? null : k.signature_image, typed: k.signature_method === "typed" ? k.signature_text ?? k.signer_name : null,
    auto: k.application === "auto_policy",
  };
}

/** Execution state of one customer signature (requirement frozen at link creation + recorded contractor row). */
export async function executionFor(db: SupabaseClient, sig: { request_id: string; version_id: string }): Promise<{ state: ExecutionState; contractor: ContractorSignature | null; required: boolean | null }> {
  const [{ data: req }, contractor] = await Promise.all([
    db.from("contractor_signing_requirements").select("required").eq("request_id", sig.request_id).maybeSingle(),
    contractorForVersion(db, sig.version_id),
  ]);
  return { state: executionState(sig, req, contractor), contractor, required: req ? Boolean(req.required) : null };
}

export const executedPdfPath = (userId: string, estimateId: string, signatureId: string) => `${userId}/${estimateId}/executed/${signatureId}.pdf`;
export const executedFilename = (doc: ProposalDocument, version: number) => signedFilename(doc, version).replace(/_SIGNED\.pdf$/, "_EXECUTED.pdf");

/**
 * Render and store the fully executed agreement (customer + contractor signatures, both certificates).
 * Only once both are recorded. Never throws; a failure is retried on the next download.
 */
export async function ensureExecutedPdf(admin: SupabaseClient, signatureId: string): Promise<{ ok: true; path: string; filename: string } | { ok: false; reason: "not_executed" | "failed" }> {
  try {
    const { data: s } = await admin.from("signatures").select("*").eq("id", signatureId).maybeSingle();
    if (!s) return { ok: false, reason: "not_executed" };
    const { data: opened } = await admin.rpc("contractor_open_executed", { p_signature_id: signatureId });
    const ex = (Array.isArray(opened) ? opened[0] : opened) as { pdf_status: string; pdf_path: string | null; executed_at: string } | null;
    if (!ex || !ex.executed_at) return { ok: false, reason: "not_executed" };
    const { data: v } = await admin.from("estimate_versions").select("proposal, snapshot->business->>logoPath").eq("id", s.version_id).maybeSingle();
    if (!v) return { ok: false, reason: "failed" };
    const doc = (v as unknown as { proposal: ProposalDocument }).proposal;
    const filename = executedFilename(doc, s.version_number);
    if (ex.pdf_status === "ready" && ex.pdf_path) return { ok: true, path: ex.pdf_path, filename };
    const k = await contractorForVersion(admin, s.version_id);
    if (!k) return { ok: false, reason: "not_executed" };
    const { data: req } = await admin.from("signing_requests").select("created_at").eq("id", s.request_id).maybeSingle();
    const pdf = await renderSignedPdf(doc, await loadLogo(admin, (v as unknown as { logoPath?: string | null }).logoPath ?? null), {
      signatureId: s.id, requestId: s.request_id, signerName: s.signer_name, signerEmail: s.signer_email, method: s.method,
      signatureText: s.signature_text, signatureImage: s.method === "drawn" ? pngBuffer(s.signature_image) : null, signedAt: s.signed_at, consentedAt: s.consented_at,
      consentVersion: s.consent_version, consentText: s.consent_text, acceptanceText: s.acceptance_text, verification: s.verification,
      documentHash: s.document_hash, contentHash: s.content_hash, versionNumber: s.version_number, total: formatCurrency(String(s.total)),
      ipAddress: s.ip_address, userAgent: s.user_agent, linkCreatedAt: req?.created_at ?? s.signed_at,
    }, { contractor: certificateFor(k), executed: true, executedAt: ex.executed_at });
    const path = executedPdfPath(s.user_id, s.estimate_id, s.id);
    const up = await admin.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    await admin.rpc("contractor_record_executed_pdf", { p_signature_id: s.id, p_ok: true, p_path: path, p_hash: sha256(pdf), p_error: null });
    return { ok: true, path, filename };
  } catch (e) {
    logError("contractor.executed_pdf", e, { signature: signatureId });
    await admin.rpc("contractor_record_executed_pdf", { p_signature_id: signatureId, p_ok: false, p_path: null, p_hash: null, p_error: String((e as Error).message ?? e).slice(0, 500) });
    return { ok: false, reason: "failed" };
  }
}

/** Plain-language error for a refused contractor-signature RPC. */
export function contractorError(message: string): { status: number; code: string; text: string } {
  const table: [string, number, string][] = [
    ["signer_not_authorized", 403, "You aren't authorized to sign this contract for the company. Ask the company owner to authorize you."],
    ["no_signature_on_file", 409, "Set up your signature first (Account settings → My Signature)."],
    ["signer_mismatch", 403, "Only the signer can apply their own signature."],
    ["already_countersigned", 409, "This version already has a contractor signature."],
    ["auto_not_permitted", 409, "Automatic signing isn't allowed for this contract. An authorized person must sign it."],
    ["estimate_archived", 409, "Restore this bid before signing it."],
    ["statement_required", 422, "Confirm the statement to sign."],
    ["forbidden", 403, "Only the company owner or an administrator they trusted can change this."],
    ["self_grant", 403, "You can't grant signing authority to yourself."],
    ["not_a_member", 422, "That person isn't an active estimator or manager in your company."],
    ["owner_already_authorized", 422, "The company owner can always sign."],
    ["use_company_policy", 409, "Your company's signing policy is managed in Company Profile → Proposal Signing."],
    ["invalid_policy", 422, "Check the signing settings and try again."],
  ];
  for (const [k, status, text] of table) if (message.includes(k)) return { status, code: k, text };
  return { status: 500, code: "contractor_signing_failed", text: "Something went wrong. Nothing was signed. Please try again." };
}
