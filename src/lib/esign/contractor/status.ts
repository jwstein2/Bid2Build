/**
 * Contractor-side execution status of a customer-signed version (V5.3), derived from recorded rows only.
 * Kept separate from the customer signing state (src/lib/esign/status.ts), which is unchanged.
 */
export type ExecutionState = "fully_executed" | "awaiting_contractor" | "not_required" | "historical";

export interface RequirementRow { request_id: string; estimate_id: string; version_id: string; required: boolean; mode: string; sequence: string }
export interface ContractorSignatureRow {
  id: string; estimate_id: string; version_id: string; signer_name: string; signer_title: string | null; company_name: string;
  application: "auto_policy" | "interactive"; trigger: string; sequence: "contractor_first" | "customer_first"; corrective: boolean; applied_at: string;
}
export interface SignedRow { id: string; request_id: string; version_id: string; signed_at: string }

export const EXECUTION_LABELS: Record<ExecutionState, string> = {
  fully_executed: "Fully Executed",
  awaiting_contractor: "Awaiting Contractor Signature",
  not_required: "Signed",
  historical: "Customer signed (no contractor signature on record)",
};

/**
 * - historical: the link was created before contractor signatures existed (no requirement row). It is
 *   shown as it actually is; a corrective countersignature can be added later (then fully_executed).
 * - not_required: the policy at link creation didn't require a contractor signature.
 */
export function executionState(sig: Pick<SignedRow, "request_id" | "version_id">, requirement: Pick<RequirementRow, "required"> | null | undefined, contractor: Pick<ContractorSignatureRow, "version_id"> | null | undefined): ExecutionState {
  if (contractor && contractor.version_id === sig.version_id) return "fully_executed";
  if (!requirement) return "historical";
  return requirement.required ? "awaiting_contractor" : "not_required";
}

/** How the contractor signature was applied, in plain words for screens and the certificate. */
export function applicationLabel(c: Pick<ContractorSignatureRow, "application" | "trigger" | "corrective">): string {
  if (c.application === "auto_policy") {
    return c.trigger === "customer_signed"
      ? "Applied automatically after the customer signed, under the signer's prior authorization and the company signing policy"
      : "Applied automatically when the signing link was created, under the signer's prior authorization and the company signing policy";
  }
  if (c.corrective) return "Countersigned later by the signer in person (corrective countersignature on a proposal signed before contractor signatures were recorded)";
  return c.trigger === "sign_before_send" ? "Signed by the signer in person before the proposal was sent" : "Countersigned by the signer in person after review";
}

/** Order of events actually recorded, oldest first. */
export function signingOrder(customerSignedAt: string | null, contractorAppliedAt: string | null): ("customer" | "contractor")[] {
  const ev: { who: "customer" | "contractor"; at: string }[] = [];
  if (customerSignedAt) ev.push({ who: "customer", at: customerSignedAt });
  if (contractorAppliedAt) ev.push({ who: "contractor", at: contractorAppliedAt });
  return ev.sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.who);
}
