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

/**
 * Bumped whenever the adoption wording changes; stored with every credential (older credentials keep theirs).
 * v2026-11-21: agreement to transact electronically (UETA sec. 5), express intent and legal effect (ESIGN
 * 15 U.S.C. 7001(a), UETA sec. 7), attribution and security duties (UETA sec. 9), authority limits, and notice
 * that adoption and every application are recorded. Draft wording for attorney review.
 */
export const ADOPTION_VERSION = "contractor-adopt-2026-11-21";

export type SigningMode = "company_signer" | "sales_rep" | "manual";
export type AutoTiming = "before_send" | "after_customer";

export const MODE_LABELS: Record<SigningMode, { title: string; body: string }> = {
  company_signer: { title: "Authorized company signature", body: "The designated company signer signs every contract. It can be applied automatically only if that person authorized it." },
  sales_rep: { title: "Assigned sales representative", body: "The rep assigned to the bid signs, if you authorized them and they have a signature on file. Otherwise the company signer signs." },
  manual: { title: "Manual countersignature", body: "After the customer signs, an authorized person reviews and countersigns each contract." },
};

const LEGAL_EFFECT = "the same legal effect as a handwritten signature under the federal ESIGN Act and the Uniform Electronic Transactions Act as adopted in the applicable state";

/** Statement a person affirms when adopting a signature. */
export function adoptionText(p: { legalName: string; companyName?: string | null }): string {
  const who = p.legalName.trim();
  const co = p.companyName?.trim();
  return [
    `I, ${who}, adopt the signature shown above as my electronic signature${co ? `, for myself and when signing on behalf of ${co}` : ""}.`,
    `I agree to do business electronically. Each time I apply this signature to a document, or authorize it to be applied, I intend to sign that document, and my signature has ${LEGAL_EFFECT}.`,
    `I confirm that I am the person named above, that this is my own signature, and that no one else will use it.${co ? ` I will sign for ${co} only within the authority ${co} has given me.` : ""}`,
    "I will keep my Built2Bid sign-in secure, and I will remove this signature right away if I believe someone else has used it or my account.",
    "I understand that Built2Bid records when I adopt this signature and every time it is applied, and that this record can be used as evidence that I signed.",
  ].join(" ");
}

/** Separate, optional standing authorization for automatic application. */
export function autoApplyText(p: { legalName: string; companyName?: string | null }): string {
  const c = p.companyName?.trim() || "my business";
  return [
    `I authorize Built2Bid to apply this signature for me automatically to proposals and contracts for ${c}, only as allowed by ${c}'s signing policy, until I revoke this authorization in My Signature.`,
    `I intend each automatic application to be my electronic signature, adopted by me in advance, binding ${c} as if I had signed that document myself, with ${LEGAL_EFFECT}.`,
    "Each automatic application is recorded and labeled as applied under this prior authorization, not as a signature I personally made at that moment. Revoking stops future applications only; documents already signed stay signed.",
  ].join(" ");
}

/** Statement affirmed for an interactive countersignature. */
export function countersignText(p: { signerName: string; companyName: string; proposalNumber: string; projectTitle: string; total: string; versionNumber: number; customerSigned: boolean }): string {
  const what = [p.projectTitle && `"${p.projectTitle}"`, p.proposalNumber && `proposal #${p.proposalNumber}`, `version ${p.versionNumber}`].filter(Boolean).join(", ");
  const co = p.companyName || "the contractor";
  return [
    `I, ${p.signerName}, am authorized to sign for and bind ${co}. I have reviewed ${what} for a total of ${p.total}${p.customerSigned ? ", as accepted by the customer," : ""} and I sign it on behalf of ${co}.`,
    `I intend to sign this document electronically, and my signature has ${LEGAL_EFFECT}.`,
    "I agree that the electronic record of this document, with its signature certificate and audit trail, may be used as the signed original.",
  ].join(" ");
}

/** Label beside "sign before sending" in the builder; the full countersignature statement is stored when it is applied. */
export function signBeforeSendText(p: { signerName: string; companyName?: string | null }): string {
  const co = p.companyName?.trim() || "the company";
  return `I am authorized to sign for and bind ${co}. I have reviewed this proposal exactly as the customer will see it, and I intend to sign it electronically on ${co}'s behalf, with the same legal effect as a handwritten signature.`;
}

/** Shown under the Countersign / Sign buttons so the act of signing is unmistakable. */
export const CONTRACTOR_SIGN_INTENT_NOTICE = "Selecting the sign button applies your adopted signature to this exact version and records the time, your IP address and browser in the signature certificate.";

/** Human wording for why a contractor signature can't be applied yet. */
export const MISSING_LABELS: Record<string, string> = {
  no_signature_on_file: "The designated signer hasn't set up a signature yet.",
  signer_not_authorized: "The designated signer isn't authorized to sign for the company.",
  signer_scope_own_bids: "That signer may only sign their own bids.",
};
