/**
 * Command-center building blocks for the owner/admin area. Server components with hand-drawn SVG:
 * no chart library, no client JavaScript. Every chart also carries text (labels, values, <title>
 * tooltips) so it reads without the graphic.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MetricShell, type MetricDrawerSpec } from "@/components/ui/metric-card";

export type Tone = "green" | "blue" | "amber" | "red" | "violet" | "muted";
export const TONE: Record<Tone, string> = { green: "var(--cc-green)", blue: "var(--cc-blue)", amber: "var(--cc-amber)", red: "var(--cc-red)", violet: "var(--cc-violet)", muted: "#5b7383" };

export const fmt = (n: number) => n.toLocaleString("en-US");
export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function PageHead({ kicker, title, intro, right }: { kicker: string; title: string; intro?: string; right?: ReactNode }) {
  return (
    <div className="cc-rise flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="cc-kicker flex items-center gap-2"><span className="cc-live" aria-hidden />{kicker}</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{title}</h1>
        {intro && <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{intro}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ title, kicker, action, children, className, id }: { title?: string; kicker?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("cc-panel cc-rise min-w-0 scroll-mt-24 p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>{kicker && <p className="cc-kicker">{kicker}</p>}{title && <h2 className="mt-0.5 text-base font-bold text-white">{title}</h2>}</div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="cc-mono shrink-0 rounded-md border border-[var(--cc-line)] px-2 py-1 text-[11px] uppercase tracking-wider text-[var(--cc-blue)] hover:border-[var(--cc-blue)] hover:text-white">{children} →</Link>;
}

export function Delta({ pct, previous }: { pct: number | null; previous?: number }) {
  if (pct === null) return <span className="cc-mono text-[11px] text-muted">{previous === 0 ? "new" : "–"}</span>;
  const up = pct >= 0;
  return <span className={cn("cc-mono rounded px-1.5 py-0.5 text-[11px] font-semibold", up ? "bg-[rgb(61_255_168/0.1)] text-[var(--cc-green)]" : "bg-[rgb(255_107_129/0.1)] text-[var(--cc-red)]")}>{up ? "▲" : "▼"} {Math.abs(pct)}%</span>;
}

/** Small "i" with the metric definition as a native tooltip (and screen-reader text). */
export function Info({ text }: { text: string }) {
  if (!text) return null;
  return <span title={text} className="cc-mono inline-grid h-4 w-4 shrink-0 cursor-help place-items-center rounded-full border border-[var(--cc-line-strong)] text-[9px] leading-none text-muted" aria-label={`Definition: ${text}`} role="img">i</span>;
}

/**
 * Owner KPI card. Pass `href` (filtered records page) or `drawer` (quick inspection) so the number is
 * actionable; the whole card becomes the link/button (see components/ui/metric-card.tsx).
 */
export function Kpi({ label, value, sub, tone = "green", spark, delta, href, drawer, action, def, na, testId }: { label: string; value: string | number; sub?: ReactNode; tone?: Tone; spark?: number[]; delta?: ReactNode; href?: string; drawer?: MetricDrawerSpec; action?: string; def?: string; na?: boolean; testId?: string }) {
  return (
    <MetricShell href={href} drawer={drawer} action={action} testId={testId ?? "kpi"} className="cc-panel cc-rise p-4">
      <span className="flex items-start justify-between gap-2"><span className="cc-kicker flex items-center gap-1.5">{label}{def && <Info text={def} />}</span>{delta}</span>
      {na
        ? <span className="cc-mono mt-2 block text-lg font-semibold leading-tight text-muted">{value}</span>
        : <span className={cn("cc-mono mt-2 block text-[2rem] font-bold leading-none", tone === "blue" ? "cc-glow-blue" : tone === "green" ? "cc-glow-green" : "")} style={tone !== "green" && tone !== "blue" ? { color: TONE[tone] } : undefined}>{typeof value === "number" ? fmt(value) : value}</span>}
      {sub && <span className="mt-1.5 block text-xs text-muted">{sub}</span>}
      {spark && spark.length > 1 && <span className="mt-auto block pt-3"><Sparkline values={spark} tone={tone} /></span>}
    </MetricShell>
  );
}

