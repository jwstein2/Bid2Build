import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ProposalDocument } from "@/lib/proposal/types";
import { ProposalPdf } from "@/lib/pdf/proposal-pdf";
import { contractorOnProposal } from "@/lib/pdf/signed-pdf";
import { logError } from "@/lib/http/api";
import { sha256 } from "@/lib/export/finalize";
import { loadLogo, type PublicRequest } from "../server";
import { countersignText } from "./config";
import { certificateFor, contractorError, contractorForVersion, resolveSigner, type ContractorSignature, type Resolution } from "./server";

/** The proposal PDF with the contractor signature already on it (contractor-first). */
export async function renderWithContractor(doc: ProposalDocument, logo: { data: Buffer; format: "png" | "jpg" } | null, k: ContractorSignature): Promise<Buffer> {
  return renderToBuffer(<ProposalPdf doc={doc} logo={logo} contractor={contractorOnProposal(certificateFor(k))} />);
}

/** Fallback render of a request's PDF when the stored copy is missing: includes a contractor-first signature. */
export async function contractorPdfFor(admin: SupabaseClient, req: PublicRequest): Promise<Buffer> {
  const logo = await loadLogo(admin, req.logoPath);
  const k = await contractorForVersion(admin, req.versionId);
  if (k && k.applied_at <= req.createdAt) return renderWithContractor(req.doc, logo, k);
  return renderToBuffer(<ProposalPdf doc={req.doc} logo={logo} />);
}

export interface BeforeSendResult {
  pdf: Buffer;
  pdfHash: string;
  contractor: ContractorSignature | null;
  resolution: Resolution | null;
}

/**
 * Contractor-first, before a signing link is created:
 *  - signBeforeSend: the signed-in person signs now, in person (must be authorized and have a signature).
 *  - otherwise, if the policy allows automatic application before sending and the designated signer
 *    authorized it, it is applied automatically and recorded as such.
 * The customer then reviews (and its hash covers) the PDF that already shows the contractor signature.
 * Returns an error Response only for an explicit signBeforeSend that can't be honoured.
 */
export async function prepareBeforeSend(admin: SupabaseClient, p: {
  userId: string; estimateId: string; versionId: string; versionNumber: number; doc: ProposalDocument; pdf: Buffer; pdfHash: string;
  signBeforeSend: boolean; ip: string | null; userAgent: string | null; sessionAt: string | null;
}): Promise<BeforeSendResult | { error: { status: number; code: string; text: string } }> {
  let k = await contractorForVersion(admin, p.versionId);
  const resolution = await resolveSigner(admin, p.estimateId);
  if (!k && p.signBeforeSend) {
    const { data, error } = await admin.rpc("contractor_apply_signature", {
      p_estimate_id: p.estimateId, p_version_id: p.versionId, p_signer: p.userId, p_actor: p.userId, p_application: "interactive", p_trigger: "sign_before_send",
      p_statement: countersignText({ signerName: await signerName(admin, p.userId), companyName: p.doc.brand.companyName, proposalNumber: p.doc.meta.number, projectTitle: p.doc.meta.title, total: p.doc.pricing.total, versionNumber: p.versionNumber, customerSigned: false }),
      p_ip: p.ip, p_user_agent: p.userAgent, p_session_authenticated_at: p.sessionAt,
    });
    if (error) return { error: contractorError(error.message) };
    k = (Array.isArray(data) ? data[0] : data) as ContractorSignature;
  } else if (!k && resolution?.required && resolution.autoEligible && resolution.autoTiming === "before_send" && resolution.signerId) {
    const { data, error } = await admin.rpc("contractor_apply_signature", {
      p_estimate_id: p.estimateId, p_version_id: p.versionId, p_signer: resolution.signerId, p_actor: p.userId, p_application: "auto_policy", p_trigger: "signing_link_created",
      p_statement: null, p_ip: null, p_user_agent: null, p_session_authenticated_at: null,
    });
    // Not fatal: the link still goes out and the contract waits for a countersignature instead.
    if (error) logError("contractor.auto_before_send", error, { estimate: p.estimateId });
    else k = (Array.isArray(data) ? data[0] : data) as ContractorSignature;
  }
  if (!k) return { pdf: p.pdf, pdfHash: p.pdfHash, contractor: null, resolution };
  const { data: v } = await admin.from("estimate_versions").select("snapshot->business->>logoPath").eq("id", p.versionId).maybeSingle();
  const pdf = await renderWithContractor(p.doc, await loadLogo(admin, (v as unknown as { logoPath?: string | null } | null)?.logoPath ?? null), k);
  return { pdf, pdfHash: sha256(pdf), contractor: k, resolution };
}

async function signerName(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("contractor_signer_credentials").select("legal_name").eq("user_id", userId).eq("status", "active").maybeSingle();
  return data?.legal_name ?? "the signer";
}
