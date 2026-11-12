import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { loadReport, type Summary } from "@/lib/market/admin";
import { parseFilters, toQuery } from "@/lib/market/filters";
import { CoverageLine, FilterBar, Methodology, PageHeader, RangeBar, ReportError, SummaryCell, keyLabel } from "../ui";

export const dynamic = "force-dynamic";

interface Materials {
  keys: { material_key: string; unit_norm: string; n: number; contributors: number; price: Summary; cost: Summary; latest: string; earliest: string }[];
  detail: { by_state: { state: string; price: Summary }[]; history: { month: string; price: Summary }[] } | null;
  brands: { category: string; brand: string; product_line: string; unit: string; price: Summary }[];
}

export default async function MaterialPricing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { data: d, error } = await loadReport<Materials>("materials", filters);
  const max = d ? Math.max(1, ...d.keys.map((k) => (k.price.suppressed ? 0 : k.price.p75))) : 1;
  return (
    <div className="space-y-6">
      <PageHeader title="Material pricing" intro="Quoted customer unit prices and, where shared, contractor purchase costs. Units are normalized (per square foot, linear foot, cubic yard...) and each specification is compared only with itself." meta={d?.meta} />
      <form method="get" className="flex flex-wrap gap-2">
        {Object.entries(filters).filter(([k]) => !["q", "detail_key", "detail_unit"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={filters.q} placeholder="Search materials, brands, product lines (e.g. trex enhance)" className="field max-w-md" aria-label="Search materials" />
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>
      <FilterBar filters={filters} base="/admin/market/materials" extra={["material"]} hidden={["q"]} />
      {!d ? <ReportError error={error} /> : <>
        <CoverageLine c={d.coverage} />
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="px-4 py-2">Material / specification</th><th className="px-4 py-2">Quoted unit price</th><th className="w-1/5 px-4 py-2">Distribution</th><th className="px-4 py-2">Reported purchase cost</th><th className="px-4 py-2">Freshness</th></tr></thead>
            <tbody>
              {d.keys.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No confidently classified materials match. Low-confidence items wait in the classification review queue.</td></tr>}
              {d.keys.map((k) => (
                <tr key={`${k.material_key}|${k.unit_norm}`} className="border-t border-line align-top">
                  <td className="px-4 py-2"><Link className="font-semibold underline-offset-2 hover:underline" href={`/admin/market/materials${toQuery(filters, { detail_key: k.material_key, detail_unit: k.unit_norm })}`}>{keyLabel(k.material_key)}</Link><span className="block text-xs text-muted">per {k.unit_norm} · n={k.n}</span></td>
                  <td className="px-4 py-2"><SummaryCell s={k.price} unit={k.unit_norm} /></td>
                  <td className="px-4 py-3"><RangeBar s={k.price} max={max} label={keyLabel(k.material_key)} /></td>
                  <td className="px-4 py-2"><SummaryCell s={k.cost} unit={k.unit_norm} /></td>
                  <td className="px-4 py-2 text-xs text-muted">{k.earliest} to {k.latest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {d.detail && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-display text-lg font-bold">{keyLabel(filters.detail_key!)}: by state</h2>
              <table className="mt-3 w-full text-sm"><tbody>{d.detail.by_state.map((r) => <tr key={r.state} className="border-t border-line"><td className="py-1.5 pr-3 font-semibold">{r.state}</td><td className="py-1.5"><SummaryCell s={r.price} unit={filters.detail_unit} /></td></tr>)}</tbody></table>
            </Card>
            <Card className="p-5">
              <h2 className="font-display text-lg font-bold">Price history</h2>
              <table className="mt-3 w-full text-sm"><tbody>{d.detail.history.map((r) => <tr key={r.month} className="border-t border-line"><td className="py-1.5 pr-3">{r.month.slice(0, 7)}</td><td className="py-1.5"><SummaryCell s={r.price} unit={filters.detail_unit} /></td></tr>)}</tbody></table>
            </Card>
          </div>
        )}
        {d.brands.length > 0 && (
          <Card className="overflow-x-auto p-5">
            <h2 className="font-display text-lg font-bold">Brand and product-line comparison</h2>
            <p className="text-xs text-muted">Items naming a brand but not a product line are kept separate from named lines, so different price tiers are never pooled.</p>
            <table className="mt-3 w-full min-w-[640px] text-sm"><tbody>
              {d.brands.map((b, i) => <tr key={i} className="border-t border-line align-top"><td className="py-1.5 pr-3">{keyLabel(b.category)}</td><td className="py-1.5 pr-3 font-semibold">{b.brand}</td><td className="py-1.5 pr-3">{b.product_line}</td><td className="py-1.5"><SummaryCell s={b.price} unit={b.unit} /></td></tr>)}
            </tbody></table>
          </Card>
        )}
        <Methodology meta={d.meta} />
      </>}
    </div>
  );
}
