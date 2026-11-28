"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { buttonClass } from "@/components/ui/button-styles";
import { CLIENT_BUILD_ID, isChunkLoadError, parseVersionInfo, updateStateFor, type UpdateState } from "@/lib/pwa/version";
import { hasUnsavedWork } from "@/lib/pwa/unsaved-work";
// Imported for its side effect: keeps the browser's one-time install event for every install button on the site.
import "@/lib/pwa/install-prompt";

/**
 * V10.1 desktop app runtime, mounted once in the root layout (website and installed app alike):
 * - registers /sw.js, which only shows a branded "You're offline" page when a launch has no internet (it caches nothing
 *   else: no pages, no API responses, no customer or financial data);
 * - shows "You're offline" while the connection is down;
 * - notices a newer production release (or a script that no longer exists after a deploy) and offers a refresh, asking
 *   the person to save first when the screen has unsaved work.
 */

const CHECK_EVERY_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;
const FIRST_CHECK_MS = 20_000;

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

export function AppRuntime() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [update, setUpdate] = useState<UpdateState>("current");
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const lastCheck = useRef(0);

  const check = useCallback(async (force = false) => {
    if (!CLIENT_BUILD_ID) return; // local dev and tests
    if (!force && Date.now() - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = Date.now();
    try {
      const r = await fetch("/api/version", { cache: "no-store", credentials: "omit" });
      if (!r.ok) return;
      const next = updateStateFor(CLIENT_BUILD_ID, parseVersionInfo(await r.json()));
      setUpdate((prev) => (prev === "required" ? prev : next));
    } catch { /* offline or blocked: try again later */ }
  }, []);

  // Offline page helper. Registered on deployed builds only; scope "/" so a launch from the desktop icon is covered.
  useEffect(() => {
    if (!CLIENT_BUILD_ID || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    if (document.readyState === "complete") register(); else window.addEventListener("load", register, { once: true });
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void check(true), FIRST_CHECK_MS);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const onOnline = () => void check(true);
    // A script chunk from the previous deploy failed to load: this window is running an old release.
    const onError = (e: ErrorEvent) => { if (isChunkLoadError(e.error ?? e.message)) { setUpdate((p) => (p === "required" ? p : "available")); setDismissed(false); } };
    const onRejection = (e: PromiseRejectionEvent) => { if (isChunkLoadError(e.reason)) { setUpdate((p) => (p === "required" ? p : "available")); setDismissed(false); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [check]);

  const refresh = (force = false) => {
    if (!force && hasUnsavedWork()) { setConfirming(true); return; }
    window.location.reload();
  };

  const showUpdate = update === "required" || (update === "available" && !dismissed);

  return (
    <>
      {!online && (
        <div role="status" aria-live="polite" data-testid="offline-banner"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-navy px-4 py-2 text-center text-sm font-semibold text-white shadow-lg">
          <WifiOff className="h-4 w-4 shrink-0 text-cyan" aria-hidden />
          You&apos;re offline. Connect to the internet to continue using Built2Bid.
        </div>
      )}
      {showUpdate && (
        <div role="status" aria-live="polite" data-testid="update-banner" data-state={update}
          className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-lg rounded-xl border border-line bg-surface p-4 text-ink shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-[32rem] sm:-translate-x-1/2">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
            <div className="min-w-0 flex-1">
              {confirming ? (
                <p className="text-sm font-semibold">You have changes that may not be saved yet. Save your work first, then refresh.</p>
              ) : (
                <p className="text-sm font-semibold">
                  Built2Bid has been updated. Refresh to use the latest version.
                  {update === "required" && <span className="mt-1 block font-normal text-ink-soft">This update is required. Save anything you&apos;re working on, then refresh.</span>}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {confirming ? (
                  <>
                    <button type="button" className={buttonClass("primary", "sm")} onClick={() => setConfirming(false)} data-testid="update-not-yet">I&apos;ll save first</button>
                    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => refresh(true)} data-testid="update-refresh-anyway">Refresh anyway</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={buttonClass("primary", "sm")} onClick={() => refresh()} data-testid="update-refresh">Refresh</button>
                    {update !== "required" && <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setDismissed(true)} data-testid="update-later">Later</button>}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
