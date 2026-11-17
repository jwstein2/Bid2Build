import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed one-purpose values (not login tokens):
 *   unsubscribe link  m=<message id>&s=<HMAC>   can only opt that address out of that account's emails
 *   reply address     reply+<random token>@<COMM_REPLY_DOMAIN>, stored on the message
 */
type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function secret(env: Env = process.env): Buffer {
  const own = env.COMM_UNSUBSCRIBE_SECRET;
  if (own && own.length >= 32) return Buffer.from(own);
  const service = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!service) throw new Error("unsubscribe secret unavailable");
  return createHmac("sha256", service).update("built2bid/comm-unsubscribe/v1").digest();
}
export function unsubSig(messageId: string, env?: Env): string {
  if (!UUID.test(messageId)) throw new Error("bad id");
  return createHmac("sha256", secret(env)).update(`comm-unsub:${messageId}`).digest("base64url").slice(0, 32);
}
export function checkUnsubSig(messageId: unknown, sig: unknown, env?: Env): boolean {
  if (typeof messageId !== "string" || typeof sig !== "string" || !UUID.test(messageId)) return false;
  let want: string;
  try { want = unsubSig(messageId, env); } catch { return false; }
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function unsubUrls(appUrl: string, messageId: string, env?: Env) {
  const q = `m=${messageId}&s=${unsubSig(messageId, env)}`;
  const base = appUrl.replace(/\/+$/, "");
  return { page: `${base}/email/preferences?${q}`, oneClick: `${base}/api/comms/unsubscribe?${q}` };
}
export const newReplyToken = () => randomBytes(12).toString("hex");
export const replyAddress = (token: string, domain: string) => `reply+${token}@${domain}`;
/** Reply token from any recipient address like reply+<token>@domain. */
export function tokenFromAddresses(addrs: string[], domain: string | null): string | null {
  for (const a of addrs) {
    const m = a.toLowerCase().match(/reply\+([0-9a-f]{24})@([a-z0-9.-]+)/);
    if (m && (!domain || m[2] === domain)) return m[1];
  }
  return null;
}
