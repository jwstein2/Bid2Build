import { companyNav, loadMyCompany } from "@/lib/enterprise/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { after } from "next/server";
import { getUser, createClient, createAdminClient } from "@/lib/supabase/server";
import { isFinancialsEnabled, isPmEnabled, isSupabaseConfigured, isUnifiedHomeEnabled, serverEnv } from "@/lib/env";
import { ATTRIBUTION_COOKIE, decodeAttribution } from "@/lib/growth/attribution";
import { syncSignedInUser } from "@/lib/growth/leads";
import { REFERRAL_COOKIE } from "@/lib/growth/referral";
import { recordReferral } from "@/lib/growth/referral-server";
import { SALES_COOKIE } from "@/lib/sales/link";
import { SALES_JOIN_COOKIE } from "@/lib/sales/next";
import { isInviteToken } from "@/lib/sales/invite";
import { NO_WORKSPACES, switchLinks } from "@/lib/workspaces";
import { loadWorkspaces } from "@/lib/workspaces-server";
import { recordRepAttribution } from "@/lib/sales/billing-server";
import { AppSidebar } from "@/components/layout/app-nav";
import { FeatureHost } from "@/components/features/feature-host";
import { formatPhone } from "@/lib/auth/phone";
import { loadLearningNav } from "@/lib/creator/nav";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { PremiumAccessProvider } from "@/components/billing/premium";
import { AccountThemeScript } from "@/components/theme/account-theme-script";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationBell } from "@/components/operations/notification-bell";
import { Suspense } from "react";
import { GlobalSearchHost, SearchField } from "@/components/search/global-search";
import { SearchFocus } from "@/components/search/search-focus";
import { loadEffectiveAccess } from "@/lib/access/server";
import { sidebarAccess } from "@/lib/access/nav";
import { DemoBanner } from "@/components/demo/demo-controls";
import { GuideHost } from "@/components/guide/guide-host";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="grid min-h-screen place-items-center px-4 text-center">
        <div><h1 className="text-2xl font-extrabold">Accounts aren&apos;t configured yet</h1><p className="mt-2 text-ink-soft">Set the Supabase environment variables to enable the dashboard. See docs/SETUP.md.</p><Link href="/" className="mt-4 inline-block underline">Home</Link></div>
      </main>
    );
  }
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard");
  // A sales invite opened before signing in some other way: finish (or confirm) it before the contractor
  // app's own onboarding can take over. /sales/join forgets the invite once it's used or no longer open.
  if (isInviteToken((await cookies()).get(SALES_JOIN_COOKIE)?.value ?? "")) redirect("/sales/join");
  const supabase = await createClient();
  const [{ data: isAdmin }, company, premium, learning, access, workspaces] = await Promise.all([
    supabase.rpc("is_admin", { p_user_id: user.id }), loadMyCompany(supabase), hasPremiumAccess(supabase), loadLearningNav(supabase),
    // V6.7: which workspace links this person sees (company members only; solo accounts and owners see everything).
    loadEffectiveAccess(supabase).catch(() => null),
    // V8.10: "Switch to Sales Hub" in the account menu for sales reps and sales admins.
    loadWorkspaces().catch(() => NO_WORKSPACES),
  ]);
  // Link the account to its lead + first-touch attribution (best effort, one indexed lookup when already linked).
  // Runs after the page is sent (next/server after()), so this bookkeeping never delays a signed-in page.
  // Demo / Practice logins are sample tenants: no lead, attribution or referral bookkeeping.
  if (serverEnv().supabaseServiceKey && !user.demo) {
    const jar = await cookies();
    const attribution = decodeAttribution(jar.get(ATTRIBUTION_COOKIE)?.value);
    // Arrived through a member's referral link: record it (only new accounts count; idempotent).
    const ref = jar.get(REFERRAL_COOKIE)?.value;
    // Arrived through a sales rep's /s/<code> link: attach the rep to this account (new, never-paid accounts only).
    const rep = jar.get(SALES_COOKIE)?.value;
    after(async () => {
      const admin = createAdminClient();
      await syncSignedInUser(admin, user, attribution);
      if (ref) await recordReferral(admin, user.id, ref);
      if (rep) await recordRepAttribution(admin, user.id, rep);
    });
  }
  return (
    <PremiumAccessProvider unlocked={premium}>
    <AccountThemeScript pref={user.theme} />
    {/* app-theme: marks a customer app screen, so the Dark Mode tokens (globals.css) apply. */}
    {user.demo && <DemoBanner kind={user.demo.kind} company={company?.name ?? null} />}
    <div className="app-theme flex min-h-screen flex-col md:flex-row">
      <aside className="on-dark bg-navy text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:overscroll-contain no-print">
        <AppSidebar isAdmin={Boolean(isAdmin)} projects={isPmEnabled()} financials={isFinancialsEnabled()} home={isUnifiedHomeEnabled()} company={companyNav(company)} access={sidebarAccess(access)} learning={learning} switches={switchLinks(workspaces, "contractor")} email={user.email ?? (user.phone ? formatPhone(user.phone) : null)} theme={user.theme ?? null} />
      </aside>
      {/* Bottom padding keeps the last controls on every page clear of the fixed Guide button (bottom left). */}
      <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 md:pt-2">
        {/* Desktop header row: Light/Dark switch, top right. On phones it sits in the top bar. */}
        {/* Task review notices (V4.3) sit beside it, on phones too. */}
        {/* Universal search (V6.4): header field + Ctrl/Cmd+K on desktop; the phone icon is in the top bar. */}
        <div className="mb-1 flex items-center justify-end gap-1 no-print">
          <div className="mr-auto hidden w-full max-w-md md:block"><SearchField /></div>
          {isPmEnabled() && <NotificationBell />}
          <span className="hidden md:inline-flex"><ThemeToggle signedIn account={user.theme ?? null} /></span>
        </div>
        {children}
      </main>
      <FeatureHost />
      <GuideHost />
      <GlobalSearchHost />
      <Suspense fallback={null}><SearchFocus /></Suspense>
    </div>
    </PremiumAccessProvider>
  );
}
