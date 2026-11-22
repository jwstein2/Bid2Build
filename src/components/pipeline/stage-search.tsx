"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Loader2, MapPin, Search, X } from "lucide-react";
import { COLUMN_LABELS, valueOf, type BoardBid, type Column } from "@/lib/pipeline/board";
import { MATCH_LABELS, normaliseQuery, searchStages, type StageMatch } from "@/lib/pipeline/stage-search";
import { cn } from "@/lib/cn";
import { money } from "./format";

/** A bid found by the universal search that isn't among the bids loaded on the board (only when the board is capped). */
export interface RemoteMatch { id: string; title: string; customer: string | null; status: string | null; amount: number | null; href: string }

/**
 * Arrow keys move between results; Escape (or Up from the first result) goes back to the search box.
 * Put it on a results container inside an element marked data-search-scope that also holds the search box.
 */
export function onResultKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
  const input = () => e.currentTarget.closest("[data-search-scope]")?.querySelector<HTMLInputElement>("input[type=search]") ?? null;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-result], [data-card-link]")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === "Escape") { e.preventDefault(); input()?.focus(); return; }
  if (i === -1) return;
  e.preventDefault();
  if (e.key === "ArrowUp" && i === 0) { input()?.focus(); return; }
  items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

/** Compact search box used inside each stage card and in the expanded stage view. */
export function StageSearchInput({ col, value, onChange, placeholder, inputRef, onArrowDown, busy, size = "sm", testId }: {
  col: Column; value: string; onChange: (v: string) => void; placeholder: string; inputRef?: React.Ref<HTMLInputElement>;
  onArrowDown?: () => void; busy?: boolean; size?: "sm" | "md"; testId?: string;
}) {
  return (
    <div className="relative" role="search">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={inputRef} type="search" enterKeyHint="search" autoComplete="off" spellCheck={false} maxLength={100}
        aria-label={`Search ${COLUMN_LABELS[col]} bids, then other stages`} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); }
          if (e.key === "ArrowDown" && onArrowDown) { e.preventDefault(); onArrowDown(); }
        }}
        data-testid={testId ?? `column-${col}-search`}
        className={cn(
          "w-full rounded-lg border border-line bg-paper pl-8 pr-8 text-ink placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-search-cancel-button]:hidden",
          // 16px text on phones so iOS doesn't zoom the page on focus.
          size === "sm" ? "h-9 text-base sm:h-8 sm:text-[13px]" : "h-11 text-base",
        )}
      />
      {busy ? (
        <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" aria-label="Searching" />
      ) : value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-navy">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The search the stage cards and the expanded view share: local (this stage) and other-stage matches over every
 * loaded bid, plus, only when the board hit its load cap, the universal search for bids that aren't loaded.
 */
export function useStageSearch(allBids: BoardBid[], query: string, col: Column, capped: boolean) {
  const q = normaliseQuery(query);
  const result = useMemo(() => searchStages(allBids, q, col), [allBids, q, col]);
  const remote = useRemoteBids(capped ? q : "", allBids);
  return { q, ...result, remote: remote.rows, busy: remote.busy };
}

/** Debounced universal-search lookup (existing /api/search, bids only, row-level security applies). */
function useRemoteBids(q: string, loaded: BoardBid[]) {
  const [state, setState] = useState<{ q: string; rows: RemoteMatch[] }>({ q: "", rows: [] });
  const loadedIds = useMemo(() => new Set(loaded.map((b) => b.id)), [loaded]);
  const active = q.length >= 2;
  useEffect(() => {
    if (!active) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?${new URLSearchParams({ q, mode: "page", types: "estimate" })}`, { signal: ctl.signal });
        const d = r.ok ? await r.json() : null;
        const rows = ((d?.results ?? []) as { id: string; title: string; customerName: string | null; status: { label: string } | null; amount: string | null; href: string; estimateId: string | null }[])
          .filter((x) => !loadedIds.has(x.estimateId ?? x.id))
          .map((x) => ({ id: x.id, title: x.title, customer: x.customerName, status: x.status?.label ?? null, amount: x.amount === null ? null : Number(x.amount), href: x.href }));
        setState({ q, rows });
      } catch {
        if (!ctl.signal.aborted) setState({ q, rows: [] });
      }
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [active, q, loadedIds]);
  if (!active) return { rows: [] as RemoteMatch[], busy: false };
  return state.q === q ? { rows: state.rows, busy: false } : { rows: [] as RemoteMatch[], busy: true };
}

const OTHER_STEP = 5;

/** Other-stage matches: each bid on its own row with the stage it's in now. */
export function OtherStageResults({ matches, remote, q, compact = true }: { matches: StageMatch[]; remote: RemoteMatch[]; q: string; compact?: boolean }) {
  // "Show more" resets whenever the search text changes.
  const [more, setMore] = useState({ q, n: OTHER_STEP });
  const shown = more.q === q ? more.n : OTHER_STEP;
  const setShown = (f: (n: number) => number) => setMore({ q, n: f(shown) });
  const total = matches.length + remote.length;
  if (total === 0) return null;
  const list = matches.slice(0, shown);
  const remoteShown = remote.slice(0, Math.max(0, shown - matches.length));
  return (
    <div data-testid="other-stage-results">
      <p className="px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">Found in other stages · {total}</p>
      <ul className={cn(compact ? "space-y-1.5" : "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
        {list.map((m) => (
          <li key={m.bid.id}>
            <ResultRow href={`/estimates/${m.bid.id}`} customer={m.bid.customer} title={m.bid.title} stage={COLUMN_LABELS[m.column]}
              amount={valueOf(m.bid)} note={m.field === "email" || m.field === "address" || m.field === "number" ? `${MATCH_LABELS[m.field]} match` : null} testId={`result-${m.column}`} />
          </li>
        ))}
        {remoteShown.map((r) => (
          <li key={r.id}>
            <ResultRow href={r.href} customer={r.customer ?? ""} title={r.title} stage={r.status ?? "Bid"} amount={r.amount} note="Older bid" testId="result-remote" />
          </li>
        ))}
      </ul>
      {shown < total && (
        <button type="button" onClick={() => setShown((n) => n + 10)} className="mt-1.5 w-full rounded-md px-2 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-tint" data-testid="other-more">
          Show {Math.min(10, total - shown)} more of {total - shown}
        </button>
      )}
    </div>
  );
}

function ResultRow({ href, customer, title, stage, amount, note, testId }: { href: string; customer: string; title: string; stage: string; amount: number | null; note: string | null; testId: string }) {
  return (
    <Link href={href} data-result data-testid={testId}
      className="block rounded-lg border border-line bg-surface px-2.5 py-2 hover:border-brand/50 hover:bg-paper focus-visible:border-accent">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold text-ink">{customer || "No customer yet"}</span>
        {amount !== null && <span className="tabular shrink-0 text-xs font-bold text-navy">{money(amount)}</span>}
      </span>
      <span className="block truncate text-xs text-ink-soft">{title}</span>
      <span className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-[11px] font-bold text-accent-dark">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden /><span>Found in: {stage}</span>
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-accent-ink">View bid<ArrowRight className="h-3 w-3" aria-hidden /></span>
      </span>
      {note && <span className="mt-0.5 block text-[10px] text-muted">{note}</span>}
    </Link>
  );
}

/** Small section label inside a stage card's results ("In Draft · 2"). */
export function ResultsLabel({ children }: { children: ReactNode }) {
  return <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{children}</p>;
}
