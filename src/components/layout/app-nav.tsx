"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { REVEAL_FEATURE_EVENT } from "@/lib/features/state";
import { Sparkles, CreditCard, FileText, LayoutDashboard, Library, Menu, Settings, Shield, Building2, Users, Plug, LayoutTemplate, LogOut, X, UserCog, Receipt, Gauge, SquareKanban, CalendarRange } from "lucide-react";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "./logo";
import { PremiumDiamond } from "../billing/premium";
import { ReplayTourButton } from "../onboarding/replay-tour-button";
import { FeatureTourButton } from "../features/tour-buttons";
import type { FeatureId } from "@/lib/features/registry";
import type { ThemePref } from "@/lib/theme";
import { ThemeToggle } from "../theme/theme-toggle";

type NavItem = { href: string; label: string; icon: typeof Library; exact?: boolean; premium?: boolean; feature?: FeatureId };
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Bids", icon: LayoutDashboard, exact: true },
  // Directly below Bids: contractors set this up first and their proposals depend on it.
  { href: "/settings/company", label: "Company profile", icon: Building2 },
  { href: "/dashboard/customers", label: "Saved customers", icon: Users },
  { href: "/dashboard/items", label: "Saved Items & Pricing", icon: Library, premium: true, feature: "library" },
  { href: "/dashboard/templates", label: "Proposal Templates", icon: LayoutTemplate, premium: true, feature: "templates" },
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
export type CompanyHref = "/company" | "/company/pipeline" | "/company/users" | "/company/billing";
export type CompanyNav = { name: string; links: { href: CompanyHref; label: string }[] };
const COMPANY_ICONS = { "/company": Gauge, "/company/pipeline": SquareKanban, "/company/users": UserCog, "/company/billing": Receipt } as const;
const companyExact = (href: CompanyHref) => href === "/company";

/** Projects (schedules) sit right below Bids when project scheduling is switched on. */
const PROJECTS: NavItem = { href: "/projects", label: "Projects", icon: CalendarRange };

export function AppSidebar({ isAdmin, email, company, projects = false, theme = null }: { isAdmin: boolean; email: string | null; company?: CompanyNav | null; projects?: boolean; theme?: ThemePref | null }) {
  const nav: NavItem[] = projects ? [NAV[0], PROJECTS, ...NAV.slice(1)] : NAV;
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile menu after navigating
  useEffect(() => { setOpen(false); }, [path]);
  // On phones the links are inside the Menu: the feature walkthrough opens it for a step that points
  // at a sidebar link (Saved Items, Templates) and closes it again when the walkthrough ends.
  const openedForTour = useRef(false);
  const isOpen = useRef(open);
  useEffect(() => { isOpen.current = open; }, [open]);
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent).detail as string | null;
      if (id && NAV.some((n) => n.feature === id)) {
        if (!isOpen.current) { openedForTour.current = true; setOpen(true); }
      } else if (openedForTour.current) {
        openedForTour.current = false;
        setOpen(false);
      }
    };
    window.addEventListener(REVEAL_FEATURE_EVENT, on);
    return () => window.removeEventListener(REVEAL_FEATURE_EVENT, on);
  }, []);
  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const current = nav.find((n) => active(n.href, n.exact)) ?? company?.links.find((l) => active(l.href, companyExact(l.href)));
  return (
    <>
      <div className="flex items-center justify-between gap-1 px-3 py-3 sm:gap-2 sm:px-4 md:py-4">
        <Logo tone="dark" href="/dashboard" />
        <div className="flex items-center gap-1 max-[380px]:gap-0 md:hidden">
          <ButtonLink href="/bids" variant="accent" size="sm" className="min-h-11 max-[380px]:px-2.5"><FileText className="h-4 w-4 max-[380px]:hidden" aria-hidden /> New bid</ButtonLink>
          <ThemeToggle signedIn account={theme} tone="dark" />
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
            <Link key={n.href} href={n.href} data-feature={n.feature} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
              <n.icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {n.label}
              {n.premium && <PremiumDiamond tone="dark" className="ml-auto pl-2" />}
            </Link>
          );
        })}
        {company && company.links.length > 0 && (
          <>
            <p className="mt-3 truncate px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" title={company.name}>Company · {company.name}</p>
            {company.links.map((l) => {
              const on = active(l.href, companyExact(l.href));
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
        <FeatureTourButton className={cn(item, "w-full text-left text-[#C9D6E3] hover:bg-white/5 hover:text-white")} />
        <Link href="/whats-new" aria-current={active("/whats-new") ? "page" : undefined} className={cn(item, active("/whats-new") ? "bg-white/10 text-white" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")} data-testid="nav-whats-new"><Sparkles className="h-4 w-4" aria-hidden /> What&apos;s New</Link>
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
