/**
 * Pure text helpers for the comment-to-trial funnel (no I/O; shared by the webhook, ManyChat route,
 * claim page and tests).
 */

/** A qualifying comment is just the word BID (any case), optionally with punctuation or emoji around it. */
export function isBidComment(text: string | null | undefined): boolean {
  if (!text) return false;
  const letters = text.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  return letters === "bid";
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/;

/** The first email address in a message, normalized, or null. */
export function extractEmail(text: string | null | undefined): string | null {
  if (!text || text.length > 2000) return null;
  const m = text.match(EMAIL_RE);
  if (!m) return null;
  const e = m[0].toLowerCase().replace(/\.+$/, "");
  return e.length <= 320 ? e : null;
}

export function isValidEmail(text: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) && text.length <= 320;
}

/** Messenger opt-out words. */
export function isOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  return /^\s*(stop|unsubscribe|cancel|quit|end|stop all|no more)\s*[.!]*\s*$/i.test(text);
}

/** "Yes, send it" typed instead of tapping the quick reply. */
export function isSendIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  return /^\s*(send( my)? invite|invite|send it|yes|yes please|sure|ok|okay|bid)\s*[.!]*\s*$/i.test(text);
}

/** j***@example.com: lets someone recognise the address without echoing it in full. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "your inbox";
  return `${email[0]}***${email.slice(at)}`;
}

/** "Monday, November 23, 2026 at 6:52 PM CST" (dateStyle can't be combined with timeZoneName). */
export const EXPIRY_FORMAT = { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const;

export function formatExpiry(iso: string, timeZone = "America/Chicago"): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
}
