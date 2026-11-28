/**
 * One shared store for the browser's install event (Chrome/Edge on Windows, macOS, ChromeOS, Android).
 *
 * The browser fires `beforeinstallprompt` once, early, and only to listeners that already exist. This module is
 * imported by the root-level AppRuntime (every page), so the event is kept no matter which install button the person
 * later uses: the homepage "Install Built2Bid", the menu item, or the "Install Built2Bid on your computer" card.
 */

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const INSTALLED_KEY = "b2b:pwa-installed";

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

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

export function subscribeInstall(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The kept install event, or null when the browser has not offered one (installed already, or unsupported). */
export const installEvent = () => deferred;

/** Open the browser's own install dialog. Resolves true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (!ev) return false;
  await ev.prompt();
  const choice = await ev.userChoice.catch(() => null);
  if (choice?.outcome === "accepted") {
    deferred = null;
    try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* ignore */ }
    emit();
    return true;
  }
  return false;
}

/** True when this window is the installed app (desktop or phone). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** We saw this browser install the app (best effort: the person may have uninstalled it since). */
export function seenInstalled(): boolean {
  try { return localStorage.getItem(INSTALLED_KEY) === "1"; } catch { return false; }
}

export type DesktopPlatform = "windows" | "mac" | "chromeos" | "linux" | "mobile";
export type DesktopBrowser = "chrome" | "edge" | "safari" | "firefox" | "opera" | "other";

/** Platform and browser for the computer install steps. Exported for tests. */
export function describeDevice(ua: string, maxTouchPoints = 0): { platform: DesktopPlatform; browser: DesktopBrowser } {
  const ipad = ua.includes("Macintosh") && maxTouchPoints > 1;
  const platform: DesktopPlatform =
    /Android|iPhone|iPod|iPad/.test(ua) || ipad ? "mobile"
    : /Windows/.test(ua) ? "windows"
    : /CrOS/.test(ua) ? "chromeos"
    : /Macintosh|Mac OS X/.test(ua) ? "mac"
    : "linux";
  const browser: DesktopBrowser =
    /Edg\//.test(ua) ? "edge"
    : /OPR\//.test(ua) ? "opera"
    : /Firefox\//.test(ua) ? "firefox"
    : /Chrome\//.test(ua) ? "chrome"
    : /Safari\//.test(ua) ? "safari"
    : "other";
  return { platform, browser };
}

/** Safari 17+ on macOS Sonoma can add a web app to the Dock (File > Add to Dock). Exported for tests. */
export function safariCanAddToDock(ua: string): boolean {
  const m = ua.match(/Version\/(\d+)/);
  return Boolean(m && +m[1] >= 17);
}
