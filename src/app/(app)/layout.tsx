import { companyNav, loadMyCompany } from "@/lib/enterprise/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getUser, createClient, createAdminClient } from "@/lib/supabase/server";
import { isPmEnabled, isSupabaseConfigured, serverEnv } from "@/lib/env";
import { ATTRIBUTION_COOKIE, decodeAttribution } from "@/lib/growth/attribution";
import { syncSignedInUser } from "@/lib/growth/leads";
import { REFERRAL_COOKIE } from "@/lib/growth/referral";
import { recordReferral } from "@/lib/growth/referral-server";
import { AppSidebar } from "@/components/layout/app-nav";
import { FeatureHost } from "@/components/features/feature-host";
import { formatPhone } from "@/lib/auth/phone";
import { loadLearningNav } from "@/lib/creator/nav";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { PremiumAccessProvider } from "@/components/billing/premium";
import { AccountThemeScript } from "@/components/theme/account-theme-script";
import { ThemeToggle } from "@/components/theme/theme-toggle";


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
  const supabase = await createClient();
  const [{ data: isAdmin }, company, premium, learning] = await Promise.all([supabase.rpc("is_admin", { p_user_id: user.id }), loadMyCompany(supabase), hasPremiumAccess(supabase), loadLearningNav(supabase)]);
  // Link the account to its lead + first-touch attribution (best effort, one indexed lookup when already linked).
  if (serverEnv().supabaseServiceKey) {
    const jar = await cookies();
    const admin = createAdminClient();
    await syncSignedInUser(admin, user, decodeAttribution(jar.get(ATTRIBUTION_COOKIE)?.value));
    // Arrived through a member's referral link: record it (only new accounts count; idempotent).
    const ref = jar.get(REFERRAL_COOKIE)?.value;
    if (ref) await recordReferral(admin, user.id, ref);
  }
  return (
    <PremiumAccessProvider unlocked={premium}>
    <AccountThemeScript pref={user.theme} />
    {/* app-theme: marks a customer app screen, so the Dark Mode tokens (globals.css) apply. */}
    <div className="app-theme flex min-h-screen flex-col md:flex-row">
      <aside className="on-dark bg-navy text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col no-print">
        <AppSidebar isAdmin={Boolean(isAdmin)} projects={isPmEnabled()} company={companyNav(company)} learning={learning} email={user.email ?? (user.phone ? formatPhone(user.phone) : null)} theme={user.theme ?? null} />
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8 md:pt-2">
        {/* Desktop header row: Light/Dark switch, top right. On phones it sits in the top bar. */}
        <div className="mb-1 hidden justify-end md:flex no-print"><ThemeToggle signedIn account={user.theme ?? null} /></div>
        {children}
      </main>
      <FeatureHost />
    </div>
    </PremiumAccessProvider>
  );
}
