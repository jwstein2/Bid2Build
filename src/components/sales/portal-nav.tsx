"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const MY_LINKS = [
  { href: "/sales", label: "Overview" },
  { href: "/sales/leads", label: "Leads" },
  { href: "/sales/business", label: "My Business" },
  { href: "/sales/customers", label: "Customers" },
  { href: "/sales/calendar", label: "Calendar" },
  { href: "/sales/commissions", label: "Commissions" },
  { href: "/sales/rewards", label: "Rewards" },
  { href: "/sales/academy", label: "Academy" },
  { href: "/sales/preferences", label: "My preferences" },
  { href: "/sales/how-you-get-paid", label: "How you get paid" },
];

const item = (active: boolean) => cn("whitespace-nowrap rounded-md px-3 py-2 font-semibold", active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white");

/** Navigation follows the current view: personal pages in My Sales Hub, team sections in Admin Sales Hub. */
export function PortalNav({ adminTabs }: { adminTabs: { id: string; label: string }[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  if (path.startsWith("/sales/admin")) {
    const tab = path.startsWith("/sales/admin/reps") ? "analytics" : sp.get("tab") ?? "overview";
    return (
      <nav aria-label="Admin Sales Hub" className="flex gap-1 overflow-x-auto text-sm">
        {adminTabs.map((t) => (
          <Link key={t.id} href={t.id === "overview" ? "/sales/admin" : `/sales/admin?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} className={item(tab === t.id)}>{t.label}</Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="My Sales Hub" className="flex gap-1 overflow-x-auto text-sm">
      {MY_LINKS.map((l) => {
        const active = l.href === "/sales" ? path === "/sales" : path.startsWith(l.href);
        return <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={item(active)}>{l.label}</Link>;
      })}
    </nav>
  );
}
