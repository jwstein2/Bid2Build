/**
 * "Send via My Email": the message a contractor sends from their own email app. Built2Bid never
 * sends this email, never stores it, and never asks for mailbox access. Only fields the contractor
 * already entered are used; anything missing is left out rather than invented.
 */
export interface ShareEmailInput {
  customerName?: string | null;
  customerEmail?: string | null;
  projectTitle?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
}

export interface ShareEmail {
  /** Empty when the estimate has no valid customer email. */
  to: string;
  subject: string;
  body: string;
}

// Control characters (incl. CR/LF) would let a value break out of a header-like field.
const CONTROL = /[\u0000-\u001f\u007f]/g;
const oneLine = (s?: string | null) => (s ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
// Keeps line breaks the contractor typed but drops other control characters.
const multiLine = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();

const EMAIL = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/;
export function validEmail(s?: string | null): string {
  const v = oneLine(s);
  return v.length <= 320 && EMAIL.test(v) ? v : "";
}

/** First word of the customer's name, unless it is a company-style name or empty. */
export function firstName(name?: string | null): string {
  const n = oneLine(name);
  if (!n) return "";
  const first = n.split(" ")[0].replace(/[,;]+$/, "");
  return first.length >= 2 ? first : n;
}

export function buildShareEmail(i: ShareEmailInput): ShareEmail {
  const company = oneLine(i.companyName);
  const project = oneLine(i.projectTitle);
  const contact = oneLine(i.contactName);
  const phone = oneLine(i.phone);
  const greetName = firstName(i.customerName);

  const subject = company && project ? `Your Estimate from ${company} — ${project}`
    : company ? `Your Estimate from ${company}`
    : project ? `Your Estimate — ${project}`
    : "Your Estimate";

  const signature = [contact, company && company !== contact ? company : "", phone].filter(Boolean);
  const body = [
    greetName ? `Hi ${greetName},` : "Hi,",
    "",
    project
      ? `Thank you for the opportunity to provide an estimate for ${project}.`
      : "Thank you for the opportunity to provide an estimate for your project.",
    "",
    "I've attached our proposal for your review. Please let me know if you have any questions or would like to discuss anything further.",
    "",
    "Thank you,",
    ...signature,
  ].join("\n");

  return { to: validEmail(i.customerEmail), subject, body };
}

/**
 * A mailto: link with every part percent-encoded (RFC 6068). Line breaks become CRLF. A mailto link
 * can't carry an attachment, so the PDF is attached by the contractor (or shared via the share sheet).
 */
export function mailtoHref(e: { to?: string; subject: string; body: string }): string {
  const to = validEmail(e.to);
  const enc = (s: string) => encodeURIComponent(s).replace(/%0A/g, "%0D%0A");
  const parts = [`subject=${enc(oneLine(e.subject))}`, `body=${enc(multiLine(e.body).replace(/\r/g, ""))}`];
  return `mailto:${to ? encodeURIComponent(to).replace(/%40/g, "@") : ""}?${parts.join("&")}`;
}

/** Whether this browser can share this file through the system share sheet (feature detection only). */
export function canShareFile(file: File, nav: Partial<Pick<Navigator, "share" | "canShare">> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  try {
    return Boolean(nav && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] }));
  } catch {
    return false;
  }
}
