import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { Logo } from "@/components/layout/logo";
import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { hashInviteToken, isInviteToken } from "@/lib/sales/invite";
import { SalesLoginForm } from "../../login/sales-login-form";

export const metadata: Metadata = { title: "Join the Built2Bid sales team", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Lookup { status: "valid" | "expired" | "revoked" | "accepted" | "not_found"; full_name?: string; email_hint?: string; expires_at?: string }

/**
 * A rep's invite link. The token in the URL is checked by its hash only; the page never shows the full
 * invited email (only a hint) so a forwarded link doesn't leak it. Signing in with the invited email
 * links the account (sales_me) and marks the invite accepted.
 */
export default async function SalesInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite: Lookup = { status: "not_found" };
  if (isSupabaseConfigured() && isInviteToken(token)) {
    const { data } = await createAdminClient().rpc("sales_invite_lookup", { p_token_hash: hashInviteToken(token) });
    if (data) invite = data as Lookup;
  }
  const user = isSupabaseConfigured() ? await getUser() : null;
  const first = invite.full_name?.split(" ")[0];
  return (
    <Container className="max-w-md py-16">
      <Logo />
      {invite.status === "valid" ? (
        <>
          <h1 className="mt-8 text-3xl font-extrabold">Welcome{first ? `, ${first}` : ""}</h1>
          <p className="mt-2 text-ink-soft">You&apos;ve been invited to the Built2Bid sales team. Sign in with the email this invite was sent to{invite.email_hint ? ` (${invite.email_hint})` : ""} and we&apos;ll email you a code. No password needed.</p>
          {user ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm">You&apos;re signed in as <strong>{user.email}</strong>. If that&apos;s the invited email, open the portal to finish joining.</p>
              <Link href="/sales" className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white">Open the sales portal</Link>
            </div>
          ) : <SalesLoginForm next="/sales" />}
          {invite.expires_at && <p className="mt-6 text-xs text-muted">This link works until {new Date(invite.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}.</p>}
        </>
      ) : (
        <>
          <h1 className="mt-8 text-3xl font-extrabold">{invite.status === "accepted" ? "You've already joined" : "This invite link doesn't work"}</h1>
          <p className="mt-2 text-ink-soft">
            {invite.status === "accepted" ? "This invite was already used. Sign in to the sales portal with your email."
              : invite.status === "expired" ? "This invite has expired. Ask the Built2Bid owner to send you a new link."
              : invite.status === "revoked" ? "A newer invite replaced this one. Use the latest link you were sent, or ask the owner for a new one."
              : "Check that you copied the whole link, or ask the Built2Bid owner for a new one."}
          </p>
          <Link href="/sales/login" className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">Go to sales sign in</Link>
        </>
      )}
    </Container>
  );
}
