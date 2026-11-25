"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronsDown, Maximize2 } from "lucide-react";
import {
  COLUMN_HINTS, COLUMN_LABELS, COLUMNS, JOB_COLUMNS, SALES_COLUMNS, checkMove, columnOf, columnTotals, lastActivity,
  stageForColumn, type BoardBid, type Column, type ColumnTotal, type Stage,
} from "@/lib/pipeline/board";
import { SEARCH_PLACEHOLDER, stageQueryParam } from "@/lib/pipeline/stage-search";
import { cn } from "@/lib/cn";
import { MoveDialog, type MoveExtras } from "./move-dialog";
import { BidCard } from "./bid-card";
import { DeleteDialog, postDelete } from "./delete-dialog";
import { OtherStageResults, ResultsLabel, StageSearchInput, onResultKeys, useStageSearch } from "./stage-search";
import { StageView } from "./stage-view";
import { money } from "./format";

/** Cards fully visible in a stage before its list scrolls. */
export const VISIBLE_CARDS = 4;

type Toast = { text: string; tone: "ok" | "danger"; undo?: () => void } | null;

type ColumnQueries = Partial<Record<Column, string>>;

/**
 * Kanban board. Native drag-and-drop on desktop; every move is also in each card's "Move to" menu (keyboard + touch).
 * Each stage shows at most four cards and scrolls on its own; its header opens the expanded stage view, and its own
 * mini search finds bids in that stage first, then in every other stage.
 *
 *   bids     the bids on the board (after the toolbar's search and date filters): counts, totals, cards
 *   allBids  every bid loaded for the person (no filters): what the stage searches look through
 *   capped   the loader hit its row limit, so stage searches also ask the universal search
 */
