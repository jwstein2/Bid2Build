import type { Metadata } from "next";
import Link from "next/link";
import { Container, Notice } from "@/components/ui/misc";
import { Logo } from "@/components/layout/logo";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { inviteTokenHash } from "@/lib/affiliates/server";
import { PROGRAM } from "@/lib/affiliates/content";
import { AffiliateLoginForm } from "../../login/login-form";
import { acceptInvite } from "./actions";

export const metadata: Metadata = { title: "Affiliate invitation", robots: { index: false, follow: false } };

/** Private invitation link. Shows who it's for; accepting requires signing in with that exact, verified email. */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const { token } = await params;
  const { err } = await searchParams;
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const info = valid && isSupabaseConfigured() ? ((await createAdminClient().rpc("affiliate_invite_lookup", { p_token_hash: inviteTokenHash(token) })).data as { email: string; name: string | null; note: string | null; valid: boolean } | null) : null;
  const user = info?.valid ? await getUser() : null;
  const here = `/affiliate-hub/invite/${token}`;
  return (
    <Container className="max-w-lg py-16">
      <Logo />
      {!info?.valid ? (
        <>
          <h1 className="mt-8 text-2xl font-extrabold">This invitation isn&apos;t valid</h1>
          <p className="mt-2 text-ink-soft">It may have expired, been replaced by a newer link, or already been used. Ask the person who invited you for a new link, or <Link className="underline" href="/affiliates/apply">apply here</Link>.</p>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-3xl font-extrabold">You&apos;re invited to the Built2Bid Affiliate Program</h1>
          {info.note && <blockquote className="mt-4 border-l-4 border-brand pl-4 text-ink-soft">{info.note}</blockquote>}
          <p className="mt-4 text-ink-soft">{PROGRAM.short}</p>
          <p className="mt-2 text-sm font-semibold">{PROGRAM.annual}</p>
          <p className="mt-2 text-xs text-muted">{PROGRAM.noGuarantee}</p>
          <p className="mt-6 text-sm">This invitation is for <strong>{info.email}</strong>.</p>
          {err && <Notice tone="danger" className="mt-3">{err === "wrong_email" ? `You're signed in as ${user?.email ?? "another account"}. Sign out and sign in with ${info.email}.` : "We couldn't accept this invitation. Please try again or ask for a new link."}</Notice>}
          {user ? (
            <div className="mt-6">
              <form action={acceptInvite}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" className="min-h-11 rounded-lg bg-ink px-5 font-semibold text-white">Accept and start setup</button>
              </form>
              <form action="/auth/signout" method="post" className="mt-2 text-xs text-muted">Signed in as {user.email}. <button type="submit" className="underline">Not you? Sign out</button></form>
            </div>
          ) : <AffiliateLoginForm next={here} autoOpen={false} label={`Sign in as ${info.email}`} />}
        </>
      )}
    </Container>
  );
}
