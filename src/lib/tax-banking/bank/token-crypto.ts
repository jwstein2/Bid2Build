/**
 * Provider access tokens are encrypted before they reach the database (AES-256-GCM, key from BANK_TOKEN_KEY,
 * 32 bytes base64). The ciphertext lives in fin_bank_connection_secrets, which only the service role can read.
 * Tokens are never sent to the browser, logged, or written to the audit log.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(raw = process.env.BANK_TOKEN_KEY): Buffer {
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new Error("bank_token_key_missing");
  return k;
}

export function sealToken(token: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

export function openToken(sealed: string, rawKey?: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("bad_token_format");
  const d = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** Mock tokens (sandbox / tests) are stored with a fixed dev key so practice books work without BANK_TOKEN_KEY. */
export const MOCK_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
