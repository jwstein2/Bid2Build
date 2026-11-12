import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard, FileText, LayoutDashboard, Library, LogOut, Settings, Shield, Building2, Users, Plug, LayoutTemplate } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { getUser, createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { ButtonLink } from "@/components/ui/button";

const nav = [
  { href: "/dashboard", label: "Bids", icon: LayoutDashboard },
  { href: "/dashboard/customers", label: "Saved customers", icon: Users },
  { href: "/dashboard/items", label: "Saved cost items", icon: Library },
  { href: "/dashboard/templates", label: "Proposal templates", icon: LayoutTemplate },
  { href: "/settings/company", label: "Company profile", icon: Building2 },
  { href: "/settings/billing", label: "Subscription", icon: CreditCard },
  { href: "/settings/pricing", label: "Pricing data", icon: Plug },
  { href: "/settings/account", label: "Account settings", icon: Settings },
];

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
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r no-print">
        <div className="flex items-center justify-between px-4 py-4"><Logo /></div>
        <div className="px-3"><ButtonLink href="/bids" variant="accent" className="w-full"><FileText className="h-4 w-4" /> New Bid</ButtonLink></div>
        <nav aria-label="Account" className="mt-3 flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-paper hover:text-ink">
              <n.icon className="h-4 w-4" aria-hidden /> {n.label}
            </Link>
          ))}
          {isAdmin && <Link href="/admin" className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-paper"><Shield className="h-4 w-4" /> Admin</Link>}
          <form action="/auth/signout" method="post">
            <button className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-paper"><LogOut className="h-4 w-4" /> Sign out</button>
          </form>
        </nav>
        <p className="hidden truncate px-5 pb-4 text-xs text-muted md:block">{user.email}</p>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
