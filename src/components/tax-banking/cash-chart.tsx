"use client";
/**
 * Cash-flow forecast chart: one balance line (or area) for the chosen view, or money in / money out bars, or a table.
 * One y-scale, hover crosshair + tooltip, keyboard reachable points, and the table is always available.
 * Colors: balance uses the brand ink; in/out reuse the P&L pair validated with the dataviz script
 * (light #0891b2/#c2410c, dark #06a3c4/#e0702c).
 */
import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import type { CashEvent, SeriesPoint } from "@/lib/tax-banking/forecast";

export type CashView = "confirmed" | "scheduled" | "expected";
type Kind = "line" | "area" | "bar" | "table";
const VIEW_LABEL: Record<CashView, string> = { confirmed: "Confirmed", scheduled: "Scheduled", expected: "Expected" };
const VIEW_HELP: Record<CashView, string> = {
  confirmed: "Bank-reported balance only. Nothing that hasn't happened yet.",
  scheduled: "Plus bills, payroll and planned payments with a set date.",
  expected: "Plus invoices and milestones on the dates customers usually pay (estimates).",
};
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function CashChart({ series, events, scheduledEvents, initialView = "expected", startsFromBank }: {
  series: SeriesPoint[]; events: CashEvent[]; scheduledEvents: CashEvent[]; initialView?: CashView; startsFromBank: boolean;
}) {
  const [view, setView] = useState<CashView>(initialView);
  const [kind, setKind] = useState<Kind>("line");
  const [hover, setHover] = useState<number | null>(null);
  const evs = useMemo(() => (view === "expected" ? events : view === "scheduled" ? scheduledEvents : []), [view, events, scheduledEvents]);
  const flows = useMemo(() => {
    const m = new Map<string, { in: number; out: number }>();
    for (const e of evs) { const f = m.get(e.date) ?? { in: 0, out: 0 }; const a = Number(e.amount); if (a >= 0) f.in += a; else f.out += -a; m.set(e.date, f); }
    return series.map((p) => ({ date: p.date, ...(m.get(p.date) ?? { in: 0, out: 0 }), bal: Number(p[view]) }));
  }, [evs, series, view]);
  // Bars: one per day up to 31 days, else one per week (sum of the week, balance at its end).
  const bars = useMemo(() => {
    if (flows.length <= 31) return flows.map((f) => ({ ...f, label: fmtDay(f.date) }));
    const out: { date: string; in: number; out: number; bal: number; label: string }[] = [];
    for (let i = 0; i < flows.length; i += 7) { const w = flows.slice(i, i + 7); out.push({ date: w[0].date, in: w.reduce((s, x) => s + x.in, 0), out: w.reduce((s, x) => s + x.out, 0), bal: w[w.length - 1].bal, label: `Wk of ${fmtDay(w[0].date)}` }); }
    return out;
  }, [flows]);

  const W = 720, H = 240, PL = 64, PR = 12, PT = 12, PB = 28;
  const vals = kind === "bar" ? bars.flatMap((b) => [b.in, -b.out]) : flows.map((f) => f.bal);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0) lo -= pad;
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const n = kind === "bar" ? bars.length : flows.length;
  const x = (i: number) => PL + (n <= 1 ? (W - PL - PR) / 2 : (i / (n - 1)) * (W - PL - PR));
  const ticks = [lo, lo + (hi - lo) / 2, hi].map((v) => Math.round(v / 100) * 100);
  const path = flows.map((f, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(f.bal).toFixed(1)}`).join("");
  const area = `${path}L${x(flows.length - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}L${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}Z`;
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const h = hover !== null ? (kind === "bar" ? bars[hover] : flows[hover]) : null;

  return (
    <figure className="cash-chart space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="cash-chart">
      <style>{`.cash-chart{--c-bal:#0b2d4d;--c-in:#0891b2;--c-out:#c2410c}html[data-theme]:has(.app-theme) .cash-chart{--c-bal:#9cc3f0;--c-in:#06a3c4;--c-out:#e0702c}`}</style>
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Forecast view" className="inline-flex rounded-lg border border-line p-0.5">
          {(Object.keys(VIEW_LABEL) as CashView[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} disabled={v === "confirmed" && !startsFromBank}
              className={`min-h-9 rounded-md px-3 text-sm font-semibold disabled:opacity-40 ${view === v ? "bg-brand-tint text-ink" : "text-ink-soft"}`}>{VIEW_LABEL[v]}</button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Chart type" className="inline-flex rounded-lg border border-line p-0.5">
          {(["line", "area", "bar", "table"] as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setHover(null); }}
              className={`min-h-9 rounded-md px-3 text-sm font-semibold capitalize ${kind === k ? "bg-brand-tint text-ink" : "text-ink-soft"}`}>{k}</button>
          ))}
        </div>
        <p className="text-xs text-muted">{VIEW_HELP[view]}</p>
      </div>
      {kind === "table" ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm" data-testid="cash-table">
            <caption className="sr-only">{VIEW_LABEL[view]} cash forecast by day</caption>
            <thead className="sticky top-0 bg-surface"><tr className="text-left text-xs text-muted"><th className="py-1 pr-3">Date</th><th className="pr-3 text-right">Money in</th><th className="pr-3 text-right">Money out</th><th className="text-right">Balance</th></tr></thead>
            <tbody>{flows.filter((f, i) => f.in || f.out || i === 0 || i === flows.length - 1).map((f) => (
              <tr key={f.date} className="border-t border-line"><td className="py-1 pr-3">{fmtDay(f.date)}</td><td className="pr-3 text-right tabular-nums">{f.in ? formatCurrency(f.in.toFixed(2)) : ""}</td><td className="pr-3 text-right tabular-nums">{f.out ? formatCurrency(f.out.toFixed(2)) : ""}</td><td className={`text-right font-semibold tabular-nums ${f.bal < 0 ? "text-danger" : ""}`}>{formatCurrency(f.bal.toFixed(2))}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          {kind === "bar" && (
            <div className="mb-1 flex gap-4 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--c-in)" }} />Money in</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--c-out)" }} />Money out</span>
            </div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${VIEW_LABEL[view]} cash forecast, ${kind} chart. Ends at ${formatCurrency(flows[flows.length - 1]?.bal.toFixed(2) ?? "0")}. Use the table view for every value.`}
            onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => <g key={t}><line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line" strokeWidth={1} /><text x={PL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} className="fill-current text-muted">{formatCurrency(String(t)).replace(/\.00$/, "")}</text></g>)}
            {lo < 0 && <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-ink-soft" strokeWidth={1} />}
            {kind === "area" && <path d={area} fill="var(--c-bal)" opacity={0.14} />}
            {kind !== "bar" && <path d={path} fill="none" stroke="var(--c-bal)" strokeWidth={2} strokeLinejoin="round" />}
            {kind === "bar" && bars.map((b, i) => {
              const bw = Math.max(3, Math.min(18, ((W - PL - PR) / bars.length) * 0.35));
              return <g key={b.date}>
                {b.in > 0 && <rect x={x(i) - bw - 1} y={y(b.in)} width={bw} height={Math.max(1, y(0) - y(b.in))} rx={2} fill="var(--c-in)" />}
                {b.out > 0 && <rect x={x(i) + 1} y={y(0)} width={bw} height={Math.max(1, y(-b.out) - y(0))} rx={2} fill="var(--c-out)" />}
              </g>;
            })}
            {Array.from({ length: n }, (_, i) => i).filter((i) => i % labelEvery === 0).map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i >= n - labelEvery ? "end" : "middle"} fontSize={11} className="fill-current text-muted">{kind === "bar" ? fmtDay(bars[i].date) : fmtDay(flows[i].date)}</text>)}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="currentColor" className="text-ink-soft" strokeDasharray="3 3" />}
            {hover !== null && kind !== "bar" && <circle cx={x(hover)} cy={y(flows[hover].bal)} r={4.5} fill="var(--c-bal)" stroke="white" strokeWidth={2} />}
            {Array.from({ length: n }, (_, i) => i).map((i) => {
              const w = (W - PL - PR) / Math.max(1, n - 1);
              return <rect key={i} x={x(i) - w / 2} y={PT} width={w} height={H - PT - PB} fill="transparent" tabIndex={0} aria-label={kind === "bar" ? `${bars[i].label}: in ${formatCurrency(bars[i].in.toFixed(2))}, out ${formatCurrency(bars[i].out.toFixed(2))}` : `${fmtDay(flows[i].date)}: ${formatCurrency(flows[i].bal.toFixed(2))}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />;
            })}
          </svg>
          {h && (
            <div role="status" className="pointer-events-none absolute top-6 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md" style={{ left: `clamp(0px, calc(${(x(hover!) / W) * 100}% - 70px), calc(100% - 160px))` }}>
              <p className="font-semibold">{"label" in h ? (h as { label: string }).label : fmtDay(h.date)}</p>
              <p>Balance {formatCurrency(h.bal.toFixed(2))}</p>
              {h.in > 0 && <p>In {formatCurrency(h.in.toFixed(2))}</p>}
              {h.out > 0 && <p>Out {formatCurrency(h.out.toFixed(2))}</p>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
