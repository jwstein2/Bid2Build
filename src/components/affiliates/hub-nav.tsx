"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/affiliate-hub", label: "Dashboard" },
  { href: "/affiliate-hub/calendar", label: "Calendar" },
  { href: "/affiliate-hub/earnings", label: "Earnings" },
  { href: "/affiliate-hub/customers", label: "Portfolio" },
  { href: "/affiliate-hub/resources", label: "Resources" },
  { href: "/affiliate-hub/profile", label: "Profile & payouts" },
];

export function HubNav({ setupOnly }: { setupOnly: boolean }) {
  const path = usePathname();
  const items = setupOnly ? [{ href: "/affiliate-hub/onboarding", label: "Setup" }] : ITEMS;
  return (
    <nav aria-label="Affiliate Hub" className="-mx-1 flex gap-1 overflow-x-auto">
      {items.map((i) => {
        const on = i.href === "/affiliate-hub" ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={cn("inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold", on ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white")}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
