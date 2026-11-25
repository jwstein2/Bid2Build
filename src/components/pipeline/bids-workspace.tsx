"use client";
import Link from "next/link";
import type { FeatureId } from "@/lib/features/registry";
import { REVEAL_FEATURE_EVENT } from "@/lib/features/state";
import { FeatureHelp } from "@/components/features/feature-help";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, Columns3, List, Search } from "lucide-react";
import {
  BOARD_LOAD_LIMIT, FOCUS, RANGES, analytics, isColumn, boardSummary, columnTotals, filterBoard, isFocus, isRange, resolveRange, MIN_DECIDED,
  type BoardBid, type BoardDateField, type Column, type FocusKey, type HistoryRow, type RangeKey,
} from "@/lib/pipeline/board";
import type { PaySettings } from "@/lib/pipeline/sales-pay";
import { readStageQueries } from "@/lib/pipeline/stage-search";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { cn } from "@/lib/cn";
import { PipelineBoard } from "./pipeline-board";
import { AnalyticsView } from "./analytics-view";
import { money } from "./format";

export type BidsView = "pipeline" | "table" | "analytics";
const VIEWS: { id: BidsView; label: string; icon: typeof List; feature?: FeatureId }[] = [
  { id: "pipeline", label: "Pipeline", icon: Columns3, feature: "pipeline" },
  { id: "table", label: "Table", icon: List },
  { id: "analytics", label: "Analytics", icon: BarChart3, feature: "analytics" },
];

/** Page walkthrough for each view (src/lib/features/page-guides.ts): the active view decides what it teaches. */
const GUIDE_PAGE = { pipeline: "dashboard.pipeline", table: "dashboard.table", analytics: "dashboard.analytics" } as const;

