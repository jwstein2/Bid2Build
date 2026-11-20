import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { Container } from "@/components/ui/misc";
import { HubNav } from "@/components/affiliates/hub-nav";
import { loadAffiliate } from "@/lib/affiliates/server";

export const metadata: Metadata = { title: { default: "Affiliate Hub", template: "%s · Affiliate Hub" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SignOut = () => (
  <form action="/auth/signout" method="post">
    <button type="submit" className="min-h-11 rounded-md px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">Sign out</button>
  </form>
);

/**
 * Affiliate Hub shell. Separate from the contractor app, the staff-only Sales Portal and the owner admin. Every page
 * re-checks access through the database (affiliate_* functions return only the signed-in affiliate's own rows).
 */
export default async function AffiliateHubLayout({ children }: { children: React.ReactNode }) {
  const a = await loadAffiliate();
  if (a.kind !== "affiliate") {
    const blocked = a.kind === "blocked";
    return (
      <main className="min-h-screen bg-paper">
        <Container className="max-w-lg py-16">
          <Logo />
          <h1 className="mt-8 text-2xl font-extrabold">
            {blocked ? (a.status === "rejected" ? "Your application wasn't approved" : a.status === "suspended" ? "Your affiliate account is paused" : "Your affiliate agreement has ended") : "This account isn't an affiliate yet"}
          </h1>
          <p className="mt-2 text-ink-soft">
            {blocked ? (a.reason ? `Note from Built2Bid: ${a.reason}` : "Email partners@built2bid.org with any questions.")
              : `You're signed in as ${a.user.email ?? "this account"}. The Affiliate Hub opens for approved applications and invitations, matched by verified email.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {!blocked && <Link href="/affiliates/apply" className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 font-semibold text-white">Apply to join</Link>}
            <form action="/auth/signout" method="post"><button type="submit" className="min-h-11 rounded-lg border border-line px-4 font-semibold">Sign out</button></form>
          </div>
        </Container>
      </main>
    );
  }
  const setupOnly = a.me.status !== "active" && a.me.status !== "terminated";
  return (
    <div className="min-h-screen bg-paper">
      <header className="on-dark bg-navy text-white">
        <Container className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <div className="flex items-center gap-3">
            <Logo tone="dark" href="/affiliate-hub" />
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Affiliates</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden text-sm text-white/75 md:block">{a.me.display_name ?? a.me.legal_name ?? a.me.email}</span>
            <SignOut />
          </div>
          <div className="w-full"><HubNav setupOnly={setupOnly} /></div>
        </Container>
      </header>
      <main id="main"><Container className="py-6">{children}</Container></main>
    </div>
  );
}
