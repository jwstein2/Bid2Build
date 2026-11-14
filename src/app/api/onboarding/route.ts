import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { isOnboardingStatus } from "@/lib/onboarding/state";

/**
 * The signed-in account's welcome-popup status (profiles.onboarding_status).
 * known=false when it can't be read (e.g. the column's migration isn't applied yet): the client
 * then never opens the popup automatically for this account.
 */
export async function GET() {
  if (!isSupabaseConfigured()) return json({ signedIn: false });
  const user = await getUser();
  if (!user) return json({ signedIn: false });
  const { data, error } = await (await createClient()).from("profiles").select("onboarding_status").eq("id", user.id).maybeSingle();
  if (error || !data) {
    if (error) logError("onboarding.read", error);
    return json({ signedIn: true, status: null, known: false });
  }
  const status = (data as { onboarding_status?: unknown }).onboarding_status;
  return json({ signedIn: true, status: isOnboardingStatus(status) ? status : null, known: true });
}

/** Records Not Right Now / close / Skip ("dismissed") or finishing the tour ("completed"). First answer wins. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isSupabaseConfigured()) return fail(503, "not_configured", "Accounts aren't configured.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const p = z.object({ status: z.enum(["dismissed", "completed"]) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const { error } = await (await createClient())
    .from("profiles")
    .update({ onboarding_status: p.data.status, onboarding_updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("onboarding_status", null);
  if (error) {
    logError("onboarding.write", error);
    return fail(500, "write_failed", "Couldn't save onboarding status.");
  }
  return json({ ok: true });
}
