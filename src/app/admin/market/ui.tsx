import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Notice } from "@/components/ui/misc";
import { labelForKey } from "@/lib/market/classify";
import { toQuery, type Filters } from "@/lib/market/filters";
import { US_STATES } from "@/lib/market/geo";
import { SECTORS, WORK_TYPES } from "@/lib/market/trade-models";
import { trades, tradeName, UNIT_ABBR } from "@/lib/trades/catalog";
import type { ReportMeta, Summary, TrendPoint } from "@/lib/market/admin";

export const money = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
export const unitPrice = (v: number | null | undefined, unit?: string | null) => `${money(v, v !== null && v !== undefined && Math.abs(v) < 100 ? 2 : 0)}${unit ? ` / ${UNIT_ABBR[unit] ?? unit}` : ""}`;
export const count = (v: number | null | undefined) => (v ?? 0).toLocaleString("en-US");
export const keyLabel = labelForKey;

export function PageHeader({ title, intro, meta }: { title: string; intro: string; meta?: ReportMeta }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-3xl font-extrabold">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{intro}</p>
      </div>
      {meta?.dataset === "synthetic" && <SyntheticBanner />}
    </div>
  );
}

export function SyntheticBanner() {
  return (
    <div role="status" className="rounded-lg border-2 border-warn bg-warn-tint px-4 py-3 text-sm">
      <p className="font-bold uppercase tracking-wide text-warn">Synthetic demo data</p>
      <p className="mt-0.5 text-ink-soft">Every figure on this page is randomly generated for development. It is not construction market intelligence and must never be quoted, exported, or shown to customers.</p>
    </div>
  );
}

export function ReportError({ error }: { error: string | null }) {
  if (error === "not_migrated") return <Notice tone="warn" title="Market Intelligence isn't set up in this database yet">Apply the migration <code>20261112000900_market_intelligence.sql</code>, then reload.</Notice>;
  return <Notice tone="danger" title="This report is unavailable right now">Try again in a moment. The error was logged.</Notice>;
}

/** Explains the data limitation instead of showing an unreliable number. */
export function Suppressed({ s }: { s: Extract<Summary, { suppressed: true }> }) {
  if (s.reason === "no_data") return <span className="text-xs text-muted">No data</span>;
  return <span className="text-xs text-muted" title="Fewer independent businesses than the reporting minimum. Multiple bids from one business count once.">Not enough data · {s.contributors} business{s.contributors === 1 ? "" : "es"}</span>;
}

export function SummaryCell({ s, unit, digits }: { s: Summary | null | undefined; unit?: string | null; digits?: number }) {
  if (!s) return <span className="text-xs text-muted">–</span>;
  if (s.suppressed) return <Suppressed s={s} />;
  const f = (v: number) => (unit === "%" ? `${v.toFixed(1)}%` : unit ? unitPrice(v, unit) : money(v, digits ?? 0));
  return (
    <span className="tabular">
      <span className="font-semibold">{f(s.median)}</span>
      <span className="block text-xs text-muted">{f(s.p25)} to {f(s.p75)} · n={count(s.n)} · {s.contributors} businesses</span>
    </span>
  );
}

/** Interquartile range as a band with the median as a tick, on a shared scale. */
export function RangeBar({ s, max, label }: { s: Summary | null | undefined; max: number; label: string }) {
  if (!s || s.suppressed || !(max > 0)) return <span aria-hidden className="block h-3" />;
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <svg className="block h-4 w-full" role="img" aria-label={`${label}: median ${s.median}, middle half ${s.p25} to ${s.p75}`}>
      <title>{`${label}\nMedian ${s.median.toLocaleString()}\n25th–75th percentile ${s.p25.toLocaleString()} – ${s.p75.toLocaleString()}\n${s.n} observations from ${s.contributors} businesses`}</title>
      <line x1="0" x2="100%" y1="8" y2="8" stroke="var(--color-line)" strokeWidth="1" />
      <rect x={x(s.p25)} width={`calc(${x(s.p75)} - ${x(s.p25)})`} y="3" height="10" rx="4" fill="var(--color-accent)" fillOpacity="0.35" />
      <rect x={`calc(${x(s.median)} - 1px)`} width="2" y="1" height="14" fill="var(--color-brand)" />
    </svg>
  );
}

