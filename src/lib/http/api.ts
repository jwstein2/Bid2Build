import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { reportHandledError } from "@/lib/monitoring/report-server";

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
  // Fast path: this instance's own counter stops bursts without a database round trip.
  if (!memoryHit(k, limit, windowMs)) return false;
  // Shared counter across all serverless instances (supabase/migrations/20261120001000_durable_rate_limits.sql).
  // Until that SQL runs, or if the database is unreachable, the in-memory result above stands.
  return durableHit(k, limit, windowMs);
}

function memoryHit(k: string, limit: number, windowMs: number): boolean {
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

let durableOff = false; // set once the function is known to be missing, so we stop asking

async function durableHit(k: string, limit: number, windowMs: number): Promise<boolean> {
  if (durableOff || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) return true;
  try {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const hash = createHash("sha256").update(k).digest("hex");
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key_hash: hash, p_limit: limit, p_window_seconds: Math.max(1, Math.min(86_400, Math.ceil(windowMs / 1000))) });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") durableOff = true; // function not installed yet
      return true;
    }
    return data !== false;
  } catch {
    return true;
  }
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
  // Handled errors never reach Next.js's onRequestError, so forward them to Sentry too (checkout, webhook,
  // email, cron, customer linking...). Off without a DSN.
  reportHandledError(scope, e?.message, e?.code, meta);
}
