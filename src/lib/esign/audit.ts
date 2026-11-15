import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditRecord {
  format: "built2bid.signature-audit.v1";
  signature: {
    id: string; signedAtUtc: string; method: "typed" | "drawn"; typedSignature: string | null; drawnSignature: boolean;
    signerName: string; signerEmail: string; verification: string;
  };
  consent: { version: string; text: string; consentedAtUtc: string };
  acceptance: { text: string; total: string; versionNumber: number; proposalNumber: string; projectTitle: string; customerName: string };
  document: { proposalPdfSha256: string; proposalContentSha256: string; signedPdfSha256: string | null; signedPdfStatus: string };
  request: { id: string; createdAtUtc: string; expiresAtUtc: string; status: string } | null;
  evidence: { ipAddress: string | null; userAgent: string | null };
  estimateId: string;
  versionId: string;
}

/** Read through the caller's RLS-bound client: returns null when the caller may not see this bid. */
export async function auditRecord(supabase: SupabaseClient, signatureId: string): Promise<AuditRecord | null> {
  const { data: s } = await supabase.from("signatures")
    .select("id, request_id, estimate_id, version_id, signer_name, signer_email, method, signature_text, signature_image, consent_version, consent_text, acceptance_text, consented_at, document_hash, content_hash, total, version_number, proposal_number, project_title, customer_name, verification, ip_address, user_agent, signed_at, pdf_status, pdf_hash")
    .eq("id", signatureId).maybeSingle();
  if (!s) return null;
  const { data: r } = await supabase.from("signing_requests").select("id, created_at, expires_at, status").eq("id", s.request_id).maybeSingle();
  return {
    format: "built2bid.signature-audit.v1",
    signature: { id: s.id, signedAtUtc: s.signed_at, method: s.method, typedSignature: s.signature_text, drawnSignature: Boolean(s.signature_image), signerName: s.signer_name, signerEmail: s.signer_email, verification: s.verification },
    consent: { version: s.consent_version, text: s.consent_text, consentedAtUtc: s.consented_at },
    acceptance: { text: s.acceptance_text, total: String(s.total), versionNumber: s.version_number, proposalNumber: s.proposal_number, projectTitle: s.project_title, customerName: s.customer_name },
    document: { proposalPdfSha256: s.document_hash, proposalContentSha256: s.content_hash, signedPdfSha256: s.pdf_hash, signedPdfStatus: s.pdf_status },
    request: r ? { id: r.id, createdAtUtc: r.created_at, expiresAtUtc: r.expires_at, status: r.status } : null,
    evidence: { ipAddress: s.ip_address, userAgent: s.user_agent },
    estimateId: s.estimate_id,
    versionId: s.version_id,
  };
}
