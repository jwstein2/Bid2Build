import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import type { ContractorSignatureRow, RequirementRow } from "./status";
import { resolveSigner, type Resolution } from "./server";
import { countersignText } from "./config";
import type { ProposalDocument } from "@/lib/proposal/types";

export interface ContractorState {
  requirements: RequirementRow[];
  signatures: ContractorSignatureRow[];
  resolution: Resolution | null;
  me: { authorized: boolean; hasSignature: boolean; canSign: boolean; reason: string | null; name: string | null };
  /** Exact statements the viewer would affirm (rebuilt identically on the server when they sign). */
  statements: { versionId: string; text: string }[];
  /** Display name of the designated signer (from the company roster), when known. */
  designatedName: string | null;
}

const SIG_COLS = "id, estimate_id, version_id, signer_name, signer_title, company_name, application, trigger, sequence, corrective, applied_at";

/**
 * Contractor-side state of one bid for the signed-in viewer. Document rows are read through the
 * viewer's RLS client (so a bid they can't see returns nothing); the authority check uses the service
 * role because it reads company policy the viewer may not see directly.
 */
export async function contractorState(db: SupabaseClient, admin: SupabaseClient, userId: string, estimateId: string): Promise<ContractorState | null> {
  const { data: visible } = await db.from("estimates").select("id").eq("id", estimateId).maybeSingle();
  if (!visible) return null;
  const [{ data: requirements, error }, { data: signatures }, resolution, { data: auth }, { data: cred }] = await Promise.all([
    db.from("contractor_signing_requirements").select("request_id, estimate_id, version_id, required, mode, sequence").eq("estimate_id", estimateId),
    db.from("contractor_signatures").select(SIG_COLS).eq("estimate_id", estimateId).order("applied_at", { ascending: false }),
    resolveSigner(admin, estimateId),
    admin.rpc("contractor_signer_authority", { p_signer: userId, p_estimate_id: estimateId }),
    admin.from("contractor_signer_credentials").select("id, legal_name").eq("user_id", userId).eq("status", "active").maybeSingle(),
  ]);
  if (error) { logError("contractor.state", error, { estimate: estimateId }); return null; }
  const a = (Array.isArray(auth) ? auth[0] : auth) as { ok?: boolean; reason?: string | null } | null;
  const authorized = Boolean(a?.ok);
  const hasSignature = Boolean(cred);
  // Statements for customer-signed versions that still need a contractor signature (and the next send).
  const signedVersions = new Set(((signatures ?? []) as ContractorSignatureRow[]).map((x) => x.version_id));
  const statements: ContractorState["statements"] = [];
  if (authorized && cred) {
    const { data: custom } = await db.from("signatures").select("version_id").eq("estimate_id", estimateId);
    const versions = [...new Set((custom ?? []).map((x) => x.version_id as string))].filter((v) => !signedVersions.has(v)).slice(0, 5);
    if (versions.length) {
      const { data: vs } = await admin.from("estimate_versions").select("id, version_number, proposal").in("id", versions);
      for (const v of vs ?? []) {
        const doc = v.proposal as ProposalDocument;
        statements.push({ versionId: v.id, text: countersignText({ signerName: cred.legal_name, companyName: doc.brand.companyName, proposalNumber: doc.meta.number, projectTitle: doc.meta.title, total: doc.pricing.total, versionNumber: v.version_number, customerSigned: true }) });
      }
    }
  }
  let designatedName: string | null = resolution?.signerName ?? null;
  if (!designatedName && resolution?.signerId) {
    const { data: m } = await admin.from("company_members").select("display_name, email").eq("user_id", resolution.signerId).maybeSingle();
    designatedName = m?.display_name || m?.email || (resolution.signerId === userId ? "you" : null);
  }
  return {
    statements,
    designatedName,
    requirements: (requirements ?? []) as RequirementRow[],
    signatures: (signatures ?? []) as ContractorSignatureRow[],
    resolution,
    me: { authorized, hasSignature, canSign: authorized && hasSignature, reason: authorized ? (hasSignature ? null : "no_signature_on_file") : (a?.reason ?? "signer_not_authorized"), name: cred?.legal_name ?? null },
  };
}
