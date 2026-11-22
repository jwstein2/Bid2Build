import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUser, createAdminClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/http/api";
import { site } from "@/lib/site";
import { QB_CALLBACK_PATH, qbConfigured } from "@/lib/quickbooks/config";
import { authorizeUrl } from "@/lib/quickbooks/client";
import { hasTwoStep } from "@/lib/staff/server";

export const runtime = "nodejs";

const QB_ADMIN_PAGE = "/admin/payouts?tab=quickbooks";
const back = (q: string) => NextResponse.redirect(new URL(`${QB_ADMIN_PAGE}&${q}`, site.url));

/**
 * Owner only: connects Built2Bid's own QuickBooks company for paying reps and affiliates. Uses the same Intuit
 * redirect address as the customer hours sync; the state cookie marks this sign-in as the platform connection.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(QB_ADMIN_PAGE)}`, site.url));
  const { data } = await createAdminClient().rpc("staff_capabilities", { p_user: user.id });
  if (!((data as string[] | null) ?? []).includes("payouts.activate")) return NextResponse.redirect(new URL("/", site.url));
  if (!(await hasTwoStep())) return back("err=two_step");
  if (!qbConfigured()) return back("err=qb_unavailable");
  if (!(await rateLimit(`qb-admin-connect:${user.id}`, 10, 10 * 60_000))) return back("err=qb_busy");
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("qb_oauth_state", `${state}.${user.id}.platform`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/quickbooks", maxAge: 600 });
  return NextResponse.redirect(await authorizeUrl(new URL(QB_CALLBACK_PATH, site.url).toString(), state));
}
