/**
 * Circle (donut) overview card, QuickBooks-dashboard style. Server-rendered SVG, no chart library.
 * Every slice and every legend row links to the records behind it; the legend always prints the name,
 * amount and share, so no slice is told apart by color alone. Slices are separated by a 2px surface gap.
 * Colors: the dataviz reference categorical slots 1-6 (validated light + dark, fixed order) plus the
 * status trio (paid / not due / overdue) and two neutrals.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import type { Slice } from "@/lib/financials/donuts";

const STYLE = `.fin-donut{--d-c1:#2a78d6;--d-c2:#eb6834;--d-c3:#1baf7a;--d-c4:#eda100;--d-c5:#e87ba4;--d-c6:#008300;--d-ok:#0f8a5f;--d-info:#2a78d6;--d-danger:#d03b3b;--d-muted:#8a96a3;--d-rest:#c3cdd7;--d-gap:var(--color-surface)}
html[data-theme]:has(.app-theme) .fin-donut{--d-c1:#3987e5;--d-c2:#d95926;--d-c3:#199e70;--d-c4:#c98500;--d-c5:#d55181;--d-c6:#0ca30c;--d-ok:#1baf7a;--d-info:#3987e5;--d-danger:#e66767;--d-muted:#6f8293;--d-rest:#465767}`;

const R = 40, C = 2 * Math.PI * R, GAP = 1.2;

export function DonutCard({ title, slices, total, center, centerSub, empty, footer, testId, action }: {
  title: string; slices: Slice[]; total: string; center?: string; centerSub?: string; empty: ReactNode; footer?: ReactNode; testId?: string; action?: { label: string; href: string };
}) {
  const sum = Number(total);
  let at = 0;
  const arcs = sum > 0 ? slices.map((s) => {
    const len = (Number(s.amount) / sum) * C;
    const gap = slices.length > 1 ? Math.min(GAP, len / 2) : 0;
    const arc = { s, dash: `${Math.max(0, len - gap)} ${C}`, offset: -at };
    at += len;
    return arc;
  }) : [];
  return (
    <section className="fin-donut @container flex h-full flex-col rounded-xl border border-line bg-surface p-4" aria-label={title} data-testid={testId}>
      <style>{STYLE}</style>
      <div className="mb-3 flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-display text-base font-extrabold">{title}</h2>
        {action && <Link href={action.href} prefetch={false} className="shrink-0 text-xs font-semibold text-accent-ink underline">{action.label}</Link>}
      </div>
      {sum <= 0 ? <div className="flex flex-1 items-center justify-center py-6 text-center text-sm text-ink-soft">{empty}</div> : (
        <div className="flex flex-1 flex-col items-center gap-4 @md:flex-row @md:items-center">
          <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0 -rotate-90" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${formatCurrency(s.amount)} (${s.pct}%)`).join(", ")}`}>
            {arcs.map(({ s, dash, offset }) => {
              const ring = <circle cx="50" cy="50" r={R} fill="none" stroke={`var(--d-${s.tone})`} strokeWidth="14" strokeDasharray={dash} strokeDashoffset={offset} className="transition-[stroke-width] duration-150 hover:[stroke-width:17]"><title>{`${s.label}: ${formatCurrency(s.amount)} (${s.pct}%)`}</title></circle>;
              return s.href ? <a key={s.key} href={s.href} aria-label={`${s.label}: ${formatCurrency(s.amount)}, ${s.pct}%`}>{ring}</a> : <g key={s.key}>{ring}</g>;
            })}
            <g className="rotate-90" style={{ transformOrigin: "50px 50px" }}>
              <text x="50" y={centerSub ? 49 : 53} textAnchor="middle" className="fill-ink font-display text-[11px] font-extrabold">{center ?? compact(total)}</text>
              {centerSub && <text x="50" y="60" textAnchor="middle" className="fill-muted text-[6.5px]">{centerSub}</text>}
            </g>
          </svg>
          <ul className="w-full min-w-0 flex-1 space-y-0.5 text-sm">
            {slices.map((s) => {
              const row = (
                <>
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(--d-${s.tone})` }} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="tabular font-semibold">{formatCurrency(s.amount)}</span>
                  <span className="w-9 text-right text-xs tabular text-muted">{s.pct}%</span>
                </>
              );
              return (
                <li key={s.key}>
                  {s.href
                    ? <Link href={s.href} prefetch={false} className="flex min-h-9 items-center gap-2 rounded-md px-1.5 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-1">{row}</Link>
                    : <span className="flex min-h-9 items-center gap-2 px-1.5">{row}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {footer && <div className="mt-2 text-xs text-muted">{footer}</div>}
    </section>
  );
}

/** $12.3K style for the ring's center (the legend carries exact amounts). */
export function compact(v: string): string {
  const n = Number(v), a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}
