/**
 * Chart widget drawings: donut, pie, bar, line, area and table. Server-rendered SVG/HTML, no chart library.
 * Every mark links to the records behind it, every mark has a text tooltip and an aria label, and the legend
 * always prints the name and amount, so nothing is told apart by color alone. A table view exists for every
 * dataset. Colors reuse the validated palettes from the Financials donut (categorical slots + status) and the
 * P&L money chart (money in / money out), with dark-theme steps.
 */
import Link from "next/link";
import { formatCurrency } from "@/lib/estimate/money";
import type { ChartData, ChartType } from "@/lib/dashboard/charts";
import { compact } from "@/components/financials/donut";

const STYLE = `.dash-chart{--d-c1:#2a78d6;--d-c2:#eb6834;--d-c3:#1baf7a;--d-c4:#eda100;--d-c5:#e87ba4;--d-c6:#008300;--d-ok:#0f8a5f;--d-info:#2a78d6;--d-danger:#d03b3b;--d-muted:#8a96a3;--d-rest:#c3cdd7;--d-in:#0891b2;--d-out:#c2410c;--d-gap:var(--color-surface)}
html[data-theme]:has(.app-theme) .dash-chart{--d-c1:#3987e5;--d-c2:#d95926;--d-c3:#199e70;--d-c4:#c98500;--d-c5:#d55181;--d-c6:#0ca30c;--d-ok:#1baf7a;--d-info:#3987e5;--d-danger:#e66767;--d-muted:#6f8293;--d-rest:#465767;--d-in:#06a3c4;--d-out:#e0702c}`;

const R = 40, GAP = 1.2;

