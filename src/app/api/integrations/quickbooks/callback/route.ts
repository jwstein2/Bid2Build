import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { QB_CALLBACK_PATH, QB_PAGE_PATH, isQuickBooksEnabled, qbConfigured } from "@/lib/quickbooks/config";
import { QbError, exchangeCode } from "@/lib/quickbooks/client";
import { saveConnection, scopeFor } from "@/lib/quickbooks/server";
import { savePlatformConnection } from "@/lib/quickbooks/platform";

export const runtime = "nodejs";

const back = (q: string) => NextResponse.redirect(new URL(`${QB_PAGE_PATH}?qb=${q}`, site.url));
const adminBack = (q: string) => NextResponse.redirect(new URL(`/admin/payouts?tab=quickbooks&${q}`, site.url));

/** Owner connecting Built2Bid's own QuickBooks company (admin payouts). State already checked by the caller. */
async function platformCallback(u: URL, userId: string): Promise<NextResponse> {
  const { data } = await createAdminClient().rpc("staff_capabilities", { p_user: userId });
  if (!((data as string[] | null) ?? []).includes("payouts.activate")) return NextResponse.redirect(new URL("/", site.url));
  if (u.searchParams.get("error")) return adminBack("err=qb_declined");
  const code = u.searchParams.get("code"), realm = u.searchParams.get("realmId") ?? "";
  if (!code || !/^\d{1,32}$/.test(realm)) return adminBack("err=qb_failed");
  try {
    const tokens = await exchangeCode(code, new URL(QB_CALLBACK_PATH, site.url).toString());
    await savePlatformConnection(createAdminClient(), userId, realm, tokens);
    return adminBack("ok=qb_connected");
  } catch (e) {
    logError("quickbooks.platform_callback", e, { intuit_tid: e instanceof QbError ? e.tid ?? undefined : undefined });
    return adminBack("err=qb_failed");
  }
}

/** Intuit sends the contractor back here with a one-time code and the QuickBooks company id (realmId). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get("qb_oauth_state")?.value ?? "";
  const [want, forUser, purpose] = raw.split(".");
  const platform = purpose === "platform";
  if (!qbConfigured() || (!platform && (!isPmEnabled() || !isQuickBooksEnabled()))) return platform ? adminBack("err=qb_unavailable") : back("unavailable");
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${platform ? "/admin/payouts" : QB_PAGE_PATH}`, site.url));
  jar.delete({ name: "qb_oauth_state", path: "/api/integrations/quickbooks" });
  const got = u.searchParams.get("state") ?? "";
  if (!want || forUser !== user.id || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return platform ? adminBack("err=qb_failed") : back("failed");
  if (platform) return platformCallback(u, user.id);
  if (u.searchParams.get("error")) return back("declined");
  const code = u.searchParams.get("code"), realm = u.searchParams.get("realmId") ?? "";
  if (!code || !/^\d{1,32}$/.test(realm)) return back("failed");
  const scope = await scopeFor(await createClient());
  if (!scope?.canManage) return back("forbidden");
  try {
    const tokens = await exchangeCode(code, new URL(QB_CALLBACK_PATH, site.url).toString());
    await saveConnection(createAdminClient(), scope, user.id, realm, tokens);
    return back("connected");
  } catch (e) {
    logError("quickbooks.callback", e, { intuit_tid: e instanceof QbError ? e.tid ?? undefined : undefined });
    return back("failed");
  }
}
