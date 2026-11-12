import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { requireAdmin } from "@/lib/admin/server";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/market", label: "Market Intelligence" },
  { href: "/admin/templates", label: "Trade templates" },
  { href: "/admin/flags", label: "Feature flags" },
  { href: "/admin/logs", label: "Import & PDF errors" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/settings/pricing", label: "Pricing integrations" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Logo />
          <span className="rounded bg-ink px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Admin</span>
          <nav aria-label="Admin" className="flex flex-wrap gap-1 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 font-medium text-ink-soft hover:bg-paper hover:text-ink">{n.label}</Link>)}
          </nav>
          <span className="ml-auto text-xs text-muted">{user.email} · <Link href="/dashboard" className="underline">Exit</Link></span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
