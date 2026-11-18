import { z } from "zod";
import { createAdminClient, getAuthUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { demoClaimOf, isPlatformOwner, isPracticeEnabled, prepareWorkspace, recordDemoEvent, switchToDemo } from "@/lib/demo/server";

export const runtime = "nodejs";
export const maxDuration = 26;

const body = z.object({ kind: z.enum(["owner_demo", "practice"]) });

/**
 * Enter Demo Mode (platform owner) or Practice Mode (anyone, when PRACTICE_MODE=on).
 * The first call may answer { status: "seeding", progress } while the sample company is prepared; the
 * browser calls again until { status: "ready" }, at which point this browser is switched to the demo
 * login. Authorization is server-side: the owner check uses the existing admin process by user id.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Choose Demo or Practice.");
  const user = await getAuthUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const claim = demoClaimOf(user);
  // In a demo session already: only continuing the same owner's workspace (after Reset) is allowed.
  const owner = claim ? claim.owner : user.id;
  if (claim && claim.kind !== p.data.kind) return fail(409, "in_demo", "Exit the current demo first.");
  if (!claim && !(user.email_confirmed_at || user.phone_confirmed_at)) return fail(403, "not_verified", "Verify your account first.");
  if (!(await rateLimit(`demo-enter:${owner}`, 40, 10 * 60_000))) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const admin = createAdminClient();
  if (p.data.kind === "owner_demo") {
    // Not disclosed to anyone else: a non-owner gets the same 404 as a missing route.
    if (!(await isPlatformOwner(admin, owner))) return fail(404, "not_found", "Not found.");
  } else if (!isPracticeEnabled()) {
    return fail(404, "not_found", "Practice Mode isn't available yet.");
  }
  try {
    const r = await prepareWorkspace(admin, owner, p.data.kind);
    if (r.status === "seeding") return json({ status: "seeding", progress: r.progress });
    if (r.status === "failed") { logError("demo.seed", new Error(r.error), { owner }); return fail(500, "seed_failed", "The sample company couldn't be prepared. Try Reset, or try again later.", { detail: r.error.slice(0, 200) }); }
    if (claim && r.workspace.demo_user_id === user.id) return json({ status: "ready", redirect: "/dashboard" });
    await switchToDemo(admin, r.workspace, claim ? null : { id: user.id });
    if (!claim) await recordDemoEvent(admin, owner, p.data.kind === "practice" ? "practice_started" : "demo_entered", p.data.kind);
    return json({ status: "ready", redirect: "/dashboard" });
  } catch (e) {
    logError("demo.enter", e, { owner });
    return fail(500, "demo_failed", "Demo Mode couldn't start. Your real account is unchanged.");
  }
}
