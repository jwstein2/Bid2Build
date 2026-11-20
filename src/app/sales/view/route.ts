import { NextResponse, type NextRequest } from "next/server";
import { loadSalesAccess } from "@/lib/sales/server";
import { canAdmin, canMy, VIEW_COOKIE } from "@/lib/sales/caps";

/**
 * The My/Admin hub switcher. Remembers the choice and opens that hub. It never changes a role: a person
 * without the admin hub is sent to their own hub, and every admin page and action checks again.
 */
export async function GET(req: NextRequest) {
  const access = await loadSalesAccess();
  const want = req.nextUrl.searchParams.get("to") === "admin" ? "admin" : "my";
  const ok = access.kind === "staff" && (want === "admin" ? canAdmin(access.caps) : canMy(access.caps));
  const res = NextResponse.redirect(new URL(ok && want === "admin" ? "/sales/admin" : "/sales", req.url), 303);
  // Also remembered on the account (V8.10), so the next sign-in on any device opens the same hub.
  if (ok && access.kind === "staff") await access.db.rpc("set_my_workspace", { p_last: "sales", p_sales_view: want }).then(() => null, () => null);
  if (ok) res.cookies.set(VIEW_COOKIE, want, { path: "/sales", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