/** Change vs the previous period, without percentages from tiny baselines. */
export function Change({ current, previous, pctChange, good = "up" }: { current: number; previous: number; pctChange: number | null; good?: "up" | "down" }) {
  const diff = current - previous;
  if (diff === 0) return <span className="cc-mono text-[11px] text-muted">= prev.</span>;
  const better = good === "up" ? diff > 0 : diff < 0;
  const txt = pctChange !== null ? `${Math.abs(pctChange)}%` : `${Math.abs(diff)}`;
  return <span className={cn("cc-mono rounded px-1.5 py-0.5 text-[11px] font-semibold", better ? "bg-[rgb(61_255_168/0.1)] text-[var(--cc-green)]" : "bg-[rgb(255_181_71/0.1)] text-[var(--cc-amber)]")} title={`${current} now vs ${previous} in the previous period`}>{diff > 0 ? "▲" : "▼"} {txt}</span>;
}

/** A percentage with its denominator, flagged when the sample is small. */
export function Pct({ r, empty = "–" }: { r: { n: number; d: number; pct: number | null; small: boolean }; empty?: string }) {
  if (r.pct === null) return <span className="cc-mono text-muted">{empty}</span>;
  return (
    <span className="cc-mono">
      <span className="text-white">{r.pct}%</span> <span className="text-muted">({fmt(r.n)} of {fmt(r.d)})</span>
      {r.small && <span className="ml-1 rounded border border-[var(--cc-line)] px-1 text-[10px] text-[var(--cc-amber)]" title="Fewer than 20 in the denominator: treat the percentage as directional">small sample</span>}
    </span>
  );
}

/** Honest placeholder for data that has no connected source. */
export function NotConnected({ children = "Not connected" }: { children?: ReactNode }) {
  return <span className="cc-mono inline-flex items-center gap-1 rounded border border-dashed border-[var(--cc-line-strong)] px-1.5 py-0.5 text-[11px] text-muted">{children}</span>;
}

