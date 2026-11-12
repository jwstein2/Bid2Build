"use client";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export function MobileNav({ items, signedIn }: { items: { href: string; label: string }[]; signedIn: boolean }) {
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
              {signedIn ? "Dashboard" : "Log in"}
            </Link>
            <Link href="/bids" onClick={() => setOpen(false)} className="mt-3 rounded-lg bg-accent py-3 text-center font-semibold text-navy">Create a free bid</Link>
          </nav>
        </div>
      )}
    </div>
  );
}
