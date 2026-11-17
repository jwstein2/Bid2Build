import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed one-purpose value for the lifecycle email unsubscribe link (not a login token): an HMAC of
 * the account id under a server secret. Nothing is stored. It can only ever stop lifecycle emails.
 */
type Env = Record<string, string | undefined>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function secret(env: Env = process.env): Buffer {
  const own = env.LIFECYCLE_UNSUBSCRIBE_SECRET;
  if (own && own.length >= 32) return Buffer.from(own);
  const service = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!service) throw new Error("unsubscribe secret unavailable");
  // Domain-separated so the service key is never used directly as a MAC key.
  return createHmac("sha256", service).update("built2bid/lifecycle-unsubscribe/v1").digest();
}

export function lifecycleUnsubSig(userId: string, env?: Env): string {
  if (!UUID_RE.test(userId)) throw new Error("bad user id");
  return createHmac("sha256", secret(env)).update(`lifecycle-unsub:${userId}`).digest("base64url").slice(0, 32);
}

export function checkLifecycleUnsubSig(userId: unknown, sig: unknown, env?: Env): boolean {
  if (typeof userId !== "string" || typeof sig !== "string" || !UUID_RE.test(userId)) return false;
  let expected: string;
  try { expected = lifecycleUnsubSig(userId, env); } catch { return false; }
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function lifecycleUnsubUrls(appUrl: string, userId: string, env?: Env): { page: string; oneClick: string } {
  const base = appUrl.replace(/\/+$/, "");
  const q = `u=${userId}&s=${lifecycleUnsubSig(userId, env)}`;
  return { page: `${base}/email/unsubscribe?${q}`, oneClick: `${base}/api/email/unsubscribe?${q}` };
}
