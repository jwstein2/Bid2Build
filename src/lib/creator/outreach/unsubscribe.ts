import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed, non-expiring opt-out tokens: base64url(email).hmac. No database lookup needed to verify. */
export function unsubscribeToken(email: string, secret: string): string {
  const e = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  return `${e}.${createHmac("sha256", secret).update(`creator-unsub:${e}`).digest("base64url")}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret || typeof token !== "string" || token.length > 800) return null;
  const [e, sig] = token.split(".");
  if (!e || !sig) return null;
  const want = createHmac("sha256", secret).update(`creator-unsub:${e}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const email = Buffer.from(e, "base64url").toString("utf8");
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}
