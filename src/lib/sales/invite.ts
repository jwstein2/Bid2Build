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