/** Monthly median with the interquartile band. Suppressed months are gaps, never interpolated. */
export function TrendChart({ points, title, unit }: { points: TrendPoint[] | null | undefined; title: string; unit?: string | null }) {
  const pts = (points ?? []).filter((p) => p.month);
  const shown = pts.filter((p) => !p.stats.suppressed) as { month: string; stats: Extract<Summary, { suppressed: false }> }[];
  if (shown.length < 2) return <Card className="p-5"><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm text-muted">Not enough data for a trend yet. Each month needs at least the minimum number of independent businesses.</p></Card>;
  const W = 640, H = 180, L = 56, R = 12, T = 12, B = 26;
  const max = Math.max(...shown.map((p) => p.stats.p75)) * 1.08;
  const xs = (i: number) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1);
  const ys = (v: number) => T + (1 - v / max) * (H - T - B);
  const segments: { i: number; s: Extract<Summary, { suppressed: false }> }[][] = [];
  let cur: { i: number; s: Extract<Summary, { suppressed: false }> }[] = [];
  pts.forEach((p, i) => { if (p.stats.suppressed) { if (cur.length) segments.push(cur); cur = []; } else cur.push({ i, s: p.stats }); });
  if (cur.length) segments.push(cur);
  const fmt = (v: number) => (unit ? unitPrice(v, unit) : money(v));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  return (
    <Card className="p-5">
      <h3 className="font-bold">{title}</h3>
      <p className="text-xs text-muted">Monthly median; shaded band = middle 50% of observations. Gaps = months below the reporting minimum.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={`${title} by month`}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={ys(t)} y2={ys(t)} stroke="var(--color-line)" strokeWidth="1" /><text x={L - 6} y={ys(t) + 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">{fmt(t)}</text></g>)}
        {segments.map((seg, k) => (
          <g key={k}>
            <path d={`M${seg.map((p) => `${xs(p.i)},${ys(p.s.p75)}`).join(" L")} L${[...seg].reverse().map((p) => `${xs(p.i)},${ys(p.s.p25)}`).join(" L")} Z`} fill="var(--color-accent)" fillOpacity="0.18" />
            <path d={`M${seg.map((p) => `${xs(p.i)},${ys(p.s.median)}`).join(" L")}`} fill="none" stroke="var(--color-brand)" strokeWidth="2" />
          </g>
        ))}
        {pts.map((p, i) => (
          <g key={p.month}>
            {!p.stats.suppressed && <circle cx={xs(i)} cy={ys(p.stats.median)} r="4" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="2" />}
            {/* Hit target taller than the mark */}
            <rect x={xs(i) - 8} y={T} width="16" height={H - T - B} fill="transparent">
              <title>{p.stats.suppressed ? `${p.month.slice(0, 7)}: not enough data (${p.stats.contributors} businesses)` : `${p.month.slice(0, 7)}\nMedian ${fmt(p.stats.median)}\nMiddle 50%: ${fmt(p.stats.p25)} – ${fmt(p.stats.p75)}\n${p.stats.n} observations · ${p.stats.contributors} businesses`}</title>
            </rect>
            {(i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 6) === 0) && <text x={xs(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} fontSize="10" fill="var(--color-muted)">{p.month.slice(0, 7)}</text>}
          </g>
        ))}
      </svg>
    </Card>
  );
}

