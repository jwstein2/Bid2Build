"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, CirclePlay, Compass, ListChecks, Minus, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { activePage } from "@/components/features/feature-host";
import { loadGuideContext, startFeatureTour, type GuideView } from "@/components/features/client";
import { DemoEnterButton } from "@/components/demo/demo-controls";
import { PAGE_GUIDES, pickTrade } from "@/lib/features/page-guides";
import { OPEN_TOUR_EVENT } from "@/lib/onboarding/state";
import { getResource, helpIndex, searchHelp, type HelpEntry } from "@/lib/guide/help";
import { progressFor } from "@/lib/guide/rules";
import { eligibleTours } from "@/lib/guide/tours";
import { loadGuideState, recordGuide, type GuideState } from "./client";

const row = "flex w-full min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent";

/**
 * The Guide menu: walk through this page, guided tours, the first-bid checklist, the video, help
 * search (works with no AI), optional Ask Built2Bid, Practice Mode and restarting onboarding. Only
 * tours and help this person can use are listed (same plan/role rules as the walkthroughs).
 */
export function GuidePanel({ onClose, onStartTour, onMinimize }: { onClose: () => void; onStartTour: (id: string) => void; onMinimize: () => void }) {
  const [ctx, setCtx] = useState<GuideView | null>(null);
  const [state, setState] = useState<GuideState | null>(null);
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<{ phase: "idle" | "asking" | "done"; answer?: string | null; error?: string }>({ phase: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const searched = useRef(false);
  const page = useMemo(() => (typeof document === "undefined" ? null : activePage()?.key ?? null), []);

  useEffect(() => {
    void loadGuideContext().then(setCtx);
    void loadGuideState().then(setState);
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ws = state?.workspace ?? "real";
  const tours = ctx ? eligibleTours(ctx, ws) : [];
  const index = useMemo(() => (ctx ? helpIndex(ctx, ws, pickTrade([], ctx.trades)) : []), [ctx, ws]);
  const results = q.trim().length >= 2 ? searchHelp(index, q, 6, page) : [];

  useEffect(() => {
    if (q.trim().length < 3 || searched.current) return;
    const t = setTimeout(() => { searched.current = true; recordGuide({ event: "help_search", page: page ?? undefined }); }, 1200);
    return () => clearTimeout(t);
  }, [q, page]);

  const openResult = (r: HelpEntry) => {
    recordGuide({ event: "help_viewed", page: page ?? undefined, dedupe: `help:${r.id}:${new Date().toISOString().slice(0, 10)}` });
    if (r.tourId) { onStartTour(r.tourId); return; }
    if (r.page && r.page === page) { onClose(); startFeatureTour(); }
  };

  const askAi = async () => {
    if (q.trim().length < 3) return;
    setAsk({ phase: "asking" });
    try {
      const r = await fetch("/api/guide/ask", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ question: q.trim(), page: page ?? undefined, ctx: ctx ? { unlimited: ctx.unlimited, admin: ctx.admin, pm: ctx.pm, company: ctx.company } : undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setAsk({ phase: "done", error: j?.error?.message ?? "Ask Built2Bid isn't available right now. The help results below still work." });
      else setAsk({ phase: "done", answer: j.answer ?? null });
    } catch {
      setAsk({ phase: "done", error: "You seem to be offline. Try again in a moment." });
    }
  };

  const video = getResource("video.getting-started");
  return (
    <div ref={box} role="dialog" aria-modal="false" aria-labelledby="guide-title" data-testid="guide-panel"
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-3 right-3 z-50 flex max-h-[min(640px,calc(100dvh-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:right-auto sm:w-[380px] no-print">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Compass className="h-5 w-5 text-accent-ink" aria-hidden />
        <h2 id="guide-title" className="flex-1 font-display text-base font-extrabold text-navy">Built2Bid Guide</h2>
        <button type="button" onClick={onMinimize} aria-label="Minimize the Guide" className="grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-black/5 sm:h-9 sm:w-9" data-testid="guide-minimize"><Minus className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={onClose} aria-label="Close the Guide" className="grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-black/5 sm:h-9 sm:w-9" data-testid="guide-close"><X className="h-4 w-4" aria-hidden /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <label className="relative mx-1 mb-2 block">
          <span className="sr-only">Search help</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input data-autofocus value={q} onChange={(e) => { setQ(e.target.value); if (ask.phase !== "asking") setAsk({ phase: "idle" }); }} placeholder="Search help, e.g. add a customer"
            className="min-h-11 w-full rounded-lg border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent" data-testid="guide-search" maxLength={300} />
        </label>

        {q.trim().length >= 2 && (
          <div aria-live="polite" className="mb-2" data-testid="guide-results">
            {results.length ? results.map((r) => {
              const inner = (<>
                <BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block font-semibold">{r.title}</span><span className="block text-xs text-muted">{r.source} · {r.body}</span></span>
              </>);
              return r.href
                ? <Link key={r.id} href={r.href} className={row} onClick={() => { openResult(r); onClose(); }} data-testid="guide-result">{inner}</Link>
                : <button key={r.id} type="button" className={row} onClick={() => openResult(r)} data-testid="guide-result">{inner}</button>;
            }) : <p className="px-3 py-2 text-sm text-muted">No help notes match yet. Try other words, or email support@built2bid.org.</p>}
            {state?.ai && q.trim().length >= 3 && (
              <div className="mx-1 mt-2 rounded-lg border border-line p-3">
                {ask.phase === "done" && ask.answer && <p className="text-sm text-ink" data-testid="guide-ai-answer">{ask.answer}</p>}
                {ask.phase === "done" && !ask.answer && <p className="text-sm text-muted">{ask.error ?? "Built2Bid's help notes don't cover that yet. Try the results above or email support@built2bid.org."}</p>}
                {ask.phase !== "done" && (
                  <button type="button" onClick={() => void askAi()} disabled={ask.phase === "asking"} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent-ink" data-testid="guide-ask">
                    <Sparkles className="h-4 w-4" aria-hidden /> {ask.phase === "asking" ? "Asking…" : "Ask Built2Bid"}
                  </button>
                )}
                <p className="mt-1 text-[11px] text-muted">Answers come only from Built2Bid&apos;s help notes and can be wrong.</p>
              </div>
            )}
          </div>
        )}

        <button type="button" className={row} onClick={() => { onClose(); startFeatureTour(); }} data-testid="guide-page-walkthrough">
          <Compass className="h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
          <span className="flex-1"><span className="block font-semibold">Walk me through this page</span>{page && <span className="block text-xs text-muted">{PAGE_GUIDES[page].label}</span>}</span>
        </button>

        {tours.length > 0 && <p className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted">Guided tours</p>}
        {tours.map((t) => {
          const done = progressFor(state?.progress ?? [], t)?.status === "completed";
          return (
            <button key={t.id} type="button" className={row} onClick={() => onStartTour(t.id)} data-testid={`guide-tour-${t.id}`}>
              {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
              <span className="flex-1"><span className="block font-semibold">{t.title}</span><span className="block text-xs text-muted">{done ? "Done. Replay any time." : t.description}</span></span>
            </button>
          );
        })}

        <p className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted">Learn</p>
        {ws !== "demo" && (
          <Link href="/dashboard#first-bid-checklist" className={row} onClick={() => { recordGuide({ event: "checklist_opened" }); onClose(); }} data-testid="guide-checklist">
            <ListChecks className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="flex-1 font-semibold">First-bid checklist</span>
          </Link>
        )}
        {video && (
          <button type="button" className={row} onClick={() => { onClose(); window.dispatchEvent(new Event(OPEN_TOUR_EVENT)); }} data-testid="guide-video">
            <CirclePlay className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="flex-1 font-semibold">{video.title}</span>
          </button>
        )}
        <Link href="/academy" className={row} onClick={onClose}><BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="flex-1 font-semibold">Contractor Academy</span></Link>
        {ws !== "demo" && tours.some((t) => t.id === "first-estimate") && (
          <button type="button" className={row} onClick={() => onStartTour("first-estimate")} data-testid="guide-restart">
            <RotateCcw className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="flex-1 font-semibold">Restart onboarding</span>
          </button>
        )}

        {state?.practice && ws === "real" && (
          <div className="mx-1 mt-3 rounded-lg bg-paper p-3">
            <p className="text-sm font-semibold text-ink">Practice with sample data</p>
            <p className="mt-0.5 text-xs text-muted">A separate practice workspace with sample bids. Nothing you do there touches your real account.</p>
            <DemoEnterButton kind="practice" className="mt-2" />
          </div>
        )}
        {ws !== "real" && (
          <p className="mx-1 mt-3 rounded-lg bg-paper p-3 text-xs text-muted">You&apos;re in {ws === "demo" ? "Demo Mode" : "Practice Mode"}. Tours here don&apos;t change your real account&apos;s onboarding.</p>
        )}
      </div>
    </div>
  );
}
