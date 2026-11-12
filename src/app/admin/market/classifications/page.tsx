import Link from "next/link";
import { Badge, Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { parseFilters, toQuery } from "@/lib/market/filters";
import { mergeClassifications, updateClassification } from "../actions";
import { PageHeader, ReportError, keyLabel, tradeName } from "../ui";

export const dynamic = "force-dynamic";

interface Item {
  fingerprint: string; sample_name: string; trade: string | null; component: string | null; material: string | null; category: string;
  brand: string | null; product_line: string | null; cost_class: string; material_key: string; confidence: number; method: string;
  status: string; observation_count: number;
}

export default async function Classifications({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const status = typeof sp.status === "string" && ["needs_review", "auto", "reviewed"].includes(sp.status) ? sp.status : "needs_review";
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("market_classifications", { p_caller: user.id, p_filters: { status, q: filters.q } });
  const d = data as { counts: Record<string, number> | null; items: Item[] } | null;
  return (
    <div className="space-y-6">
      <PageHeader title="Classification review" intro="Every distinct item text is classified by deterministic rules with a confidence score. Low-confidence items stay out of precise comparisons until reviewed here. Corrections apply to past and future observations with the same text." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[["needs_review", "Needs review"], ["auto", "Auto-classified"], ["reviewed", "Reviewed"]].map(([v, l]) => (
          <Link key={v} href={`/admin/market/classifications?status=${v}${filters.q ? `&q=${encodeURIComponent(filters.q)}` : ""}`} className={`rounded-full border px-3 py-1 ${status === v ? "border-brand bg-brand-tint" : "border-line"}`}>{l} <span className="text-muted">{d?.counts?.[v] ?? 0}</span></Link>
        ))}
        <form method="get" className="ml-auto flex gap-2"><input type="hidden" name="status" value={status} /><input name="q" defaultValue={filters.q} placeholder="Search item text or key" className="field field-sm w-56" aria-label="Search" /><button className="rounded-md border border-line-strong px-3 py-1 font-semibold">Search</button></form>
      </div>
      {!d ? <ReportError error={error && /does not exist|schema cache/.test(error.message) ? "not_migrated" : "failed"} /> : (
        <>
          <form id="merge" action={mergeClassifications} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
            <p className="w-full text-xs text-muted">Merge: tick two or more rows below, then give them one comparison key. Only merge items you have confirmed price alike (for example spelling variants of the same product). To split, edit a single row&apos;s key.</p>
            <label className="text-xs font-semibold text-ink-soft">Category<input name="category" placeholder="decking.composite" className="field field-sm mt-1 block" required /></label>
            <label className="text-xs font-semibold text-ink-soft">Comparison key<input name="material_key" placeholder="decking.composite.trex.enhance-basics" className="field field-sm mt-1 block w-80" required /></label>
            <button className="rounded-md bg-brand px-3 py-1.5 font-semibold text-white">Merge selected</button>
          </form>
          <div className="space-y-2">
            {d.items.length === 0 && <Card className="p-6 text-center text-sm text-muted">Nothing here.</Card>}
            {d.items.map((c) => (
              <Card key={c.fingerprint} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <input type="checkbox" name="fp" value={c.fingerprint} form="merge" aria-label={`Select ${c.sample_name}`} className="mt-1 accent-[var(--color-brand)]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">&ldquo;{c.sample_name}&rdquo; <span className="font-normal text-muted">· {c.trade ? tradeName(c.trade) : "any trade"} · {c.observation_count} observation{c.observation_count === 1 ? "" : "s"}</span></p>
                    <p className="text-sm text-ink-soft">{keyLabel(c.material_key)} <Badge tone={c.confidence >= 0.75 ? "ok" : "warn"}>{Math.round(c.confidence * 100)}%</Badge> <Badge>{c.method}</Badge> <Badge>{c.cost_class}</Badge></p>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-accent-ink">Correct this classification</summary>
                  <form action={updateClassification.bind(null, c.fingerprint)} className="mt-2 grid gap-2 sm:grid-cols-4">
                    {([["component", c.component], ["material", c.material], ["category", c.category], ["brand", c.brand], ["product_line", c.product_line], ["material_key", c.material_key]] as const).map(([k, v]) => (
                      <label key={k} className="text-xs font-semibold text-ink-soft">{k.replace("_", " ")}<input name={k} defaultValue={v ?? ""} className="field field-sm mt-1 block w-full" /></label>
                    ))}
                    <label className="text-xs font-semibold text-ink-soft">cost class
                      <select name="cost_class" defaultValue={c.cost_class} className="field field-sm mt-1 block w-full">{["material", "labor", "equipment", "subcontractor", "other"].map((x) => <option key={x}>{x}</option>)}</select>
                    </label>
                    <div className="self-end"><button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">Save as reviewed</button></div>
                  </form>
                </details>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted"><Link href={`/admin/market/classifications${toQuery({ q: filters.q })}`} className="underline">Reset</Link> · AI-assisted suggestions are not enabled; rules plus admin review keep every mapping auditable.</p>
        </>
      )}
    </div>
  );
}
