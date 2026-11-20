import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { payoutProvider, ProviderError, type ProviderName } from "@/lib/payouts/provider";
import { PAYOUT_STATE_COOKIE, readPayoutState } from "@/lib/payouts/state";
import { emailBankChanged } from "@/lib/payouts/notify";

export const dynamic = "force-dynamic";

/** Return from the provider's hosted bank page (affiliates): read bank name, type and last 4 only, and record them. */
export async function GET(req: NextRequest) {
  const backTo = req.nextUrl.searchParams.get("back") === "/affiliate-hub/profile" ? "/affiliate-hub/profile" : "/affiliate-hub/onboarding?step=payout";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${backTo}${backTo.includes("?") ? "&" : "?"}${q}`, req.url), 303);
    res.cookies.delete({ name: PAYOUT_STATE_COOKIE, path: "/api/affiliate-payouts" });
    return res;
  };
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/affiliate-hub/login", req.url), 303);
  const db = createAdminClient();
  const [{ data: a }, { data: s }] = await Promise.all([
    db.from("affiliates").select("id").eq("user_id", user.id).maybeSingle(),
    db.from("payout_settings").select("mode, provider").eq("id", true).maybeSingle(),
  ]);
  if (!a) return back("err=not_affiliate");
  const st = readPayoutState(req.cookies.get(PAYOUT_STATE_COOKIE)?.value, `aff:${a.id}`);
  const mode = s?.mode === "live" ? "live" : "test";
  if (!st || st.mode !== mode) return back("err=expired");
  try {
    const provider = (s?.provider ?? "mock") as ProviderName;
    const d = await payoutProvider(provider, mode).destination(st.recipientRef);
    if (!d) return back("err=no_method");
    const { data, error } = await db.rpc("affiliate_destination_record", { p_user: user.id, p_provider: provider, p_mode: mode, p_recipient_ref: d.recipientRef,
      p_method_ref: d.methodRef, p_institution: d.institution, p_account_type: d.accountType, p_last4: d.last4, p_status: d.status });
    if (error) return back("err=save");
    const r = data as { changed: boolean; email?: string; name?: string; id: string; eligible_from: string | null };
    if (r.changed && r.email) await emailBankChanged(r.email, r.name ?? "", d.last4, d.institution, r.eligible_from, `aff-${r.id}`).catch(() => undefined);
    return back(r.changed ? "ok=bank_changed" : "ok=bank");
  } catch (e) {
    return back(`err=${e instanceof ProviderError ? encodeURIComponent(e.code) : "provider"}`);
  }
}
