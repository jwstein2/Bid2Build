import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { Container } from "@/components/ui/misc";
import { PortalNav } from "@/components/sales/portal-nav";
import { loadSalesAccess } from "@/lib/sales/server";

export const metadata: Metadata = { title: { default: "Sales portal", template: "%s · Sales portal" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className="min-h-11 rounded-md px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">Sign out</button>
    </form>
  );
}

/**
 * Sales portal shell. Separate from the contractor app (no contractor sidebar, no bids) and from the
 * owner admin area. Every page below re-checks access through the database (sales_me / sales_my_*).
 */
export default async function SalesPortalLayout({ children }: { children: React.ReactNode }) {
  const access = await loadSalesAccess();
  if (access.kind !== "rep") {
    return (
      <main className="min-h-screen bg-paper">
        <Container className="max-w-lg py-16">
          <Logo />
          <h1 className="mt-8 text-2xl font-extrabold">{access.kind === "suspended" ? "Your sales portal access is paused" : "This account isn't on the sales team"}</h1>
          <p className="mt-2 text-ink-soft">
            {access.kind === "suspended"
              ? "The Built2Bid owner has paused your access. Reach out to them if you think this is a mistake."
              : `You're signed in as ${access.user.email ?? "this account"}. The sales portal opens for email addresses the Built2Bid owner has invited. Sign out and use your invited email, or ask the owner to send an invite.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <form action="/auth/signout" method="post"><button type="submit" className="min-h-11 rounded-lg bg-ink px-4 font-semibold text-white">Sign out</button></form>
            <a href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 font-semibold">Go to my contractor account</a>
          </div>
        </Container>
      </main>
    );
  }
  return (
    <div className="min-h-screen bg-paper">
      <header className="on-dark bg-navy text-white">
        <Container className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <div className="flex items-center gap-3">
            <Logo tone="dark" href="/sales" />
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Sales</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-white/75 sm:inline">{access.rep.full_name}</span>
            <SignOut />
          </div>
          <div className="w-full"><PortalNav /></div>
        </Container>
      </header>
      <main id="main"><Container className="py-6">{children}</Container></main>
    </div>
  );
}
