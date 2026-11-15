import { createHash, randomBytes } from "node:crypto";

/** 256-bit random signing token, URL-safe. Only its SHA-256 is stored. */
export const newSigningToken = () => randomBytes(32).toString("base64url");
export const hashSigningToken = (t: string) => createHash("sha256").update(t).digest("hex");
/** Shape check before any database lookup (43 base64url chars). */
export const isSigningToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
