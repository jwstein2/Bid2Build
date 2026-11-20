import { NextResponse } from "next/server";
import { createClient, getUser } from "@/lib/supabase/server";
import { hashInviteToken, isInviteToken } from "@/lib/sales/invite";

export const dynamic = "force-dynamic";

/** Accept a staff invite for the signed-in, verified user, then open onboarding. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") ?? "";
  if (!isInviteToken(t)) return NextResponse.redirect(new URL("/staff/invite/x?why=not_found", url));
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(`/staff/invite/${t}`, url));
  const { data, error } = await (await createClient()).rpc("staff_invite_accept", { p_token_hash: hashInviteToken(t) });
  const status = error ? "not_found" : (data as { status: string }).status;
  if (status !== "ok") return NextResponse.redirect(new URL(`/staff/invite/${t}?why=${status}`, url));
  return NextResponse.redirect(new URL("/staff/onboarding", url));
}
