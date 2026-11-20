"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { payoutProvider, ProviderError, type ProviderName } from "@/lib/payouts/provider";
import { PAYOUT_STATE_COOKIE, signPayoutState } from "@/lib/payouts/state";
import { site } from "@/lib/site";

/**
 * "Connect Bank Account": opens the payout provider's hosted page. Built2Bid never receives the account or routing
 * number. The recipient id is remembered in a signed cookie so the return page can read the bank name and last 4.
 */
export async function connectBank() {
  const user = await getUser();
  if (!user) redirect("/staff/login?next=/staff/payouts");
  const db = createAdminClient();
  const [{ data: m }, { data: s }] = await Promise.all([
    db.from("staff_members").select("id, email, display_name, preferred_name, classification, status").eq("user_id", user.id).maybeSingle(),
    db.from("payout_settings").select("mode, provider").eq("id", true).maybeSingle(),
  ]);
  if (!m || !["onboarding", "active"].includes(m.status)) redirect("/staff?err=not_staff");
  if (!["contractor_1099", "vendor"].includes(m.classification)) redirect("/staff/payouts?err=payroll");
  const mode = s?.mode === "live" ? "live" : "test";
  const { data: cur } = await db.from("staff_payout_destinations").select("recipient_ref").eq("staff_id", m.id).eq("mode", mode).eq("is_current", true).maybeSingle();
  let url: string;
  try {
    const p = payoutProvider((s?.provider ?? "mock") as ProviderName, mode);
    const base = site.url.replace(/\/$/, "");
    const link = await p.onboardingLink({ recipientRef: cur?.recipient_ref ?? null, email: m.email, name: m.preferred_name ?? m.display_name, staffId: m.id,
      returnUrl: `${base}/api/payouts/return`, refreshUrl: `${base}/staff/payouts?err=expired#connect` });
    (await cookies()).set(PAYOUT_STATE_COOKIE, signPayoutState({ staffId: m.id, recipientRef: link.recipientRef, mode }), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/payouts", maxAge: 1800 });
    url = link.url;
  } catch (e) {
    redirect(`/staff/payouts?err=${e instanceof ProviderError ? encodeURIComponent(e.code) : "provider"}#connect`);
  }
  redirect(url);
}
