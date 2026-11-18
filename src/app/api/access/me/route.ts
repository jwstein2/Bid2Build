import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { loadEffectiveAccess } from "@/lib/access/server";

export const runtime = "nodejs";

/** The signed-in person's effective workspace access (V6.7). Their own access only; never cached. */
export async function GET() {
  if (!(await getUser())) return fail(401, "not_authenticated", "Sign in required.");
  try {
    return json({ access: await loadEffectiveAccess(await createClient()) });
  } catch (e) {
    logError("access.me", e);
    return fail(500, "server_error", "We couldn't load your access.");
  }
}
