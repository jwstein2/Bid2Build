/**
 * Built2Bid's sending identities, grouped into "streams" so delivery can be measured (and later
 * isolated) per kind of mail. Pure: safe in tests.
 *
 *   auth          Supabase sign-in codes (custom SMTP via Resend)          login@  (or login@auth.)
 *   transactional founder welcome after purchase                            james@ (founder email)
 *   project       contractor -> customer project updates                    updates@
 *   trial         Facebook trial funnel                                     hello@
 *   other         anything else (lifecycle and creator outreach also use james@ today; see the audit)
 *
 * Only the sender address is used to classify. Recipient addresses are never stored, only their domain
 * (gmail.com, outlook.com…) so placement can be compared across providers without personal data.
 */
export type EmailStream = "auth" | "transactional" | "project" | "trial" | "other";

export function addressOf(from: string): string {
  const m = (from ?? "").match(/<([^>]+)>/);
  return (m ? m[1] : from ?? "").trim().toLowerCase();
}

export function emailStream(from: string): EmailStream {
  const a = addressOf(from);
  const [local, domain = ""] = a.split("@");
  if (!domain.endsWith("built2bid.org")) return "other";
  if (local === "login" || domain === "auth.built2bid.org") return "auth";
  if (local === "updates") return "project";
  if (local === "hello") return "trial";
  if (local === "james") return "transactional";
  return "other";
}

/** "Name <x@Gmail.com>" or ["x@gmail.com"] -> "gmail.com". Null when there's no address. */
export function recipientDomain(to: unknown): string | null {
  const first = Array.isArray(to) ? to[0] : to;
  const a = addressOf(String(first ?? ""));
  const d = a.includes("@") ? a.split("@").pop()! : "";
  return /^[a-z0-9.-]{1,253}$/.test(d) ? d : null;
}

/** Resend webhook event type -> the short kind stored for metrics. */
export const DELIVERY_KINDS: Record<string, string> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delayed",
  "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed",
  "email.suppressed": "suppressed",
};
