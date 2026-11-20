import type { YearBar } from "@/lib/affiliates/portfolio";
import { usd } from "@/lib/affiliates/portfolio";

/**
 * Annual earnings by year: one stacked bar per year. Paid (solid brand), earned but not yet paid (lighter brand), and
 * forecast (hatched outline, never solid, so it can't be mistaken for money earned). One hue, light to dark; a 2px gap
 * between segments; rounded top end; native hover titles; the table below is the accessible alternative.
 */
export function EarningsChart({ bars }: { bars: YearBar[] }) {
  if (!bars.length) return <p className="text-sm text-ink-soft">Nothing to chart yet. Annual commissions appear here once a referred customer pays.</p>;
  const max = Math.max(...bars.map((b) => b.paid + b.pending + b.projected), 1);
  const W = Math.max(320, bars.length * 56), H = 220, top = 12, bottom = 28, left = 8, plot = H - top - bottom;
  const bw = Math.min(32, (W - left * 2) / bars.length - 12);
  const y = (c: number) => (c / max) * plot;
  return (
    <figure>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Annual earnings by year: paid, earned not yet paid, and forecast. Full numbers in the table below." className="min-w-[320px]">
          <defs>
            <pattern id="aff-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-brand)" strokeWidth="1.5" strokeOpacity="0.45" />
            </pattern>
          </defs>
          <line x1={0} x2={W} y1={top + plot} y2={top + plot} stroke="currentColor" strokeOpacity="0.2" />
          {bars.map((b, i) => {
            const cx = left + (i + 0.5) * ((W - left * 2) / bars.length);
            const x = cx - bw / 2;
            let base = top + plot;
            const segs = [
              { k: "Paid", v: b.paid, fill: "var(--color-brand)", op: 1, stroke: "none" },
              { k: "Earned, not yet paid", v: b.pending, fill: "var(--color-brand)", op: 0.45, stroke: "none" },
              { k: "Forecast", v: b.projected, fill: "url(#aff-hatch)", op: 1, stroke: "var(--color-brand)" },
            ].filter((s) => s.v > 0);
            return (
              <g key={b.year}>
                <title>{`${b.year}: paid ${usd(b.paid)}, earned not yet paid ${usd(b.pending)}, forecast ${usd(b.projected)}`}</title>
                <rect x={cx - (bw + 12) / 2} y={top} width={bw + 12} height={plot} fill="transparent" />
                {segs.map((s, j) => {
                  const h = Math.max(2, y(s.v) - (j > 0 ? 2 : 0));
                  base -= h + (j > 0 ? 2 : 0);
                  const last = j === segs.length - 1;
                  return (
                    <path key={s.k} fill={s.fill} fillOpacity={s.op} stroke={s.stroke} strokeWidth={s.stroke === "none" ? 0 : 1} strokeDasharray={s.stroke === "none" ? undefined : "3 2"}
                      d={last ? `M${x},${base + h} V${base + 4} Q${x},${base} ${x + 4},${base} H${x + bw - 4} Q${x + bw},${base} ${x + bw},${base + 4} V${base + h} Z` : `M${x},${base} H${x + bw} V${base + h} H${x} Z`} />
                  );
                })}
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.7">{b.year}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-brand" />Paid</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-brand opacity-45" />Earned, not yet paid</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-dashed border-brand" />Forecast (if customers keep paying)</span>
      </figcaption>
    </figure>
  );
}
