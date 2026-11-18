import { z } from "zod";
import { createAdminClient, getAuthUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { demoClaimOf, isPlatformOwner, loadWorkspace, prepareWorkspace, recordDemoEvent, switchToDemo } from "@/lib/demo/server";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * Reset Demo Workspace. Only from inside a demo/practice session, only for that session's own workspace
 * (the claim's workspace must match the registered workspace for its owner). It never deletes with a
 * broad query: the current demo login is retired and a fresh one is seeded from the versioned dataset.
 * This browser switches to the new demo login at once and calls /api/demo/enter until seeding is done.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const p = z.object({ confirm: z.literal("RESET") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Confirm the reset first.");
  const user = await getAuthUser();
  const claim = demoClaimOf(user);
  if (!user || !claim) return fail(409, "not_in_demo", "Reset is only available inside Demo Mode.");
  if (!(await rateLimit(`demo-reset:${claim.owner}`, 6, 60 * 60_000))) return fail(429, "rate_limited", "Too many resets. Try again later.");
  const admin = createAdminClient();
  const ws = await loadWorkspace(admin, claim.owner, claim.kind);
  if (!ws || ws.id !== claim.workspace || ws.demo_user_id !== user.id) return fail(403, "forbidden", "This isn't the current demo workspace.");
  if (claim.kind === "owner_demo" && !(await isPlatformOwner(admin, claim.owner))) return fail(404, "not_found", "Not found.");
  try {
    const r = await prepareWorkspace(admin, claim.owner, claim.kind, { reset: true });
    await recordDemoEvent(admin, claim.owner, "demo_reset", claim.kind);
    if (r.status === "failed") return fail(500, "seed_failed", "The sample company couldn't be prepared. Try again.");
    // The old demo login is retired (banned), so this browser moves to the new one right away.
    const fresh = await loadWorkspace(admin, claim.owner, claim.kind);
    if (!fresh?.demo_user_id) throw new Error("demo_workspace_missing");
    await switchToDemo(admin, fresh, null);
    return json({ status: "seeding", progress: r.status === "seeding" ? r.progress : 100 });
  } catch (e) {
    logError("demo.reset", e, { owner: claim.owner });
    return fail(500, "reset_failed", "Reset didn't finish. Your real account is unchanged.");
  }
}