/** Horizontal funnel: each step's count, share of the previous step and of the first step. */
export function FunnelSteps({ steps, lead }: { steps: { label: string; n: number | null; ofPrev?: { n: number; d: number; pct: number | null; small: boolean }; note?: ReactNode }[]; lead?: ReactNode }) {
  const top = Math.max(1, ...steps.map((s) => s.n ?? 0));
  return (
    <div>
      {lead}
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ["--n" as string]: steps.length }}>
        {steps.map((s, i) => (
          <li key={s.label} className="rounded-lg border border-[var(--cc-line)] bg-[rgb(5_9_12/0.45)] p-3">
            <p className="cc-kicker !text-[10px]">{i + 1}. {s.label}</p>
            {s.n === null ? <p className="mt-2"><NotConnected /></p> : <p className="cc-mono mt-1 text-2xl font-bold text-white">{fmt(s.n)}</p>}
            {s.n !== null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgb(56_182_255/0.08)]"><div className="h-full rounded-full bg-[var(--cc-blue)]" style={{ width: `${Math.max(2, (s.n / top) * 100)}%` }} /></div>}
            {i > 0 && s.ofPrev && <p className="mt-1.5 text-[11px] text-muted">{s.ofPrev.pct === null ? "–" : <><span className="text-ink-soft">{s.ofPrev.pct}%</span> of previous step{s.ofPrev.small ? " · small sample" : ""}</>}</p>}
            {s.note && <p className="mt-1 text-[11px] text-muted">{s.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Compact owner data table with consistent styling. */
export function Table({ head, children, minWidth = 640, align }: { head: string[]; children: ReactNode; minWidth?: number; align?: ("l" | "r")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="cc-kicker text-left"><tr>{head.map((h, i) => <th key={h + i} className={cn("pb-2 pr-3 font-normal", align?.[i] === "r" && "text-right")}>{h}</th>)}</tr></thead>
        <tbody className="cc-mono [&_td]:border-t [&_td]:border-[var(--cc-line)] [&_td]:py-2 [&_td]:pr-3">{children}</tbody>
      </table>
    </div>
  );
}

export function Sparkline({ values, tone = "green", height = 32 }: { values: number[]; tone?: Tone; height?: number }) {
  const max = Math.max(1, ...values);
  const w = 100; const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(height - (v / max) * (height - 3) - 1.5).toFixed(2)}`);
  const id = `sg-${tone}-${values.length}-${values.join("").length}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={TONE[tone]} stopOpacity="0.35" /><stop offset="1" stopColor={TONE[tone]} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={TONE[tone]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface SeriesLine { name: string; tone: Tone; points: { label: string; value: number }[] }

/** Multi-series area/line chart. Lines share one y-scale; the first series is filled. */
export function AreaChart({ series, height = 180, totals = true }: { series: SeriesLine[]; height?: number; totals?: boolean }) {
  const n = series[0]?.points.length ?? 0;
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const w = 600; const h = height;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => h - (v / niceMax) * (h - 8) - 4;
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const empty = series.every((s) => s.points.every((p) => p.value === 0));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => <span key={s.name} className="flex items-center gap-1.5 text-xs text-ink-soft"><span className="h-2 w-2 rounded-full" style={{ background: TONE[s.tone], }} />{s.name}{totals && <span className="cc-mono text-muted"> {fmt(s.points.reduce((a, p) => a + p.value, 0))}</span>}</span>)}
      </div>
      <div className="relative">
        <span className="cc-mono absolute -top-1 left-0 text-[10px] text-muted">{fmt(niceMax)}</span>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={series.map((s) => `${s.name}: ${s.points.reduce((a, p) => a + p.value, 0)} total`).join("; ")}>
          <defs>{series.map((s, i) => <linearGradient key={i} id={`ag-${i}-${s.tone}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={TONE[s.tone]} stopOpacity="0.32" /><stop offset="1" stopColor={TONE[s.tone]} stopOpacity="0" /></linearGradient>)}</defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="rgb(56 182 255 / 0.08)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
          <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} stroke="rgb(56 182 255 / 0.2)" vectorEffect="non-scaling-stroke" />
          {series.map((s, si) => {
            const pts = s.points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
            return (
              <g key={s.name}>
                {si === 0 && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#ag-${si}-${s.tone})`} />}
                <polyline points={pts} fill="none" stroke={TONE[s.tone]} strokeWidth={si === 0 ? 2 : 1.6} strokeDasharray={si === 0 ? undefined : si === 1 ? undefined : "4 3"} vectorEffect="non-scaling-stroke" />
                {s.points.map((p, i) => p.value > 0 && <circle key={i} cx={x(i)} cy={y(p.value)} r="2.2" fill={TONE[s.tone]} vectorEffect="non-scaling-stroke"><title>{`${s.name} · ${p.label}: ${p.value}`}</title></circle>)}
              </g>
            );
          })}
        </svg>
        {empty && <p className="cc-mono absolute inset-0 grid place-items-center text-xs text-muted">No activity in this window yet</p>}
      </div>
      <div className="cc-mono relative mt-1.5 h-4 text-[10px] text-muted" aria-hidden>
        {series[0]?.points.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (n - 1 - i >= labelEvery / 2 || i === n - 1) && (
          <span key={i} className="absolute top-0 whitespace-nowrap" style={i === 0 ? { left: 0 } : i === n - 1 ? { right: 0 } : { left: `${(i / Math.max(1, n - 1)) * 100}%`, transform: "translateX(-50%)" }}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Vertical columns, one per bucket. */
export function Columns({ points, tone = "blue", height = 120 }: { points: { label: string; value: number }[]; tone?: Tone; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {points.map((p, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end" title={`${p.label}: ${p.value}`}>
            <div className="cc-col w-full rounded-t-sm" style={{ height: `${p.value ? Math.max(4, (p.value / max) * 100) : 1.5}%`, background: p.value ? `linear-gradient(180deg, ${TONE[tone]}, color-mix(in srgb, ${TONE[tone]} 25%, transparent))` : "rgb(56 182 255 / 0.12)", animationDelay: `${i * 18}ms` }} />
            {p.value > 0 && <span className="cc-mono pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-ink-soft opacity-0 group-hover:opacity-100">{p.value}</span>}
          </div>
        ))}
      </div>
      <div className="cc-mono relative mt-1.5 h-4 text-[10px] text-muted" aria-hidden>
        {points.map((p, i) => i % labelEvery === 0 && (
          <span key={i} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 0.5) / points.length) * 100}%` }}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items, tone = "green", empty = "No data yet", max }: { items: { label: ReactNode; value: number; sub?: ReactNode; href?: string }[]; tone?: Tone; empty?: string; max?: number }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate text-ink-soft">{it.label}</span><span className="cc-mono shrink-0 font-semibold text-white">{fmt(it.value)}{it.sub && <span className="ml-1.5 font-normal text-muted">{it.sub}</span>}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgb(56_182_255/0.08)]"><div className="cc-bar h-full rounded-full" style={{ width: `${Math.max(2, (it.value / top) * 100)}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${TONE[tone]} 40%, transparent), ${TONE[tone]})`, animationDelay: `${i * 40}ms` }} /></div>
          </>
        );
        return <li key={i}>{it.href ? <Link href={it.href} className="block hover:opacity-90">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}

export interface Segment { label: string; value: number; tone: Tone }

export function Donut({ segments, center, sub, size = 148 }: { segments: Segment[]; center: string; sub?: string; size?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 42; const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")} className="shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(56 182 255 / 0.1)" strokeWidth="9" />
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * c; const el = (
            <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={TONE[s.tone]} strokeWidth="9" strokeDasharray={`${Math.max(0, len - 1.2)} ${c}`} strokeDashoffset={-offset}><title>{`${s.label}: ${s.value}`}</title></circle>
          ); offset += len; return el;
        })}
        <g className="rotate-90" style={{ transformOrigin: "50px 50px" }}>
          <text x="50" y={sub ? 50 : 54} textAnchor="middle" className="cc-mono" fill="#fff" fontSize="15" fontWeight="700">{center}</text>
          {sub && <text x="50" y="63" textAnchor="middle" fill="var(--color-muted)" fontSize="7" letterSpacing="1">{sub.toUpperCase()}</text>}
        </g>
      </svg>
      <Legend segments={segments} total={total} />
    </div>
  );
}

export function Legend({ segments, total }: { segments: Segment[]; total?: number }) {
  const t = total ?? segments.reduce((a, s) => a + s.value, 0);
  return (
    <ul className="min-w-[10rem] flex-1 space-y-1.5 text-sm">
      {segments.map((s) => (
        <li key={s.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-ink-soft"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TONE[s.tone], }} />{s.label}</span>
          <span className="cc-mono text-white">{fmt(s.value)}<span className="ml-1.5 text-muted">{t ? Math.round((s.value / t) * 100) : 0}%</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Semicircle meter, 0–100. */
export function Gauge({ value, label, sub, tone = "green" }: { value: number; label: string; sub?: string; tone?: Tone }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 40; const half = Math.PI * r;
  return (
    <div className="text-center">
      <svg viewBox="0 0 100 58" className="mx-auto w-full max-w-[150px]" role="img" aria-label={`${label}: ${Math.round(v)}%`}>
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="rgb(56 182 255 / 0.12)" strokeWidth="8" strokeLinecap="round" />
        {Array.from({ length: 11 }, (_, i) => { const a = Math.PI - (i / 10) * Math.PI; return <line key={i} x1={50 + 31 * Math.cos(a)} y1={50 - 31 * Math.sin(a)} x2={50 + 34 * Math.cos(a)} y2={50 - 34 * Math.sin(a)} stroke="rgb(143 166 180 / 0.35)" strokeWidth="0.8" />; })}
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke={TONE[tone]} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(v / 100) * half} ${half}`} />
        <text x="50" y="47" textAnchor="middle" className="cc-mono" fill="#fff" fontSize="15" fontWeight="700">{Math.round(v)}%</text>
      </svg>
      <p className="mt-1 text-sm font-semibold text-white">{label}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** One horizontal 100% bar split into segments. */
export function StackBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[rgb(56_182_255/0.08)]" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {total > 0 && segments.filter((s) => s.value).map((s) => <div key={s.label} className="cc-bar h-full" title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: TONE[s.tone] }} />)}
      </div>
      <div className="mt-3"><Legend segments={segments} total={total} /></div>
    </div>
  );
}

export function Chip({ tone = "blue", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="cc-mono inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px]" style={{ borderColor: `color-mix(in srgb, ${TONE[tone]} 40%, transparent)`, color: TONE[tone], background: `color-mix(in srgb, ${TONE[tone]} 8%, transparent)` }}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="cc-mono rounded-lg border border-dashed border-[var(--cc-line)] px-3 py-6 text-center text-xs text-muted">{children}</p>;
}

/** Small labelled number used in dense tiles. */
export function Mini({ label, value, tone }: { label: string; value: string | number; tone?: Tone }) {
  return <div className="rounded-lg border border-[var(--cc-line)] bg-[rgb(5_9_12/0.5)] px-3 py-2.5"><p className="cc-kicker !text-[10px]">{label}</p><p className="cc-mono mt-1 text-xl font-bold" style={{ color: tone ? TONE[tone] : "#fff" }}>{typeof value === "number" ? fmt(value) : value}</p></div>;
}

/** Segmented control made of links (keeps pages server-rendered). */
export function Segmented({ options, active }: { options: { href: string; label: string; value: string }[]; active: string }) {
  return (
    <div className="cc-mono inline-flex rounded-lg border border-[var(--cc-line)] bg-[rgb(5_9_12/0.6)] p-0.5 text-xs">
      {options.map((o) => <Link key={o.value} href={o.href} aria-current={o.value === active ? "page" : undefined} className={cn("rounded-md px-2.5 py-1.5", o.value === active ? "bg-[rgb(61_255_168/0.12)] text-[var(--cc-green)] shadow-[inset_0_0_0_1px_rgb(61_255_168/0.35)]" : "text-ink-soft hover:text-white")}>{o.label}</Link>)}
    </div>
  );
}

/** Two values per bucket side by side (e.g. MRR added vs lost, signups vs first bids). */
export function PairColumns({ points, a, b, height = 120 }: { points: { label: string; a: number; b: number }[]; a: { name: string; tone: Tone }; b: { name: string; tone: Tone }; height?: number }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const bar = (v: number, tone: Tone, title: string) => <div className="w-1/2 rounded-t-sm" title={title} style={{ height: `${v ? Math.max(4, (v / max) * 100) : 1.5}%`, background: v ? TONE[tone] : "rgb(56 182 255 / 0.12)", opacity: v ? 0.85 : 1 }} />;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 text-xs text-ink-soft">
        {[a, b].map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: TONE[s.tone] }} />{s.name} <span className="cc-mono text-muted">{fmt(points.reduce((n, p) => n + (i ? p.b : p.a), 0))}</span></span>)}
      </div>
      <div className="flex items-end gap-1" style={{ height }} role="img" aria-label={`${a.name} and ${b.name} by period`}>
        {points.map((p, i) => <div key={i} className="flex h-full flex-1 items-end gap-px">{bar(p.a, a.tone, `${p.label} · ${a.name}: ${p.a}`)}{bar(p.b, b.tone, `${p.label} · ${b.name}: ${p.b}`)}</div>)}
      </div>
      <div className="cc-mono relative mt-1.5 h-4 text-[10px] text-muted" aria-hidden>
        {points.map((p, i) => i % labelEvery === 0 && <span key={i} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 0.5) / points.length) * 100}%` }}>{p.label}</span>)}
      </div>
    </div>
  );
}

/** A labelled value row for detail panels. */
export function Row({ k, children }: { k: ReactNode; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 border-t border-[var(--cc-line)] py-2 text-sm first:border-t-0"><dt className="text-ink-soft">{k}</dt><dd className="cc-mono text-right text-white">{children}</dd></div>;
}

export const usdWhole = (dollars: number) => dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "–");

/** Data freshness for a provider-powered section: connection status and when it was last read. */
export function Fresh({ at, state, now, staleAfterH = 24 }: { at?: string | null; state: "live" | "not_connected" | "error" | "manual"; now: number; staleAfterH?: number }) {
  if (state === "not_connected") return <NotConnected />;
  if (state === "error") return <span className="cc-mono rounded border border-[var(--cc-amber)]/50 px-1.5 py-0.5 text-[11px] text-[var(--cc-amber)]">Unavailable · not shown</span>;
  if (!at) return <span className="cc-mono text-[11px] text-muted">{state === "manual" ? "Owner-entered" : "–"}</span>;
  const stale = now - Date.parse(at) > staleAfterH * 3_600_000;
  return <span className={cn("cc-mono text-[11px]", stale ? "text-[var(--cc-amber)]" : "text-muted")} title={new Date(at).toISOString()}>{state === "manual" ? "Updated" : stale ? "Stale ·" : "Live ·"} {ago(at, now)}</span>;
}
