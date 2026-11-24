"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { REVEAL_FEATURE_EVENT, START_TOUR_EVENT } from "@/lib/features/state";
import { CreditCard, FileText, LayoutDashboard, Library, Menu, Settings, Shield, Building2, Users, HardHat, LayoutTemplate, LogOut, ArrowLeftRight, X, UserCog, Clock, Receipt, Gauge, SquareKanban, CalendarRange, GraduationCap, Palette, Landmark, Shapes, Bot, House, Newspaper, ChevronDown, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "./logo";
import { PremiumDiamond } from "../billing/premium";
import { OPEN_GUIDE_EVENT } from "../guide/client";
import type { FeatureId } from "@/lib/features/registry";
import type { ThemePref } from "@/lib/theme";
import { ThemeToggle } from "../theme/theme-toggle";
import { SearchIconButton } from "../search/global-search";
import { DemoNavItem, PracticeNavToggle } from "../demo/demo-controls";
import { inPracticeScope } from "@/lib/demo/scope";
import type { DemoSessionKind } from "@/lib/demo/session";

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
/** V7.3: Contractors & Workforce sits right under Projects (PM Hub). It replaced the retired "Pricing data" link. */
const WORKFORCE: NavItem = { href: "/projects/workforce", label: "Contractors & Workforce", icon: HardHat };
const HOME: NavItem = { href: "/home", label: "Home", icon: House, exact: true };
/** V8.2: employees linked to a Staff entry get the time clock right under Home. */
const CLOCK: NavItem = { href: "/clock", label: "My work", icon: Clock };
/** V6.8 Industry Intelligence: free for every plan. */
const INDUSTRY: NavItem = { href: "/industry", label: "Industry News", icon: Newspaper };

/** V6.7 workspace access: links this company member can't use, and features kept from a workspace that is off. */
export type SidebarAccess = { hidden: string[]; other: { href: string; label: string }[] };

/** V8.10 workspace switches ("Switch to Sales Hub"), chosen on the server from the person's permissions. */
export type WorkspaceSwitch = { href: string; label: string };

/** Links a brand-new solo account sees up front (2026-11-22 simpler menu). Everything else is under "More tools". */
export const ESSENTIAL_HREFS = new Set(["/home", "/clock", "/dashboard", "/dashboard/customers", "/dashboard/items", "/dashboard/templates"]);
const MORE_KEY = "b2b:nav-more-open";

export function AppSidebar({ essentials = false, isAdmin, email, company, access = null, projects = false, clock = false, financials = false, home = false, theme = null, learning, switches = [], bell = null, practice = false, demo = null }: { /** New solo account: show the essentials and fold the rest under "More tools". */ essentials?: boolean; isAdmin: boolean; /** Practice Mode switch in the Help section (on for everyone unless PRACTICE_MODE=off). */ practice?: boolean; /** Active demo / practice session, if any. */ demo?: DemoSessionKind | null; email: string | null; company?: CompanyNav | null; access?: SidebarAccess | null; projects?: boolean; clock?: boolean; financials?: boolean; home?: boolean; theme?: ThemePref | null; learning?: LearningNav | null; switches?: WorkspaceSwitch[]; /** Phone top bar notifications (the desktop copy sits in the page header). */ bell?: ReactNode }) {
  // In a company, say whose bids and whose subscription each link is ("Team bids" is in the Company section).
  const own = (n: NavItem): NavItem => (!company ? n : n.href === "/dashboard" ? { ...n, label: "My bids" } : n.href === "/settings/billing" ? { ...n, label: "My subscription" } : n);
  const shown = (href: string) => !access?.hidden.includes(href);
  const work: NavItem[] = [...(home ? [HOME] : []), ...(projects && clock ? [CLOCK] : []), ...(projects ? [NAV[0], PROJECTS, WORKFORCE, ...NAV.slice(1)] : NAV)].map(own).filter((n) => shown(n.href));
  const finLinks = financials && shown(FINANCIALS.href);
  const finSettings = financials ? FIN_SETTINGS.filter((n) => shown(n.href)) : [];
  const companyLinks = company?.links.filter((l) => shown(l.href)) ?? [];
  const other: NavItem[] = (access?.other ?? []).map((o) => ({ href: o.href, label: o.label, icon: Shapes, exact: o.href === "/dashboard" || o.href === "/company" }));
  const nav: NavItem[] = [...work, INDUSTRY, ...(finLinks ? [FINANCIALS] : []), ...finSettings, ...other, ...ACCOUNT_NAV.map(own)];
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // "More tools" (essentials menu only): remembered per browser; opens by itself on a page that lives in it.
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the remembered choice after hydration
    try { if (window.localStorage.getItem(MORE_KEY) === "1") setMoreOpen(true); } catch { /* storage blocked */ }
  }, []);
  const toggleMore = () => setMoreOpen((v) => { try { window.localStorage.setItem(MORE_KEY, v ? "0" : "1"); } catch { /* storage blocked */ } return !v; });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile menu after navigating
  useEffect(() => { setOpen(false); }, [path]);
  // On phones the links are inside the Menu. Starting a walkthrough from it closes it so the page it
  // teaches is visible. A feature announcement step that points at a sidebar link (Saved Items,
  // Templates) opens it for that step only and closes it again afterwards.
  const openedForTour = useRef(false);
  const isOpen = useRef(open);
  useEffect(() => { isOpen.current = open; }, [open]);
  useEffect(() => {
    const onStart = () => { openedForTour.current = false; setOpen(false); };
    const on = (e: Event) => {
      const key = (e as CustomEvent).detail as string | null;
      if (key && NAV.some((n) => n.feature && key === `feature:${n.feature}`)) {
        if (!isOpen.current) { openedForTour.current = true; setOpen(true); }
      } else if (openedForTour.current) {
        openedForTour.current = false;
        setOpen(false);
      }
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    window.addEventListener(REVEAL_FEATURE_EVENT, on);
    return () => { window.removeEventListener(START_TOUR_EVENT, onStart); window.removeEventListener(REVEAL_FEATURE_EVENT, on); };
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
  const current = nav.find((n) => active(n.href, n.exact)) ?? (active(COMPANY_PROFILE.href) ? COMPANY_PROFILE : undefined) ?? companyLinks.find((l) => active(l.href, companyExact(l.href)));
  const primary = essentials ? work.filter((n) => ESSENTIAL_HREFS.has(n.href)) : work;
  const moreItems: NavItem[] = essentials ? [...work.filter((n) => !ESSENTIAL_HREFS.has(n.href)), ...(finLinks ? [FINANCIALS] : []), ...finSettings] : [];
  const showMore = moreOpen || moreItems.some((n) => active(n.href, n.exact));
  const link = (n: NavItem, wrap = false) => {
    const on = active(n.href, n.exact);
    return (
      <Link key={n.href} href={n.href} data-feature={n.feature} aria-current={on ? "page" : undefined} className={cn(item, wrap && "whitespace-normal", on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
        <n.icon className={cn("h-4 w-4 shrink-0", on ? "text-cyan" : "")} aria-hidden /> {n.label}
        {n.premium && <PremiumDiamond tone="dark" className="ml-auto pl-2" />}
      </Link>
    );
  };
  return (
    <>
      <div className="flex items-center justify-between gap-1 px-3 py-3 max-[359px]:px-2 sm:gap-2 sm:px-4 md:py-4">
        <Logo tone="dark" href={home ? "/home" : "/dashboard"} />
        <div className="flex items-center gap-1 max-[380px]:gap-0 md:hidden">
          <ButtonLink href="/new-bid" variant="accent" size="sm" className="min-h-11 max-[380px]:px-2.5 max-[359px]:min-w-11 max-[359px]:px-0" data-guide="bids.new-bid" aria-label="New bid">
            <FileText className="h-4 w-4 max-[440px]:hidden max-[359px]:block" aria-hidden /><span className="max-[359px]:sr-only">New bid</span>
          </ButtonLink>
          <SearchIconButton tone="dark" />
          {bell}
          {/* With notifications on, the phone bar has no room for the theme switch: it moves to the top of the Menu. */}
          <ThemeToggle signedIn account={theme} tone="dark" className={bell ? "hidden" : undefined} />
          <button
            ref={menuButton}
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="account-nav"
            className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="max-[440px]:sr-only">{open ? "Close" : "Menu"}</span>
          </button>
        </div>
      </div>
      <div className="hidden px-3 md:block"><ButtonLink href="/new-bid" variant="accent" className="w-full"><FileText className="h-4 w-4" aria-hidden /> Create New Bid</ButtonLink></div>
      {/* Phone "you are here" label; Home's own heading already says it, so it is left out there. */}
      {!open && current && current.href !== "/home" && <p className="flex items-center gap-1.5 px-4 pb-2 text-xs text-[#B8C6D4] md:hidden" data-testid="nav-current">{current.label}{"premium" in current && current.premium && <PremiumDiamond tone="dark" />}</p>}
      <nav id="account-nav" aria-label="Account" className={cn("flex-col gap-1 px-2 pb-3 md:mt-4 md:flex", open ? "flex max-md:motion-drop-in" : "hidden")}>
        {bell && <ThemeToggle signedIn account={theme} tone="dark" label className={cn(item, "w-full justify-start text-[#C9D6E3] hover:text-white md:hidden")} />}
        {primary.map((n) => link(n))}
        {essentials && moreItems.length > 0 && (
          <>
            <button type="button" onClick={toggleMore} aria-expanded={showMore} aria-controls="nav-more" data-testid="nav-more-toggle"
              className={cn(item, "w-full text-left text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", showMore ? "rotate-180" : "")} aria-hidden />
              <span className="flex-1">{showMore ? "Fewer tools" : "More tools"}</span>
              {!showMore && <span className="text-[11px] text-[#B8C6D4]">{moreItems.length}</span>}
            </button>
            {showMore && (
              <div id="nav-more" className="flex flex-col gap-1" data-testid="nav-more">
                <p className="px-3 pb-1 text-xs text-[#B8C6D4]">Scheduling, crews, financials and more. They&apos;re here whenever you need them.</p>
                {moreItems.map((n) => link(n))}
              </div>
            )}
          </>
        )}
        {!essentials && finLinks && (
          <>
            <p className="mt-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" data-testid="nav-numbers-heading">Know Your Numbers</p>
            {link(FINANCIALS)}
          </>
        )}
        {other.length > 0 && (
          <>
            <p className="mt-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" data-testid="nav-other-heading">Other access</p>
            {other.map((n) => link(n, true))}
          </>
        )}
        <p className="mt-3 truncate px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]" title={company?.name} data-testid="nav-company-heading">{company ? `Company · ${company.name}` : "Company"}</p>
        <Link href={COMPANY_PROFILE.href} aria-current={active(COMPANY_PROFILE.href) ? "page" : undefined} data-testid="nav-company-profile" className={cn(item, active(COMPANY_PROFILE.href) ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
          <Building2 className={cn("h-4 w-4", active(COMPANY_PROFILE.href) ? "text-cyan" : "")} aria-hidden /> {COMPANY_PROFILE.label}
        </Link>
        {!essentials && finSettings.map((n) => link(n))}
        {companyLinks.map((l) => {
          const on = active(l.href, companyExact(l.href));
          const Icon = COMPANY_ICONS[l.href];
          return (
            <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
              <Icon className={cn("h-4 w-4", on ? "text-cyan" : "")} aria-hidden /> {l.label}
            </Link>
          );
        })}
        <p className="mt-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8C6D4]">Account</p>
        {/* A full page load (not client navigation): unsaved-change warnings fire, and no contractor-app state carries into the Sales Hub. */}
        {switches.map((w) => (
          <a key={w.href} href={w.href} data-testid="switch-workspace" className={cn(item, "text-[#C9D6E3] hover:bg-white/5 hover:text-white active:scale-[0.98] motion-safe:transition")}>
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-cyan" aria-hidden /> {w.label}
          </a>
        ))}
        {ACCOUNT_NAV.map(own).map((n) => link(n))}
        {learning && (learning.creator || learning.participant) && (
          <>
            {learning.creator && (
              <Link href="/learning" aria-current={active("/learning") ? "page" : undefined} className={cn(item, active("/learning") ? "bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-cyan)]" : "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
                <GraduationCap className={cn("h-4 w-4", active("/learning") ? "text-cyan" : "")} aria-hidden /> Learning Team
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
        {/* One way in to help (2026-11-22): the Help panel holds the page walkthrough, tours, the getting
            started checklist and tour, search, the Academy, What's New and Contact support. */}
        <button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new Event(OPEN_GUIDE_EVENT)); }} aria-haspopup="dialog" data-testid="nav-help"
          className={cn(item, "w-full text-left text-[#C9D6E3] hover:bg-white/5 hover:text-white")}>
          <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden /> Help &amp; guides
        </button>
        {(practice || demo) && inPracticeScope(path) && <PracticeNavToggle active={demo} className={cn(item, "w-full text-left text-[#C9D6E3] hover:bg-white/5 hover:text-white")} />}
        {isAdmin && !demo && <DemoNavItem className={cn(item, "w-full text-left text-[#C9D6E3] hover:bg-white/5 hover:text-white")} />}
        {isAdmin && (
          <Link href="/admin" className={cn(item, "text-[#C9D6E3] hover:bg-white/5 hover:text-white")}><Shield className="h-4 w-4" aria-hidden /> Admin</Link>
        )}
        <form action="/auth/signout" method="post">
          <button className={cn(item, "w-full text-[#C9D6E3] hover:bg-white/5 hover:text-white")}><LogOut className="h-4 w-4" aria-hidden /> Sign out</button>
        </form>
        {email && <p className="truncate px-3 pt-2 text-xs text-[#B8C6D4] md:hidden">{email}</p>}
      </nav>
      {/* md:pb-20 reserves room under the email for the fixed Guide button, so it never covers Sign out. */}
      <p className="mt-auto hidden truncate border-t border-white/10 px-5 pb-20 pt-4 text-xs text-[#B8C6D4] md:block">{email}</p>
    </>
  );
}
