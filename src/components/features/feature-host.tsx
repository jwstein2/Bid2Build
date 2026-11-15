"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature } from "@/lib/features/registry";
import { START_TOUR_EVENT, newlyUnlocked, tourSteps } from "@/lib/features/state";
import { loadFeatures, saveFeatures, setPendingTour, takePendingTour } from "./client";
import { UnlockedModal } from "./unlocked-modal";
import { FeatureTour, type TourEnd } from "./feature-tour";

const SETTLE_MS = 1500;
/** After checkout the webhook can land a few seconds after the redirect: re-check this many times. */
const CHECKOUT_POLLS = 8;
const POLL_MS = 3000;

function otherDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open], [data-testid="feature-tour"]'));
}

/**
 * Mounted once in the signed-in app layout. Opens "Your New Features Are Ready" when the account's
 * access includes premium features it hasn't been told about (right after a successful upgrade, or
 * once after a release), and runs the feature walkthrough on request.
 */
export function FeatureHost() {
  const pathname = usePathname();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<Feature[] | null>(null);
  const [steps, setSteps] = useState<Feature[] | null>(null);
  const checked = useRef(false);

  const begin = useCallback(async (ids: string[] | null) => {
    const v = await loadFeatures();
    const s = tourSteps(v?.signedIn ? v.access : { unlimited: false }, ids);
    if (s.length) setSteps(s);
  }, []);

  // Walkthrough requests: run on the dashboard (where most controls live); elsewhere, go there first.
  useEffect(() => {
    const on = (e: Event) => {
      const ids = ((e as CustomEvent).detail as string[] | null) ?? null;
      if (window.location.pathname === "/dashboard") void begin(ids);
      else { setPendingTour(ids); router.push("/dashboard"); }
    };
    window.addEventListener(START_TOUR_EVENT, on);
    return () => window.removeEventListener(START_TOUR_EVENT, on);
  }, [begin, router]);

  useEffect(() => {
    if (pathname !== "/dashboard") return;
    const ids = takePendingTour();
    if (ids === undefined) return;
    const t = setTimeout(() => void begin(ids), 400);
    return () => clearTimeout(t);
  }, [pathname, begin]);

  // Automatic unlocked-features modal: checked once per full page load.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    let cancelled = false;
    const afterCheckout = new URLSearchParams(window.location.search).get("checkout") === "success";
    const run = async (attempt: number) => {
      if (cancelled) return;
      const v = await loadFeatures(attempt > 0);
      if (cancelled || !v?.signedIn || !v.known) return;
      const list = newlyUnlocked(v.state, v.access);
      if (!list.length) {
        if (afterCheckout && !v.access.unlimited && attempt < CHECKOUT_POLLS) setTimeout(() => void run(attempt + 1), POLL_MS);
        return;
      }
      if (otherDialogOpen()) { setTimeout(() => void run(attempt), POLL_MS); return; }
      setUnlocked(list);
    };
    const t = setTimeout(() => void run(0), SETTLE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  const ack = useCallback((then?: () => void) => {
    const ids = (unlocked ?? []).map((f) => f.id);
    setUnlocked(null);
    void saveFeatures({ ack: ids });
    then?.();
  }, [unlocked]);

  const end = useCallback((how: TourEnd) => {
    setSteps(null);
    if (how !== "left") void saveFeatures({ tour: how });
  }, []);

  return (
    <>
      {unlocked && (
        <UnlockedModal
          features={unlocked}
          onLater={() => ack()}
          onClose={() => ack()}
          onExplore={() => {
            const ids = (unlocked ?? []).map((f) => f.id);
            ack(() => {
              if (window.location.pathname === "/dashboard") setTimeout(() => void begin(ids), 250);
              else { setPendingTour(ids); router.push("/dashboard"); }
            });
          }}
        />
      )}
      {steps && <FeatureTour key={steps.map((s) => s.id).join()} steps={steps} onEnd={end} />}
    </>
  );
}
