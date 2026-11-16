import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { AccountThemeScript } from "@/components/theme/account-theme-script";
import { getUser } from "@/lib/supabase/server";
import { parseArrival } from "@/lib/bid-check/engine";
import { trialConfig } from "@/lib/trial/config";
import { BidCheck } from "./bid-check";

export const metadata: Metadata = {
  title: "What's slowing down your bids?",
  description: "Six quick questions for contractors. Get one thing to fix on your next estimate, with a real example for your trade.",
  robots: { index: false, follow: false },
  openGraph: { title: "What's slowing down your bids?", description: "Six quick questions. One thing to fix on your next estimate, with a real example for your trade." },
};
export const dynamic = "force-dynamic";

/**
 * Bid check questionnaire for contractors arriving from Facebook (Page posts, the Comment BID
 * Messenger flow and trade-group posts). Links can carry a campaign id and a trade hint:
 *   /bid-check?trade=painting&utm_source=facebook&utm_medium=group&utm_campaign=bid_check_painters
 * The result is shown before any email is asked for. The 7-day pass uses the Facebook trial invite
 * and stays paused until FB_TRIAL_ENABLED=true.
 */
export default async function BidCheckPage({ searchParams }: PageProps<"/bid-check">) {
  const arrival = parseArrival(await searchParams);
  const user = await getUser();
  return (
    <div className="app-theme flex min-h-screen flex-col bg-paper text-ink">
      <AccountThemeScript pref={user?.theme} />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-1">
            {user ? <Link href="/dashboard" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-black/5">Dashboard</Link> : null}
            <ThemeToggle signedIn={Boolean(user)} account={user?.theme ?? null} />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1 px-4 pb-16 pt-6 sm:pt-10">
        <BidCheck arrival={arrival} invitesOpen={trialConfig().enabled} signedIn={Boolean(user)} />
      </main>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        Built2Bid · <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link>
      </footer>
    </div>
  );
}
