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
export const CONSENT_VERSION = "esign-consent-2026-11-19";

/**
 * ESIGN Act (15 U.S.C. 7001(c)) style consumer disclosure, shown before the customer agrees.
 * v2026-11-19 adds: what the consent covers, no fee for paper, how to update an email address, the
 * consequence of withdrawing, and an affirmation that the signer can open and keep the PDF on this
 * device (the "reasonably demonstrates" step). Draft wording for attorney review (docs/esign/LEGAL_REVIEW.md).
 */
export function consentText(companyName: string): string {
  const c = companyName.trim() || "the contractor";
  return [
    `By checking this box, I agree to receive, review and sign this proposal from ${c} electronically, and I agree that my electronic signature has the same legal effect as a handwritten signature. This consent covers this proposal and the records about signing it.`,
    `I may ask ${c} for a paper copy at no charge. I may withdraw this consent before I sign by not signing and telling ${c}; ${c} can then give me the proposal on paper. Withdrawing consent does not affect anything I already signed. If my email address changes, I will tell ${c}.`,
    "To view and keep this record I need a device with a current web browser that can open PDF files. I confirm that I can open the proposal PDF on this device, and I understand I can download and save a copy of the signed proposal from this page.",
  ].join(" ");
}

export function acceptanceText(p: { companyName: string; proposalNumber: string; projectTitle: string; total: string }): string {
  const parts = [p.projectTitle && `"${p.projectTitle}"`, p.proposalNumber && `proposal #${p.proposalNumber}`].filter(Boolean).join(", ");
  return `I have reviewed the entire proposal${parts ? ` (${parts})` : ""} from ${p.companyName.trim() || "the contractor"}, including its scope, pricing, exclusions, payment schedule and terms, and I accept it for a total of ${p.total}.`;
}

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
