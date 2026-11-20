import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { payoutProvider, ProviderError, type ProviderName } from "@/lib/payouts/provider";
import { PAYOUT_STATE_COOKIE, readPayoutState } from "@/lib/payouts/state";
import { emailBankChanged } from "@/lib/payouts/notify";

export const dynamic = "force-dynamic";

/** Return from the provider's hosted bank page: read the payout method (bank name, type, last 4 only) and record it. */
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/staff/payouts?${q}#connect`, req.url), 303);
    res.cookies.delete({ name: PAYOUT_STATE_COOKIE, path: "/api/payouts" });
    return res;
  };
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/staff/login?next=/staff/payouts", req.url), 303);
  const db = createAdminClient();
  const [{ data: m }, { data: s }] = await Promise.all([
    db.from("staff_members").select("id").eq("user_id", user.id).maybeSingle(),
    db.from("payout_settings").select("mode, provider").eq("id", true).maybeSingle(),
  ]);
  if (!m) return back("err=not_staff");
  const st = readPayoutState(req.cookies.get(PAYOUT_STATE_COOKIE)?.value, m.id);
  const mode = s?.mode === "live" ? "live" : "test";
  if (!st || st.mode !== mode) return back("err=expired");
  try {
    const provider = (s?.provider ?? "mock") as ProviderName;
    const d = await payoutProvider(provider, mode).destination(st.recipientRef);
    if (!d) return back("err=no_method");
    const { data, error } = await db.rpc("staff_destination_record", { p_user: user.id, p_provider: provider, p_mode: mode, p_recipient_ref: d.recipientRef,
      p_method_ref: d.methodRef, p_institution: d.institution, p_account_type: d.accountType, p_last4: d.last4, p_status: d.status });
    if (error) return back("err=save");
    const r = data as { changed: boolean; email?: string; name?: string; destination: { id: string; eligible_from: string | null } };
    if (r.changed && r.email) await emailBankChanged(r.email, r.name ?? "", d.last4, d.institution, r.destination.eligible_from, r.destination.id).catch(() => undefined);
    return back(r.changed ? "ok=bank_changed" : "ok=bank");
  } catch (e) {
    return back(`err=${e instanceof ProviderError ? encodeURIComponent(e.code) : "provider"}`);
  }
}
