import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TrialConfig } from "./config";

/**
 * Minimal Meta Graph / Messenger Send API client for the comment-to-trial funnel.
 * Access tokens go in the Authorization header (never the URL) and every call carries an
 * appsecret_proof, so it also works with "Require App Secret" switched on.
 */

/** X-Hub-Signature-256 check over the exact raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header) return false;
  const m = header.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const got = Buffer.from(m[1], "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type Fetch = typeof fetch;

export interface GraphError { status: number; code?: number; subcode?: number; message: string }
export type GraphResult<T> = { ok: true; data: T } | { ok: false; error: GraphError; retry: boolean };

/** Rate-limit and transient codes worth retrying later. */
const RETRY_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80006]);

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

export async function graph<T>(cfg: TrialConfig, method: "GET" | "POST", path: string, opts: { body?: unknown; params?: Record<string, string>; token?: string; fetchImpl?: Fetch } = {}): Promise<GraphResult<T>> {
  const token = opts.token ?? cfg.pageToken;
  const url = new URL(`https://graph.facebook.com/${cfg.graphVersion}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  if (cfg.appSecret && token) url.searchParams.set("appsecret_proof", appSecretProof(token, cfg.appSecret));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const r = await (opts.fetchImpl ?? fetch)(url, {
      method,
      signal: ctl.signal,
      headers: { authorization: `Bearer ${token}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const body = (await r.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number; message?: string } } & T;
    if (r.ok && !body.error) return { ok: true, data: body };
    const e = body.error ?? {};
    const error = { status: r.status, code: e.code, subcode: e.error_subcode, message: String(e.message ?? `HTTP ${r.status}`).slice(0, 200) };
    return { ok: false, error, retry: r.status >= 500 || r.status === 429 || RETRY_CODES.has(e.code ?? -1) };
  } catch (err) {
    return { ok: false, error: { status: 0, message: String((err as Error).message ?? err).slice(0, 200) }, retry: true };
  } finally {
    clearTimeout(t);
  }
}

export interface QuickReply { content_type: "text" | "user_email"; title?: string; payload?: string }
export interface OutMessage { text: string; quick_replies?: QuickReply[] }

/** One private reply to a comment (Meta allows one per comment, within 7 days of it). */
export function sendPrivateReply(cfg: TrialConfig, commentId: string, message: OutMessage, fetchImpl?: Fetch) {
  return graph<{ recipient_id?: string; message_id?: string }>(cfg, "POST", `${cfg.pageId}/messages`, {
    body: { recipient: { comment_id: commentId }, message },
    fetchImpl,
  });
}

/** A standard reply inside the 24-hour window that the person's own message opened. */
export function sendMessage(cfg: TrialConfig, psid: string, message: OutMessage, fetchImpl?: Fetch) {
  return graph<{ recipient_id?: string; message_id?: string }>(cfg, "POST", `${cfg.pageId}/messages`, {
    body: { recipient: { id: psid }, messaging_type: "RESPONSE", message },
    fetchImpl,
  });
}

export function describeGraphError(e: GraphError): string {
  return `graph ${e.status}${e.code != null ? ` code ${e.code}` : ""}${e.subcode != null ? `/${e.subcode}` : ""}: ${e.message}`.slice(0, 300);
}
