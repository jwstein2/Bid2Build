import "server-only";

/**
 * Server-only client for the Growth OS database (a separate Supabase project: staging today). It calls growth_api
 * functions through PostgREST with that project's service-role key, which never reaches the browser. Every call is
 * made after requireAdmin(), and the database audits it again (actor service_role, on_behalf = the admin user).
 *
 * Env (server only): GROWTH_SUPABASE_URL, GROWTH_SUPABASE_SERVICE_ROLE_KEY. The project must expose the growth_api
 * schema in its API settings. When either is missing the page falls back to registry baselines (never live).
 */
const env = (k: string) => (process.env[k] ?? "").trim();

export function growthConfigured(): boolean {
  return Boolean(env("GROWTH_SUPABASE_URL") && env("GROWTH_SUPABASE_SERVICE_ROLE_KEY"));
}

export function growthFunctionsBase(): string {
  return env("GROWTH_SUPABASE_URL").replace(/\/+$/, "") + "/functions/v1";
}

export async function growthRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!growthConfigured()) throw new Error("Growth OS database is not configured in this environment");
  if (!/^[a-z_]{3,60}$/.test(fn)) throw new Error("bad function name");
  const key = env("GROWTH_SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${env("GROWTH_SUPABASE_URL").replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Content-Profile": "growth_api", "Accept-Profile": "growth_api" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Growth OS returned HTTP ${res.status}`;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* keep generic */ }
    throw new Error(msg.slice(0, 300));
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function loadOverview(): Promise<{ overview: unknown | null; error: string | null; fetchedAt: number }> {
  const fetchedAt = Date.now();
  if (!growthConfigured()) return { overview: null, error: null, fetchedAt };
  try { return { overview: await growthRpc("connections_overview"), error: null, fetchedAt }; }
  catch (e) { return { overview: null, error: (e as Error).message, fetchedAt }; }
}
