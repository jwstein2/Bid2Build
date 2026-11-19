import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSalesRep } from "@/lib/sales/server";
import { exchangeCode, saveConnection } from "@/lib/sales/google";
import { createAdminClient } from "@/lib/supabase/server";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";

export const runtime = "nodejs";

const back = (q: string) => NextResponse.redirect(new URL(`/sales/calendar?google=${q}`, site.url));

export async function GET(req: Request) {
  const { rep } = await requireSalesRep();
  const u = new URL(req.url);
  const jar = await cookies();
  const want = jar.get("sales_google_state")?.value ?? "";
  jar.delete({ name: "sales_google_state", path: "/api/sales/google" });
  const got = u.searchParams.get("state") ?? "";
  if (!want || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return back("failed");
  if (u.searchParams.get("error")) return back("declined");
  const code = u.searchParams.get("code");
  if (!code) return back("failed");
  try {
    const c = await exchangeCode(code, new URL("/api/sales/google/callback", site.url).toString());
    await saveConnection(createAdminClient(), rep.id, c);
    return back("connected");
  } catch (e) {
    logError("sales.google.callback", e);
    return back("failed");
  }
}
