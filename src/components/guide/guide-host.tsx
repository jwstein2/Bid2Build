"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Compass, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { activePage } from "@/components/features/feature-host";
import { loadGuideContext } from "@/components/features/client";
import type { TourEnd, TourStep } from "@/components/features/feature-tour";
import { pickTrade } from "@/lib/features/page-guides";
import { decideOffer, progressFor, resumeStep, stillOfferable } from "@/lib/guide/rules";
import { TOURS, getTour, guideRole, type TourDef } from "@/lib/guide/tours";
import { RUN_KEY, pageLabel, parseRun, planTour, segmentAt, type ActiveRun, type PlannedStep } from "@/lib/guide/runner";
import { OPEN_GUIDE_EVENT, START_GUIDE_TOUR_EVENT, loadGuideState, recordGuide } from "./client";

// Code for the walkthrough card and the panel loads only when it's about to open.
const FeatureTour = dynamic(() => import("@/components/features/feature-tour").then((m) => m.FeatureTour), { ssr: false });
const GuidePanel = dynamic(() => import("./guide-panel").then((m) => m.GuidePanel), { ssr: false });

const SETTLE_MS = 1800;
const MIN_KEY = "b2b:guide:min";

function otherDialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open], [data-testid="feature-tour"], [data-testid="onboarding-dialog"]'));
}
function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return Boolean(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable));
}
const readRun = () => { try { return parseRun(window.sessionStorage.getItem(RUN_KEY)); } catch { return null; } };
const writeRun = (r: ActiveRun) => { try { window.sessionStorage.setItem(RUN_KEY, JSON.stringify(r)); } catch { /* storage blocked */ } };
const clearRun = () => { try { window.sessionStorage.removeItem(RUN_KEY); } catch { /* storage blocked */ } };
const readMin = () => { try { return window.localStorage.getItem(MIN_KEY) === "1"; } catch { return false; } };

type Live = { tour: TourDef; steps: PlannedStep[]; at: number; role: string } & (
  | { phase: "showing"; segEnd: number; cards: TourStep[] }
  | { phase: "between" }
);

/**
 * The Built2Bid Guide: bottom-left launcher (just right of the app sidebar on desktop, so it never covers a menu item), smart tour offers and the multi-page tour runner.
 * Mounted in the signed-in layout; the estimate builder mounts it with launcher={false} so a tour that
 * continues into the builder picks up there. It never navigates, clicks or saves anything for the
 * person: between pages it offers a link and waits.
 */
