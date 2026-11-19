"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/sales", label: "Overview" },
  { href: "/sales/leads", label: "Leads" },
  { href: "/sales/customers", label: "Customers" },
  { href: "/sales/commissions", label: "Commissions" },
];

export function PortalNav() {
  const path = usePathname();
  return (
    <nav aria-label="Sales portal" className="flex gap-1 overflow-x-auto text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/sales" ? path === "/sales" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-md px-3 py-2 font-semibold", active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white")}>{l.label}</Link>
        );
      })}
    </nav>
  );
}
