"use client";
import { useState, useSyncExternalStore } from "react";
import { Check, Copy, Monitor, X } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button-styles";
import { InstallAppButton } from "@/components/marketing/install-app-button";
import { describeDevice, installEvent, isStandalone, promptInstall, safariCanAddToDock, seenInstalled, subscribeInstall, type DesktopBrowser, type DesktopPlatform } from "@/lib/pwa/install-prompt";
import { isDesktopInstallPromoEnabled } from "@/lib/pwa/version";

/**
 * V10.1 "Install Built2Bid on your computer". The installed app is this same website in its own window (Chrome or Edge
 * on Windows/macOS, Safari's Add to Dock on macOS Sonoma+), so it always runs the current release and uses the same
 * account and subscription. It never promises a one-click button where the browser has none: it shows the browser's
 * own install dialog when offered, and otherwise short steps for the browser in use.
 *
 * `dismissible` (after purchase): "Not now" hides it on this browser. The account settings card is always there.
 */

const DISMISS_KEY = "b2b:desktop-install-dismissed";

type View =
  | { kind: "hidden" }
  | { kind: "native" }
  | { kind: "installed"; platform: DesktopPlatform }
  | { kind: "steps"; platform: DesktopPlatform; browser: DesktopBrowser; addToDock: boolean }
  | { kind: "mobile" };

let snapshot: View = { kind: "hidden" };
let snapshotKey = "";
function computeView(): View {
  if (isStandalone()) return { kind: "hidden" };
  const { platform, browser } = describeDevice(navigator.userAgent, navigator.maxTouchPoints);
  const key = `${platform}|${browser}|${installEvent() ? 1 : 0}|${seenInstalled() ? 1 : 0}`;
  if (key === snapshotKey) return snapshot;
  snapshotKey = key;
  snapshot =
    platform === "mobile" ? { kind: "mobile" }
    : installEvent() ? { kind: "native" }
    : seenInstalled() ? { kind: "installed", platform }
    : { kind: "steps", platform, browser, addToDock: browser === "safari" && safariCanAddToDock(navigator.userAgent) };
  return snapshot;
}

const where = (p: DesktopPlatform) =>
  p === "windows" ? "your Start menu, taskbar or desktop" : p === "mac" ? "Launchpad, your Applications folder or the Dock" : "your app launcher";

export function InstallDesktopCard({ dismissible = false, className, id }: { dismissible?: boolean; className?: string; id?: string }) {
  const view = useSyncExternalStore(subscribeInstall, computeView, () => ({ kind: "hidden" }) as View);
  const [dismissed, setDismissed] = useState(() => {
    if (!dismissible || typeof window === "undefined") return false;
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [copied, setCopied] = useState(false);
  if (!isDesktopInstallPromoEnabled() || view.kind === "hidden" || (dismissible && dismissed)) return null;
  if (dismissible && (view.kind === "installed" || view.kind === "mobile")) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage blocked: hidden for this visit */ }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/login`); setCopied(true); } catch { /* the steps still say what to do */ }
  };

  return (
    <Card className={className ?? "p-5"} id={id} data-testid="install-desktop" data-view={view.kind}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy text-cyan"><Monitor className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-bold">{view.kind === "mobile" ? "Add Built2Bid to your home screen" : view.kind === "installed" ? "Built2Bid is installed on this computer" : "Install Built2Bid on your computer"}</h2>
            {dismissible && (
              <button type="button" onClick={dismiss} aria-label="Not now" className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-black/5" data-testid="install-desktop-dismiss">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <p className="text-sm text-ink-soft">
            {view.kind === "installed"
              ? `Open it from ${where(view.platform)}. It's the same Built2Bid account and subscription, and it updates by itself.`
              : "Open Built2Bid like a desktop application, with your projects and account available whenever you're signed in."}
          </p>

          {view.kind === "native" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className={buttonClass("primary", "md")} onClick={() => void promptInstall()} data-testid="install-desktop-native">Install Built2Bid</button>
              {dismissible && <button type="button" className={buttonClass("ghost", "md")} onClick={dismiss}>Not now</button>}
            </div>
          )}

          {view.kind === "mobile" && <div className="mt-2"><InstallAppButton tone="light" /></div>}

          {view.kind === "steps" && (
            <div className="mt-3 text-sm text-ink-soft" data-testid="install-desktop-steps" data-browser={view.browser} data-platform={view.platform}>
              {view.browser === "chrome" || view.browser === "opera" ? (
                <p>Click the <b>install icon</b> at the right end of the address bar. Don&apos;t see it? Open the <b>⋮</b> menu, choose <b>Cast, save, and share</b>, then <b>Install Built2Bid</b>.</p>
              ) : view.browser === "edge" ? (
                <p>Click the <b>App available</b> icon at the right end of the address bar. Don&apos;t see it? Open the <b>⋯</b> menu, choose <b>Apps</b>, then <b>Install Built2Bid</b>.</p>
              ) : view.browser === "safari" && view.addToDock ? (
                <p>In Safari&apos;s menu bar, choose <b>File</b>, then <b>Add to Dock</b>, then <b>Add</b>.</p>
              ) : (
                <>
                  <p>{view.browser === "safari"
                    ? "This version of Safari can't install web apps. Update to macOS Sonoma or later, or open Built2Bid in Google Chrome or Microsoft Edge to install it."
                    : "This browser can't install web apps on a computer. Open Built2Bid in Google Chrome or Microsoft Edge to install it."}</p>
                  <button type="button" onClick={copyLink} className={`${buttonClass("secondary", "sm")} mt-2`} data-testid="install-desktop-copy">
                    {copied ? <><Check className="h-4 w-4" aria-hidden /> Link copied</> : <><Copy className="h-4 w-4" aria-hidden /> Copy the Built2Bid link</>}
                  </button>
                </>
              )}
              <p className="mt-2 text-xs text-muted">Built2Bid then opens from {where(view.platform)} in its own window. Same sign-in and subscription, nothing extra to buy, and it updates by itself.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Discreet menu entry: goes to the install card on Account settings. Hidden inside the installed app. */
export function InstallNavItem({ className, onNavigate }: { className: string; onNavigate?: () => void }) {
  const view = useSyncExternalStore(subscribeInstall, computeView, () => ({ kind: "hidden" }) as View);
  if (!isDesktopInstallPromoEnabled() || view.kind === "hidden" || view.kind === "mobile" || view.kind === "installed") return null;
  return (
    <a href="/settings/account#install-app" onClick={onNavigate} className={className} data-testid="nav-install-desktop">
      <Monitor className="h-4 w-4 shrink-0" aria-hidden /> Install desktop app
    </a>
  );
}
