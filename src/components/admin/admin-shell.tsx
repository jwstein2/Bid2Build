"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PRIMARY, TOOLS } from "./nav";

/** Pages that render on the dark command-center theme; the rest keep the light theme. */
const DARK = ["/admin", "/admin/marketing", "/admin/customers", "/admin/revenue", "/admin/usage", "/admin/operations", "/admin/states", "/admin/definitions", "/admin/complimentary", "/admin/costs"];

const under = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

function TestDataToggle({ path }: { path: string }) {
  const sp = useSearchParams();
  const on = sp.get("data") === "all";
  const next = new URLSearchParams(sp.toString());
  if (on) next.delete("data"); else next.set("data", "all");
  next.delete("page");
  const q = next.toString();
  return (
    <Link href={q ? `${path}?${q}` : path} aria-pressed={on} title="Business metrics count genuine accounts only. Turn on to include internal, test and demo accounts (diagnostics)."
      className={cn("cc-mono rounded-md border px-2 py-1 text-[11px]", on ? "border-[var(--cc-amber)] text-[var(--cc-amber)]" : "border-[var(--cc-line)] text-[#8fa6b4] hover:text-white")}>
      {on ? "Including test data ✕" : "Genuine accounts only"}
    </Link>
  );
}

function NavLinks({ path }: { path: string }) {
  const sp = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["range", "data"]) { const v = sp.get(k); if (v) keep.set(k, v); }
  const q = keep.toString();
  return (
    <>
      {PRIMARY.map((n) => {
        const active = under(path, n.href) || (n.also ?? []).some((a) => under(path, a));
        return (
          <Link key={n.href} href={q ? `${n.href}?${q}` : n.href} aria-current={active ? "page" : undefined}
            className={cn("rounded-md px-2.5 py-1.5", active ? "bg-[rgb(61_255_168/0.12)] text-[var(--cc-green)] shadow-[inset_0_0_0_1px_rgb(61_255_168/0.35)]" : "text-[#b9cbd6] hover:bg-white/5 hover:text-white")}>{n.label}</Link>
        );
      })}
    </>
  );
}

/**
 * Owner chrome. Report pages use the dark command-center theme; older operational tools (templates,
 * flags, logs...) keep the light theme under the same navigation. Authorization happens in the layout
 * and in every page/action (requireAdmin), never here.
 */
export function AdminShell({ email, logo, children }: { email: string; logo: ReactNode; children: ReactNode }) {
  const path = usePathname() ?? "/admin";
  const dark = DARK.some((p) => under(path, p));
  return (
    <div className={cn("min-h-screen", dark ? "cc cc-grid" : "")}>
      <header className="cc sticky top-0 z-30 border-b border-[var(--cc-line)] bg-[rgb(5_9_12/0.94)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            {logo}
            <span className="cc-mono hidden rounded border border-[var(--cc-line-strong)] px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-[var(--cc-green)] sm:inline">Owner</span>
          </div>
          <nav aria-label="Owner command center" className="cc-mono flex flex-wrap gap-1 text-[13px]">
            <Suspense fallback={null}><NavLinks path={path} /></Suspense>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md px-2.5 py-1.5 text-[#b9cbd6] hover:bg-white/5 hover:text-white [&::-webkit-details-marker]:hidden">Tools ▾</summary>
              <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-[var(--cc-line)] bg-[#0a1117] p-1 shadow-2xl sm:left-0 sm:right-auto">
                {TOOLS.map((n) => <Link key={n.href} href={n.href} className={cn("block rounded-md px-3 py-2 font-sans text-sm", under(path, n.href) ? "text-[var(--cc-green)]" : "text-[#b9cbd6] hover:bg-white/5 hover:text-white")}>{n.label}</Link>)}
              </div>
            </details>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {dark && <Suspense fallback={null}><TestDataToggle path={path} /></Suspense>}
            <span className="hidden text-xs text-[#8fa6b4] lg:inline">{email}</span>
            <Link href="/dashboard" className="text-xs text-[#8fa6b4] underline hover:text-white">Exit</Link>
          </div>
        </div>
      </header>
      <main id="main" className={cn("mx-auto px-4 py-7", dark ? "max-w-7xl" : "max-w-6xl")}>{children}</main>
    </div>
  );
}
