import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed one-purpose values for sales emails (not login tokens), keyed from a server secret:
 *   unsubscribe   base64url(email).sig   can only opt that address out of sales email
 *   booking ref   <campaign id>.sig      links a walkthrough booking to the campaign that offered it
 */
type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function secret(env: Env = process.env): Buffer {
  const own = env.SALES_NURTURE_SECRET;
  if (own && own.length >= 32) return Buffer.from(own);
  const service = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!service) throw new Error("sales nurture secret unavailable");
  return createHmac("sha256", service).update("built2bid/sales-nurture/v1").digest();
}
const sig = (purpose: string, value: string, env?: Env) => createHmac("sha256", secret(env)).update(`${purpose}:${value}`).digest("base64url").slice(0, 32);
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function unsubscribeToken(email: string, env?: Env): string {
  const e = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  return `${e}.${sig("sales-unsub", e, env)}`;
}

export function verifyUnsubscribeToken(token: unknown, env?: Env): string | null {
  if (typeof token !== "string" || token.length > 800) return null;
  const [e, s] = token.split(".");
  if (!e || !s) return null;
  try { if (!same(s, sig("sales-unsub", e, env))) return null; } catch { return null; }
  const email = Buffer.from(e, "base64url").toString("utf8");
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

export function bookingRef(campaignId: string, env?: Env): string {
  if (!UUID.test(campaignId)) throw new Error("bad id");
  return `${campaignId}.${sig("sales-book", campaignId, env).slice(0, 16)}`;
}

export function verifyBookingRef(ref: unknown, env?: Env): string | null {
  if (typeof ref !== "string" || ref.length > 80) return null;
  const [id, s] = ref.split(".");
  if (!id || !s || !UUID.test(id)) return null;
  try { return same(s, sig("sales-book", id, env).slice(0, 16)) ? id : null; } catch { return null; }
}
