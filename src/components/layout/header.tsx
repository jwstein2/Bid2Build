import Link from "next/link";
import { getAccountStatus } from "@/lib/account/server";
import { accountCtas, creditBadge } from "@/lib/account/status";
import { ButtonLink } from "../ui/button";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";

const nav = [
  { href: "/bids", label: "Trades" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/learn", label: "Learn" },
];

export async function Header() {
  const status = await getAccountStatus();
  const { primary } = accountCtas(status);
  const badge = creditBadge(status);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur no-print">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-brand-tint hover:text-navy">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {badge && <Link href="/settings/billing" data-testid="credit-badge" className="hidden whitespace-nowrap rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-navy lg:inline-block">{badge}</Link>}
          {status.signedIn ? (
            <ButtonLink href="/dashboard" variant="secondary" size="sm" data-cta="bids">My Bids</ButtonLink>
          ) : (
            <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">Log in</Link>
          )}
          <ButtonLink href={primary.href} variant="accent" size="sm" data-cta={primary.action}>{primary.label}</ButtonLink>
        </div>
        <MobileNav items={nav} signedIn={status.signedIn} primary={primary} badge={badge} />
      </div>
    </header>
  );
}