export function PipelineBoard({ bids, allBids, esign, focus, capped = false, expanded = null, onExpand, initialQueries }: {
  bids: BoardBid[]; allBids?: BoardBid[]; esign: boolean; focus?: Column[]; capped?: boolean;
  expanded?: Column | null; onExpand?: (c: Column | null) => void; initialQueries?: ColumnQueries;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, { stage: Stage; wonAt?: string | null }>>({});
  const [pending, setPending] = useState<{ bid: BoardBid; to: Column; confirm: "won" | "lost" | "reopen" | "job" } | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  // Delete: the bid waiting for confirmation, and bids hidden right away while the server catches up.
  const [deleting, setDeleting] = useState<BoardBid | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Column | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The ref is read by drag handlers that fire before React re-renders with dragId.
  const dragRef = useRef<string | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Each stage's mini search keeps its own text here, so opening a stage view and coming back keeps it.
  const [queries, setQueries] = useState<ColumnQueries>(() => initialQueries ?? {});
  const setQuery = useCallback((c: Column, v: string) => setQueries((q) => ({ ...q, [c]: v })), []);
  // ...and in the address bar, so Back from an opened bid brings each stage's search back.
  useEffect(() => {
    const u = new URL(window.location.href);
    const before = u.search;
    for (const c of COLUMNS) { const v = queries[c]?.trim(); if (v) u.searchParams.set(stageQueryParam(c), v.slice(0, 100)); else u.searchParams.delete(stageQueryParam(c)); }
    if (u.search !== before) window.history.replaceState(window.history.state, "", u);
  }, [queries]);

  // An optimistic override only applies until the refreshed server data shows the same stage.
  const apply = useCallback((list: BoardBid[]) => list.filter((b) => !hidden.has(b.id)).map((b) => {
    const o = overrides[b.id];
    return o && o.stage !== b.stage ? { ...b, ...o } : b;
  }), [overrides, hidden]);
  const view = useMemo(() => apply(bids), [apply, bids]);
  const searchable = useMemo(() => (allBids ? apply(allBids) : view), [apply, allBids, view]);
  const totals = useMemo(() => columnTotals(view), [view]);
  const byCol = useMemo(() => {
    const m = Object.fromEntries(COLUMNS.map((c) => [c, [] as BoardBid[]])) as Record<Column, BoardBid[]>;
    for (const b of view) m[columnOf(b)].push(b);
    for (const c of COLUMNS) m[c].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
    return m;
  }, [view]);

  function show(t: Toast) {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), t?.undo ? 9000 : 6000);
  }

  async function post(id: string, stage: Stage, extras: MoveExtras = {}) {
    const r = await fetch("/api/pipeline/stage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimateId: id, stage, note: extras.note || undefined, effectiveDate: extras.date || undefined }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    return r?.ok ? null : (d?.error?.message as string | undefined) ?? "Couldn't save that move. Check your connection and try again.";
  }

  async function commit(b: BoardBid, to: Column, extras: MoveExtras = {}, isUndo = false) {
    const prev = { stage: b.stage, wonAt: b.wonAt };
    const stage = stageForColumn(to, b);
    setOverrides((o) => ({ ...o, [b.id]: { stage, wonAt: to === "won" ? (extras.date ? `${extras.date}T12:00:00Z` : new Date().toISOString()) : b.wonAt } }));
    const err = await post(b.id, stage, extras);
    if (err) {
      setOverrides((o) => ({ ...o, [b.id]: prev }));
      show({ text: err, tone: "danger" });
      return;
    }
    const fromCol = columnOf(b);
    show({
      text: isUndo ? `Moved "${b.title}" back to ${COLUMN_LABELS[to]}.` : `Moved "${b.title}" to ${COLUMN_LABELS[to]}.`, tone: "ok",
      // Undo puts the stage back; the move and the undo both stay in the bid's history.
      undo: isUndo || checkMove({ ...b, stage }, fromCol).ok === false ? undefined : () => commit({ ...b, stage }, fromCol, {}, true),
    });
    router.refresh();
  }

  const setHiddenOne = (id: string, on: boolean) => setHidden((h) => { const n = new Set(h); if (on) n.add(id); else n.delete(id); return n; });

  async function commitDelete(b: BoardBid, reason?: string) {
    setHiddenOne(b.id, true);
    const err = await postDelete(b.id, "delete", reason);
    if (err) { setHiddenOne(b.id, false); show({ text: err, tone: "danger" }); return; }
    show({ text: `Deleted "${b.title}". It's kept in Recently deleted.`, tone: "ok", undo: () => void undoDelete(b) });
    router.refresh();
  }

  async function undoDelete(b: BoardBid) {
    const err = await postDelete(b.id, "restore");
    if (err) { show({ text: err, tone: "danger" }); return; }
    setHiddenOne(b.id, false);
    show({ text: `Restored "${b.title}".`, tone: "ok" });
    router.refresh();
  }

  function request(b: BoardBid, to: Column) {
    const c = checkMove(b, to);
    if (!c.ok) { show({ text: c.reason, tone: "danger" }); return; }
    if (c.confirm) setPending({ bid: b, to, confirm: c.confirm });
    else void commit(b, to);
  }

  const dragged = dragId ? view.find((b) => b.id === dragId) ?? null : null;
  const draggedNow = () => (dragRef.current ? view.find((b) => b.id === dragRef.current) ?? null : null);
  const colProps = (c: Column) => ({
    col: c, bids: byCol[c], total: totals[c], esign, onMove: request, onDelete: setDeleting, allBids: searchable, capped,
    query: queries[c] ?? "", onQuery: (v: string) => setQuery(c, v), onOpen: () => onExpand?.(c),
    dropState: dragged ? (checkMove(dragged, c).ok ? (overCol === c ? "over" : "can") : "no") as "over" | "can" | "no" : null,
    onDragOver: (e: React.DragEvent) => { const b = draggedNow(); if (b && checkMove(b, c).ok) { e.preventDefault(); if (overCol !== c) setOverCol(c); } },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOverCol(null); const b = draggedNow(); dragRef.current = null; setDragId(null); if (b) request(b, c); },
    onDragStart: (id: string) => { dragRef.current = id; setDragId(id); }, onDragEnd: () => { dragRef.current = null; setDragId(null); setOverCol(null); },
  });

  return (
    <div data-testid="pipeline-board">
      {expanded && (
        <StageView
          key={expanded} col={expanded} bids={byCol[expanded]} total={totals[expanded]} allBids={searchable} capped={capped} esign={esign} onMove={request} onDelete={setDeleting}
          initialQuery={queries[expanded] ?? ""} onBack={() => onExpand?.(null)}
        />
      )}
      {/* The board stays mounted under the stage view so each stage's search and scroll position survive the round trip.
          Row 1: selling stages. Row 2: jobs and the separate Lost / Declined outcome. Wide screens fit every column;
          narrower ones scroll sideways, one stage at a time on phones. */}
      <div className={cn(expanded && "hidden")} data-testid="pipeline-columns">
        {focus ? (
          // A KPI card narrowed the board: only the stages behind that number, in one row.
          <StageRow testId="pipeline-focus" cols={focus.length}>{focus.map((c) => <BoardColumn key={c} {...colProps(c)} />)}</StageRow>
        ) : (
          <>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Sales pipeline</h3>
            <StageRow cols={5}>{SALES_COLUMNS.map((c) => <BoardColumn key={c} {...colProps(c)} />)}</StageRow>
            <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Jobs &amp; outcomes</h3>
            <StageRow cols={4}>{[...JOB_COLUMNS, "lost" as const].map((c) => <BoardColumn key={c} {...colProps(c)} />)}</StageRow>
          </>
        )}
      </div>
      {pending && (
        <MoveDialog
          bid={pending.bid} to={pending.to} kind={pending.confirm}
          onCancel={() => setPending(null)}
          onConfirm={(extras) => { const p = pending; setPending(null); void commit(p.bid, p.to, extras); }}
        />
      )}
      {deleting && (
        <DeleteDialog bid={deleting} onCancel={() => setDeleting(null)}
          onConfirm={(reason) => { const b = deleting; setDeleting(null); void commitDelete(b, reason); }} />
      )}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        {toast && (
          <div role={toast.tone === "danger" ? "alert" : "status"} data-testid="pipeline-toast"
            className={cn("pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-2xl", toast.tone === "ok" ? "bg-navy text-white" : "bg-danger text-white")}>
            <span>{toast.text}</span>
            {toast.undo && <button type="button" onClick={() => { const u = toast.undo!; setToast(null); u(); }} className="rounded-md bg-white/15 px-2 py-1 font-bold hover:bg-white/25">Undo</button>}
          </div>
        )}
      </div>
    </div>
  );
}


