import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Link2, GraduationCap, Wallet } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { Logo } from "@/components/layout/logo";
import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { hashInviteToken, isInviteToken } from "@/lib/sales/invite";
import { SalesLoginForm } from "../../login/sales-login-form";

export const metadata: Metadata = { title: "Join the Built2Bid sales team", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Lookup { status: "valid" | "expired" | "revoked" | "accepted" | "not_found"; full_name?: string; email_hint?: string; expires_at?: string }

/** Why /sales/join sent the person back here (sales_invite_accept statuses). */
const WHY: Record<string, { title: string; body: string }> = {
  email_mismatch: { title: "Use your invited email", body: "This invite is for a Sales Administrator, so it only opens for the email address it was sent to. Sign out, then sign in with that email." },
  other_record: { title: "This account is already on the sales team", body: "Your account is already linked to a different sales team record, so it can't take a second one. Open your Sales Hub, or ask the Built2Bid owner to check your invites." },
  unverified: { title: "Confirm your email first", body: "Enter the code we emailed you, then open this invite link again." },
  accepted: { title: "This invite was already used", body: "Someone already joined with this link. If that wasn't you, ask the Built2Bid owner for a new invite." },
  expired: { title: "This invite has expired", body: "Ask the Built2Bid owner to send you a new link. It takes them one click." },
  revoked: { title: "This invite link was replaced", body: "A newer invite replaced this one, or your access was paused. Use the latest link you were sent, or ask the owner." },
  not_found: { title: "This invite link doesn't work", body: "Check that you copied the whole link, or ask the Built2Bid owner for a new one." },
};

const STEPS = [
  { icon: BadgeCheck, title: "Create or sign in to your account", body: "One Built2Bid login. An existing contractor account works too and stays as it is." },
  { icon: Link2, title: "Get your personal referral link", body: "Customers who sign up through it stay connected to you." },
  { icon: GraduationCap, title: "Finish Sales Academy", body: "Short lessons and quizzes that certify you to sell." },
  { icon: Wallet, title: "See how you get paid", body: "Commissions, the 30-day hold and milestone bonuses." },
];

/**
 * A rep's invite link. The token in the URL is checked by its hash only; the page never shows the full
 * invited email (only a hint) so a forwarded link doesn't leak it. Opening it remembers the token (the
 * proxy sets an httpOnly cookie) and sign-in returns to /sales/join, which accepts it on the server.
 */
export default async function SalesInvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ why?: string }> }) {
  const { token } = await params;
  const why = WHY[(await searchParams).why ?? ""] ?? null;
  let invite: Lookup = { status: "not_found" };
  if (isSupabaseConfigured() && isInviteToken(token)) {
    const { data } = await createAdminClient().rpc("sales_invite_lookup", { p_token_hash: hashInviteToken(token) });
    if (data) invite = data as Lookup;
  }
  const user = isSupabaseConfigured() ? await getUser() : null;
  const first = invite.full_name?.split(" ")[0];
  const join = `/sales/join?t=${token}`;
  const button = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 text-sm font-semibold text-white transition hover:bg-ink/90 active:scale-[0.98]";
  const outline = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold transition hover:bg-paper active:scale-[0.98]";

  if (why) {
    return (
      <Container className="max-w-md py-16">
        <Logo />
        <h1 className="mt-8 text-3xl font-extrabold">{why.title}</h1>
        <p className="mt-2 text-ink-soft">{why.body}</p>
        {user && <p className="mt-4 text-sm text-muted">Signed in as <strong>{user.email}</strong>.</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {user ? <form action="/auth/signout" method="post"><button type="submit" className={button}>Sign out</button></form> : null}
          <a href="/sales" className={outline}>Go to the Sales Hub</a>
        </div>
      </Container>
    );
  }

  if (invite.status === "valid") {
    return (
      <Container className="max-w-xl py-12 sm:py-16">
        <Logo />
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.14em] text-brand">Built2Bid sales team</p>
        <h1 className="mt-1 text-3xl font-extrabold">Welcome to the team{first ? `, ${first}` : ""}</h1>
        <p className="mt-2 text-ink-soft">You&apos;ve been invited to sell Built2Bid. Create your account (or sign in) and you&apos;ll go straight to your own Sales Hub.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-xl border border-line bg-white p-3">
              <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div><p className="text-sm font-semibold">{i + 1}. {s.title}</p><p className="text-xs text-ink-soft">{s.body}</p></div>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-xl border border-line bg-white p-5">
          {user ? (
            <div className="space-y-3">
              <p className="text-sm">You&apos;re signed in as <strong>{user.email}</strong>. Join with this account?</p>
              <a href={join} className={button} data-testid="sales-join">Join the sales team</a>
              <form action="/auth/signout" method="post" className="text-xs text-muted">Not you? <button type="submit" className="underline">Sign out</button> first, then open this link again. Or <a href="/sales/join?dismiss=1" className="underline">not now</a>.</form>
            </div>
          ) : (
            <>
              <p className="text-sm">New to Built2Bid? Use the email this invite was sent to{invite.email_hint ? ` (${invite.email_hint})` : ""}. Already have an account? Sign in with it and it joins the team. We&apos;ll email you a code, no password needed.</p>
              <SalesLoginForm next={join} autoOpen={false} invite label="Create my account or sign in" />
            </>
          )}
        </div>
        {invite.expires_at && <p className="mt-6 text-xs text-muted">This link works until {new Date(invite.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}.</p>}
      </Container>
    );
  }

  const state = WHY[invite.status] ?? WHY.not_found;
  return (
    <Container className="max-w-md py-16">
      <Logo />
      {invite.status === "accepted" ? (
        <>
          <h1 className="mt-8 text-3xl font-extrabold">You&apos;ve already joined</h1>
          <p className="mt-2 text-ink-soft">This invite was used to join the sales team. {user ? "Open your Sales Hub below." : "Sign in to open your Sales Hub."}</p>
          {user ? <a href={join} className={`${button} mt-6`}>Open my Sales Hub</a> : <SalesLoginForm next={join} />}
        </>
      ) : (
        <>
          <h1 className="mt-8 text-3xl font-extrabold">{state.title}</h1>
          <p className="mt-2 text-ink-soft">{state.body}</p>
          <Link href="/sales/login" className={`${outline} mt-6`}>Go to sales sign in</Link>
        </>
      )}
    </Container>
  );
}
