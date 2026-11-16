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
  /**
   * When set, this is a signing request: its own subject and message, with the online signing link
   * and no mention of an attachment.
   */
  signingUrl?: string | null;
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
  const signingUrl = /^https?:\/\/\S+$/.test(oneLine(i.signingUrl)) ? oneLine(i.signingUrl) : "";

  const signature = [contact, company && company !== contact ? company : "", phone].filter(Boolean);
  const greeting = greetName ? `Hi ${greetName},` : "Hi,";

  if (signingUrl) {
    return {
      to: validEmail(i.customerEmail),
      subject: project ? `Please Review & Sign Your Proposal — ${project}` : "Please Review & Sign Your Proposal",
      body: [
        greeting,
        "",
        "Thank you for the opportunity to provide an estimate for your project.",
        "",
        "Please review your proposal and electronically sign it using the secure link below:",
        "",
        signingUrl,
        "",
        "If you have any questions or would like to discuss anything before signing, please let me know.",
        "",
        "Thank you,",
        ...signature,
      ].join("\n"),
    };
  }

  const subject = company && project ? `Your Estimate from ${company} — ${project}`
    : company ? `Your Estimate from ${company}`
    : project ? `Your Estimate — ${project}`
    : "Your Estimate";

  const body = [
    greeting,
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

/**
 * Web compose links for Gmail and Outlook. They open a new message in the contractor's own,
 * already signed-in mailbox with the recipient, subject and message filled in. Like mailto:, they
 * can't carry an attachment: Built2Bid downloads the PDF first and the contractor drags it in.
 * (Attaching automatically would need the contractor to connect their mailbox through OAuth.)
 */
export type WebMail = "gmail" | "outlook" | "outlook-personal";

const WEBMAIL_BASE: Record<WebMail, string> = {
  gmail: "https://mail.google.com/mail/",
  // Work or school accounts (Microsoft 365) and most personal accounts, which are redirected.
  outlook: "https://outlook.office.com/mail/deeplink/compose",
  // Outlook.com / Hotmail / Live accounts, when the work URL doesn't keep the draft.
  "outlook-personal": "https://outlook.live.com/mail/0/deeplink/compose",
};

/** Keep compose URLs well under the ~8 KB most servers accept; long messages are cut, not dropped. */
const MAX_BODY = 3000;

/** Whether the whole message fits a web draft link (longer ones are cut, so offer Copy message). */
export function webComposeFits(body: string): boolean {
  return multiLine(body).length <= MAX_BODY;
}

export function webComposeHref(app: WebMail, e: { to?: string; subject: string; body: string }): string {
  const to = validEmail(e.to);
  const subject = oneLine(e.subject);
  let body = multiLine(e.body);
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY).trimEnd()}…`;
  const q = new URLSearchParams();
  if (app === "gmail") {
    q.set("view", "cm"); q.set("fs", "1");
    if (to) q.set("to", to);
    q.set("su", subject); q.set("body", body);
  } else {
    if (to) q.set("to", to);
    q.set("subject", subject); q.set("body", body);
  }
  // URLSearchParams writes spaces as "+", which Outlook shows literally: use %20 instead.
  return `${WEBMAIL_BASE[app]}?${q.toString().replace(/\+/g, "%20")}`;
}

/** Plain-text copy of the whole email, for pasting into any email app. */
export function plainEmail(e: { to?: string; subject: string; body: string }): string {
  const to = validEmail(e.to);
  return [to ? `To: ${to}` : "", `Subject: ${oneLine(e.subject)}`, "", multiLine(e.body)].filter((l, i) => i > 0 || l).join("\n");
}