/** One row of stages: a grid on tablets and desktops, a sideways-scrolling strip of stages on phones. */
function StageRow({ cols, testId, children }: { cols: number; testId?: string; children: React.ReactNode }) {
  return (
    <div className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-2 md:snap-none md:pb-1" data-testid={testId}>
      <div className="flex gap-3 md:grid md:items-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(200px, 1fr))` }}>{children}</div>
    </div>
  );
}

function BoardColumn({ col, bids, total, esign, onMove, onDelete, dropState, onDragOver, onDrop, onDragStart, onDragEnd, allBids, capped, query, onQuery, onOpen }: {
  col: Column; bids: BoardBid[]; total: ColumnTotal; esign: boolean;
  onMove: (b: BoardBid, to: Column) => void; onDelete?: (b: BoardBid) => void; dropState: "over" | "can" | "no" | null;
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
  allBids: BoardBid[]; capped: boolean; query: string; onQuery: (v: string) => void; onOpen: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const s = useStageSearch(allBids, query, col, capped);
  const searching = s.q.length > 0;
  const headId = `col-${col}`;
  const valueText = total.count && total.count === total.unpriced ? "No prices yet" : money(total.value);
  const card = (b: BoardBid) => <BidCard b={b} esign={esign} onMove={onMove} onDelete={onDelete} onDragStart={onDragStart} onDragEnd={onDragEnd} />;
  return (
    <section
      data-search-scope aria-labelledby={headId} data-testid={`column-${col}`} data-guide="bids.stage" onDragOver={onDragOver} onDrop={onDrop}
      className={cn(
        "flex w-[min(86vw,340px)] shrink-0 snap-start flex-col rounded-xl border bg-surface transition-colors md:w-auto md:min-w-0",
        dropState === "over" ? "border-accent ring-2 ring-accent/40" : dropState === "can" ? "border-dashed border-accent/60" : dropState === "no" ? "opacity-50" : "border-line",
      )}
    >
      {/* The whole heading opens this stage's full view. */}
      <button
        type="button" onClick={onOpen} data-testid={`column-${col}-open`} title={`Open all ${COLUMN_LABELS[col]} bids`}
        aria-label={`${COLUMN_LABELS[col]}: ${total.count} bid${total.count === 1 ? "" : "s"}, ${valueText}. Open the full stage.`}
        className="group/head flex w-full items-start justify-between gap-2 rounded-t-xl px-3 pb-2 pt-3 text-left transition-colors hover:bg-paper focus-visible:bg-paper active:bg-brand-tint"
      >
        <span className="min-w-0">
          <span id={headId} className="block truncate text-sm font-bold text-navy decoration-2 underline-offset-2 group-hover/head:underline">
            {COLUMN_LABELS[col]} <span className="font-semibold text-muted">· {total.count}</span>
          </span>
          <span className="block text-xs text-muted">
            <span className="tabular font-semibold text-ink-soft" data-testid={`column-${col}-value`}>{valueText}</span>
            {total.unpriced > 0 && total.unpriced < total.count && <> · {total.unpriced} not priced</>}
          </span>
        </span>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted transition-colors group-hover/head:bg-brand-tint group-hover/head:text-navy">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden /><span className="hidden 2xl:inline">Expand</span>
        </span>
      </button>
      {/* The stage's own search stays put; only the list under it scrolls. */}
      <div className="px-2 pb-2">
        <StageSearchInput
          col={col} value={query} onChange={onQuery} placeholder={SEARCH_PLACEHOLDER[col]} inputRef={inputRef} busy={s.busy}
          onArrowDown={() => resultsRef.current?.querySelector<HTMLElement>("[data-result], [data-card-link]")?.focus()}
        />
      </div>
      <div className="border-t border-line" />
      {searching ? (
        <div ref={resultsRef} onKeyDown={onResultKeys} data-testid={`column-${col}-results`}
          className="max-h-[30rem] overflow-y-auto overscroll-y-contain p-2">
          <p className="sr-only" aria-live="polite">{s.local.length} in {COLUMN_LABELS[col]}, {s.other.length + s.remote.length} in other stages.</p>
          <ResultsLabel>In {COLUMN_LABELS[col]} · {s.local.length}</ResultsLabel>
          {s.local.length === 0 ? (
            <p className="px-1 pb-1 text-xs text-muted" data-testid="local-empty">No matches in this stage.</p>
          ) : (
            <ul className="space-y-2">{s.local.map((m) => <li key={m.bid.id}>{card(m.bid)}</li>)}</ul>
          )}
          <OtherStageResults matches={s.other} remote={s.remote} q={s.q} />
          {s.local.length + s.other.length + s.remote.length === 0 && !s.busy && (
            <p className="px-1 pt-2 text-xs text-muted" data-testid="search-empty">No bids match “{query.trim()}” in any stage.</p>
          )}
        </div>
      ) : bids.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted">{COLUMN_HINTS[col]}</p>
      ) : (
        <CardList col={col} count={bids.length} onOpen={onOpen}>{bids.map((b) => <li key={b.id}>{card(b)}</li>)}</CardList>
      )}
    </section>
  );
}

