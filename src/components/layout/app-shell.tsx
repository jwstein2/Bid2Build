import { Suspense } from "react";
import { companyNav, loadMyCompany } from "@/lib/enterprise/server";
import { createClient, type SessionUser } from "@/lib/supabase/server";
import { isFinancialsEnabled, isPmEnabled, isUnifiedHomeEnabled } from "@/lib/env";
import { NO_WORKSPACES, switchLinks } from "@/lib/workspaces";
import { loadWorkspaces } from "@/lib/workspaces-server";
import { AppSidebar } from "@/components/layout/app-nav";
import { FeatureHost } from "@/components/features/feature-host";
import { formatPhone } from "@/lib/auth/phone";
import { loadLearningNav } from "@/lib/creator/nav";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { PremiumAccessProvider } from "@/components/billing/premium";
import { AccountThemeScript } from "@/components/theme/account-theme-script";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationBell } from "@/components/operations/notification-bell";
import { GlobalSearchHost, SearchField } from "@/components/search/global-search";
import { SearchFocus } from "@/components/search/search-focus";
import { StickyBar } from "@/components/layout/sticky-height";
import { loadEffectiveAccess } from "@/lib/access/server";
import { sidebarAccess } from "@/lib/access/nav";
import { DemoBanner } from "@/components/demo/demo-controls";
import { isPracticeEnabled } from "@/lib/demo/server";
import { GuideHost } from "@/components/guide/guide-host";

/**
 * The signed-in contractor app frame: Practice/Demo bar, navy sidebar (phone top bar), and on regular
 * pages the sticky search row plus the Guide / search hosts.
 *
 * `bare` is for the bid builder (/builder, /estimates/[id], /start/[trade]): it keeps the sidebar so a new
 * or open bid stays inside the app, but leaves out the search row and page padding because the builder
 * brings its own sticky header, search, Guide and full-width layout. On phones the navy bar scrolls away
 * there, so the builder's header and steps keep the screen.
 */
export async function AppShell({ user, bare = false, children }: { user: SessionUser; bare?: boolean; children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: isAdmin }, company, premium, learning, access, workspaces, clockRes, wonRes] = await Promise.all([
    supabase.rpc("is_admin", { p_user_id: user.id }), loadMyCompany(supabase), hasPremiumAccess(supabase), loadLearningNav(supabase),
    // V6.7: which workspace links this person sees (company members only; solo accounts and owners see everything).
    loadEffectiveAccess(supabase).catch(() => null),
    // V8.10: "Switch to Sales Hub" in the account menu for sales reps and sales admins.
    loadWorkspaces().catch(() => NO_WORKSPACES),
    // V8.2: "Time clock" in the sidebar for anyone linked to a Staff entry (employees clock in there).
    isPmEnabled() ? supabase.from("pm_resources").select("id").eq("linked_user_id", user.id).eq("kind", "staff").eq("status", "active").limit(1) : Promise.resolve({ data: [] }),
    // 2026-11-22 simpler menu: has this account won a job yet? (One indexed head count.)
    supabase.from("estimates").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("pipeline_stage", ["won", "scheduled", "in_progress", "completed"]),
  ]);
  const clock = ((clockRes.data as unknown[] | null) ?? []).length > 0;
  // New solo accounts start with the essentials (bids, customers, prices, templates); Projects, Workforce,
  // Financials and Industry News sit under "More tools" until the first won job. Companies, admins,
  // practice logins and anyone who already won a job see the full menu.
  const essentials = !company && !isAdmin && !user.demo && !clock && !wonRes.error && (wonRes.count ?? 0) === 0;
  const sidebar = (
    <AppSidebar essentials={essentials} isAdmin={Boolean(isAdmin)} projects={isPmEnabled()} clock={clock} financials={isFinancialsEnabled()} home={isUnifiedHomeEnabled()} company={companyNav(company)} access={sidebarAccess(access)} learning={learning} switches={switchLinks(workspaces, "contractor")} email={user.email ?? (user.phone ? formatPhone(user.phone) : null)} theme={user.theme ?? null} practice={isPracticeEnabled()} demo={user.demo?.kind ?? null} bell={isPmEnabled() ? <NotificationBell only="phone" tone="dark" /> : null} />
  );
  return (
    <PremiumAccessProvider unlocked={premium}>
    <AccountThemeScript pref={user.theme} />
    {/* app-theme: marks a customer app screen, so the Dark Mode tokens (globals.css) apply. */}
    {user.demo && <DemoBanner kind={user.demo.kind} company={company?.name ?? null} />}
    {/* --app-sidebar-w: fixed bars inside a page (the builder's phone/tablet totals bar) start right of the sidebar. */}
    <div className="app-theme flex min-h-screen flex-col md:flex-row md:[--app-sidebar-w:16rem]">
      {bare ? (
        <aside className="on-dark bg-navy text-white md:sticky md:top-[var(--b2b-banner-h)] md:flex md:h-[calc(100vh-var(--b2b-banner-h))] md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:overscroll-contain no-print" data-testid="app-sidebar">
          {sidebar}
        </aside>
      ) : (
        // Phones: the navy top bar (logo, New bid, search, bell, Menu) stays pinned under the Practice/Demo bar
        // while scrolling; an open Menu scrolls inside it. Desktop: the sidebar fills the height left under that bar.
        <StickyBar as="aside" cssVar="--app-topbar-h" media="(max-width: 767.98px)" className="on-dark sticky top-[var(--b2b-banner-h)] z-30 max-h-[calc(100dvh-var(--b2b-banner-h))] overflow-y-auto overscroll-contain bg-navy text-white md:flex md:h-[calc(100vh-var(--b2b-banner-h))] md:max-h-none md:w-64 md:shrink-0 md:flex-col no-print" data-testid="app-sidebar">
          {sidebar}
        </StickyBar>
      )}
      {bare ? (
        // The builder renders its own <main id="main">, header, search, Guide and walkthrough hosts.
        <div className="min-w-0 flex-1">{children}</div>
      ) : (
        <>
          {/* Bottom padding keeps the last controls on every page clear of the fixed Guide button (bottom left). */}
          <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 sm:px-8 md:pt-0">
            {/* Desktop header row: search field, task review notices (V4.3) and the Light/Dark switch, top right. */}
            {/* On phones all three live in the top bar (search icon, bell, theme in the Menu), so this row is desktop only. */}
            {/* Sticky: it stays at the top (under the Practice/Demo bar) while the page scrolls, on a paper backdrop. */}
            <StickyBar cssVar="--app-topbar-h" media="(min-width: 768px)" className="sticky top-[var(--b2b-banner-h)] z-30 -mx-4 mb-1 hidden items-center justify-end gap-1 border-b border-transparent bg-paper/95 px-4 py-2 backdrop-blur no-print sm:-mx-8 sm:px-8 md:flex" data-testid="app-topbar">
              <div className="mr-auto w-full max-w-md"><SearchField /></div>
              {isPmEnabled() && <NotificationBell only="desktop" />}
              <span className="hidden md:inline-flex"><ThemeToggle signedIn account={user.theme ?? null} /></span>
            </StickyBar>
            {children}
          </main>
          <FeatureHost />
          <GuideHost />
          <GlobalSearchHost />
          <Suspense fallback={null}><SearchFocus /></Suspense>
        </>
      )}
    </div>
    </PremiumAccessProvider>
  );
}