export function Histogram({ buckets, title }: { buckets: { label: string; n: number }[] | null | undefined; title: string }) {
  if (!buckets) return <Card className="p-5"><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm text-muted">Hidden until enough independent businesses contribute.</p></Card>;
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <Card className="p-5">
      <h3 className="font-bold">{title}</h3>
      <ul className="mt-3 space-y-1.5 text-sm">
        {buckets.map((b) => (
          <li key={b.label} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
            <span className="text-ink-soft">{b.label}</span>
            <span className="h-2.5 rounded-r bg-brand" style={{ width: `${(b.n / max) * 100}%`, minWidth: b.n ? 2 : 0 }} title={`${b.label}: ${b.n} bids`} />
            <span className="tabular text-right font-semibold">{count(b.n)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return <Card className="p-4"><p className="text-sm text-ink-soft">{k}</p><p className="tabular mt-1 text-2xl font-extrabold">{v}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</Card>;
}

export function Methodology({ meta, children }: { meta?: ReportMeta; children?: ReactNode }) {
  if (!meta) return null;
  return (
    <details className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
      <summary className="cursor-pointer font-semibold text-ink">How these numbers are calculated</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Source: {meta.dataset === "synthetic" ? "synthetic demo observations (not real data)" : "finalized proposals from contractors who opted in to anonymous benchmarking"}. Drafts, previews and repeat downloads are never counted; only the latest finalized version of each estimate is used.</li>
        <li>Medians and the 25th/75th percentiles use linear interpolation. MAD is the median absolute deviation from the median.</li>
        <li>A figure is shown only when at least {meta.min_contributors} independent businesses contributed to it. Several bids from one business count as one.</li>
        <li>Prices are customer-facing and pre-tax unless the tax filter says otherwise. Costs and margins come only from businesses that also opted in to sharing them.</li>
        <li>Material comparisons use items classified with at least {Math.round(meta.precise_confidence * 100)}% confidence; units are normalized (e.g. roofing squares to square feet) before comparing.</li>
        <li>Observations an admin confirmed as entry or unit errors are excluded. Report generated {new Date(meta.generated_at).toLocaleString("en-US")}.</li>
      </ul>
      {children}
    </details>
  );
}

const STATUS = [["all", "All finalized bids"], ["quoted", "Quoted, no decision"], ["accepted", "Accepted or completed"], ["declined", "Declined"]];

/** One row of filters above the report. Plain GET form: works without JavaScript and keeps URLs shareable. */
export function FilterBar({ filters, base, extra = [], hidden = [] }: { filters: Filters; base: string; extra?: ("material" | "basis" | "level" | "price" | "size")[]; hidden?: (keyof Filters)[] }) {
  const sel = (name: keyof Filters, label: string, options: [string, string][], all = "All") => (
    <label className="text-xs font-semibold text-ink-soft">{label}
      <select name={name} defaultValue={filters[name] ?? ""} className="field field-sm mt-1 block w-full">
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <form method="get" action={base} className="rounded-xl border border-line bg-surface p-4">
      {hidden.map((h) => filters[h] ? <input key={h} type="hidden" name={h} value={filters[h]} /> : null)}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold text-ink-soft">Dataset
          <select name="dataset" defaultValue={filters.dataset ?? "real"} className="field field-sm mt-1 block w-full">
            <option value="real">Real contributions</option>
            <option value="synthetic">Synthetic demo (fake)</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-soft">From<input type="date" name="date_from" defaultValue={filters.date_from} className="field field-sm mt-1 block w-full" /></label>
        <label className="text-xs font-semibold text-ink-soft">To<input type="date" name="date_to" defaultValue={filters.date_to} className="field field-sm mt-1 block w-full" /></label>
        {sel("trade", "Trade", trades.map((t) => [t.slug, t.name]))}
        {sel("state", "State", Object.entries(US_STATES).map(([c, n]) => [c, n]))}
        <label className="text-xs font-semibold text-ink-soft">Metro<input name="metro" defaultValue={filters.metro} placeholder="e.g. Chicago, IL" className="field field-sm mt-1 block w-full" /></label>
        {sel("work_type", "Work type", WORK_TYPES.map((o) => [o.value, o.label]))}
        {sel("sector", "Sector", SECTORS.map((o) => [o.value, o.label]))}
        {sel("complexity", "Complexity", [["standard", "Standard"], ["complex", "Complex"]])}
        {sel("status", "Bid status", STATUS.slice(1) as [string, string][], "All finalized bids")}
        <label className="text-xs font-semibold text-ink-soft">Project type<input name="project_type" defaultValue={filters.project_type} placeholder="e.g. new_deck" className="field field-sm mt-1 block w-full" /></label>
        {sel("tax", "Tax", [["included", "Including tax"]], "Excluding tax")}
        {extra.includes("basis") && sel("basis", "Value", [["cost", "Internal cost (shared only)"]], "Customer price")}
        {extra.includes("material") && <>
          <label className="text-xs font-semibold text-ink-soft">Material category<input name="material_category" defaultValue={filters.material_category} placeholder="e.g. decking.composite" className="field field-sm mt-1 block w-full" /></label>
          <label className="text-xs font-semibold text-ink-soft">Brand<input name="brand" defaultValue={filters.brand} placeholder="e.g. Trex" className="field field-sm mt-1 block w-full" /></label>
          <label className="text-xs font-semibold text-ink-soft">Specification key<input name="material_key" defaultValue={filters.material_key} placeholder="e.g. decking.composite.trex" className="field field-sm mt-1 block w-full" /></label>
        </>}
        {extra.includes("price") && <>
          <label className="text-xs font-semibold text-ink-soft">Min project price<input name="price_min" inputMode="numeric" defaultValue={filters.price_min} className="field field-sm mt-1 block w-full" /></label>
          <label className="text-xs font-semibold text-ink-soft">Max project price<input name="price_max" inputMode="numeric" defaultValue={filters.price_max} className="field field-sm mt-1 block w-full" /></label>
        </>}
        {extra.includes("size") && <>
          <label className="text-xs font-semibold text-ink-soft">Min project size<input name="size_min" inputMode="numeric" defaultValue={filters.size_min} className="field field-sm mt-1 block w-full" /></label>
          <label className="text-xs font-semibold text-ink-soft">Max project size<input name="size_max" inputMode="numeric" defaultValue={filters.size_max} className="field field-sm mt-1 block w-full" /></label>
        </>}
        {extra.includes("level") && sel("level", "Geography level", [["national", "National"], ["metro", "Metro"], ["zip3", "3-digit ZIP"], ["zip5", "ZIP code"]], "State")}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">Apply filters</button>
        <Link href={`${base}${toQuery({ dataset: filters.dataset })}`} className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">Clear</Link>
      </div>
    </form>
  );
}

export { tradeName };

export function CoverageLine({ c }: { c: import("@/lib/market/admin").Coverage | undefined }) {
  if (!c) return null;
  return (
    <p className="text-xs text-muted">
      {count(c.bids)} bids · {count(c.contributors)} independent businesses
      {c.date_from && <> · quotes dated {c.date_from} to {c.date_to}</>}
      {c.freshest && <> · latest capture {new Date(c.freshest).toLocaleDateString("en-US")}</>}
    </p>
  );
}
