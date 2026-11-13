"use client";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import type { Cta } from "@/lib/account/status";

export function MobileNav({ items, signedIn, primary, badge }: { items: { href: string; label: string }[]; signedIn: boolean; primary: Cta; badge: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)} className="grid h-11 w-11 place-items-center rounded-md hover:bg-black/5">
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-16 border-b border-line bg-surface px-4 pb-4 shadow-lg">
          <nav aria-label="Mobile" className="flex flex-col">
            {items.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="border-b border-line py-3 font-medium">{n.label}</Link>
            ))}
            <Link href={signedIn ? "/dashboard" : "/login"} onClick={() => setOpen(false)} className="border-b border-line py-3 font-medium">
              {signedIn ? "My Bids" : "Log in"}
            </Link>
            {badge && <p className="pt-3 text-center text-sm text-ink-soft" data-testid="credit-badge-mobile">{badge}</p>}
            <Link href={primary.href} onClick={() => setOpen(false)} data-cta={primary.action} className="mt-3 rounded-lg bg-accent py-3 text-center font-semibold text-navy">{primary.label}</Link>
          </nav>
        </div>
      )}
    </div>
  );
}
