import { createHash, randomBytes } from "node:crypto";

/** Rep invite tokens: 32 random bytes, URL-safe. Only the SHA-256 hash is stored in the database. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const isInviteToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

export { safeSalesNext } from "./next";

/** Cookie that carries a just-created invite link ("<rep id>.<token>") to the Sales Hub page for two minutes. */
export const INVITE_FLASH = "b2b_sales_invite";

/** Reads that cookie's value; null unless it is a rep id and a well-formed token. */
export function parseInviteFlash(v: string | undefined): { rep: string; token: string } | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(v ?? "");
  return m ? { rep: m[1], token: m[2] } : null;
}
