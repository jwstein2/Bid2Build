"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Cta } from "@/lib/account/status";
import { cn } from "@/lib/cn";

/**
 * Phone menu for the public site. A disclosure (not a modal): it drops down under the header, a tap
 * on the dimmed page or Escape closes it, focus moves into it on open and back to the Menu button on
 * close, and it closes on navigation (including the browser Back button).
 * Motion is CSS only (tokens in globals.css), so the public site ships no animation JavaScript. The
 * panel stays mounted and is `invisible` when closed, which also takes it out of the tab order.
 */
export function MobileNav({ items, groups = [], signedIn, primary, badge, home = { href: "/dashboard", label: "My Bids" } }: { items: { href: string; label: string }[]; groups?: { label: string; links: readonly { href: string; label: string }[] }[]; signedIn: boolean; primary: Cta; badge: string | null; home?: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const path = usePathname();

  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the menu after navigating
  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    if (!open) return;
    // Move focus to the first link once the panel is visible (focusable). One frame is usually enough;
    // retry shortly after in case the browser hasn't applied the new visibility yet.
    const focusFirst = () => panel.current?.querySelector<HTMLElement>("a")?.focus();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      focusFirst();
      if (!panel.current?.contains(document.activeElement)) retry = setTimeout(focusFirst, 60);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); clearTimeout(retry); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const close = () => setOpen(false);
  // The closed panel is still in the DOM (for the exit transition), so turn off viewport prefetch
  // while it's closed; otherwise every phone visit would prefetch all menu pages up front.
  const prefetch = open ? undefined : false;
  // Opening: visible at once (so focus can move in), then fade/slide in. Closing: fade/slide out, and
  // only become invisible when the transition ends (visibility is in the closing transition list).
  const shown = open ? "visible opacity-100 translate-y-0 transition-[opacity,translate]" : "invisible opacity-0 -translate-y-2 pointer-events-none transition-[opacity,translate,visibility]";
  return (
    <div className="md:hidden">
      <button
        ref={toggle}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen(!open)}
        className="grid h-11 w-11 place-items-center rounded-md transition-colors duration-(--motion-fast) hover:bg-black/5 active:bg-black/10"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {/* Dimmed page under the menu: tap anywhere outside to close. The header uses backdrop-blur,
          which makes it the containing block, so this is sized from the header down. */}
      <div
        aria-hidden
        data-testid="mobile-menu-scrim"
        onClick={close}
        className={cn(
          "absolute inset-x-0 top-16 h-[calc(100dvh-4rem)] bg-navy/40 duration-(--motion-base) ease-brand-out",
          open ? "visible opacity-100 transition-opacity" : "invisible opacity-0 pointer-events-none transition-[opacity,visibility]",
        )}
      />
      <nav
        ref={panel}
        id="mobile-menu"
        aria-label="Mobile"
        className={cn(
          "absolute inset-x-0 top-16 flex flex-col border-b border-line bg-surface px-4 pb-4 shadow-lg duration-(--motion-slow) ease-brand-out",
          shown,
        )}
      >
        {items.map((n) => (
          <Link key={n.href} href={n.href} prefetch={prefetch} onClick={close} className="flex min-h-12 items-center border-b border-line font-medium active:bg-brand-tint">{n.label}</Link>
        ))}
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="border-b border-line">
            <p className="pt-3 text-xs font-bold uppercase tracking-wider text-muted" aria-hidden>{g.label}</p>
            {g.links.map((l) => (
              <Link key={l.href} href={l.href} prefetch={prefetch} onClick={close} className="flex min-h-12 items-center pl-3 font-medium active:bg-brand-tint">{l.label}</Link>
            ))}
          </div>
        ))}
        <Link href={signedIn ? home.href : "/login"} prefetch={prefetch} onClick={close} className="flex min-h-12 items-center border-b border-line font-medium active:bg-brand-tint">
          {signedIn ? home.label : "Sign in"}
        </Link>
        {badge && <p className="pt-3 text-center text-sm text-ink-soft" data-testid="credit-badge-mobile">{badge}</p>}
        <Link href={primary.href} prefetch={prefetch} onClick={close} data-cta={primary.action} className="mt-3 flex min-h-12 items-center justify-center rounded-lg bg-accent text-center font-semibold text-navy transition-transform duration-(--motion-fast) active:scale-[0.98]">{primary.label}</Link>
      </nav>
    </div>
  );
}
