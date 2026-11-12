import { Card, Notice } from "@/components/ui/misc";
import { loadReport, type Summary, type TrendPoint } from "@/lib/market/admin";
import { parseFilters } from "@/lib/market/filters";
import { CoverageLine, FilterBar, Methodology, PageHeader, ReportError, SummaryCell, TrendChart, keyLabel, tradeName } from "../ui";

export const dynamic = "force-dynamic";

interface Labor {
  rates: { trade: string; unit: string; stats: Summary }[];
  hourly_by_state: { state: string; stats: Summary }[];
  hourly_trend: TrendPoint[];
  project_labor: { trade: string; labor_price: Summary; labor_share_pct: Summary }[];
  packages: { key: string; unit: string; bids: number; contributors: number; stats: Summary }[];
}

export default async function LaborAnalytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { data: d, error } = await loadReport<Labor>("labor", filters);
  return (
    <div className="space-y-6">
      <PageHeader title="Labor analytics" intro="Labor as contractors bill it on quotes." meta={d?.meta} />
      <Notice tone="warn" title="These are billing rates, not wages">They are what contractors charge customers for labor (including overhead and profit), not what employees are paid. Never present them as wage data.</Notice>
      <FilterBar filters={filters} base="/admin/market/labor" />
      {!d ? <ReportError error={error} /> : <>
        <CoverageLine c={d.coverage} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Quoted labor rates by unit</h2>
            <table className="mt-3 w-full text-sm"><tbody>
              {d.rates.length === 0 && <tr><td className="py-3 text-muted">No labor lines match.</td></tr>}
              {d.rates.map((r, i) => <tr key={i} className="border-t border-line align-top"><td className="py-1.5 pr-3 font-semibold">{tradeName(r.trade)}</td><td className="py-1.5 pr-3 text-ink-soft">per {r.unit}</td><td className="py-1.5"><SummaryCell s={r.stats} unit={r.unit} /></td></tr>)}
            </tbody></table>
          </Card>
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Labor per project</h2>
            <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th>Trade</th><th>Labor billed</th><th>Share of bid</th></tr></thead><tbody>
              {d.project_labor.map((r) => <tr key={r.trade} className="border-t border-line align-top"><td className="py-1.5 pr-3 font-semibold">{tradeName(r.trade)}</td><td className="py-1.5 pr-3"><SummaryCell s={r.labor_price} /></td><td className="py-1.5"><SummaryCell s={r.labor_share_pct} unit="%" /></td></tr>)}
            </tbody></table>
          </Card>
        </div>
        <TrendChart points={d.hourly_trend} title="Hourly labor billing rate" unit="hour" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Hourly rate by state</h2>
            <table className="mt-3 w-full text-sm"><tbody>{d.hourly_by_state.map((r) => <tr key={r.state} className="border-t border-line"><td className="py-1.5 pr-3 font-semibold">{r.state}</td><td className="py-1.5"><SummaryCell s={r.stats} unit="hour" /></td></tr>)}</tbody></table>
          </Card>
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">Common labor packages</h2>
            <table className="mt-3 w-full text-sm"><tbody>{d.packages.map((r, i) => <tr key={i} className="border-t border-line align-top"><td className="py-1.5 pr-3">{keyLabel(r.key.replace(/^labor\./, ""))}<span className="block text-xs text-muted">per {r.unit} · {r.bids} bids</span></td><td className="py-1.5"><SummaryCell s={r.stats} /></td></tr>)}</tbody></table>
          </Card>
        </div>
        <Methodology meta={d.meta} />
      </>}
    </div>
  );
}
