import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { DEFAULT_LANDING } from "@/lib/http/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { hashInviteToken, isInviteToken } from "@/lib/sales/invite";
import { SALES_JOIN_COOKIE } from "@/lib/sales/next";
import { VIEW_COOKIE } from "@/lib/sales/caps";

export const dynamic = "force-dynamic";

type Accept = { status: string; rep_id?: string; sells?: boolean; role?: string };

/**
 * Finishes a sales invitation for the signed-in person (V8.9). The token comes from the invite page's
 * Join / sign-in step (?t=); the database checks it against the invite record
 * (expired, revoked, already used, one team record per account) and links the account. Signed-out
 * visitors are sent to the sales sign-in by the proxy and come straight back here.
 *
 *   joined          -> My Sales Hub (or the Admin Sales Hub for an admin-only member), with onboarding
 *   already_member  -> their hub
 *   anything else   -> the invite page, which explains what happened and what to do
 */
export async function GET(req: NextRequest) {
  const to = (path: string) => new URL(path, req.url);
  if (!isSupabaseConfigured()) return NextResponse.redirect(to("/sales/login"), 303);
  const user = await getUser();
  const jar = await cookies();
  const fromQuery = req.nextUrl.searchParams.get("t");
  const remembered = jar.get(SALES_JOIN_COOKIE)?.value;
  const clear = (res: NextResponse) => { res.cookies.set(SALES_JOIN_COOKIE, "", { maxAge: 0, path: "/" }); return res; };
  if (!user) {
    const back = fromQuery && isInviteToken(fromQuery) ? `/sales/join?t=${fromQuery}` : "/sales/join";
    return NextResponse.redirect(to(`/sales/login?next=${encodeURIComponent(back)}`), 303);
  }
  if (!fromQuery || !isInviteToken(fromQuery)) {
    // No explicit "Join" click, only a remembered invite (signed in some other way, e.g. the normal log in
    // in another tab). Never accept silently: an open invite goes back to its page to confirm the
    // account; anything else is forgotten and the person continues to their usual workspace.
    if (req.nextUrl.searchParams.get("dismiss") === "1" || !remembered || !isInviteToken(remembered)) return clear(NextResponse.redirect(to(DEFAULT_LANDING), 303));
    const { data } = await createAdminClient().rpc("sales_invite_lookup", { p_token_hash: hashInviteToken(remembered) });
    if ((data as { status?: string } | null)?.status === "valid") return NextResponse.redirect(to(`/sales/invite/${remembered}`), 303);
    return clear(NextResponse.redirect(to(DEFAULT_LANDING), 303));
  }
  const token = fromQuery;

  const db = await createClient();
  const { data, error } = await db.rpc("sales_invite_accept", { p_token_hash: hashInviteToken(token) });
  // Before the V8.9 SQL is applied: fall back to the email link (sales_me runs in the portal layout).
  const result: Accept = error || !data ? { status: "legacy" } : (data as Accept);

  let dest: string;
  if (result.status === "joined" || result.status === "legacy") {
    dest = result.sells === false ? "/sales/admin?welcome=1" : "/sales?welcome=1";
  } else if (result.status === "already_member") {
    dest = result.sells === false ? "/sales/admin" : "/sales";
  } else {
    dest = `/sales/invite/${token}?why=${encodeURIComponent(result.status)}`;
  }
  const res = NextResponse.redirect(to(dest), 303);
  // Used: forget it, so it never redirects anyone again. ("unverified" keeps it for the next try.)
  if (result.status !== "unverified") clear(res);
  if (result.status === "joined" || result.status === "already_member") {
    await db.rpc("set_my_workspace", { p_last: "sales", p_sales_view: result.sells === false ? "admin" : "my" }).then(() => null, () => null);
    res.cookies.set(VIEW_COOKIE, result.sells === false ? "admin" : "my", { path: "/sales", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}
