/**
 * Money in vs money out per period (company Reports). Server-rendered, no chart library: grouped bars on one
 * y-scale, each period links to the records behind it. Every bar has a text tooltip and the P&L table below
 * is the table view. Colors passed the dataviz validator (light: #0891b2/#c2410c, dark: #06a3c4/#e0702c).
 */
import Link from "next/link";
import { formatCurrency } from "@/lib/estimate/money";

export interface MoneyPoint { label: string; moneyIn: string; moneyOut: string; net: string; href: string }

export function MoneyChart({ points }: { points: MoneyPoint[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [Math.max(0, Number(p.moneyIn)), Math.max(0, Number(p.moneyOut))]));
  const h = (v: string) => `${Math.max(0, Number(v)) ? Math.max(2, (Math.max(0, Number(v)) / max) * 100) : 0}%`;
  return (
    <figure className="pl-chart" data-testid="pl-chart">
      <style>{`.pl-chart{--pl-in:#0891b2;--pl-out:#c2410c}html[data-theme]:has(.app-theme) .pl-chart{--pl-in:#06a3c4;--pl-out:#e0702c}`}</style>
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--pl-in)" }} />Money in</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--pl-out)" }} />Money out</span>
        <span className="text-muted">Select a period to see its records</span>
      </figcaption>
      <div className="overflow-x-auto">
        <div className="flex h-44 min-w-full items-stretch gap-1 border-b border-line" style={{ minWidth: `${points.length * 1.75}rem` }}>
          {points.map((p) => (
            <Link key={p.label} href={p.href} prefetch={false} className="group flex flex-1 flex-col rounded-t-md px-0.5 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2"
              title={`${p.label} · Money in ${formatCurrency(p.moneyIn)} · Money out ${formatCurrency(p.moneyOut)} · Net ${formatCurrency(p.net)}`}
              aria-label={`${p.label}: money in ${formatCurrency(p.moneyIn)}, money out ${formatCurrency(p.moneyOut)}, net ${formatCurrency(p.net)}`}>
              <span className="flex flex-1 items-end justify-center gap-[2px]">
                <span className="w-[42%] max-w-6 rounded-t" style={{ height: h(p.moneyIn), background: "var(--pl-in)" }} />
                <span className="w-[42%] max-w-6 rounded-t" style={{ height: h(p.moneyOut), background: "var(--pl-out)" }} />
              </span>
            </Link>
          ))}
        </div>
        <div className="flex gap-1" style={{ minWidth: `${points.length * 1.75}rem` }}>
          {points.map((p) => <span key={p.label} className="flex-1 overflow-hidden whitespace-nowrap pt-1 text-center text-[10px] text-muted sm:text-[11px]">{p.label}</span>)}
        </div>
      </div>
    </figure>
  );
}
