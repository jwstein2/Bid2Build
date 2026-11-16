import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Invite link tokens. Nothing about the token is stored: it is the invite id plus an HMAC of
 * (id, token_version) under a server secret. The server can re-create it to retry an email, and the
 * database bumps token_version to kill old links. Tokens travel in the URL fragment (#), which
 * browsers never send to the server, analytics or logs.
 */
function secret(env: Record<string, string | undefined> = process.env): Buffer {
  const own = env.TRIAL_INVITE_SECRET;
  if (own && own.length >= 32) return Buffer.from(own);
  const service = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!service) throw new Error("trial invite secret unavailable");
  // Domain-separated so the service key itself is never used directly as a MAC key elsewhere.
  return createHmac("sha256", service).update("built2bid/trial-invite/v1").digest();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mac(id: string, version: number, env?: Record<string, string | undefined>): string {
  return createHmac("sha256", secret(env)).update(`invite:${id}:${version}`).digest("base64url");
}

export function makeInviteToken(id: string, version: number, env?: Record<string, string | undefined>): string {
  if (!UUID_RE.test(id) || !Number.isInteger(version) || version < 1) throw new Error("bad invite");
  return `${Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url")}.${version}.${mac(id, version, env)}`;
}

/** Returns the invite id and version if the token is genuine, else null. Never throws on bad input. */
export function readInviteToken(token: unknown, env?: Record<string, string | undefined>): { id: string; version: number } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const m = token.match(/^([A-Za-z0-9_-]{22})\.(\d{1,4})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const hex = Buffer.from(m[1], "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const version = Number(m[2]);
  if (version < 1) return null;
  let expected: string;
  try { expected = mac(id, version, env); } catch { return null; }
  const a = Buffer.from(m[3]), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { id, version } : null;
}

/** Signed one-purpose value for the check-in unsubscribe link (not a login token). */
export function unsubscribeSig(inviteId: string, env?: Record<string, string | undefined>): string {
  return createHmac("sha256", secret(env)).update(`unsub:${inviteId}`).digest("base64url").slice(0, 32);
}

export function checkUnsubscribeSig(inviteId: string, sig: unknown, env?: Record<string, string | undefined>): boolean {
  if (typeof sig !== "string" || !UUID_RE.test(inviteId)) return false;
  let expected: string;
  try { expected = unsubscribeSig(inviteId, env); } catch { return false; }
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
