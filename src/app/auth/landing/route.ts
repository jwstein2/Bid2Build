import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { contractorHomePath, isSupabaseConfigured } from "@/lib/env";
import { isInviteToken } from "@/lib/sales/invite";
import { SALES_JOIN_COOKIE } from "@/lib/sales/next";
import { VIEW_COOKIE } from "@/lib/sales/caps";
import { landingPath } from "@/lib/workspaces";
import { loadWorkspaces } from "@/lib/workspaces-server";

export const dynamic = "force-dynamic";

/**
 * The default destination after any sign-in that didn't ask for a specific page (V8.9/V8.10). A pending
 * sales invite is finished first; otherwise the person opens the workspace they're authorized for and
 * prefer. Before this, every sign-in defaulted to the contractor dashboard, which is how invited sales
 * reps ended up in the contractor app.
 */
export async function GET(req: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  if (!isSupabaseConfigured()) return to("/dashboard");
  const home = contractorHomePath();
  const user = await getUser();
  if (!user) return to("/login");
  const jar = await cookies();
  const pendingInvite = isInviteToken(jar.get(SALES_JOIN_COOKIE)?.value ?? "");
  try {
    return to(landingPath(await loadWorkspaces(), { pendingInvite, lastView: jar.get(VIEW_COOKIE)?.value ?? null, contractorHome: home }));
  } catch {
    return to(pendingInvite ? "/sales/join" : home);
  }
}
