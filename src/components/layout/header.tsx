import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
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
  const user = await getUser();
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/90 backdrop-blur no-print">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-black/5 hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <ButtonLink href="/dashboard" variant="secondary" size="sm">Dashboard</ButtonLink>
          ) : (
            <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink">Log in</Link>
          )}
          <ButtonLink href="/bids" variant="accent" size="sm">Start a Bid</ButtonLink>
        </div>
        <MobileNav items={nav} signedIn={Boolean(user)} />
      </div>
    </header>
  );
}