/**
 * A stage's cards: exactly four fit before the list scrolls inside the column (measured, since card heights vary
 * with badges and width). A fade and a "more" control say there are more; View all opens the stage view.
 */
function CardList({ col, count, onOpen, children }: { col: Column; count: number; onOpen: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement | null>(null);
  const [maxH, setMaxH] = useState<number | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const over = count > VISIBLE_CARDS;
  const check = useCallback(() => {
    const el = ref.current;
    if (el) setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!over) { setMaxH(null); setAtEnd(true); return; }
      const li = el.children[VISIBLE_CARDS - 1] as HTMLElement | undefined;
      // Hidden (stage view open): keep the last measurement.
      if (!li || li.offsetHeight === 0) return;
      setMaxH(li.offsetTop + li.offsetHeight + 8);
      check();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [over, count, check]);
  const more = count - VISIBLE_CARDS;
  return (
    <>
      <div className="relative">
        <ul
          ref={ref} onScroll={over ? check : undefined} data-testid={`column-${col}-list`} data-scrollable={over ? "true" : "false"}
          tabIndex={over ? 0 : undefined} aria-label={over ? `${COLUMN_LABELS[col]} bids, ${count} in this stage. Scroll for more.` : undefined}
          style={over && maxH ? { maxHeight: maxH } : undefined}
          // Until measured, a cap close to four compact cards avoids a first paint thousands of pixels tall.
          className={cn("relative space-y-2 p-2", over && "overflow-y-auto overscroll-y-contain [scrollbar-width:thin]", over && !maxH && "max-h-[33rem]")}
        >
          {children}
        </ul>
        {over && !atEnd && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-none bg-gradient-to-t from-surface to-transparent" />}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 rounded-b-xl border-t border-line px-2 py-1">
        {over ? (
          <button type="button" data-testid={`column-${col}-more`}
            onClick={() => ref.current?.scrollBy({ top: (ref.current.clientHeight || 300) * 0.8, behavior: "smooth" })}
            aria-label={`Scroll for ${more} more`} title="Scroll for more"
            className={cn("inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-semibold text-muted hover:bg-black/5 hover:text-navy", atEnd && "invisible")}>
            <ChevronsDown className="h-3.5 w-3.5" aria-hidden />{more} more
          </button>
        ) : <span />}
        <button type="button" onClick={onOpen} data-testid={`column-${col}-view-all`}
          className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-bold text-accent-ink hover:bg-accent-tint">
          View all{over ? ` ${count}` : ""}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </>
  );
}
