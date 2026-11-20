import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, short-lived state for the bank connection round trip. The provider's return page tells us nothing about who
 * started it, so the recipient id travels in an httpOnly cookie signed with a server secret and bound to the staff
 * member. A tampered or swapped cookie can't attach someone else's bank account.
 */
export const PAYOUT_STATE_COOKIE = "b2b_payout_connect";
const TTL_MS = 30 * 60 * 1000;

const key = (secret?: string) => {
  const k = secret ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!k) throw new Error("payout_state_secret_missing");
  return createHmac("sha256", k).update("b2b-payout-state-v1").digest();
};
const mac = (body: string, secret?: string) => createHmac("sha256", key(secret)).update(body).digest("base64url");

export function signPayoutState(s: { staffId: string; recipientRef: string; mode: string }, now = Date.now(), secret?: string): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: now + TTL_MS })).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function readPayoutState(v: string | undefined, staffId: string, now = Date.now(), secret?: string): { recipientRef: string; mode: string } | null {
  if (!v) return null;
  const [body, sig] = v.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { staffId?: string; recipientRef?: string; mode?: string; exp?: number };
    if (s.staffId !== staffId || typeof s.recipientRef !== "string" || !s.recipientRef || typeof s.exp !== "number" || s.exp < now) return null;
    return { recipientRef: s.recipientRef, mode: s.mode === "live" ? "live" : "test" };
  } catch { return null; }
}
