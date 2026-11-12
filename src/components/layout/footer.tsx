import Link from "next/link";
import { featuredTrades } from "@/lib/trades/catalog";
import { site } from "@/lib/site";
import { Logo } from "./logo";

export function Footer() {
  return (
    <footer className="on-dark mt-auto bg-navy text-white no-print">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <Logo tone="dark" />
          <p className="mt-4 font-display text-sm font-semibold text-white">{site.tagline}</p>
          <p className="mt-2 text-sm text-[#B8C6D4]">Estimates and proposals for contractors. 3 free bids to start, plus 1 every month. No credit card.</p>
        </div>
        <FooterCol title="Popular trades">
          {featuredTrades.slice(0, 6).map((t) => (
            <li key={t.slug}><Link href={`/bids/${t.slug}`} className="hover:text-white hover:underline">{t.seoTitle}</Link></li>
          ))}
        </FooterCol>
        <FooterCol title="Product">
          <li><Link href="/bids" className="hover:text-white hover:underline">All trades</Link></li>
          <li><Link href="/#how-it-works" className="hover:text-white hover:underline">How it works</Link></li>
          <li><Link href="/pricing" className="hover:text-white hover:underline">Pricing</Link></li>
          <li><Link href="/learn" className="hover:text-white hover:underline">Contractor guides</Link></li>
          <li><Link href="/dashboard" className="hover:text-white hover:underline">Your bids</Link></li>
        </FooterCol>
        <FooterCol title="Support">
          <li><a href={`mailto:${site.supportEmail}`} className="hover:text-white hover:underline">Contact support</a></li>
          <li><Link href="/privacy" className="hover:text-white hover:underline">Privacy policy</Link></li>
          <li><Link href="/terms" className="hover:text-white hover:underline">Terms of service</Link></li>
        </FooterCol>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-[#B8C6D4]">© {new Date().getFullYear()} {site.name}. All rights reserved.</div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-cyan">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm text-[#D5DFE9]">{children}</ul>
    </div>
  );
}
