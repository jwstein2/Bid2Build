/**
 * V5.3 contractor-side signatures (company signer, assigned sales rep, manual countersignature).
 * Off until the owner sets NEXT_PUBLIC_CONTRACTOR_SIGNING=on, after running
 * supabase/migrations/20261125001000_contractor_signatures.sql. Needs e-signatures on as well.
 * Inlined at build time, so pages, routes and PDFs switch together. With it off, every screen and
 * document behaves exactly as before.
 */
import { isEsignEnabled } from "../config";

export const isContractorSigningEnabled = (env: Record<string, string | undefined> = {
  NEXT_PUBLIC_CONTRACTOR_SIGNING: process.env.NEXT_PUBLIC_CONTRACTOR_SIGNING,
  NEXT_PUBLIC_ESIGNATURES: process.env.NEXT_PUBLIC_ESIGNATURES,
}) => isEsignEnabled(env) && ["on", "true", "1"].includes((env.NEXT_PUBLIC_CONTRACTOR_SIGNING ?? "").trim().toLowerCase());

/** A credential is only stored right after the person proved it's them (fresh sign-in / email code). */
export const RECENT_AUTH_MINUTES = 15;

/** Bumped whenever the adoption wording changes; stored with every credential. */
export const ADOPTION_VERSION = "contractor-adopt-2026-11-17";

export type SigningMode = "company_signer" | "sales_rep" | "manual";
export type AutoTiming = "before_send" | "after_customer";

export const MODE_LABELS: Record<SigningMode, { title: string; body: string }> = {
  company_signer: { title: "Authorized company signature", body: "The designated company signer signs every contract. It can be applied automatically only if that person authorized it." },
  sales_rep: { title: "Assigned sales representative", body: "The rep assigned to the bid signs, if you authorized them and they have a signature on file. Otherwise the company signer signs." },
  manual: { title: "Manual countersignature", body: "After the customer signs, an authorized person reviews and countersigns each contract." },
};

/** Statement a person affirms when adopting a signature. */
export function adoptionText(p: { legalName: string; companyName?: string | null }): string {
  const who = p.legalName.trim();
  return `I, ${who}, adopt the signature shown above as my electronic signature. When I apply it to a document, or authorize it to be applied${p.companyName ? ` on behalf of ${p.companyName.trim()}` : ""}, it has the same effect as my handwritten signature. I confirm this is my own signature and that no one else will use it.`;
}

/** Separate, optional standing authorization for automatic application. */
export function autoApplyText(p: { legalName: string; companyName?: string | null }): string {
  const c = p.companyName?.trim() || "my business";
  return `I authorize Built2Bid to apply this signature automatically to proposals and contracts for ${c}, only as allowed by ${c}'s signing policy, until I revoke this authorization. Each automatic application is recorded as applied under this prior authorization, not as a signature I personally made at that moment.`;
}

/** Statement affirmed for an interactive countersignature. */
export function countersignText(p: { signerName: string; companyName: string; proposalNumber: string; projectTitle: string; total: string; versionNumber: number; customerSigned: boolean }): string {
  const what = [p.projectTitle && `"${p.projectTitle}"`, p.proposalNumber && `proposal #${p.proposalNumber}`, `version ${p.versionNumber}`].filter(Boolean).join(", ");
  return `I, ${p.signerName}, am authorized to sign for ${p.companyName || "the contractor"}. I have reviewed ${what} for a total of ${p.total}${p.customerSigned ? ", as accepted by the customer," : ""} and I sign it on behalf of ${p.companyName || "the contractor"}.`;
}

/** Human wording for why a contractor signature can't be applied yet. */
export const MISSING_LABELS: Record<string, string> = {
  no_signature_on_file: "The designated signer hasn't set up a signature yet.",
  signer_not_authorized: "The designated signer isn't authorized to sign for the company.",
  signer_scope_own_bids: "That signer may only sign their own bids.",
};
