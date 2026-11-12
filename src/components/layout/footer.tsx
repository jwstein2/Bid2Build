import Link from "next/link";
import { featuredTrades } from "@/lib/trades/catalog";
import { site } from "@/lib/site";
import { Logo } from "./logo";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-surface no-print">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <Logo />
          <p className="mt-3 text-sm text-muted">Professional estimates and proposals for every trade. Three free bids every month.</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Popular trades</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            {featuredTrades.slice(0, 6).map((t) => (
              <li key={t.slug}><Link href={`/bids/${t.slug}`} className="hover:text-ink">{t.seoTitle}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li><Link href="/bids" className="hover:text-ink">All trades</Link></li>
            <li><Link href="/pricing" className="hover:text-ink">Pricing</Link></li>
            <li><Link href="/learn" className="hover:text-ink">Learn</Link></li>
            <li><Link href="/dashboard" className="hover:text-ink">Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li><Link href="/privacy" className="hover:text-ink">Privacy policy</Link></li>
            <li><Link href="/terms" className="hover:text-ink">Terms of service</Link></li>
            <li><a href={`mailto:${site.supportEmail}`} className="hover:text-ink">Contact support</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-5 text-center text-xs text-muted">© {new Date().getFullYear()} {site.name}. All rights reserved.</div>
    </footer>
  );
}
