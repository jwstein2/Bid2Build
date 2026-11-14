"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CreditCard, FileText, LayoutDashboard, Library, Menu, Settings, Shield, Building2, Users, Plug, LayoutTemplate, LogOut, X, UserCog, Receipt } from "lucide-react";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "./logo";
import { PremiumDiamond } from "../billing/premium";
import { ReplayTourButton } from "../onboarding/replay-tour-button";

const nav: { href: string; label: string; icon: typeof Library; exact?: boolean; premium?: boolean }[] = [
  { href: "/dashboard", label: "Bids", icon: LayoutDashboard, exact: true },
  // Directly below Bids: contractors set this up first and their proposals depend on it.
  { href: "/settings/company", label: "Company profile", icon: Building2 },
  { href: "/dashboard/customers", label: "Saved customers", icon: Users },
  { href: "/dashboard/items", label: "Saved Items & Pricing", icon: Library, premium: true },
  { href: "/dashboard/templates", label: "Proposal Templates", icon: LayoutTemplate, premium: true },
  { href: "/settings/billing", label: "Subscription", icon: CreditCard },
  { href: "/settings/pricing", label: "Pricing data", icon: Plug },
  { href: "/settings/account", label: "Account settings", icon: Settings },
];

const item = "flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors md:min-h-10";

/**
 * Navy account sidebar. Desktop: always-visible vertical list. Mobile: a compact top bar
 * (logo, New bid, Menu) whose menu opens the same list, so content starts near the top of the screen.
 */
/** Enterprise company links, chosen on the server from the member's permissions. */
export type CompanyNav = { name: string; links: { href: "/company/users" | "/company/billing"; label: string }[] };
const COMPANY_ICONS = { "/company/users": UserCog, "/company/billing": Receipt } as const;

export function AppSidebar({ isAdmin, email, company }: { isAdmin: boolean; email: string | null; company?: CompanyNav | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile menu after navigating
  useEffect(() => { setOpen(false); }, [path]);
  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const current = nav.find((n) => active(n.href, n.exact)) ?? company?.links.find((l) => active(l.href));
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 py-3 sm:px-4 md:py-4">
        <Logo tone="dark" href="/dashboard" />
        <div className="flex items-center gap-1 md:hidden">
          <ButtonLink href="/bids" variant="accent" size="sm" className="min-h-11 max-[380px]:px-2.5"><FileText className="h-4 w-4 max-[380px]:hidden" aria-hidden /> New bid</ButtonLink>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="account-nav"
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="max-[380px]:sr-only">{open ? "Close" : "Menu"}</span>
          </button>
        </div>
      </div>
      <div className="hidden px-3 md:block"><ButtonLink href="/bids" variant="accent" className="w-full"><FileText className="h-4 w-4" aria-hidden /> Create New Bid</ButtonLink></div>
      {!open && current && <p className="flex items-center gap-1.5 px-4 pb-2 text-xs text-[#B8C6D4] md:hidden">{current.label}{"premium" in current && current.premium && <PremiumDiamond tone="dark" />}</p>}
      <nav id="account-nav" aria-label="Account" className={cn("flex-col gap-1 px-2 pb-3 md:mt-4 md:flex", open ? "flex" : "hidden")}>
        {nav.map((n) => {
          const on = active(n.href, n.exact);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
              <n.icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {n.label}
              {n.premium && <PremiumDiamond tone="dark" className="ml-auto pl-2" />}
            </Link>
          );
        })}
        {company && company.links.length > 0 && (
          <>
            <p className="mt-3 truncate px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" title={company.name}>Company · {company.name}</p>
            {company.links.map((l) => {
              const on = active(l.href);
              const Icon = COMPANY_ICONS[l.href];
              return (
                <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
                  <Icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {l.label}
                </Link>
              );
            })}
          </>
        )}
        <p className="mt-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]">Help</p>
        <ReplayTourButton className={cn(item, "w-full text-left text-[#C9D6E3] hover:bg-white/5 hover:text-white")} />
        {isAdmin && (
          <Link href="/admin" className={cn(item, "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}><Shield className="h-4 w-4" aria-hidden /> Admin</Link>
        )}
        <form action="/auth/signout" method="post">
          <button className={cn(item, "w-full text-[#C9D6E3] hover:bg-white/5 hover:text-white")}><LogOut className="h-4 w-4" aria-hidden /> Sign out</button>
        </form>
        {email && <p className="truncate px-3 pt-2 text-xs text-[#B8C6D4] md:hidden">{email}</p>}
      </nav>
      <p className="mt-auto hidden truncate border-t border-white/10 px-5 py-4 text-xs text-[#B8C6D4] md:block">{email}</p>
    </>
  );
}
