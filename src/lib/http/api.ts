import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message, ...extra } }, status);

/**
 * Simple fixed-window rate limiter (per server instance). Good enough to blunt abuse of costly
 * endpoints; for multi-instance production add a shared store (see docs/SECURITY.md).
 */
const buckets = new Map<string, { count: number; reset: number }>();
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const h = await headers();
  const ip = h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const k = `${key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || b.reset < now) {
    buckets.set(k, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) for (const [kk, v] of buckets) if (v.reset < now) buckets.delete(kk);
    return true;
  }
  b.count++;
  return b.count <= limit;
}

/** Reject cross-site state-changing requests (defense in depth on top of SameSite cookies). */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return true; // non-browser or same-origin navigation
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

/** Log errors without user content or secrets. */
export function logError(scope: string, err: unknown, meta: Record<string, string | number | boolean | undefined> = {}) {
  const e = err as { message?: string; code?: string };
  console.error(JSON.stringify({ level: "error", scope, message: e?.message?.slice(0, 300), code: e?.code, ...meta }));
}
