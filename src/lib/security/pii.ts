import "server-only";
/**
 * Full tax ids (subcontractor TIN, employee SSN) are encrypted on the server before they reach the database
 * (AES-256-GCM). Key: PII_ENCRYPTION_KEY, 32 bytes base64 (`openssl rand -base64 32`), set as a secret in Netlify.
 * The key must never change once ids are stored (they couldn't be read back). Plain values are never logged,
 * audited or sent to analytics; the app shows the last 4 and reveals the full value only after
 * public.pm_sensitive_log records who asked.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(raw = process.env.PII_ENCRYPTION_KEY): Buffer {
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new Error("pii_key_missing");
  return k;
}

/** True when the encryption key is configured (otherwise full ids can't be stored yet). */
export function piiReady(raw = process.env.PII_ENCRYPTION_KEY): boolean {
  try { key(raw); return true; } catch { return false; }
}

export function sealPii(value: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

export function openPii(sealed: string, rawKey?: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("bad_pii_format");
  const d = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** 9 digits for an SSN / EIN / ITIN, or null. Dashes and spaces are ignored. */
export function normalizeTaxId(v: unknown): string | null {
  const d = String(v ?? "").replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(d)) return null;
  // Never-issued patterns: area 000/666/9xx for SSNs is allowed for ITINs (9xx), so only reject all-zero groups.
  if (/^0{9}$/.test(d)) return null;
  return d;
}

export const formatTaxId = (digits: string, type: "ssn" | "ein") =>
  type === "ein" ? `${digits.slice(0, 2)}-${digits.slice(2)}` : `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
