import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isContractorSigningEnabled } from "./contractor/config";
import { executionFor } from "./contractor/server";
import { createAdminClient } from "@/lib/supabase/server";
import { listSigningEvents, type SigningEvent } from "./events";
import { applicationLabel, EXECUTION_LABELS, signingOrder, type ExecutionState } from "./contractor/status";

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
  /** Audit trail of the signing link: opened, PDF downloaded, signed, copy emailed (oldest first). */
  activity: SigningEvent[];
  estimateId: string;
  versionId: string;
  /** V5.3 contractor side (present when contractor signatures are enabled). */
  execution?: {
    state: ExecutionState; label: string; contractorRequired: boolean | null; signingOrder: ("customer" | "contractor")[];
    contractor: null | {
      id: string; signerName: string; signerTitle: string | null; companyName: string; authority: string; application: string; howApplied: string;
      trigger: string; sequence: string; corrective: boolean; appliedAtUtc: string; credentialVersion: number; policyRevision: number | null;
      policy: Record<string, unknown>; statement: string; authorizationGivenAtUtc: string | null; ipAddress: string | null; userAgent: string | null;
      sessionAuthenticatedAtUtc: string | null; contentSha256: string;
    };
    executedPdf: { status: string; sha256: string | null; executedAtUtc: string } | null;
    events: { at: string; event: string; details: Record<string, unknown> }[];
  };
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
    // The caller may see this signature (RLS check above), so its request's events are read with the service role.
    activity: await listSigningEvents(createAdminClient(), s.request_id),
    estimateId: s.estimate_id,
    versionId: s.version_id,
    ...(isContractorSigningEnabled() ? { execution: await executionAudit(supabase, s) } : {}),
  };
}

async function executionAudit(supabase: SupabaseClient, s: { id: string; request_id: string; version_id: string; estimate_id: string; signed_at: string }): Promise<NonNullable<AuditRecord["execution"]>> {
  const [ex, { data: doc }, { data: events }] = await Promise.all([
    executionFor(supabase, s),
    supabase.from("contractor_executed_documents").select("pdf_status, pdf_hash, executed_at").eq("signature_id", s.id).maybeSingle(),
    supabase.from("contractor_signing_events").select("created_at, event, details").eq("estimate_id", s.estimate_id).order("id", { ascending: true }).limit(200),
  ]);
  const k = ex.contractor;
  return {
    state: ex.state, label: EXECUTION_LABELS[ex.state], contractorRequired: ex.required,
    signingOrder: signingOrder(s.signed_at, k?.applied_at ?? null),
    contractor: k ? {
      id: k.id, signerName: k.signer_name, signerTitle: k.signer_title, companyName: k.company_name, authority: k.authority, application: k.application,
      howApplied: applicationLabel(k), trigger: k.trigger, sequence: k.sequence, corrective: k.corrective, appliedAtUtc: k.applied_at,
      credentialVersion: k.credential_version, policyRevision: k.policy_revision, policy: k.policy_snapshot, statement: k.statement_text,
      authorizationGivenAtUtc: k.authorization_given_at, ipAddress: k.ip_address, userAgent: k.user_agent, sessionAuthenticatedAtUtc: k.session_authenticated_at,
      contentSha256: k.content_hash,
    } : null,
    executedPdf: doc ? { status: doc.pdf_status, sha256: doc.pdf_hash, executedAtUtc: doc.executed_at } : null,
    events: (events ?? []).map((e) => ({ at: e.created_at, event: e.event, details: e.details as Record<string, unknown> })),
  };
}
