import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time check of a shared secret (empty secret = always refuse). */
export function secretMatches(got: string | null | undefined, secret: string | undefined): boolean {
  const s = secret ?? "";
  const a = Buffer.from(got ?? ""), b = Buffer.from(s);
  return Boolean(s) && a.length === b.length && timingSafeEqual(a, b);
}
