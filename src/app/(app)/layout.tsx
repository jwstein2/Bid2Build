import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getUser, createClient, createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { ATTRIBUTION_COOKIE, decodeAttribution } from "@/lib/growth/attribution";
import { syncSignedInUser } from "@/lib/growth/leads";
import { AppSidebar } from "@/components/layout/app-nav";
import { formatPhone } from "@/lib/auth/phone";


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
  const { data: isAdmin } = await (await createClient()).rpc("is_admin", { p_user_id: user.id });
  // Link the account to its lead + first-touch attribution (best effort, one indexed lookup when already linked).
  if (serverEnv().supabaseServiceKey) {
    await syncSignedInUser(createAdminClient(), user, decodeAttribution((await cookies()).get(ATTRIBUTION_COOKIE)?.value));
  }
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="on-dark bg-navy text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col no-print">
        <AppSidebar isAdmin={Boolean(isAdmin)} email={user.email ?? (user.phone ? formatPhone(user.phone) : null)} />
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
