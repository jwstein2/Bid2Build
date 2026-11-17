"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { REVEAL_FEATURE_EVENT } from "@/lib/features/state";
import { Sparkles, CreditCard, FileText, LayoutDashboard, Library, Menu, Settings, Shield, Building2, Users, Plug, LayoutTemplate, LogOut, X, UserCog, Receipt, Gauge, SquareKanban, CalendarRange, GraduationCap, Palette, Landmark, Shapes, Bot } from "lucide-react";
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
  { href: "/dashboard/customers", label: "Customers", icon: Users },
  { href: "/dashboard/items", label: "Saved Items & Pricing", icon: Library, premium: true, feature: "library" },
  { href: "/dashboard/templates", label: "Proposal Templates", icon: LayoutTemplate, premium: true, feature: "templates" },
];
/** Personal account links, listed after the Company section. */
const ACCOUNT_NAV: NavItem[] = [
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
export type CompanyHref = "/company" | "/company/pipeline" | "/company/users" | "/company/billing" | "/company/proposal-style";
export type CompanyNav = { name: string; links: { href: CompanyHref; label: string }[] };
const COMPANY_ICONS = { "/company": Gauge, "/company/pipeline": SquareKanban, "/company/users": UserCog, "/company/billing": Receipt, "/company/proposal-style": Palette } as const;
const companyExact = (href: CompanyHref) => href === "/company";

/** Invitation-only Creator Partner Program links (only rendered for creators / gifted participants). */
export type LearningNav = { creator: boolean; participant: boolean };

/**
 * Company section: shown to every account. Company profile (the business details on every proposal) is
 * its first entry on every plan; Enterprise links follow only when the member's permissions allow them.
 */
const COMPANY_PROFILE: NavItem = { href: "/settings/company", label: "Company profile", icon: Building2 };

/** Financials (NEXT_PUBLIC_FINANCIALS=on only): its own "Know Your Numbers" group, plus two Company settings pages. */
const FINANCIALS: NavItem = { href: "/financials", label: "Financials", icon: Landmark };
const FIN_SETTINGS: NavItem[] = [
  { href: "/company/business-config", label: "Business & trades", icon: Shapes },
  { href: "/company/ai-automation", label: "AI & Automation", icon: Bot },
];

/** Projects (schedules) sit right below Bids when project scheduling is switched on. */
const PROJECTS: NavItem = { href: "/projects", label: "Projects", icon: CalendarRange };

export function AppSidebar({ isAdmin, email, company, projects = false, financials = false, theme = null, learning }: { isAdmin: boolean; email: string | null; company?: CompanyNav | null; projects?: boolean; financials?: boolean; theme?: ThemePref | null; learning?: LearningNav | null }) {
  // In a company, say whose bids and whose subscription each link is ("Team bids" is in the Company section).
  const own = (n: NavItem): NavItem => (!company ? n : n.href === "/dashboard" ? { ...n, label: "My bids" } : n.href === "/settings/billing" ? { ...n, label: "My subscription" } : n);
  const work: NavItem[] = (projects ? [NAV[0], PROJECTS, ...NAV.slice(1)] : NAV).map(own);
  const nav: NavItem[] = [...work, ...(financials ? [FINANCIALS, ...FIN_SETTINGS] : []), ...ACCOUNT_NAV.map(own)];
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
  // Escape closes the phone menu and puts focus back on the Menu button.
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.matchMedia("(max-width: 767px)").matches) { setOpen(false); menuButton.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const current = nav.find((n) => active(n.href, n.exact)) ?? (active(COMPANY_PROFILE.href) ? COMPANY_PROFILE : undefined) ?? company?.links.find((l) => active(l.href, companyExact(l.href)));
  const link = (n: NavItem) => {
    const on = active(n.href, n.exact);
    return (
      <Link key={n.href} href={n.href} data-feature={n.feature} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
        <n.icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {n.label}
        {n.premium && <PremiumDiamond tone="dark" className="ml-auto pl-2" />}
      </Link>
    );
  };
  return (
    <>
      <div className="flex items-center justify-between gap-1 px-3 py-3 sm:gap-2 sm:px-4 md:py-4">
        <Logo tone="dark" href="/dashboard" />
        <div className="flex items-center gap-1 max-[380px]:gap-0 md:hidden">
          <ButtonLink href="/bids" variant="accent" size="sm" className="min-h-11 max-[380px]:px-2.5"><FileText className="h-4 w-4 max-[380px]:hidden" aria-hidden /> New bid</ButtonLink>
          <ThemeToggle signedIn account={theme} tone="dark" />
          <button
            ref={menuButton}
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
      <nav id="account-nav" aria-label="Account" className={cn("flex-col gap-1 px-2 pb-3 md:mt-4 md:flex", open ? "flex max-md:motion-drop-in" : "hidden")}>
        {work.map(link)}
        {financials && (
          <>
            <p className="mt-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" data-testid="nav-numbers-heading">Know Your Numbers</p>
            {link(FINANCIALS)}
          </>
        )}
        <p className="mt-3 truncate px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" title={company?.name} data-testid="nav-company-heading">{company ? `Company · ${company.name}` : "Company"}</p>
        <Link href={COMPANY_PROFILE.href} aria-current={active(COMPANY_PROFILE.href) ? "page" : undefined} data-testid="nav-company-profile" className={cn(item, active(COMPANY_PROFILE.href) ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
          <Building2 className={cn("h-4 w-4", active(COMPANY_PROFILE.href) ? "text-cyan" : "")} aria-hidden /> {COMPANY_PROFILE.label}
        </Link>
        {financials && FIN_SETTINGS.map(link)}
        {company?.links.map((l) => {
          const on = active(l.href, companyExact(l.href));
          const Icon = COMPANY_ICONS[l.href];
          return (
            <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
              <Icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {l.label}
            </Link>
          );
        })}
        <p className="mt-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]">Account</p>
        {ACCOUNT_NAV.map(own).map(link)}
        {learning && (learning.creator || learning.participant) && (
          <>
            {learning.creator && (
              <Link href="/learning" aria-current={active("/learning") ? "page" : undefined} className={cn(item, active("/learning") ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
                <GraduationCap className={cn("h-4 w-4", active("/learning") ? "text-cyan" : "")} aria-hidden /> Learning Enterprise
              </Link>
            )}
            {learning.participant && (
              <Link href="/mentorship" aria-current={active("/mentorship") ? "page" : undefined} className={cn(item, active("/mentorship") ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
                <GraduationCap className={cn("h-4 w-4", active("/mentorship") ? "text-cyan" : "")} aria-hidden /> Mentorship
              </Link>
            )}
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
