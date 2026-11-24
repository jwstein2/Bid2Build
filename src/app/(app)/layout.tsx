import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { after } from "next/server";
import { getUser, createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { ATTRIBUTION_COOKIE, decodeAttribution } from "@/lib/growth/attribution";
import { syncSignedInUser } from "@/lib/growth/leads";
import { REFERRAL_COOKIE } from "@/lib/growth/referral";
import { recordReferral } from "@/lib/growth/referral-server";
import { decodeRepCookie, SALES_COOKIE } from "@/lib/sales/link";
import { SALES_JOIN_COOKIE } from "@/lib/sales/next";
import { isInviteToken } from "@/lib/sales/invite";
import { recordRepAttribution } from "@/lib/sales/billing-server";
import { recordAffiliateAttribution } from "@/lib/affiliates/billing-server";
import { AFFILIATE_COOKIE, attributionOrder, decodeAffiliateCookie } from "@/lib/affiliates/link";
import { AppShell } from "@/components/layout/app-shell";


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
    // Arrived through an affiliate's /a/<code> link. With both cookies the earlier visit records first; the
    // database keeps one owner per customer either way (sales_record_attribution / affiliate_record_attribution).
    const aff = jar.get(AFFILIATE_COOKIE)?.value;
    const order = attributionOrder(decodeRepCookie(rep), decodeAffiliateCookie(aff));
    after(async () => {
      const admin = createAdminClient();
      await syncSignedInUser(admin, user, attribution);
      if (ref) await recordReferral(admin, user.id, ref);
      for (const program of order) {
        if (program === "sales") await recordRepAttribution(admin, user.id, rep);
        else await recordAffiliateAttribution(admin, user.id, aff);
      }
    });
  }
  return <AppShell user={user}>{children}</AppShell>;
}
