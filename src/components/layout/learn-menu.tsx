"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface MenuLink { href: string; label: string; description?: string }

/**
 * Desktop "Learn" menu (Guides · Calculators · Academy). A disclosure button: Escape or a click
 * outside closes it, and it closes after navigating. Links stay reachable without JavaScript via
 * the Guides page, which carries the same three tabs.
 */
export function LearnMenu({ label, links }: { label: string; links: readonly MenuLink[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the menu after navigating
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const active = links.some((l) => path === l.href || path.startsWith(`${l.href}/`));
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="learn-menu"
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:bg-brand-tint hover:text-navy", (open || active) && "text-navy")}
      >
        {label}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-(--motion-fast)", open && "rotate-180")} aria-hidden />
      </button>
      <div
        id="learn-menu"
        className={cn("absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lg", open ? "block" : "hidden")}
      >
        {links.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-brand-tint">
            <span className="block text-sm font-semibold text-ink">{l.label}</span>
            {l.description && <span className="block text-xs text-muted">{l.description}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
