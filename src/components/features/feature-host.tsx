"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getFeature, type Feature } from "@/lib/features/registry";
import { START_TOUR_EVENT, newlyUnlocked, revealKeyFor, tourSteps } from "@/lib/features/state";
import { PAGE_GUIDES, isPageKey, pickTrade, resolveGuide, type PageKey } from "@/lib/features/page-guides";
import { loadFeatures, loadGuideContext, saveFeatures } from "./client";
import { UnlockedModal } from "./unlocked-modal";
import { FeatureTour, findTarget, type TourEnd, type TourStep } from "./feature-tour";
import { FEATURE_ICONS } from "./icons";

const SETTLE_MS = 1500;
/** After checkout the webhook can land a few seconds after the redirect: re-check this many times. */
const CHECKOUT_POLLS = 8;
const POLL_MS = 3000;

function otherDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open], [data-testid="feature-tour"]'));
}

function shown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * The page guide for what's on screen: the innermost visible `data-guide-page`, preferring one inside an
 * open dialog (e.g. a wizard over a page). Returns the element too, for its trade.
 */
export function activePage(): { key: PageKey; el: HTMLElement } | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-guide-page]")].filter((el) => isPageKey(el.dataset.guidePage) && shown(el));
  const inDialog = all.filter((el) => el.closest('[role="dialog"]:not([data-testid="tour-card"])'));
  const pool = inDialog.length ? inDialog : all;
  const innermost = pool.filter((el) => !pool.some((o) => o !== el && el.contains(o)));
  const el = innermost[innermost.length - 1];
  return el ? { key: el.dataset.guidePage as PageKey, el } : null;
}

/** Trades the screen is about (a bid's or a project's), which win over the account's usual trades. */
function screenTrades(el: HTMLElement): string[] {
  const own = el.closest<HTMLElement>("[data-guide-trade]") ?? el.querySelector<HTMLElement>("[data-guide-trade]");
  return (own?.dataset.guideTrade ?? "").split(/\s+/).filter(Boolean);
}

type Run = { steps: TourStep[]; label?: string; page: PageKey | null };

/**
 * Mounted in the signed-in app layout (and the estimate builder and owner command center with
 * `auto={false}`). "Feature walkthrough" teaches the page and view on screen, right there: no route
 * change, no view switch, nothing reset. Feature announcements (What's New, "Your New Features Are
 * Ready") walk through the named features on the current page too. With `auto`, it also opens "Your New
 * Features Are Ready" when the account has premium features it hasn't been told about.
 */
export function FeatureHost({ auto = true }: { auto?: boolean }) {
  const [unlocked, setUnlocked] = useState<Feature[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const checked = useRef(false);

  const beginPage = useCallback(async () => {
    const ctx = await loadGuideContext();
    const page = activePage();
    if (!page) { setRun({ steps: [], page: null }); return; }
    const trade = pickTrade(screenTrades(page.el), ctx.trades);
    const steps: TourStep[] = resolveGuide(page.key, ctx, trade).map((s) => ({ ...s, attr: "data-guide" as const }));
    // Only steps whose control is on screen now (or one a step opens itself) are counted and shown.
    setRun({ steps: steps.filter((s) => s.reveal || findTarget(s)), label: PAGE_GUIDES[page.key].label, page: page.key });
  }, []);

  const beginFeatures = useCallback(async (ids: string[]) => {
    const v = await loadFeatures();
    const list = tourSteps(v?.signedIn ? v.access : { unlimited: false }, ids);
    const steps: TourStep[] = list.map((f) => ({
      key: `feature:${f.id}`,
      title: f.walkthrough.title,
      body: f.walkthrough.body,
      targets: f.target ? [f.target] : [],
      attr: "data-feature",
      reveal: f.target ? revealKeyFor(f) : undefined,
      icon: FEATURE_ICONS[f.id],
      optional: { href: f.route, label: `Open ${f.name}` },
    }));
    if (steps.length) setRun({ steps, label: "New features", page: null });
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const ids = ((e as CustomEvent).detail as string[] | null) ?? null;
      if (ids?.length && ids.every((id) => getFeature(id))) void beginFeatures(ids);
      else void beginPage();
    };
    window.addEventListener(START_TOUR_EVENT, on);
    return () => window.removeEventListener(START_TOUR_EVENT, on);
  }, [beginPage, beginFeatures]);

  // Automatic unlocked-features modal: checked once per full page load.
  useEffect(() => {
    if (!auto || checked.current) return;
    checked.current = true;
    let cancelled = false;
    const afterCheckout = new URLSearchParams(window.location.search).get("checkout") === "success";
    const check = async (attempt: number) => {
      if (cancelled) return;
      const v = await loadFeatures(attempt > 0);
      if (cancelled || !v?.signedIn || !v.known) return;
      const list = newlyUnlocked(v.state, v.access);
      if (!list.length) {
        if (afterCheckout && !v.access.unlimited && attempt < CHECKOUT_POLLS) setTimeout(() => void check(attempt + 1), POLL_MS);
        return;
      }
      if (otherDialogOpen()) { setTimeout(() => void check(attempt), POLL_MS); return; }
      setUnlocked(list);
    };
    const t = setTimeout(() => void check(0), SETTLE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [auto]);

  const ack = useCallback((then?: () => void) => {
    const ids = (unlocked ?? []).map((f) => f.id);
    setUnlocked(null);
    void saveFeatures({ ack: ids });
    then?.();
  }, [unlocked]);

  const end = useCallback((how: TourEnd) => {
    const page = run?.page ?? null;
    setRun(null);
    if (!run?.steps.length) return;
    if (page) { if (how === "completed") void saveFeatures({ guide: page }); }
    else void saveFeatures({ tour: how });
  }, [run]);

  return (
    <>
      {unlocked && (
        <UnlockedModal
          features={unlocked}
          onLater={() => ack()}
          onClose={() => ack()}
          onExplore={() => {
            const ids = (unlocked ?? []).map((f) => f.id);
            ack(() => setTimeout(() => void beginFeatures(ids), 250));
          }}
        />
      )}
      {run && <FeatureTour key={run.steps.map((s) => s.key).join() || "empty"} steps={run.steps} label={run.label} page={run.page} onEnd={end} />}
    </>
  );
}
