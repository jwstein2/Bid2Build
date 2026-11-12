import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { getUser, createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { ButtonLink } from "@/components/ui/button";
import { AppNav } from "@/components/layout/app-nav";


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
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="on-dark bg-navy text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col no-print">
        <div className="flex items-center justify-between px-4 py-4"><Logo tone="dark" href="/dashboard" /></div>
        <div className="px-3"><ButtonLink href="/bids" variant="accent" className="w-full"><FileText className="h-4 w-4" aria-hidden /> New bid</ButtonLink></div>
        <AppNav isAdmin={Boolean(isAdmin)} />
        <p className="mt-auto hidden truncate border-t border-white/10 px-5 py-4 text-xs text-[#B8C6D4] md:block">{user.email}</p>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
