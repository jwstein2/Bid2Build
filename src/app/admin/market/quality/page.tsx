import { Card } from "@/components/ui/misc";
import { loadReport } from "@/lib/market/admin";
import { parseFilters } from "@/lib/market/filters";
import { CoverageLine, FilterBar, Methodology, PageHeader, ReportError, Stat, count } from "../ui";

export const dynamic = "force-dynamic";

interface Quality {
  bids: number; contributors: number; lines: number; usable_precise_lines: number; unclassified_lines: number; review_queue: number;
  confidence_histogram: { bucket: number; n: number }[]; missing_work_type: number; missing_project_type: number; missing_size: number;
  inferred_size: number; missing_location: number; state_conflicts: number; costs_shared_bids: number; excluded: { observations: number; lines: number };
  superseded_versions: number; freshness: { latest_capture: string | null; last_90_days: number };
  trades_meeting_threshold: number; trades_below_threshold: number; states_meeting_threshold: number; states_below_threshold: number;
  min_contributors: number; last_refresh: { started_at: string; finished_at: string | null } | null;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

export default async function DataQuality({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { data: d, error } = await loadReport<Quality>("quality", filters);
  const bucketLabels = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
  return (
    <div className="space-y-6">
      <PageHeader title="Data quality" intro="How much of the dataset is usable, how confident the classifications are, and where coverage is thin." meta={d?.meta} />
      <FilterBar filters={filters} base="/admin/market/quality" />
      {!d ? <ReportError error={error} /> : <>
        <CoverageLine c={d.coverage} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat k="Usable observations" v={count(d.usable_precise_lines)} sub={`${pct(d.usable_precise_lines, d.lines)} of ${count(d.lines)} line items`} />
          <Stat k="Unique contributors" v={count(d.contributors)} sub={`${count(d.bids)} bids`} />
          <Stat k="Unclassified items" v={count(d.unclassified_lines)} sub={`${count(d.review_queue)} item texts awaiting review`} />
          <Stat k="Costs shared" v={pct(d.costs_shared_bids, d.bids)} sub={`${count(d.costs_shared_bids)} bids`} />
          <Stat k="Missing scope" v={count(d.missing_work_type)} sub={`work type · ${count(d.missing_project_type)} without project type`} />
          <Stat k="Missing project size" v={count(d.missing_size)} sub={`${count(d.inferred_size)} sizes inferred from line items`} />
          <Stat k="Missing location" v={count(d.missing_location)} sub={`${count(d.state_conflicts)} ZIP/state conflicts`} />
          <Stat k="Freshness" v={d.freshness.latest_capture ? new Date(d.freshness.latest_capture).toLocaleDateString("en-US") : "–"} sub={`${count(d.freshness.last_90_days)} bids in the last 90 days`} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Classification confidence</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {bucketLabels.map((l, i) => { const n = d.confidence_histogram.find((b) => b.bucket === i + 1)?.n ?? 0; const max = Math.max(1, ...d.confidence_histogram.map((b) => b.n)); return (
                <li key={l} className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2"><span className="text-ink-soft">{l}</span><span className="h-2.5 rounded-r bg-brand" style={{ width: `${(n / max) * 100}%` }} /><span className="tabular text-right font-semibold">{count(n)}</span></li>
              ); })}
            </ul>
            <p className="mt-2 text-xs text-muted">Items below {Math.round(d.meta.precise_confidence * 100)}% stay out of precise material comparisons until reviewed.</p>
          </Card>
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Coverage and suppression</h2>
            <table className="mt-3 w-full text-sm"><tbody>
              <tr className="border-t border-line"><td className="py-1.5">Trades with {d.min_contributors}+ businesses</td><td className="tabular text-right font-semibold">{d.trades_meeting_threshold}</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">Trades suppressed (below minimum)</td><td className="tabular text-right font-semibold">{d.trades_below_threshold}</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">States with {d.min_contributors}+ businesses</td><td className="tabular text-right font-semibold">{d.states_meeting_threshold}</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">States suppressed</td><td className="tabular text-right font-semibold">{d.states_below_threshold}</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">Superseded versions (not counted)</td><td className="tabular text-right font-semibold">{count(d.superseded_versions)}</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">Excluded as confirmed errors</td><td className="tabular text-right font-semibold">{count(d.excluded.observations)} bids · {count(d.excluded.lines)} lines</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">Last recompute</td><td className="text-right">{d.last_refresh ? new Date(d.last_refresh.started_at).toLocaleString("en-US") : "Never"}</td></tr>
            </tbody></table>
          </Card>
        </div>
        <Methodology meta={d.meta} />
      </>}
    </div>
  );
}
