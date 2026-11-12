import { Card } from "@/components/ui/misc";
import { loadReport, type Summary, type TrendPoint } from "@/lib/market/admin";
import { parseFilters } from "@/lib/market/filters";
import { US_STATES } from "@/lib/market/geo";
import { tradeModel } from "@/lib/market/trade-models";
import { CoverageLine, FilterBar, Methodology, PageHeader, RangeBar, ReportError, SummaryCell, TrendChart } from "../ui";

export const dynamic = "force-dynamic";

interface Geo { level: string; segments: { key: string; n: number; contributors: number; price: Summary; per_unit: Summary | null }[]; suppressed_segments: number; unmapped: number; trend: TrendPoint[] }

export default async function Geography({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { data: d, error } = await loadReport<Geo>("geo", filters);
  const unit = filters.trade ? tradeModel(filters.trade).primary?.unit : null;
  const max = d ? Math.max(1, ...d.segments.map((s) => (s.price.suppressed ? 0 : s.price.p75))) : 1;
  return (
    <div className="space-y-6">
      <PageHeader title="Geographic intelligence" intro="National, state, metro and ZIP views. ZIP-level rows are listed only when they clear the contributor threshold; smaller areas are counted but never named." meta={d?.meta} />
      <FilterBar filters={filters} base="/admin/market/geography" extra={["level", "basis"]} />
      {!d ? <ReportError error={error} /> : <>
        <CoverageLine c={d.coverage} />
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2">{d.level}</th><th className="px-4 py-2">Median project bid</th><th className="w-1/4 px-4 py-2">Distribution</th>{unit && <th className="px-4 py-2">Price per {unit}</th>}</tr></thead>
            <tbody>
              {d.segments.map((s) => (
                <tr key={s.key} className="border-t border-line align-top">
                  <td className="px-4 py-2 font-semibold">{d.level === "state" ? `${US_STATES[s.key] ?? s.key}` : s.key}</td>
                  <td className="px-4 py-2"><SummaryCell s={s.price} /></td>
                  <td className="px-4 py-3"><RangeBar s={s.price} max={max} label={s.key} /></td>
                  {unit && <td className="px-4 py-2"><SummaryCell s={s.per_unit} unit={unit} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">{d.suppressed_segments} area(s) below the reporting minimum{d.unmapped ? ` · ${d.unmapped} bids without a usable location` : ""}.</p>
        </Card>
        <TrendChart points={d.trend} title={filters.state ? `${US_STATES[filters.state]}: median project bid` : "National median project bid"} />
        <Methodology meta={d.meta} />
      </>}
    </div>
  );
}
