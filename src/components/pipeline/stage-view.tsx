"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { COLUMN_HINTS, COLUMN_LABELS, type BoardBid, type Column, type ColumnTotal } from "@/lib/pipeline/board";
import { SEARCH_PLACEHOLDER, STAGE_SORTS, isStageSort, sortStage, type StageSort } from "@/lib/pipeline/stage-search";
import { ButtonLink } from "@/components/ui/button";
import { BidCard } from "./bid-card";
import { OtherStageResults, StageSearchInput, onResultKeys, useStageSearch } from "./stage-search";
import { money } from "./format";

/** Cards rendered per step in the stage view: the rest load with "Show more", never all at once. */
export const STAGE_PAGE = 24;

/**
 * Expanded stage: every bid in one stage as a responsive grid (1 column on phones up to 5 on very wide screens),
 * with the same search the stage cards use, sorting, and incremental loading. Count and total are the stage's,
 * whatever the search shows. Same moves, actions and menus as the board cards.
 */
export function StageView({ col, bids, total, allBids, capped, esign, onMove, initialQuery, onBack }: {
  col: Column; bids: BoardBid[]; total: ColumnTotal; allBids: BoardBid[]; capped: boolean; esign: boolean;
  onMove: (b: BoardBid, to: Column) => void; initialQuery: string; onBack: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<StageSort>("recent");
  // Incremental loading; starts over when the search or sort changes.
  const [page, setPage] = useState({ key: "", n: STAGE_PAGE });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const s = useStageSearch(allBids, query, col, capped);
  const searching = s.q.length > 0;
  // Searching narrows to this stage's matches (best match first); sorting applies once a sort other than the default is picked.
  const list = useMemo(() => {
    if (!searching) return sortStage(bids, sort);
    const matched = s.local.map((m) => m.bid);
    return sort === "recent" ? matched : sortStage(matched, sort);
  }, [bids, searching, s.local, sort]);
  const pageKey = `${s.q}|${sort}`;
  const limit = page.key === pageKey ? page.n : STAGE_PAGE;
  const setLimit = (f: (n: number) => number) => setPage({ key: pageKey, n: f(limit) });
  useEffect(() => { headRef.current?.scrollIntoView({ block: "start" }); headRef.current?.focus({ preventScroll: true }); }, []);
  const shown = list.slice(0, limit);
  const valueText = total.count && total.count === total.unpriced ? "No prices yet" : money(total.value);

  return (
    <section data-search-scope aria-labelledby="stage-view-title" data-testid="stage-view" data-stage={col} className="space-y-3">
      <div ref={headRef} tabIndex={-1} className="scroll-mt-20 space-y-3 rounded-xl border border-line bg-surface p-3 outline-none sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={onBack} data-testid="stage-back"
              className="-ml-1 mb-1 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-accent-ink hover:bg-accent-tint">
              <ArrowLeft className="h-4 w-4" aria-hidden />Back to Pipeline
            </button>
            <h2 id="stage-view-title" className="text-2xl font-extrabold text-navy">{COLUMN_LABELS[col]}</h2>
            <p className="text-sm text-ink-soft">
              <span data-testid="stage-count"><b className="text-ink">{total.count}</b> bid{total.count === 1 ? "" : "s"}</span>
              {" · "}<span className="tabular font-bold text-ink" data-testid="stage-total">{valueText}</span>
              {total.unpriced > 0 && total.unpriced < total.count && <> · {total.unpriced} not priced</>}
            </p>
            <p className="text-xs text-muted">{COLUMN_HINTS[col]}</p>
          </div>
          {col === "draft" && <ButtonLink href="/bids" variant="accent" size="sm">Create New Bid</ButtonLink>}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <StageSearchInput
            col={col} value={query} onChange={setQuery} placeholder={SEARCH_PLACEHOLDER[col].replace("…", " by customer, project, bid #…")}
            inputRef={inputRef} busy={s.busy} size="md" testId="stage-view-search"
            onArrowDown={() => gridRef.current?.querySelector<HTMLElement>("[data-card-link], [data-result]")?.focus()}
          />
          <select aria-label="Sort bids" className="field h-11 w-full sm:w-auto" value={sort} onChange={(e) => isStageSort(e.target.value) && setSort(e.target.value)} data-testid="stage-sort">
            {Object.entries(STAGE_SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      <div ref={gridRef} onKeyDown={onResultKeys} className="space-y-3">
        {searching && (
          <p className="text-sm text-ink-soft" aria-live="polite" data-testid="stage-search-summary">
            {s.local.length} match{s.local.length === 1 ? "" : "es"} in {COLUMN_LABELS[col]}
            {s.other.length + s.remote.length > 0 ? ` · ${s.other.length + s.remote.length} in other stages below` : ""}.
          </p>
        )}
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-muted" data-testid="stage-empty">
            {searching ? `No ${COLUMN_LABELS[col]} bids match “${query.trim()}”.` : `No bids in ${COLUMN_LABELS[col]} right now.`}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[112.5rem]:grid-cols-5" data-testid="stage-grid">
            {shown.map((b) => <li key={b.id}><BidCard b={b} esign={esign} onMove={onMove} /></li>)}
          </ul>
        )}
        {list.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted">
            <span data-testid="stage-showing">Showing {shown.length} of {list.length}</span>
            {shown.length < list.length && (
              <button type="button" onClick={() => setLimit((n) => n + STAGE_PAGE)} data-testid="stage-more"
                className="inline-flex min-h-10 items-center rounded-lg border border-line-strong bg-surface px-4 font-semibold text-ink hover:bg-paper">
                Show {Math.min(STAGE_PAGE, list.length - shown.length)} more
              </button>
            )}
          </div>
        )}
        {searching && (
          <div className="rounded-xl border border-line bg-surface p-3">
            <OtherStageResults matches={s.other} remote={s.remote} q={s.q} compact={false} />
            {s.other.length + s.remote.length === 0 && !s.busy && <p className="text-sm text-muted">No matches in other stages.</p>}
          </div>
        )}
        <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-accent-ink hover:bg-accent-tint">
          <ArrowLeft className="h-4 w-4" aria-hidden />Back to Pipeline
        </button>
      </div>
    </section>
  );
}
