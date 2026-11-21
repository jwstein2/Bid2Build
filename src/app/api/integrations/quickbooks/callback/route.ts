import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { QB_CALLBACK_PATH, QB_PAGE_PATH, isQuickBooksEnabled, qbConfigured } from "@/lib/quickbooks/config";
import { exchangeCode } from "@/lib/quickbooks/client";
import { saveConnection, scopeFor } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

const back = (q: string) => NextResponse.redirect(new URL(`${QB_PAGE_PATH}?qb=${q}`, site.url));

/** Intuit sends the contractor back here with a one-time code and the QuickBooks company id (realmId). */
export async function GET(req: Request) {
  if (!isPmEnabled() || !isQuickBooksEnabled() || !qbConfigured()) return back("unavailable");
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${QB_PAGE_PATH}`, site.url));
  const u = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get("qb_oauth_state")?.value ?? "";
  jar.delete({ name: "qb_oauth_state", path: "/api/integrations/quickbooks" });
  const [want, forUser] = raw.split(".");
  const got = u.searchParams.get("state") ?? "";
  if (!want || forUser !== user.id || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return back("failed");
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
    logError("quickbooks.callback", e);
    return back("failed");
  }
}
