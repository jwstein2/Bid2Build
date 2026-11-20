import { NextResponse, type NextRequest } from "next/server";
import { getUser, createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { VIEW_COOKIE } from "@/lib/sales/caps";
import { parseSwitchTo, switchTarget } from "@/lib/workspaces";
import { loadWorkspaces } from "@/lib/workspaces-server";

export const dynamic = "force-dynamic";

/**
 * One-click workspace switch from the account menu (V8.10): contractor dashboard <-> Sales Hub, and My
 * <-> Admin Sales Hub. Same Supabase session, no second sign-in. Permissions are read from the database
 * here; a stale menu link (role revoked since the page loaded) opens a page the person still has. It
 * only remembers the choice; the destination's own guard still decides access.
 */
export async function GET(req: NextRequest) {
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  if (!isSupabaseConfigured()) return go("/dashboard");
  if (!(await getUser())) return go("/login");
  const want = parseSwitchTo(req.nextUrl.searchParams.get("to")) ?? "sales";
  const ws = await loadWorkspaces();
  const { path, remember } = switchTarget(ws, want, req.cookies.get(VIEW_COOKIE)?.value ?? null);
  if (remember.last || remember.view) {
    const db = await createClient();
    await db.rpc("set_my_workspace", { p_last: remember.last ?? null, p_sales_view: remember.view ?? null }).then(() => null, () => null);
  }
  const res = go(path);
  if (remember.view) res.cookies.set(VIEW_COOKIE, remember.view, { path: "/sales", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
