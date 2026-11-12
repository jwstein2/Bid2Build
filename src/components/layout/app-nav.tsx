"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, LayoutDashboard, Library, Settings, Shield, Building2, Users, Plug, LayoutTemplate, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";

const nav = [
  { href: "/dashboard", label: "Bids", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/customers", label: "Saved customers", icon: Users },
  { href: "/dashboard/items", label: "Saved cost items", icon: Library },
  { href: "/dashboard/templates", label: "Proposal templates", icon: LayoutTemplate },
  { href: "/settings/company", label: "Company profile", icon: Building2 },
  { href: "/settings/billing", label: "Subscription", icon: CreditCard },
  { href: "/settings/pricing", label: "Pricing data", icon: Plug },
  { href: "/settings/account", label: "Account settings", icon: Settings },
];

const item = "flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors";

/** Account navigation for the navy sidebar. Marks the current page with aria-current. */
export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Account" className="mt-4 flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
      {nav.map((n) => {
        const on = active(n.href, n.exact);
        return (
          <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
            <n.icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {n.label}
          </Link>
        );
      })}
      {isAdmin && (
        <Link href="/admin" className={cn(item, "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}><Shield className="h-4 w-4" aria-hidden /> Admin</Link>
      )}
      <form action="/auth/signout" method="post">
        <button className={cn(item, "w-full text-[#C9D6E3] hover:bg-white/5 hover:text-white")}><LogOut className="h-4 w-4" aria-hidden /> Sign out</button>
      </form>
    </nav>
  );
}
