"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Download, ExternalLink, Share, SquarePlus, X } from "lucide-react";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/cn";

/**
 * "Install Built2Bid" for the public homepage. It works on its own, not only when the browser
 * shows its one-time install prompt:
 * - Chrome/Edge/Samsung (Android + desktop): keeps the browser's install event and opens the
 *   native install dialog when tapped.
 * - iPhone/iPad Safari and browsers without the event: opens short Add to Home Screen steps.
 * - Already running as the installed app: hidden. Installed on this device (we saw it install):
 *   becomes "Open App", which opens the app's start page.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALLED_KEY = "b2b:pwa-installed";
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Registered when this chunk loads, so an early browser event is not missed.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* storage blocked: fine */ }
    emit();
  });
}

type Mode = "hidden" | "native" | "ios" | "manual" | "open";

function currentMode(): Mode {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden";
  let installed = false;
  try { installed = localStorage.getItem(INSTALLED_KEY) === "1"; } catch { /* ignore */ }
  if (deferred) return "native"; // the browser says it isn't installed (any more)
  if (installed) return "open";
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "manual";
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function InstallAppButton({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  const mode = useSyncExternalStore(subscribe, currentMode, () => "hidden" as Mode);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), { inside: [btn, panel], returnFocus: btn });
  // The help panel only applies where the browser can't install by itself.
  const showHelp = open && (mode === "ios" || mode === "manual");

  if (mode === "hidden") return null;

  const base = cn(
    "inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2",
    tone === "dark" ? "text-cyan focus-visible:outline-cyan" : "text-accent-ink focus-visible:outline-accent",
  );

  if (mode === "open") {
    return (
      <a href="/dashboard" className={cn(base, className)} data-testid="install-app" data-mode="open">
        <ExternalLink className="h-4 w-4" aria-hidden /> Open App
      </a>
    );
  }

  const onClick = async () => {
    if (mode === "native" && deferred) {
      const ev = deferred;
      await ev.prompt();
      const choice = await ev.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        deferred = null;
        try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* ignore */ }
        emit();
      }
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <span className={cn("relative inline-block", className)}>
      <button ref={btn} type="button" onClick={onClick} className={base} aria-expanded={mode === "native" ? undefined : showHelp}
        aria-haspopup={mode === "native" ? undefined : "dialog"} data-testid="install-app" data-mode={mode}>
        <Download className="h-4 w-4" aria-hidden /> Install Built2Bid
        <span className={cn("font-normal", tone === "dark" ? "text-[#B8C6D4]" : "text-muted")}>(free app)</span>
      </button>
      {showHelp && (
        <div ref={panel} role="dialog" aria-labelledby="install-help-h"
          className="absolute left-0 top-full z-30 mt-2 w-[min(340px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-4 text-left text-ink shadow-2xl"
          data-testid="install-help">
          <div className="flex items-start justify-between gap-3">
            <h2 id="install-help-h" className="font-display text-base font-bold text-navy">Add Built2Bid to your home screen</h2>
            <button type="button" aria-label="Close" onClick={() => { setOpen(false); btn.current?.focus(); }} className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-black/5">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {mode === "ios" ? (
            <ol className="mt-3 space-y-2 text-sm text-ink-soft">
              <li className="flex gap-2"><span className="font-bold text-navy">1.</span><span>Open this page in <b>Safari</b>.</span></li>
              <li className="flex gap-2"><span className="font-bold text-navy">2.</span><span>Tap the <b>Share</b> button <Share className="inline h-4 w-4 align-[-3px] text-accent-ink" aria-label="Share icon" /> at the bottom (top right on iPad).</span></li>
              <li className="flex gap-2"><span className="font-bold text-navy">3.</span><span>Scroll down and tap <b>Add to Home Screen</b> <SquarePlus className="inline h-4 w-4 align-[-3px] text-accent-ink" aria-label="Add icon" />.</span></li>
              <li className="flex gap-2"><span className="font-bold text-navy">4.</span><span>Tap <b>Add</b>. Built2Bid opens from your home screen like any other app.</span></li>
            </ol>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li><b>Android (Chrome):</b> tap the <b>⋮</b> menu, then <b>Install app</b> or <b>Add to Home screen</b>.</li>
              <li><b>Computer (Chrome or Edge):</b> click the install icon at the right end of the address bar, or open the menu and choose <b>Install Built2Bid</b>.</li>
              <li><b>iPhone or iPad:</b> open this page in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Free, no app store needed. Your bids stay in your account.</p>
        </div>
      )}
    </span>
  );
}
