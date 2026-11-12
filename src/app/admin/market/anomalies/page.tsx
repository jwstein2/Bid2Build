import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { parseFilters, toQuery } from "@/lib/market/filters";
import { reviewAnomaly } from "../actions";
import { PageHeader, ReportError, SyntheticBanner, keyLabel, money, tradeName, unitPrice } from "../ui";

export const dynamic = "force-dynamic";

const KINDS: Record<string, string> = {
  high_price: "Substantially above peers", low_price: "Substantially below peers", unit_conversion: "Suspected unit mix-up",
  unusual_margin: "Unusual margin", duplicate: "Suspected duplicate", classification_mismatch: "Classification inconsistent with description",
};
const DECISIONS: [string, string][] = [
  ["genuine_premium", "Likely genuine premium pricing"], ["complex_scope", "Complex project scope"], ["data_entry_error", "Data entry error (exclude)"],
  ["unit_conversion_error", "Unit conversion error (exclude)"], ["insufficient_data", "Insufficient comparison data"], ["needs_investigation", "Requires further investigation"],
];

interface Item {
  id: number; kind: string; metric: string; value: number | null; peer_key: string | null; peer_level: string | null; peer_median: number | null;
  peer_mad: number | null; peer_q1: number | null; peer_q3: number | null; robust_z: number | null; peer_n: number | null; peer_contributors: number | null;
  detail: Record<string, unknown> | null; review_status: string; review_note: string | null; trade: string | null; state: string | null; quote_date: string;
  project_type: string | null; complexity: string | null; size_value: number | null; size_unit: string | null; price_subtotal: number; contributor_ref: string;
  original_name: string | null; material_key: string | null; unit_raw: string | null; unit_norm: string | null; qty: number | null; unit_price: number | null; confidence: number | null;
}

export default async function Anomalies({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const { user, db } = await requireAdmin();
  await db.rpc("market_log_view", { p_caller: user.id, p_view: "anomalies", p_filters: filters });
  const { data, error } = await db.rpc("market_anomalies", { p_caller: user.id, p_filters: filters });
  const d = data as { counts: Record<string, number>; items: Item[] } | null;
  const status = filters.review_status ?? "open";
  const unitFor = (a: Item) => (a.metric === "price_per_unit" ? a.size_unit : a.metric === "gross_margin_pct" ? null : a.unit_norm);
  const fmt = (a: Item, v: number | null) => (v === null ? "–" : a.metric === "gross_margin_pct" ? `${Number(v).toFixed(1)}%` : a.metric === "price_subtotal" ? money(Number(v)) : unitPrice(Number(v), unitFor(a)));
  return (
    <div className="space-y-6">
      <PageHeader title="Pricing anomalies" intro="Observations far outside comparable peers (same specification, unit, cost class; same state when it has enough peers). For internal data quality only." />
      {filters.dataset === "synthetic" && <SyntheticBanner />}
      <Notice title="An outlier is not a wrong price">A high or low figure can reflect premium work, unusual scope, or local conditions. It says nothing about whether a price is fair or a business is behaving badly. Never share these findings with contractors, and never rank businesses.</Notice>
      <div className="flex flex-wrap gap-2 text-sm">
        {["real", "synthetic"].map((ds) => <Link key={ds} href={`/admin/market/anomalies${toQuery({ ...filters, dataset: ds === "real" ? undefined : ds })}`} className={`rounded-full border px-3 py-1 ${((filters.dataset ?? "real") === ds) ? "border-brand bg-brand text-white" : "border-line-strong"}`}>{ds === "real" ? "Real data" : "Synthetic demo"}</Link>)}
        <span className="mx-2 border-l border-line" />
        {[["open", "Open"], ...DECISIONS].map(([v, l]) => <Link key={v} href={`/admin/market/anomalies${toQuery({ ...filters, review_status: v === "open" ? undefined : v })}`} className={`rounded-full border px-3 py-1 ${status === v ? "border-brand bg-brand-tint" : "border-line"}`}>{l.replace(" (exclude)", "")}</Link>)}
      </div>
      {!d ? <ReportError error={error && /does not exist|schema cache/.test(error.message) ? "not_migrated" : "failed"} /> : <>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/admin/market/anomalies${toQuery({ ...filters, kind: undefined })}`} className={`rounded-md px-2 py-1 ${!filters.kind ? "bg-surface font-semibold shadow-card" : ""}`}>All</Link>
          {Object.entries(KINDS).map(([k, l]) => <Link key={k} href={`/admin/market/anomalies${toQuery({ ...filters, kind: k })}`} className={`rounded-md px-2 py-1 ${filters.kind === k ? "bg-surface font-semibold shadow-card" : ""}`}>{l} <span className="text-muted">{d.counts[k] ?? 0}</span></Link>)}
        </div>
        {d.items.length === 0 ? <Card className="p-6 text-center text-sm text-muted">No findings here. Detection runs when an admin recomputes (Settings) or on the nightly schedule.</Card> : (
          <div className="space-y-3">
            {d.items.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{KINDS[a.kind]} {a.robust_z !== null && <Badge>z = {a.robust_z}</Badge>} {a.detail?.unit_ratio ? <Badge tone="warn">×{String(a.detail.unit_ratio)} off</Badge> : null}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {a.original_name ? <>&ldquo;{a.original_name}&rdquo; · {a.qty} {a.unit_raw} · </> : null}
                      {a.trade ? tradeName(a.trade) : "Unknown trade"}{a.project_type ? ` · ${a.project_type.replace(/_/g, " ")}` : ""}{a.complexity ? ` · ${a.complexity}` : ""} · {a.state ?? "no state"} · quoted {a.quote_date} · business ref {a.contributor_ref}
                    </p>
                    {a.metric !== "cost_class" && a.kind !== "duplicate" && (
                      <p className="mt-1 text-sm">Value <span className="font-semibold">{fmt(a, a.value)}</span>{a.peer_median !== null && <> vs peer median <span className="font-semibold">{fmt(a, a.peer_median)}</span>{a.peer_q1 !== null && <> (middle 50%: {fmt(a, a.peer_q1)} to {fmt(a, a.peer_q3)})</>} · {a.peer_n} observations from {a.peer_contributors} businesses, {a.peer_level} peers</>}</p>
                    )}
                    {a.kind === "duplicate" && <p className="mt-1 text-sm">Same business, trade, price ({money(a.price_subtotal)}) and line count as another estimate {String(a.detail?.days_apart)} days apart.</p>}
                    {a.kind === "classification_mismatch" && <p className="mt-1 text-sm">Marked as <span className="font-semibold">{String(a.detail?.entered)}</span>, but the description reads like {keyLabel(String(a.detail?.category ?? ""))}.</p>}
                    {a.peer_key && <p className="mt-1 font-mono text-xs text-muted">peer group: {a.peer_key}</p>}
                  </div>
                  <form action={reviewAnomaly.bind(null, a.id)} className="flex flex-wrap items-center gap-2">
                    <select name="status" defaultValue={a.review_status === "open" ? "" : a.review_status} required className="field field-sm w-auto" aria-label="Decision">
                      <option value="" disabled>Decide…</option>
                      {DECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      {a.review_status !== "open" && <option value="open">Reopen</option>}
                    </select>
                    <input name="note" defaultValue={a.review_note ?? ""} placeholder="Note (optional)" className="field field-sm w-44" maxLength={1000} aria-label="Note" />
                    <button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">Save</button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        )}
      </>}
    </div>
  );
}
