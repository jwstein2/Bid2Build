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

/** Bumped whenever the consent wording changes; stored with every signature. */
export const CONSENT_VERSION = "esign-consent-2026-11-15";

/**
 * ESIGN Act (15 U.S.C. 7001(c)) style consumer disclosure, shown before the customer agrees.
 * Needs attorney review before public release (docs/esign/LEGAL_REVIEW.md).
 */
export function consentText(companyName: string): string {
  const c = companyName.trim() || "the contractor";
  return [
    `By checking this box, I agree to use electronic records and an electronic signature for this proposal from ${c}, and I agree that my electronic signature has the same effect as a handwritten signature.`,
    `I understand that I may ask ${c} for a paper copy of this proposal at no charge, and that I may withdraw this consent before I sign by not signing and contacting ${c}. Withdrawing consent does not affect anything I already signed.`,
    "To view and keep this record I need a device with a current web browser that can open PDF files. After I sign, I can download a copy of the signed proposal from this page.",
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
