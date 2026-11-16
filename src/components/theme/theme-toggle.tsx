"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { THEME_EVENT, THEME_STORAGE_KEY, parseThemePref, type ThemeMode, type ThemePref } from "@/lib/theme";

function readLocal(): ThemePref | null {
  try { return parseThemePref(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")); } catch { return null; }
}

const current = (): ThemeMode => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

function subscribe(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  // Another tab changed it: follow along.
  const onStorage = (e: StorageEvent) => { if (e.key === THEME_STORAGE_KEY) { applyMode(readLocal()?.mode ?? "light"); cb(); } };
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(THEME_EVENT, cb); window.removeEventListener("storage", onStorage); };
}

/** Switches instantly. Transitions are paused for one frame so the whole screen changes at once. */
function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (mode === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  window.dispatchEvent(new Event(THEME_EVENT));
}

let syncedThisPage = false;

function saveToAccount(pref: ThemePref) {
  fetch("/api/theme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pref), keepalive: true }).catch(() => {});
}

/**
 * One-click sun/moon switch for the customer app header. Light is the default; the choice is saved
 * on this device and, when signed in, to the account so it follows the user to other devices.
 * The icon is chosen by CSS from <html data-theme>, so it is right on the very first paint.
 */
export function ThemeToggle({ signedIn = false, account = null, tone = "light", className }: { signedIn?: boolean; account?: ThemePref | null; tone?: "light" | "dark"; className?: string }) {
  const mode = useSyncExternalStore(subscribe, current, () => "light" as ThemeMode);
  const dark = mode === "dark";

  // A choice made on this device before signing in (or a save that didn't reach the server) is
  // newer than the account copy: store it on the account.
  useEffect(() => {
    if (!signedIn || syncedThisPage) return;
    syncedThisPage = true;
    const local = readLocal();
    if (local && local.at > (account?.at ?? 0)) saveToAccount(local);
  }, [signedIn, account?.at]);

  const toggle = () => {
    const pref: ThemePref = { mode: dark ? "light" : "dark", at: Date.now() };
    try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(pref)); } catch { /* private mode: still switches for this visit */ }
    applyMode(pref.mode);
    if (signedIn) saveToAccount(pref);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="theme-toggle"
      className={cn(
        "theme-toggle inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md transition-colors md:min-h-10 md:min-w-10",
        tone === "dark" ? "text-white hover:bg-white/10" : "text-ink-soft hover:bg-black/5 hover:text-ink",
        className,
      )}
    >
      <Moon className="theme-icon-moon h-5 w-5" aria-hidden />
      <Sun className="theme-icon-sun h-5 w-5" aria-hidden />
    </button>
  );
}
