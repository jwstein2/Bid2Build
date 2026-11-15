/**
 * Customer-facing text cleanup. Editor guidance such as "[Placeholder terms: have these reviewed by
 * your attorney.]" must never reach a customer. Older drafts (and saved proposal defaults) still
 * carry that sentence from the original default terms, so it is removed when the customer document is
 * built (buildProposal), which feeds both the live preview and the PDF. Contractor text is otherwise
 * kept exactly as written: only bracketed notes that read as instructions are dropped.
 */

/** Bracketed notes that are instructions to the contractor, not terms for the customer. */
const INSTRUCTION =
  /\[(?=[^\]]{0,300}\b(?:placeholder|attorney|lawyer|counsel|legal review|reviewed by|insert|replace (?:this|with)|fill in|edit (?:this|these)|todo|sample (?:terms|text)|example (?:terms|text))\b)[^\][]{0,300}\]/gi;

/** The exact default sentence shipped before November 2026 (kept for clarity in tests and docs). */
export const LEGACY_TERMS_PLACEHOLDER = "[Placeholder terms: have these reviewed by your attorney.]";

export function stripInstructionalText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(INSTRUCTION, "")
    // tidy the gap the note leaves behind, without touching the contractor's own line breaks
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Customer-safe text, or undefined when nothing real is left (the section is then omitted). */
export function customerText(text: string | null | undefined): string | undefined {
  const t = stripInstructionalText(text);
  return t ? t : undefined;
}

/**
 * US/Canada numbers print as "(555) 123-4567" on customer documents. Anything else (international
 * numbers, extensions, letters) prints exactly as the contractor typed it.
 */
export function displayPhone(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t || /[a-z]/i.test(t) || (t.startsWith("+") && !t.startsWith("+1"))) return t;
  const d = t.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : t;
}
