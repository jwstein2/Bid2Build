/**
 * E-signatures are off until the owner sets NEXT_PUBLIC_ESIGNATURES=on (after the migration
 * 20261115001000_e_signatures.sql has run and the legal review in docs/esign/LEGAL_REVIEW.md is done).
 * Inlined at build time, so the server routes and the builder buttons switch together.
 */
export const isEsignEnabled = (env: Record<string, string | undefined> = { NEXT_PUBLIC_ESIGNATURES: process.env.NEXT_PUBLIC_ESIGNATURES }) =>
  ["on", "true", "1"].includes((env.NEXT_PUBLIC_ESIGNATURES ?? "").trim().toLowerCase());

/** Default and maximum life of a signing link. */
export const LINK_DAYS_DEFAULT = 30;
export const LINK_DAYS_MAX = 90;
/** "Recently signed" window on the dashboard. */
export const RECENT_SIGNED_DAYS = 30;

/** Bumped whenever the consent wording changes; stored with every signature (older signatures keep theirs). */
export const CONSENT_VERSION = "esign-consent-2026-11-21";

/**
 * ESIGN Act (15 U.S.C. 7001(c)) consumer disclosure and UETA agreement to transact electronically, shown
 * before the customer agrees. Built from the elements a mature e-signature provider's disclosure covers
 * (DocuSign's public "Electronic Record and Signature Disclosure" was the benchmark; no text was copied):
 * scope of the consent, agreement to do business electronically, same effect as a handwritten signature,
 * the right to paper copies and that they are free, how to withdraw and what withdrawing does (and doesn't)
 * do, keeping contact details current, hardware/software needed, and the signer's confirmation that they can
 * open and keep the record on this device (the "reasonably demonstrates" step in 7001(c)(1)(C)(ii)).
 * v2026-11-21 adds: agreement to do business electronically, copies and notices delivered electronically,
 * how to ask for paper (the contractor's contact details on the proposal), and the email account
 * requirement. Change orders reuse it (src/lib/operations/change-orders.ts swaps "proposal" wording).
 * Draft wording for attorney review (docs/esign/LEGAL_REVIEW.md).
 */
export function consentText(companyName: string): string {
  const c = companyName.trim() || "the contractor";
  return [
    `By checking this box, I agree to do business electronically with ${c} for this proposal. I agree to receive, review and sign this proposal electronically, and to receive my signed copy and any notices and records about signing it electronically.`,
    "I agree that my electronic signature, whether typed or drawn, is my legal signature and has the same legal effect as a handwritten signature under the federal ESIGN Act and my state's electronic transactions law.",
    `I may ask ${c} at any time for a paper copy at no charge of this proposal or of the signed record, using the contact details on the proposal. I do not have to sign electronically: I may withdraw this consent before I sign by not signing and telling ${c}, who can then give me this proposal on paper. Withdrawing consent does not change the legal effect of anything I already signed electronically. If my email address changes, I will tell ${c}.`,
    "To view and keep these records I need a phone, tablet or computer with a current web browser that can open PDF files, and an email account to receive a copy by email. I confirm that I can open the proposal PDF on this device, and I understand I can download, print or save a copy of the signed proposal from this page.",
  ].join(" ");
}

/** What the signer accepts, plus an express statement of intent to sign (ESIGN/UETA "intent to sign"). */
export function acceptanceText(p: { companyName: string; proposalNumber: string; projectTitle: string; total: string }): string {
  const parts = [p.projectTitle && `"${p.projectTitle}"`, p.proposalNumber && `proposal #${p.proposalNumber}`].filter(Boolean).join(", ");
  return `I have reviewed the entire proposal${parts ? ` (${parts})` : ""} from ${p.companyName.trim() || "the contractor"}, including its scope, pricing, exclusions, payment schedule and terms, and I accept it for a total of ${p.total}. By selecting Accept & Sign Proposal, I intend to sign this proposal electronically and to be legally bound by it.`;
}

/** Shown right above the final button so the act of signing is unmistakable. */
export const SIGN_INTENT_NOTICE = "Selecting Accept & Sign Proposal is your electronic signature. It applies the signature above to this exact version of the proposal and records the time, your device's IP address and browser.";

/** When a new link expires: the default life, cut short by the proposal's own expiration date. */
export function linkExpiry(now: Date, proposalExpires?: string | null, days = LINK_DAYS_DEFAULT): Date | "proposal_expired" {
  const d = Math.min(Math.max(1, Math.floor(days)), LINK_DAYS_MAX);
  let end = new Date(now.getTime() + d * 86_400_000);
  if (proposalExpires && /^\d{4}-\d{2}-\d{2}$/.test(proposalExpires)) {
    // End of that calendar day, US Pacific (the latest US mainland zone), so it never ends early.
    const eod = new Date(`${proposalExpires}T23:59:59-08:00`);
    if (eod.getTime() <= now.getTime() + 3_600_000) return "proposal_expired";
    if (eod < end) end = eod;
  }
  return end;
}
