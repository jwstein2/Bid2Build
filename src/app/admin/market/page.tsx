import { Card } from "@/components/ui/misc";
import { loadReport, type Summary, type TrendPoint } from "@/lib/market/admin";
import { parseFilters } from "@/lib/market/filters";
import { CoverageLine, FilterBar, Histogram, Methodology, PageHeader, ReportError, Stat, SummaryCell, TrendChart, count, money } from "./ui";

export const dynamic = "force-dynamic";

interface Overview {
  bids: number; contributors: number; observations: number; project_value: Summary; volume: number | null;
  trades: number; states: number; metros: number; date_range: { from: string | null; to: string | null }; freshest: string | null;
  distribution: { label: string; n: number }[] | null; trend: TrendPoint[];
  trend_indicator: { available: boolean; change_pct?: number; recent_median?: number; prior_median?: number };
  stats_computed_at: string | null;
}

export default async function MarketOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { data: d, error } = await loadReport<Overview>("overview", filters);
  return (
    <div className="space-y-6">
      <PageHeader title="Market Intelligence" intro="What contractors are quoting, at an aggregate level. Built only from finalized proposals of businesses that opted in." meta={d?.meta} />
      <FilterBar filters={filters} base="/admin/market" extra={["material", "price", "size", "basis"]} />
      {!d ? <ReportError error={error} /> : <>
        <CoverageLine c={d.coverage} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat k="Eligible bids analyzed" v={count(d.bids)} sub="Latest finalized version per estimate" />
          <Stat k="Contributing businesses" v={count(d.contributors)} sub={`Figures need ${d.meta.min_contributors}+`} />
          <Stat k="Pricing observations" v={count(d.observations)} sub="Line items" />
          <Stat k="Quoted volume" v={d.volume === null ? "–" : money(d.volume)} sub={d.volume === null ? "Hidden: too few businesses" : "Sum of project values"} />
          <Stat k="Median project value" v={d.project_value.suppressed ? "–" : money(d.project_value.median)} sub={d.project_value.suppressed ? "Not enough data" : `Average ${money(d.project_value.mean)}`} />
          <Stat k="Trades represented" v={count(d.trades)} />
          <Stat k="Geographic coverage" v={`${count(d.states)} states`} sub={`${count(d.metros)} metro markets`} />
          <Stat k="Trend (last 3 vs prior 3 months)" v={d.trend_indicator.available ? `${d.trend_indicator.change_pct! > 0 ? "+" : ""}${d.trend_indicator.change_pct}%` : "–"} sub={d.trend_indicator.available ? `Median ${money(d.trend_indicator.prior_median)} → ${money(d.trend_indicator.recent_median)}` : "Needs 6 reportable months"} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <TrendChart points={d.trend} title="Project value over time" />
          <Histogram buckets={d.distribution} title="Project value distribution" />
        </div>
        <Card className="p-5">
          <h3 className="font-bold">Project value summary</h3>
          <div className="mt-2"><SummaryCell s={d.project_value} /></div>
          {d.stats_computed_at && <p className="mt-2 text-xs text-muted">Trend aggregates last computed {new Date(d.stats_computed_at).toLocaleString("en-US")}. Use Settings → Recompute to refresh.</p>}
        </Card>
        <Methodology meta={d.meta} />
      </>}
    </div>
  );
}
