import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSalesRep } from "@/lib/sales/server";
import { authUrl, googleConfigured } from "@/lib/sales/google";
import { site } from "@/lib/site";

export const runtime = "nodejs";

/** Starts Google's own consent screen for the signed-in rep. The state cookie ties the callback to this browser. */
export async function GET(req: Request) {
  const { rep } = await requireSalesRep();
  if (!googleConfigured()) return NextResponse.redirect(new URL("/sales/calendar?google=unavailable", site.url));
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("sales_google_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/sales/google", maxAge: 600 });
  const withGmail = new URL(req.url).searchParams.get("gmail") === "1";
  return NextResponse.redirect(authUrl({ redirectUri: new URL("/api/sales/google/callback", site.url).toString(), state, withGmail, loginHint: rep.email }));
}
