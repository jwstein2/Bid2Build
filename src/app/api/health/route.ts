import { NextResponse } from "next/server";
import { publicEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Public health check for uptime monitors. Returns 200 when the app is serving and Supabase
 * (auth + database gateway) answers, 503 otherwise. It never exposes keys, versions or user data.
 */
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5000;
const CACHE_MS = 30_000;
let cached: { at: number; ok: boolean } | null = null;

async function supabaseReachable(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ok;
  let ok = false;
  try {
    const res = await fetch(`${publicEnv.supabaseUrl.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: publicEnv.supabaseKey },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  cached = { at: Date.now(), ok };
  return ok;
}

export async function GET() {
  const ok = await supabaseReachable();
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks: { app: "ok", supabase: ok ? "ok" : "down" }, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

export const HEAD = async () => {
  const ok = await supabaseReachable();
  return new NextResponse(null, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
};
