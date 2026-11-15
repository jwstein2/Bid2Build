"use client";
import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, Columns3, List, Search } from "lucide-react";
import {
  RANGES, analytics, boardSummary, filterBoard, isRange, resolveRange, MIN_DECIDED,
  type BoardBid, type BoardDateField, type HistoryRow, type RangeKey,
} from "@/lib/pipeline/board";
import type { PaySettings } from "@/lib/pipeline/sales-pay";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { PipelineBoard } from "./pipeline-board";
import { AnalyticsView } from "./analytics-view";
import { money } from "./format";

export type BidsView = "pipeline" | "table" | "analytics";
const VIEWS: { id: BidsView; label: string; icon: typeof List }[] = [
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
  { id: "table", label: "Table", icon: List },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

/** Bids dashboard: Pipeline (default), Table (the existing list with every bid action) and Analytics. */
export function BidsWorkspace({ bids, history, esign, table, pay, paySaved, migrated, initialView }: {
  bids: BoardBid[]; history: HistoryRow[]; esign: boolean; table: ReactNode; pay: PaySettings; paySaved: boolean; migrated: boolean; initialView?: BidsView;
}) {
  const [view, setView] = useState<BidsView>(initialView ?? "pipeline");
  const [range, setRange] = useState<RangeKey>("all");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [field, setField] = useState<BoardDateField>("activity");
  const [q, setQ] = useState("");

  function pick(v: BidsView) {
    setView(v);
    const u = new URL(window.location.href); u.searchParams.set("view", v); window.history.replaceState(null, "", u);
  }

  const r = useMemo(() => resolveRange(range, new Date(), custom), [range, custom]);
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? bids.filter((b) => b.title.toLowerCase().includes(s) || b.customer.toLowerCase().includes(s) || b.number.toLowerCase().includes(s)) : bids;
  }, [bids, q]);
  const shown = useMemo(() => filterBoard(searched, r, field), [searched, r, field]);
  const summary = useMemo(() => boardSummary(shown), [shown]);
  const stats = useMemo(() => analytics(searched.filter((b) => b.status !== "archived"), history, r), [searched, history, r]);
  const rangeLabel = range === "custom" ? `${custom.from ?? "start"} to ${custom.to ?? "today"}` : RANGES[range];

  return (
    <section aria-label="Your bids" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Bids view" className="inline-flex rounded-lg border border-line bg-surface p-1">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" type="button" aria-selected={view === id} onClick={() => pick(id)} data-testid={`view-${id}`}
              className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold", view === id ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5")}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </button>
          ))}
        </div>
        {view !== "table" && (
          <div className="flex flex-wrap items-center gap-2">
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="pipeline-summary">
            <Metric label="Active pipeline" value={money(summary.activeValue)} hint="Ready, Sent and Awaiting proposals" />
            <Metric label="Open bids" value={String(summary.openCount)} hint="Draft through Awaiting" />
            <Metric label="Awaiting signature" value={String(summary.awaitingCount)} hint="Signing link out or awaiting decision" />
            <Metric label="Won value" value={money(summary.wonValue)} hint={`${summary.wonCount} won, including jobs`} />
            <Metric label="Win rate" value={summary.winRate === null ? "—" : `${summary.winRate}%`}
              hint={summary.winRate === null ? `${summary.wonCount} of ${summary.decided} decided · needs ${MIN_DECIDED}` : `${summary.wonCount} won of ${summary.decided} decided`} />
          </div>
          <p className="text-xs text-muted">
            Showing each bid&apos;s current stage{range === "all" ? "" : `, filtered by ${field === "created" ? "created date" : "last activity"}: ${rangeLabel}`}. {shown.length} bid{shown.length === 1 ? "" : "s"}.
            <span className="hidden md:inline"> Drag cards between stages, or use ⋮ to move.</span><span className="md:hidden"> Use ⋮ on a card to move it.</span>
          </p>
          {bids.length === 0 ? (
            <Card className="p-10 text-center"><p className="font-semibold">No bids yet.</p><p className="mt-1 text-sm text-muted">Create a bid and it shows up here as a Draft.</p></Card>
          ) : <PipelineBoard bids={shown} esign={esign} />}
        </>
      )}
      {view === "table" && table}
      {view === "analytics" && <AnalyticsView a={stats} rangeLabel={rangeLabel} pay={pay} paySaved={paySaved} />}
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="tabular text-xl font-extrabold text-navy">{value}</p>
      <p className="text-[11px] leading-tight text-muted">{hint}</p>
    </Card>
  );
}
