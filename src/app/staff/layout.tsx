import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { Container } from "@/components/ui/misc";

export const metadata: Metadata = { title: { default: "Built2Bid staff", template: "%s · Built2Bid staff" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Built2Bid internal staff area (onboarding, payout settings, finance views). Not part of the contractor app and never
 * linked from customer pages or the public site. Every page re-checks access in the database.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="on-dark bg-navy text-white">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3"><Logo tone="dark" href="/staff" /><span className="rounded bg-white/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Staff</span></div>
          <nav aria-label="Staff" className="flex flex-wrap items-center gap-1 text-sm">
            <a href="/staff" className="min-h-11 rounded-md px-3 py-2.5 font-semibold text-white/80 hover:bg-white/10 hover:text-white">My profile</a>
            <a href="/staff/payouts" className="min-h-11 rounded-md px-3 py-2.5 font-semibold text-white/80 hover:bg-white/10 hover:text-white">Payouts</a>
            <form action="/auth/signout" method="post"><button type="submit" className="min-h-11 rounded-md px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">Sign out</button></form>
          </nav>
        </Container>
      </header>
      <main id="main"><Container className="max-w-3xl py-6">{children}</Container></main>
    </div>
  );
}