/** Bids dashboard: Pipeline (default), Table (the existing list with every bid action) and Analytics. */
export function BidsWorkspace({ bids, history, esign, table, pay, paySaved, migrated, initialView, initialFocus, initialRange, initialQuery, initialDateField, initialStage = null, initialStageQueries }: {
  bids: BoardBid[]; history: HistoryRow[]; esign: boolean; table: ReactNode; pay: PaySettings; paySaved: boolean; migrated: boolean; initialView?: BidsView;
  /** From ?focus= and ?range= (validated): a KPI card's filter survives refresh, Back and shared links. */
  initialFocus?: FocusKey | null; initialRange?: RangeKey;
  /** From ?q= and ?date=, so Back from an opened bid card keeps the search and date field. */
  initialQuery?: string; initialDateField?: BoardDateField;
  /** From ?stage= (expanded stage view) and ?s_<stage>= (each stage's own search). */
  initialStage?: Column | null; initialStageQueries?: Partial<Record<Column, string>>;
}) {
  // Browser Back can restore this page from the router cache with props from an earlier visit, so in the
  // browser the address bar is the source of truth. On the server the props come from the same URL.
  const fromUrl = typeof window !== "undefined" ? new URL(window.location.href).searchParams : null;
  const [view, setView] = useState<BidsView>(() => {
    const v = fromUrl ? fromUrl.get("view") : initialView;
    return v === "table" || v === "analytics" ? v : "pipeline";
  });
  const [range, setRangeState] = useState<RangeKey>(() => {
    const r = fromUrl ? fromUrl.get("range") : initialRange;
    return isRange(r) && r !== "custom" ? r : "all";
  });
  const [focus, setFocusState] = useState<FocusKey | null>(() => {
    const f = fromUrl ? fromUrl.get("focus") : initialFocus;
    return isFocus(f) ? f : null;
  });
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [field, setField] = useState<BoardDateField>(() => ((fromUrl ? fromUrl.get("date") : initialDateField) === "created" ? "created" : "activity"));
  const [q, setQ] = useState(() => (fromUrl ? fromUrl.get("q")?.slice(0, 100) : initialQuery) ?? "");
  // Expanded stage view (?stage=draft). Opening one is a history entry, so browser Back returns to the board too.
  const [stage, setStageState] = useState<Column | null>(() => {
    const s = fromUrl ? fromUrl.get("stage") : initialStage;
    return isColumn(s) ? s : null;
  });
  const [stageQueries] = useState(() => (fromUrl ? readStageQueries((k) => fromUrl.get(k)) : initialStageQueries ?? {}));
  const boardScroll = useRef(0);
  const openedHere = useRef(false);
  const setStage = useCallback((c: Column | null) => {
    const u = new URL(window.location.href);
    if (c) {
      boardScroll.current = window.scrollY;
      openedHere.current = true;
      u.searchParams.set("view", "pipeline"); u.searchParams.set("stage", c);
      window.history.pushState(null, "", u);
      setStageState(c);
      return;
    }
    // Back to Pipeline: step back over the entry we pushed (keeps history tidy); a shared ?stage= link just drops it.
    if (openedHere.current) { openedHere.current = false; window.history.back(); return; }
    u.searchParams.delete("stage");
    window.history.replaceState(null, "", u);
    setStageState(null);
  }, []);
  // Returning to the board puts the page back where it was.
  const prevStage = useRef(stage);
  useEffect(() => {
    if (prevStage.current && !stage) { const y = boardScroll.current; requestAnimationFrame(() => window.scrollTo({ top: y })); }
    prevStage.current = stage;
  }, [stage]);

  const setViewUrl = useCallback((v: BidsView) => {
    setView(v);
    const u = new URL(window.location.href); u.searchParams.set("view", v); window.history.replaceState(null, "", u);
  }, []);
  // A feature announcement (What's New) may show a control from another view for a moment; the view the
  // person had is put back when it ends, unless they picked a view themselves meanwhile.
  const tourPrev = useRef<BidsView | null>(null);
  const pick = useCallback((v: BidsView) => { tourPrev.current = null; setViewUrl(v); }, [setViewUrl]);
  // KPI card filters are history entries (Back returns to the previous view); the range is kept in place.
  const setFocus = (k: FocusKey | null) => {
    const next = k === focus ? null : k;
    setFocusState(next);
    const u = new URL(window.location.href); u.searchParams.set("view", "pipeline");
    if (next) u.searchParams.set("focus", next); else u.searchParams.delete("focus");
    window.history.pushState(null, "", u);
  };
  const setRange = (r: RangeKey) => {
    setRangeState(r);
    const u = new URL(window.location.href);
    if (r === "all" || r === "custom") u.searchParams.delete("range"); else u.searchParams.set("range", r);
    window.history.replaceState(null, "", u);
  };
  // Search text and the date field live in the URL too, so opening a bid card and pressing Back
  // returns to the same filtered board.
  useEffect(() => {
    const u = new URL(window.location.href);
    const before = u.search;
    const s = q.trim();
    if (s) u.searchParams.set("q", s); else u.searchParams.delete("q");
    if (field === "created") u.searchParams.set("date", "created"); else u.searchParams.delete("date");
    if (u.search !== before) window.history.replaceState(null, "", u);
  }, [q, field]);
  useEffect(() => {
    const onPop = () => {
      const u = new URL(window.location.href);
      const f = u.searchParams.get("focus");
      setFocusState(isFocus(f) ? f : null);
      const r = u.searchParams.get("range");
      setRangeState(isRange(r) && r !== "custom" ? r : "all");
      const st = u.searchParams.get("stage");
      if (!isColumn(st)) openedHere.current = false;
      setStageState(isColumn(st) ? st : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const viewNow = useRef(view);
  useEffect(() => { viewNow.current = view; }, [view]);
  useEffect(() => {
    const on = (e: Event) => {
      const key = (e as CustomEvent).detail as string | null;
      const m = typeof key === "string" ? /^bids\.view:(pipeline|table|analytics)$/.exec(key) : null;
      if (m) {
        if (tourPrev.current === null) tourPrev.current = viewNow.current;
        setViewUrl(m[1] as BidsView);
      } else if (key === null && tourPrev.current !== null) {
        const back = tourPrev.current;
        tourPrev.current = null;
        setViewUrl(back);
      }
    };
    window.addEventListener(REVEAL_FEATURE_EVENT, on);
    return () => window.removeEventListener(REVEAL_FEATURE_EVENT, on);
  }, [setViewUrl]);

  const r = useMemo(() => resolveRange(range, new Date(), custom), [range, custom]);
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? bids.filter((b) => b.title.toLowerCase().includes(s) || b.customer.toLowerCase().includes(s) || b.number.toLowerCase().includes(s)) : bids;
  }, [bids, q]);
  const shown = useMemo(() => filterBoard(searched, r, field), [searched, r, field]);
  const summary = useMemo(() => boardSummary(shown), [shown]);
  const counts = useMemo(() => columnTotals(shown), [shown]);
  const focusCols = focus ? [...FOCUS[focus].columns] : null;
  const focusCount = focusCols ? focusCols.reduce((n, c) => n + counts[c].count, 0) : 0;
  const stats = useMemo(() => analytics(searched.filter((b) => b.status !== "archived"), history, r), [searched, history, r]);
  const rangeLabel = range === "custom" ? `${custom.from ?? "start"} to ${custom.to ?? "today"}` : RANGES[range];

  return (
    <section aria-label="Your bids" className="space-y-3" data-guide-page={GUIDE_PAGE[view]}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
        <div role="tablist" aria-label="Bids view" className="inline-flex rounded-lg border border-line bg-surface p-1" data-guide="bids.view-tabs">
          {VIEWS.map(({ id, label, icon: Icon, feature }) => (
            <button key={id} role="tab" type="button" aria-selected={view === id} onClick={() => pick(id)} data-testid={`view-${id}`} data-feature={feature}
              className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold", view === id ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5")}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </button>
          ))}
        </div>
        <FeatureHelp id={view === "analytics" ? "analytics" : "pipeline"} className="max-[379px]:hidden" guide data-guide="bids.help" />
        </div>
        {view !== "table" && (
          <div className="flex flex-wrap items-center gap-2" data-guide="bids.search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input aria-label="Search bids" className="field field-sm w-48 pl-9" placeholder="Search bids" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {view === "pipeline" && (
              <select aria-label="Date applies to" className="field field-sm w-auto" value={field} onChange={(e) => setField(e.target.value as BoardDateField)}>
                <option value="activity">Last activity</option><option value="created">Created</option>
              </select>
            )}
            <select aria-label="Date range" className="field field-sm w-auto" value={range} onChange={(e) => isRange(e.target.value) && setRange(e.target.value)} data-testid="range">
              {Object.entries(RANGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {range === "custom" && (
              <span className="flex items-center gap-1 text-sm">
                <input aria-label="From date" type="date" className="field field-sm w-auto" value={custom.from ?? ""} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || undefined }))} />
                <span className="text-muted">to</span>
                <input aria-label="To date" type="date" className="field field-sm w-auto" value={custom.to ?? ""} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || undefined }))} />
              </span>
            )}
          </div>
        )}
      </div>

      {!migrated && view !== "table" && (
        <p className="rounded-lg border border-warn/30 bg-warn-tint px-3 py-2 text-sm text-ink-soft" role="status">
          Pipeline moves are almost ready: a quick database update is pending. Your bids and their signature status are shown below.
        </p>
      )}

      {view === "pipeline" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" data-testid="pipeline-summary" data-guide="bids.kpis">
            <Metric k="active" focus={focus} onFocus={setFocus} label="Active pipeline" value={money(summary.activeValue)} hint="Ready, Sent and Awaiting proposals" />
            <Metric k="open" focus={focus} onFocus={setFocus} label="Open bids" value={String(summary.openCount)} hint="Draft through Awaiting" />
            <Metric k="draft" focus={focus} onFocus={setFocus} label="Drafts" value={String(counts.draft.count)} hint="Estimates you're still building" />
            <Metric k="sent" focus={focus} onFocus={setFocus} label="Sent" value={String(counts.sent.count)} hint="Proposals the customer has received" />
            <Metric k="awaiting" focus={focus} onFocus={setFocus} label="Awaiting signature" value={String(summary.awaitingCount)} hint="Signing link out or awaiting decision" />
            <Metric k="won" focus={focus} onFocus={setFocus} label="Won value" value={money(summary.wonValue)} hint={`${summary.wonCount} won, including jobs`} />
            <Metric k="decided" focus={focus} onFocus={setFocus} label="Win rate" value={summary.winRate === null ? "—" : `${summary.winRate}%`}
              hint={summary.winRate === null ? `${summary.wonCount} of ${summary.decided} decided · needs ${MIN_DECIDED}` : `${summary.wonCount} won of ${summary.decided} decided`} />
          </div>
          {focus && (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-tint px-3 py-2 text-sm text-ink" role="status" data-testid="pipeline-focus-note">
              <span>Showing <b>{FOCUS[focus].label}</b>: {focusCount} bid{focusCount === 1 ? "" : "s"}{range === "all" ? "" : ` · ${rangeLabel}`}.</span>
              <button type="button" onClick={() => setFocus(null)} className="font-semibold text-accent-ink underline">Show all stages</button>
            </p>
          )}
          <p className="text-xs text-muted">
            Showing each bid&apos;s current stage{range === "all" ? "" : `, filtered by ${field === "created" ? "created date" : "last activity"}: ${rangeLabel}`}. {shown.length} bid{shown.length === 1 ? "" : "s"}.
            <span className="hidden md:inline"> Drag cards between stages, or use ⋮ to move. Click a stage name to see all of its bids.</span><span className="md:hidden"> Swipe sideways for more stages. Use ⋮ on a card to move it.</span>
            {" "}<Link href="/dashboard/deleted" className="font-semibold text-brand hover:underline" data-testid="recently-deleted-link">Recently deleted</Link>
          </p>
          {bids.length === 0 ? (
            <Card className="p-10 text-center"><p className="font-semibold">No bids yet.</p><p className="mt-1 text-sm text-muted">Create a bid and it shows up here as a Draft.</p></Card>
          ) : focus && focusCount === 0 ? (
            <Card className="p-8 text-center" data-testid="metric-empty">
              <p className="font-semibold">{FOCUS[focus].empty}</p>
              <p className="mt-1 text-sm text-muted">{range === "all" ? "Try another card, or show every stage." : `Nothing in ${rangeLabel}. Try a wider date range.`}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => setFocus(null)} className="inline-flex min-h-10 items-center rounded-lg border border-line-strong px-3 text-sm font-semibold hover:bg-paper">Show all stages</button>
                {(focus === "draft" || focus === "open") && <ButtonLink href="/new-bid" variant="accent" size="sm">Create New Bid</ButtonLink>}
              </div>
            </Card>
          ) : <PipelineBoard bids={shown} allBids={bids} capped={bids.length >= BOARD_LOAD_LIMIT} esign={esign} focus={focusCols ?? undefined} expanded={stage} onExpand={setStage} initialQueries={stageQueries} />}
        </>
      )}
      {view === "table" && table}
      {view === "analytics" && <AnalyticsView a={stats} rangeLabel={rangeLabel} pay={pay} paySaved={paySaved} bids={searched} />}
    </section>
  );
}

function Metric({ k, focus, onFocus, label, value, hint }: { k: FocusKey; focus: FocusKey | null; onFocus: (k: FocusKey) => void; label: string; value: string; hint: string }) {
  const on = focus === k;
  return (
    <MetricCard size="sm" title={label} value={value} sub={hint} onSelect={() => onFocus(k)} pressed={on} testId={`metric-${k}`}
      action={on ? "Showing · tap to clear" : `Show ${FOCUS[k].label.toLowerCase()}`} />
  );
}
