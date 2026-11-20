"use client";

import Link from "next/link";
import { GlobalSearchHost, SearchIconButton } from "@/components/search/global-search";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { menuKeyDown, useDismiss } from "@/components/ui/use-dismiss";
import { PRIMARY, TOOLS } from "./nav";
import { FeatureHost } from "@/components/features/feature-host";
import { PageGuideButton } from "@/components/features/tour-buttons";

/** Pages that render on the dark command-center theme; the rest keep the light theme. */
const DARK = ["/admin", "/admin/marketing", "/admin/customers", "/admin/revenue", "/admin/usage", "/admin/operations", "/admin/states", "/admin/definitions", "/admin/tax-banking", "/admin/complimentary", "/admin/costs", "/admin/onboarding", "/admin/staff", "/admin/payouts", "/admin/banking"];

const under = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

function TestDataToggle({ path }: { path: string }) {
  const sp = useSearchParams();
  const on = sp.get("data") === "all";
  const next = new URLSearchParams(sp.toString());
  if (on) next.delete("data"); else next.set("data", "all");
  next.delete("page");
  const q = next.toString();
  return (
    <Link href={q ? `${path}?${q}` : path} aria-label={on ? "Including test data. Switch to genuine accounts only" : "Genuine accounts only. Switch to include test data"} title="Business metrics count genuine accounts only. Turn on to include internal, test and demo accounts (diagnostics)."
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
 * "Tools ▾" menu. Was a <details> element, which stayed open after picking a page (the shell
 * persists across client navigation), ignored outside clicks and had no Escape. Now it closes on
 * selection, navigation, outside click and Escape, and supports arrow keys.
 */
function ToolsMenu({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), { inside: [trigger, panel], returnFocus: trigger });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close after navigating
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>("a")?.focus(); }, [open]);
  // Keep the whole menu on screen: line it up under the button, then nudge it left if it would run off
  // the right edge (at tablet widths Tools sits near the right side and the menu was cut off).
  const wrap = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const w = wrap.current?.getBoundingClientRect(), pw = panel.current?.offsetWidth ?? 256;
      if (!w) return;
      const vw = document.documentElement.clientWidth;
      setLeft(Math.round(Math.max(8, Math.min(w.left, vw - pw - 8)) - w.left));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  const active = TOOLS.some((n) => under(path, n.href));
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="admin-tools-menu" data-testid="admin-tools"
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
        className={cn("rounded-md px-2.5 py-1.5 hover:bg-white/5 hover:text-white", active ? "text-[var(--cc-green)]" : "text-[#b9cbd6]")}>Tools ▾</button>
      {open && (
        <div ref={panel} id="admin-tools-menu" onKeyDown={menuKeyDown} style={{ left }}
          className="absolute z-40 mt-1 max-h-[70dvh] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-[var(--cc-line)] bg-[#0a1117] p-1 shadow-2xl">
          {TOOLS.map((n) => <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={under(path, n.href) ? "page" : undefined}
            className={cn("block rounded-md px-3 py-2 font-sans text-sm focus-visible:bg-white/10", under(path, n.href) ? "text-[var(--cc-green)]" : "text-[#b9cbd6] hover:bg-white/5 hover:text-white")}>{n.label}</Link>)}
        </div>
      )}
    </div>
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
          <nav aria-label="Owner command center" className="cc-mono flex flex-wrap gap-1 text-[13px]" data-guide="admin.nav">
            <Suspense fallback={null}><NavLinks path={path} /></Suspense>
            <span data-guide="admin.tools" className="inline-flex"><ToolsMenu path={path} /></span>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <SearchIconButton tone="dark" className="text-[#8fa6b4] hover:text-white" />
            {dark && <span data-guide="admin.test-data" className="inline-flex"><Suspense fallback={null}><TestDataToggle path={path} /></Suspense></span>}
            <PageGuideButton compact className="text-[#8fa6b4] hover:bg-white/10 hover:text-white" />
            <span className="hidden text-xs text-[#8fa6b4] lg:inline">{email}</span>
            <Link href="/dashboard" className="text-xs text-[#8fa6b4] underline hover:text-white" data-guide="admin.exit">Exit</Link>
          </div>
        </div>
      </header>
      <main id="main" className={cn("mx-auto px-4 py-7", dark ? "max-w-7xl" : "max-w-6xl")} data-guide-page="admin">{children}</main>
      {/* Owner-only walkthrough (page-guides.ts "admin"): started from the compass button, never automatically. */}
      <FeatureHost auto={false} />
      {/* Universal search (V6.4) with owner-admin account lookup; Ctrl/Cmd+K. */}
      <GlobalSearchHost />
    </div>
  );
}
