import "server-only";
import { parseDemoClaim, type DemoClaim } from "./session";

/**
 * The demo / practice claim of the signed-in session making this request, or null (real session, no
 * session, cron job, webhook, or code running outside a request). Uses the shared request-cached Auth
 * lookup, so calling it from several places in one request costs one lookup.
 *
 * Used as a last line of defence inside the low-level senders: even if a route forgot to refuse a
 * demo session (the proxy blocklist is the first line), nothing leaves the building from one.
 */
export async function demoSessionClaim(): Promise<DemoClaim | null> {
  try {
    const { getAuthUser } = await import("@/lib/supabase/server");
    return parseDemoClaim((await getAuthUser())?.app_metadata);
  } catch {
    return null; // outside a request (tests, scripts): no session, so not a demo session
  }
}

export const inDemoSession = async () => (await demoSessionClaim()) !== null;

/** Is this user id or company id a demo / practice tenant (current or retired)? Service-role client. */
export async function isDemoTenant(admin: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  const { data, error } = await admin.rpc("is_demo_account", { p_id: id });
  return !error && data === true;
}
