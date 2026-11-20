import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { hashInviteToken, isInviteToken } from "@/lib/sales/invite";
import { SalesLoginForm } from "../../../sales/login/sales-login-form";

export const metadata: Metadata = { title: "Join the Built2Bid team", robots: { index: false, follow: false } };

const WHY: Record<string, string> = {
  email_mismatch: "This link only opens for the email address it was sent to. Sign out, then sign in with that email.",
  other_account: "This staff record is already linked to a different sign-in.", other_record: "Your account is already linked to another staff record.",
  unverified: "Enter the code we emailed you first, then open this link again.", accepted: "This link was already used.", expired: "This link has expired. Ask the Built2Bid owner for a new one.",
  revoked: "This link was replaced or access was paused. Use the newest link you received.", not_found: "This link doesn't work. Check you copied all of it.",
};

/** A staff onboarding link. Only the token's SHA-256 is looked up; the page shows an email hint, never the full email. */
export default async function StaffInvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ why?: string }> }) {
  const { token } = await params;
  const why = (await searchParams).why;
  let inv: { status: string; display_name?: string; job_title?: string; email_hint?: string; expires_at?: string } = { status: "not_found" };
  if (isSupabaseConfigured() && isInviteToken(token)) {
    const { data } = await createAdminClient().rpc("staff_invite_lookup", { p_token_hash: hashInviteToken(token) });
    if (data) inv = data as typeof inv;
  }
  const user = isSupabaseConfigured() ? await getUser() : null;
  const join = `/staff/join?t=${token}`;
  return (
    <div className="max-w-lg py-10">
      <Logo />
      {why || inv.status !== "valid" ? (<>
        <h1 className="mt-8 text-2xl font-extrabold">{why ? "One more step" : "This link can't be used"}</h1>
        <p className="mt-2 text-ink-soft">{WHY[why ?? inv.status] ?? WHY.not_found}</p>
        {user && <form action="/auth/signout" method="post" className="mt-4"><button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold">Sign out</button></form>}
      </>) : (<>
        <h1 className="mt-8 text-3xl font-extrabold">Welcome{inv.display_name ? `, ${inv.display_name.split(" ")[0]}` : ""}</h1>
        <p className="mt-2 text-ink-soft">Built2Bid invited you to set up your {inv.job_title ? <strong>{inv.job_title}</strong> : "staff"} account. It takes about 10 minutes on your phone or computer: your details, agreements, tax form, how you get paid, and two-step sign-in.</p>
        <p className="mt-2 text-sm text-muted">Sign in with {inv.email_hint}. The link expires {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : "soon"}.</p>
        {user ? <a href={join} className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-ink px-5 font-semibold text-white">Continue as {user.email}</a>
          : <SalesLoginForm next={join} label="Sign in to start" />}
      </>)}
    </div>
  );
}