export function GuideHost({ launcher = true }: { launcher?: boolean }) {
  const pathname = usePathname();
  const [live, setLive] = useState<Live | null>(null);
  const [offer, setOffer] = useState<{ tour: TourDef; role: string } | null>(null);
  const [panel, setPanel] = useState(false);
  const [min, setMin] = useState(false);
  const offered = useRef(false);
  const liveRef = useRef<Live | null>(null);
  const launcherBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { liveRef.current = live; }, [live]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read a per-browser preference after hydration
  useEffect(() => { setMin(readMin()); }, []);

  /** Show the part of the tour that starts at `at`, or wait for its page. */
  const show = useCallback((base: Omit<Live, "phase" | "segEnd" | "cards">, at: number) => {
    const seg = segmentAt(base.steps, at);
    if (!seg) {
      recordGuide({ event: "completed", tourId: base.tour.id, version: base.tour.version, step: base.steps.length, role: base.role });
      clearRun(); setLive(null); return;
    }
    writeRun({ tourId: base.tour.id, version: base.tour.version, at, startedAt: readRun()?.startedAt ?? Date.now() });
    const here = activePage()?.key;
    if (here === seg.page) {
      const cards: TourStep[] = base.steps.slice(seg.start, seg.end).map((s) => ({
        key: `${base.tour.id}:${s.index}`, title: s.title, body: s.body, hint: s.hint, attr: "data-guide",
        targets: typeof s.target === "string" ? [s.target] : [...s.target],
      }));
      setLive({ ...base, at, phase: "showing", segEnd: seg.end, cards });
    } else setLive({ ...base, at, phase: "between" });
  }, []);

  const start = useCallback(async (id: string, opts: { from?: number; resume?: boolean } = {}) => {
    const tour = getTour(id);
    if (!tour) return;
    setOffer(null); setPanel(false);
    const ctx = await loadGuideContext();
    const steps = planTour(tour, ctx, pickTrade([], ctx.trades));
    if (!steps.length) return;
    const role = guideRole(ctx);
    const at = Math.max(0, Math.min(opts.from ?? 0, steps.length - 1));
    if (!opts.resume) {
      clearRun();
      recordGuide({ event: "started", tourId: tour.id, version: tour.version, step: at, page: activePage()?.key, role });
    }
    show({ tour, steps, at, role }, at);
  }, [show]);

  const endPart = useCallback((how: TourEnd) => {
    const l = liveRef.current;
    if (!l || l.phase !== "showing") return;
    if (how === "dismissed") {
      recordGuide({ event: "dismissed", tourId: l.tour.id, version: l.tour.version, step: l.at, role: l.role });
      clearRun(); setLive(null); return;
    }
    if (l.segEnd < l.steps.length) recordGuide({ event: "step", tourId: l.tour.id, version: l.tour.version, step: l.segEnd, role: l.role });
    show(l, l.segEnd);
  }, [show]);

  const stop = useCallback(() => {
    const l = liveRef.current;
    if (l) recordGuide({ event: "dismissed", tourId: l.tour.id, version: l.tour.version, step: l.at, role: l.role });
    clearRun(); setLive(null);
  }, []);

  // Resume a tour left mid-way in this tab (after following a "Continue on …" link, or a reload).
  useEffect(() => {
    const r = readRun();
    if (!r || liveRef.current) return;
    const t = setTimeout(() => {
      const tour = getTour(r.tourId);
      if (!tour || tour.version !== r.version) { clearRun(); return; }
      void start(r.tourId, { from: r.at, resume: true });
    }, 600);
    return () => clearTimeout(t);
  }, [start]);

  // Between pages: watch for the next page to appear (route change, builder step, dialog) and carry on.
  useEffect(() => {
    if (live?.phase !== "between") return;
    const want = live.steps[live.at]?.page;
    const tick = () => { if (activePage()?.key === want && !otherDialogOpen()) show(live, live.at); };
    const iv = setInterval(tick, 900);
    return () => clearInterval(iv);
  }, [live, show]);

  useEffect(() => {
    const onStart = (e: Event) => { const id = (e as CustomEvent).detail; if (typeof id === "string") void start(id); };
    const onOpen = () => setPanel(true);
    window.addEventListener(START_GUIDE_TOUR_EVENT, onStart);
    window.addEventListener(OPEN_GUIDE_EVENT, onOpen);
    return () => { window.removeEventListener(START_GUIDE_TOUR_EVENT, onStart); window.removeEventListener(OPEN_GUIDE_EVENT, onOpen); };
  }, [start]);

  // Smart offer: at most one per page load, never over something else (rules.ts has the full list).
  useEffect(() => {
    if (offered.current) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled || offered.current || liveRef.current || readRun()) return;
      const state = await loadGuideState();
      if (cancelled || !state?.known || state.workspace === "demo") return;
      const page = activePage()?.key ?? null;
      if (!page) return;
      const now = Date.now();
      // Cheap check first, so most page loads never read the role/plan context.
      const maybe = TOURS.some((x) => x.trigger.kind !== "manual" && x.trigger.pages.includes(page) && stillOfferable(progressFor(state.progress, x), now));
      if (!maybe) return;
      const ctx = await loadGuideContext();
      if (cancelled) return;
      const tour = decideOffer({ ctx, workspace: state.workspace, page, progress: state.progress, createdAt: state.createdAt, welcomeDone: state.welcomeDone, busy: otherDialogOpen() || typing() || Boolean(liveRef.current), offeredThisLoad: offered.current, now });
      if (!tour) return;
      offered.current = true;
      const role = guideRole(ctx);
      setOffer({ tour, role });
      recordGuide({ event: "offered", tourId: tour.id, version: tour.version, page, role, dedupe: `offered:${tour.id}:${tour.version}:${new Date().toISOString().slice(0, 10)}` });
    }, SETTLE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pathname]);

  const answerOffer = (how: "start" | "later" | "skip") => {
    if (!offer) return;
    const { tour, role } = offer;
    setOffer(null);
    if (how === "start") { void loadGuideState().then((s) => start(tour.id, { from: resumeStep(progressFor(s?.progress ?? [], tour), tour.steps.length) })); return; }
    recordGuide({ event: how === "later" ? "snoozed" : "dismissed", tourId: tour.id, version: tour.version, role });
  };

  const toggleMin = (v: boolean) => { setMin(v); try { window.localStorage.setItem(MIN_KEY, v ? "1" : "0"); } catch { /* storage blocked */ } };
  const openPanel = () => { setPanel(true); recordGuide({ event: "launcher_opened", page: activePage()?.key }); };
  const closePanel = () => { setPanel(false); requestAnimationFrame(() => launcherBtn.current?.focus()); };

  const next = live?.phase === "between" ? live.steps[live.at] : null;
  const showing = live?.phase === "showing";

  return (
    <>
      {live?.phase === "showing" && (
        <FeatureTour key={`${live.tour.id}:${live.at}`} steps={live.cards} label={live.tour.title} page={live.cards[0] ? live.steps[live.at].page : null} onEnd={endPart} />
      )}

      {next && live && (
        <div role="dialog" aria-modal="false" aria-labelledby="guide-next-title" data-testid="guide-continue"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] left-3 right-3 md:left-[calc(16rem+0.75rem)] z-50 rounded-xl border border-line bg-surface p-4 shadow-2xl sm:right-auto sm:w-[340px] no-print">
          <p className="text-xs font-semibold text-muted">{live.tour.title} · Step {live.at + 1} of {live.steps.length}</p>
          <h2 id="guide-next-title" className="font-display text-base font-extrabold text-navy">Next: {next.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{next.href ? `This part is on ${pageLabel(next.page)}.` : next.continueHint ?? `Open ${pageLabel(next.page)} to continue.`}</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={stop} className="min-h-11 sm:min-h-9" data-testid="guide-stop">Stop tour</Button>
            {next.href && (
              <ButtonLink href={next.href} size="sm" variant="primary" className="min-h-11 sm:min-h-9" data-testid="guide-continue-link">
                Continue on {pageLabel(next.page)} <ChevronRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            )}
          </div>
        </div>
      )}

      {offer && !live && (
        <div role="dialog" aria-modal="false" aria-labelledby="guide-offer-title" aria-describedby="guide-offer-body" data-testid="guide-offer" data-tour={offer.tour.id}
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] left-3 right-3 md:left-[calc(16rem+0.75rem)] z-50 rounded-xl border border-line bg-surface p-4 shadow-2xl sm:right-auto sm:w-[360px] no-print">
          <button type="button" onClick={() => answerOffer("later")} aria-label="Close" className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-black/5 sm:h-9 sm:w-9"><X className="h-4 w-4" aria-hidden /></button>
          <div className="flex items-start gap-3 pr-8">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><Compass className="h-4 w-4" aria-hidden /></span>
            <div>
              <h2 id="guide-offer-title" className="font-display text-base font-extrabold text-navy">{offer.tour.title}</h2>
              <p id="guide-offer-body" className="mt-1 text-sm text-ink-soft">{offer.tour.offer ?? offer.tour.description}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => answerOffer("skip")} className="min-h-11 sm:min-h-9" data-testid="guide-offer-skip">Skip</Button>
            <Button size="sm" variant="secondary" onClick={() => answerOffer("later")} className="min-h-11 sm:min-h-9" data-testid="guide-offer-later">Maybe later</Button>
            <Button size="sm" variant="primary" onClick={() => answerOffer("start")} className="min-h-11 sm:min-h-9" data-testid="guide-offer-start" autoFocus>Start walkthrough</Button>
          </div>
        </div>
      )}

      {panel && <GuidePanel onClose={closePanel} onStartTour={(id) => void start(id)} onMinimize={() => { closePanel(); toggleMin(true); }} />}

      {launcher && !showing && !panel && (min ? (
        <button type="button" onClick={() => { toggleMin(false); openPanel(); }} aria-label="Open the Built2Bid Guide" data-testid="guide-launcher-min"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-0 md:left-64 z-40 grid h-11 w-6 place-items-center rounded-r-lg bg-navy text-white shadow-lg no-print">
          <Compass className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <button ref={launcherBtn} type="button" onClick={openPanel} aria-haspopup="dialog" data-testid="guide-launcher"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-3 md:left-[calc(16rem+0.75rem)] z-40 inline-flex h-11 items-center gap-2 rounded-full bg-navy px-3 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-4 no-print">
          <Compass className="h-5 w-5" aria-hidden /><span className="max-sm:sr-only">Guide</span>
        </button>
      ))}
    </>
  );
}
