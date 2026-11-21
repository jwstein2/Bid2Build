import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { rateLimit } from "@/lib/http/api";
import { site } from "@/lib/site";
import { QB_CALLBACK_PATH, QB_PAGE_PATH, isQuickBooksEnabled, qbConfigured } from "@/lib/quickbooks/config";
import { authorizeUrl } from "@/lib/quickbooks/client";
import { scopeFor } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

const back = (q: string) => NextResponse.redirect(new URL(`${QB_PAGE_PATH}?qb=${q}`, site.url));

/** Starts Intuit's consent screen. The state cookie ties the callback to this browser and user. */
export async function GET() {
  if (!isPmEnabled() || !isQuickBooksEnabled()) return NextResponse.redirect(new URL("/projects", site.url));
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${QB_PAGE_PATH}`, site.url));
  if (!qbConfigured()) return back("unavailable");
  if (!(await rateLimit(`qb-connect:${user.id}`, 10, 10 * 60_000))) return back("busy");
  const scope = await scopeFor(await createClient());
  if (!scope?.canManage) return back("forbidden");
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("qb_oauth_state", `${state}.${user.id}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/quickbooks", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(new URL(QB_CALLBACK_PATH, site.url).toString(), state));
}
