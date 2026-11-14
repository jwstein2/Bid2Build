"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOCAL_KEY, OPEN_TOUR_EVENT, decide, hasSessionCookie, isBusySearch, isEligiblePath, looksReturning, needsServer, parseLocal,
  type LocalOnboarding, type OnboardingStatus, type ServerView,
} from "@/lib/onboarding/state";
import { readIntent } from "@/lib/billing/checkout-intent";
import type { TourExit } from "./onboarding-tour";

// The tour's code loads only when it's about to open, so pages don't pay for it up front.
const OnboardingTour = dynamic(() => import("./onboarding-tour").then((m) => m.OnboardingTour), { ssr: false });

/** How long after the page is ready before the automatic popup opens. */
const SETTLE_MS = 1200;

function readLocal(): LocalOnboarding | null {
  try { return parseLocal(window.localStorage.getItem(LOCAL_KEY)); } catch { return null; }
}
function writeLocal(v: LocalOnboarding) {
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { /* private mode: best effort */ }
}
function storageKeys(): string[] {
  try { return Object.keys(window.localStorage); } catch { return []; }
}
/** A checkout started in this browser in the last hour and hasn't finished or been cancelled. */
function checkoutBusy(): boolean {
  const { intent } = readIntent();
  return intent?.status === "pending" || intent?.status === "redirected";
}
/** Another dialog (sign-in, checkout, upgrade) is open: never stack the welcome popup on top. */
function otherDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]'));
}

async function fetchServer(): Promise<ServerView | null> {
  try {
    const r = await fetch("/api/onboarding", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return null;
    const j = (await r.json()) as { signedIn?: boolean; status?: OnboardingStatus | null; known?: boolean };
    return j.signedIn ? { signedIn: true, status: j.status ?? null, known: Boolean(j.known) } : { signedIn: false };
  } catch {
    return null;
  }
}

async function pushServer(status: "dismissed" | "completed"): Promise<boolean> {
  try {
    const r = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Mounted once in the root layout. Opens the one-time welcome popup for new visitors and new
 * accounts on eligible pages, and opens the tour on demand (replay) from anywhere.
 */
export function OnboardingHost() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"auto" | "replay">("auto");
  const [session, setSession] = useState(0); // remounts the tour at step 1 on every open
  const autoChecked = useRef(false);
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  const signedIn = useRef(false);

  const show = useCallback((m: "auto" | "replay") => {
    setMode(m);
    setSession((n) => n + 1);
    setOpen(true);
  }, []);

  // Manual replay: works on any page, never touches the saved status.
  useEffect(() => {
    const onOpen = () => show("replay");
    window.addEventListener(OPEN_TOUR_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, onOpen);
  }, [show]);

  // Automatic popup: evaluated at most once per full page load, on the first eligible page.
  useEffect(() => {
    if (autoChecked.current || openRef.current) return;
    if (!isEligiblePath(pathname) || isBusySearch(window.location.search)) return;
    autoChecked.current = true;
    let cancelled = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      started = true;
      if (checkoutBusy()) return;
      const local = readLocal();
      const cookie = hasSessionCookie(document.cookie);
      const server = needsServer(local, cookie) ? await fetchServer() : null;
      if (cancelled) { autoChecked.current = false; return; }
      // A session cookie but no answer (network error): don't guess for a possibly existing account.
      if (cookie && !server && needsServer(local, cookie)) return;
      signedIn.current = server?.signedIn === true;
      const d = decide({ local, returning: looksReturning(storageKeys()), server, now: new Date().toISOString() });
      if (!d.show) {
        if (d.writeLocal) writeLocal(d.writeLocal);
        if (d.pushToServer === "dismissed" || d.pushToServer === "completed") {
          const ok = await pushServer(d.pushToServer);
          if (!ok && d.writeLocal) writeLocal({ ...d.writeLocal, synced: false });
        }
        return;
      }
      if (otherDialogOpen() || checkoutBusy() || openRef.current || !isEligiblePath(window.location.pathname)) {
        autoChecked.current = false; // try again on the next eligible page
        return;
      }
      show("auto");
    };

    const start = () => { timer = setTimeout(() => { void run(); }, SETTLE_MS); };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("load", start);
      // Left the page before the check ran: evaluate again on the next eligible page.
      if (!started) autoChecked.current = false;
    };
  }, [pathname, show]);

  const onExit = useCallback((how: TourExit) => {
    setOpen(false);
    if (mode !== "auto") return; // replay never changes onboarding status
    const at = new Date().toISOString();
    const signed = signedIn.current || hasSessionCookie(document.cookie);
    writeLocal({ status: how, at, synced: false });
    if (signed) void pushServer(how).then((ok) => { if (ok) writeLocal({ status: how, at, synced: true }); });
  }, [mode]);

  const onCreateBid = useCallback(() => {
    // The real New Bid flow: trade chooser first, then company or customer & project routing.
    router.push("/bids");
  }, [router]);

  if (session === 0) return null;
  return <OnboardingTour key={session} open={open} onExit={onExit} onCreateBid={onCreateBid} />;
}
