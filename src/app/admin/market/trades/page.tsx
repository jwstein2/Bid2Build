import { Card } from "@/components/ui/misc";
import { loadReport, type Summary, type TrendPoint } from "@/lib/market/admin";
import { parseFilters } from "@/lib/market/filters";
import { tradeModel } from "@/lib/market/trade-models";
import { CoverageLine, FilterBar, Methodology, PageHeader, RangeBar, ReportError, SummaryCell, TrendChart, keyLabel, tradeName } from "../ui";

export const dynamic = "force-dynamic";

interface Trades {
  trades: { trade: string; n: number; price: Summary; margin: Summary }[];
  per_unit: { trade: string; unit: string; complexity: string; project_type: string; stats: Summary }[];
  groups: { trade: string; category: string; bids: number; contributors: number; price: Summary }[];
  named_groups: { trade: string; name: string; contributors: number; uses: number }[];
  trend: TrendPoint[] | null;
}

export default async function TradeAnalytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { data: d, error } = await loadReport<Trades>("trades", filters);
  const max = d ? Math.max(1, ...d.trades.map((t) => (t.price.suppressed ? 0 : t.price.p75))) : 1;
  return (
    <div className="space-y-6">
      <PageHeader title="Trade analytics" intro="Project bid distributions by trade, price per standardized project unit where scope and size make it meaningful, and the project groups contractors use." meta={d?.meta} />
      <FilterBar filters={filters} base="/admin/market/trades" extra={["price", "size", "basis"]} />
      {!d ? <ReportError error={error} /> : <>
        <CoverageLine c={d.coverage} />
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2">Trade</th><th className="px-4 py-2">Bids</th><th className="px-4 py-2">Median project bid (25th to 75th)</th><th className="w-1/4 px-4 py-2">Distribution</th><th className="px-4 py-2">Median gross margin</th></tr></thead>
            <tbody>
              {d.trades.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No observations match these filters.</td></tr>}
              {d.trades.map((t) => (
                <tr key={t.trade} className="border-t border-line align-top">
                  <td className="px-4 py-2 font-semibold">{tradeName(t.trade)}</td>
                  <td className="tabular px-4 py-2">{t.n}</td>
                  <td className="px-4 py-2"><SummaryCell s={t.price} /></td>
                  <td className="px-4 py-3"><RangeBar s={t.price} max={max} label={tradeName(t.trade)} /></td>
                  <td className="px-4 py-2"><SummaryCell s={t.margin} unit="%" /><span className="block text-[11px] text-muted">Only businesses that shared costs</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {d.trend && <TrendChart points={d.trend} title={`${tradeName(filters.trade!)}: median project bid`} />}
        <Card className="overflow-x-auto p-5">
          <h2 className="font-display text-lg font-bold">Price per standardized project unit</h2>
          <p className="text-xs text-muted">Single-trade projects with a measured size only, split by project type and complexity so unlike projects are not averaged together.</p>
          <table className="mt-3 w-full min-w-[640px] text-sm"><tbody>
            {d.per_unit.length === 0 && <tr><td className="py-3 text-muted">No measured projects yet.</td></tr>}
            {d.per_unit.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-2 pr-3 font-semibold">{tradeName(r.trade)}</td>
                <td className="py-2 pr-3 text-ink-soft">{tradeModel(r.trade).projectTypes.find((p) => p.value === r.project_type)?.label ?? r.project_type.replace(/_/g, " ")}</td>
                <td className="py-2 pr-3 text-ink-soft" title={tradeModel(r.trade).complexityRule}>{r.complexity}</td>
                <td className="py-2"><SummaryCell s={r.stats} unit={r.unit} /></td>
              </tr>
            ))}
          </tbody></table>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Common project groups</h2>
            <p className="text-xs text-muted">Groups standardized by their dominant item category.</p>
            <table className="mt-3 w-full text-sm"><tbody>
              {d.groups.slice(0, 30).map((g, i) => (
                <tr key={i} className="border-t border-line align-top"><td className="py-1.5 pr-2 text-ink-soft">{tradeName(g.trade)}</td><td className="py-1.5 pr-2">{keyLabel(g.category)}</td><td className="tabular py-1.5 pr-2">{g.bids} bids</td><td className="py-1.5"><SummaryCell s={g.price} /></td></tr>
              ))}
            </tbody></table>
          </Card>
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Group names in common use</h2>
            <p className="text-xs text-muted">Free-text names appear only when {d.meta.min_contributors}+ businesses use the same name.</p>
            {d.named_groups.length === 0 ? <p className="mt-3 text-sm text-muted">None meet the threshold yet.</p> : (
              <ul className="mt-3 space-y-1 text-sm">{d.named_groups.slice(0, 30).map((g, i) => <li key={i} className="flex justify-between border-t border-line py-1"><span>{tradeName(g.trade)} · {g.name}</span><span className="tabular text-muted">{g.contributors} businesses</span></li>)}</ul>
            )}
          </Card>
        </div>
        <Methodology meta={d.meta} />
      </>}
    </div>
  );
}
