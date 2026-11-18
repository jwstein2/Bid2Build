import { createAdminClient, getAuthUser } from "@/lib/supabase/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { demoClaimOf, recordDemoEvent, switchToReal } from "@/lib/demo/server";

export const runtime = "nodejs";

/** Leave Demo / Practice Mode and return to the real account (its data was never touched). */
export async function POST() {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getAuthUser();
  const claim = demoClaimOf(user);
  if (!user || !claim) return fail(409, "not_in_demo", "You're not in Demo Mode.");
  try {
    const r = await switchToReal(claim);
    if (r.restored) await recordDemoEvent(createAdminClient(), claim.owner, "demo_exited", claim.kind);
    return json({ ok: true, restored: r.restored, redirect: r.restored ? "/dashboard" : "/login?next=/dashboard" });
  } catch (e) {
    logError("demo.exit", e, { owner: claim.owner });
    return fail(500, "exit_failed", "Couldn't switch back. Sign out and sign in again; your real account is unchanged.");
  }
}
