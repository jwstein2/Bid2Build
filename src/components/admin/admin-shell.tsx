"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const COMMAND_CENTER = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/states", label: "Bids by state" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/data-quality", label: "Data quality" },
];
export const OPERATIONS = [
  { href: "/admin/sales", label: "Sales" },
  { href: "/admin/complimentary", label: "Complimentary Access" },
  { href: "/admin/market", label: "Market Intelligence" },
  { href: "/admin/templates", label: "Trade templates" },
  { href: "/admin/proposal-text", label: "Scope & exclusions" },
  { href: "/admin/flags", label: "Feature flags" },
  { href: "/admin/logs", label: "Import & PDF errors" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/settings/pricing", label: "Pricing integrations" },
];

const isActive = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

/**
 * Admin chrome. The command-center pages render on the dark data-ops theme; the operational pages
 * (sales, templates, flags, ...) keep the light Blueprint theme under the same dark navigation.
 */
export function AdminShell({ email, logo, children }: { email: string; logo: ReactNode; children: ReactNode }) {
  const path = usePathname() ?? "/admin";
  const dark = COMMAND_CENTER.some((n) => n.href === path);
  return (
    <div className={cn("min-h-screen", dark ? "cc cc-grid" : "")}>
      <header className="cc sticky top-0 z-30 border-b border-[var(--cc-line)] bg-[rgb(5_9_12/0.92)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            {logo}
            <span className="cc-mono rounded border border-[var(--cc-line-strong)] px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-[var(--cc-green)]">Command center</span>
          </div>
          <nav aria-label="Command center" className="cc-mono flex flex-wrap gap-1 text-[13px]">
            {COMMAND_CENTER.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
                className={cn("rounded-md px-2.5 py-1.5", isActive(path, n.href) ? "bg-[rgb(61_255_168/0.12)] text-[var(--cc-green)] shadow-[inset_0_0_0_1px_rgb(61_255_168/0.35)]" : "text-[#b9cbd6] hover:bg-white/5 hover:text-white")}>{n.label}</Link>
            ))}
          </nav>
          <details className="relative">
            <summary className="cc-mono cursor-pointer list-none rounded-md px-2.5 py-1.5 text-[13px] text-[#b9cbd6] hover:bg-white/5 hover:text-white [&::-webkit-details-marker]:hidden">Operations ▾</summary>
            <div className="absolute left-0 z-40 mt-1 w-60 rounded-lg border border-[var(--cc-line)] bg-[#0a1117] p-1 shadow-2xl">
              {OPERATIONS.map((n) => <Link key={n.href} href={n.href} className={cn("block rounded-md px-3 py-2 text-sm", isActive(path, n.href) ? "text-[var(--cc-green)]" : "text-[#b9cbd6] hover:bg-white/5 hover:text-white")}>{n.label}</Link>)}
            </div>
          </details>
          <span className="ml-auto text-xs text-[#8fa6b4]">{email} · <Link href="/dashboard" className="underline hover:text-white">Exit</Link></span>
        </div>
      </header>
      <main id="main" className={cn("mx-auto px-4 py-8", dark ? "max-w-7xl" : "max-w-6xl")}>{children}</main>
    </div>
  );
}