export function ChartView({ data, type, title, empty, tall }: { data: ChartData; type: ChartType; title: string; empty: string; tall: boolean }) {
  return (
    <div className="dash-chart flex min-h-0 flex-1 flex-col" data-chart-type={type}>
      <style>{STYLE}</style>
      {data.shape === "category"
        ? Number(data.total) <= 0 ? <Empty text={empty} />
          : type === "table" ? <CategoryTable data={data} />
          : type === "bar" ? <CategoryBars data={data} />
          : <Ring data={data} pie={type === "pie"} title={title} tall={tall} />
        : data.points.every((p) => p.values.every((v) => Number(v.amount) === 0)) ? <Empty text={empty} />
          : type === "table" ? <SeriesTable data={data} />
          : type === "bar" ? <SeriesBars data={data} tall={tall} />
          : <SeriesLine data={data} area={type === "area"} tall={tall} />}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-ink-soft">{text}</p>;

type Cat = Extract<ChartData, { shape: "category" }>;
type Ser = Extract<ChartData, { shape: "series" }>;

function Legend({ data }: { data: Cat }) {
  return (
    <ul className="w-full min-w-0 flex-1 space-y-0.5 text-sm">
      {data.slices.map((s) => {
        const row = (
          <>
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(--d-${s.tone})` }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular font-semibold">{formatCurrency(s.amount)}</span>
            <span className="w-9 text-right text-xs tabular text-muted">{s.pct}%</span>
          </>
        );
        return <li key={s.key}>{s.href ? <Link href={s.href} prefetch={false} className="flex min-h-9 items-center gap-2 rounded-md px-1.5 hover:bg-black/5 focus-visible:outline-2">{row}</Link> : <span className="flex min-h-9 items-center gap-2 px-1.5">{row}</span>}</li>;
      })}
    </ul>
  );
}

function Ring({ data, pie, title, tall }: { data: Cat; pie: boolean; title: string; tall: boolean }) {
  const sum = Number(data.total);
  const r = pie ? R / 2 : R, circ = 2 * Math.PI * r, width = pie ? R : 14;
  const lens = data.slices.map((s) => (Number(s.amount) / sum) * circ);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((t, l) => t + l, 0));
  const arcs = data.slices.map((s, i) => {
    const gap = data.slices.length > 1 ? Math.min(pie ? GAP / 2 : GAP, lens[i] / 2) : 0;
    return { s, dash: `${Math.max(0, lens[i] - gap)} ${circ}`, offset: -starts[i] };
  });
  return (
    <div className={`@container flex flex-1 flex-col items-center gap-3 ${tall ? "" : "@md:flex-row"} @lg:flex-row`}>
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={`${title}: ${data.slices.map((s) => `${s.label} ${formatCurrency(s.amount)} (${s.pct}%)`).join(", ")}`}>
        {pie && <circle cx="50" cy="50" r={R} fill="var(--d-gap)" />}
        {arcs.map(({ s, dash, offset }) => {
          const ring = <circle cx="50" cy="50" r={r} fill="none" stroke={`var(--d-${s.tone})`} strokeWidth={width} strokeDasharray={dash} strokeDashoffset={offset}><title>{`${s.label}: ${formatCurrency(s.amount)} (${s.pct}%)`}</title></circle>;
          return s.href ? <a key={s.key} href={s.href} aria-label={`${s.label}: ${formatCurrency(s.amount)}, ${s.pct}%`}>{ring}</a> : <g key={s.key}>{ring}</g>;
        })}
        {!pie && <g className="rotate-90" style={{ transformOrigin: "50px 50px" }}><text x="50" y="54" textAnchor="middle" className="fill-ink font-display text-[12px] font-extrabold">{compact(data.total)}</text></g>}
      </svg>
      <Legend data={data} />
    </div>
  );
}

function CategoryBars({ data }: { data: Cat }) {
  const max = Math.max(...data.slices.map((s) => Number(s.amount)), 1);
  return (
    <ul className="flex-1 space-y-1.5 text-sm" aria-label="Bar chart">
      {data.slices.map((s) => {
        const inner = (
          <>
            <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate">{s.label}</span><span className="tabular font-semibold">{formatCurrency(s.amount)}</span><span className="w-9 text-right text-xs tabular text-muted">{s.pct}%</span></span>
            <span className="mt-0.5 block h-2.5 w-full rounded bg-black/5"><span className="block h-full rounded" style={{ width: `${Math.max(2, (Number(s.amount) / max) * 100)}%`, background: `var(--d-${s.tone})` }} /></span>
          </>
        );
        return <li key={s.key}>{s.href ? <Link href={s.href} prefetch={false} title={`${s.label}: ${formatCurrency(s.amount)} (${s.pct}%)`} className="block rounded-md px-1.5 py-1 hover:bg-black/5 focus-visible:outline-2">{inner}</Link> : <span className="block px-1.5 py-1">{inner}</span>}</li>;
      })}
    </ul>
  );
}

function CategoryTable({ data }: { data: Cat }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-semibold">Category</th><th className="py-1 text-right font-semibold">Amount</th><th className="py-1 text-right font-semibold">Share</th></tr></thead>
        <tbody>
          {data.slices.map((s) => (
            <tr key={s.key} className="border-t border-line">
              <td className="py-1.5">{s.href ? <Link href={s.href} prefetch={false} className="font-semibold text-accent-ink underline">{s.label}</Link> : s.label}</td>
              <td className="py-1.5 text-right tabular">{formatCurrency(s.amount)}</td>
              <td className="py-1.5 text-right tabular text-muted">{s.pct}%</td>
            </tr>
          ))}
          <tr className="border-t-2 border-line font-semibold"><td className="py-1.5">Total</td><td className="py-1.5 text-right tabular">{formatCurrency(data.total)}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

function SeriesLegend({ data }: { data: Ser }) {
  if (data.seriesKeys.length < 2) return null;
  return (
    <p className="mb-1 flex flex-wrap gap-3 text-xs text-ink-soft">
      {data.seriesKeys.map((k) => <span key={k.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--d-${k.tone})` }} />{k.label}</span>)}
    </p>
  );
}

const tipFor = (p: Ser["points"][number]) => `${p.label} · ${p.values.map((v) => `${v.label} ${formatCurrency(v.amount)}`).join(" · ")}`;

function SeriesBars({ data, tall }: { data: Ser; tall: boolean }) {
  const vals = data.points.flatMap((p) => p.values.map((v) => Number(v.amount)));
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const hasNeg = vals.some((v) => v < 0);
  const tone = (k: string) => data.seriesKeys.find((s) => s.key === k)?.tone ?? "c1";
  return (
    <figure className="flex min-h-0 flex-1 flex-col">
      <SeriesLegend data={data} />
      <div className="overflow-x-auto">
        <div className={`flex ${tall ? "h-48" : "h-28"} items-stretch gap-1 border-b border-line`} style={{ minWidth: `${data.points.length * 1.6}rem` }}>
          {data.points.map((p) => (
            <Link key={p.key} href={p.href} prefetch={false} title={tipFor(p)} aria-label={tipFor(p)} className="flex flex-1 flex-col rounded-t-md px-0.5 hover:bg-black/5 focus-visible:outline-2">
              <span className={`flex flex-1 justify-center gap-[2px] ${hasNeg ? "items-center" : "items-end"}`}>
                {p.values.map((v) => {
                  const h = Math.abs(Number(v.amount)) / max * (hasNeg ? 50 : 100);
                  const neg = Number(v.amount) < 0;
                  return <span key={v.key} className={`w-[42%] max-w-6 ${neg ? "self-auto translate-y-1/2 rounded-b" : "rounded-t"}`} style={{ height: `${Number(v.amount) ? Math.max(2, h) : 0}%`, background: `var(--d-${neg ? "danger" : tone(v.key)})` }} />;
                })}
              </span>
            </Link>
          ))}
        </div>
        <div className="flex gap-1" style={{ minWidth: `${data.points.length * 1.6}rem` }}>
          {data.points.map((p) => <span key={p.key} className="flex-1 overflow-hidden whitespace-nowrap pt-1 text-center text-[10px] text-muted">{p.label}</span>)}
        </div>
      </div>
    </figure>
  );
}

function SeriesLine({ data, area, tall }: { data: Ser; area: boolean; tall: boolean }) {
  const W = 300, H = tall ? 150 : 90, PAD = 4;
  const vals = data.points.flatMap((p) => p.values.map((v) => Number(v.amount)));
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const n = data.points.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => PAD + ((hi - v) / span) * (H - 2 * PAD);
  const tone = (k: string) => data.seriesKeys.find((s) => s.key === k)?.tone ?? "c1";
  return (
    <figure className="flex min-h-0 flex-1 flex-col">
      <SeriesLegend data={data} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" style={{ height: tall ? "10rem" : "6rem" }}
        aria-label={data.points.map(tipFor).join("; ")}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {data.seriesKeys.map((k) => {
          const pts = data.points.map((p, i) => [x(i), y(Number(p.values.find((v) => v.key === k.key)?.amount ?? 0))] as const);
          const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
          return (
            <g key={k.key}>
              {area && <path d={`${d} L${pts.at(-1)![0].toFixed(1)},${y(0).toFixed(1)} L${pts[0][0].toFixed(1)},${y(0).toFixed(1)} Z`} fill={`var(--d-${tone(k.key)})`} opacity={0.18} />}
              <path d={d} fill="none" stroke={`var(--d-${tone(k.key)})`} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          );
        })}
        {data.points.map((p, i) => (
          <a key={p.key} href={p.href} aria-label={tipFor(p)}>
            <rect x={x(i) - (W / Math.max(n, 1)) / 2} y={0} width={W / Math.max(n, 1)} height={H} fill="transparent" className="hover:fill-black/5"><title>{tipFor(p)}</title></rect>
          </a>
        ))}
      </svg>
      <div className="flex justify-between pt-1 text-[10px] text-muted"><span>{data.points[0]?.label}</span><span>{data.points.at(-1)?.label}</span></div>
    </figure>
  );
}

function SeriesTable({ data }: { data: Ser }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-semibold">Period</th>{data.seriesKeys.map((k) => <th key={k.key} className="py-1 text-right font-semibold">{k.label}</th>)}</tr></thead>
        <tbody>
          {data.points.map((p) => (
            <tr key={p.key} className="border-t border-line">
              <td className="py-1.5"><Link href={p.href} prefetch={false} className="font-semibold text-accent-ink underline">{p.label}</Link></td>
              {p.values.map((v) => <td key={v.key} className={`py-1.5 text-right tabular ${Number(v.amount) < 0 ? "text-danger" : ""}`}>{formatCurrency(v.amount)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
