import { US_STATES } from "@/lib/market/geo";

/** Tile-grid map of the US: every state is the same size, so small states stay readable. */
const TILES: [string, number, number][] = [
  ["AK", 0, 0], ["ME", 11, 0], ["VT", 10, 1], ["NH", 11, 1],
  ["WA", 1, 2], ["ID", 2, 2], ["MT", 3, 2], ["ND", 4, 2], ["MN", 5, 2], ["IL", 6, 2], ["WI", 7, 2], ["MI", 8, 2], ["NY", 9, 2], ["RI", 10, 2], ["MA", 11, 2],
  ["OR", 1, 3], ["NV", 2, 3], ["WY", 3, 3], ["SD", 4, 3], ["IA", 5, 3], ["IN", 6, 3], ["OH", 7, 3], ["PA", 8, 3], ["NJ", 9, 3], ["CT", 10, 3],
  ["CA", 1, 4], ["UT", 2, 4], ["CO", 3, 4], ["NE", 4, 4], ["MO", 5, 4], ["KY", 6, 4], ["WV", 7, 4], ["VA", 8, 4], ["MD", 9, 4], ["DE", 10, 4],
  ["AZ", 2, 5], ["NM", 3, 5], ["KS", 4, 5], ["AR", 5, 5], ["TN", 6, 5], ["NC", 7, 5], ["SC", 8, 5], ["DC", 9, 5],
  ["OK", 4, 6], ["LA", 5, 6], ["MS", 6, 6], ["AL", 7, 6], ["GA", 8, 6],
  ["HI", 0, 7], ["TX", 4, 7], ["FL", 9, 7],
];

export function UsTileMap({ values, unit = "bids" }: { values: Record<string, number>; unit?: string }) {
  const max = Math.max(1, ...Object.values(values));
  const size = 10; const gap = 0.9;
  return (
    <svg viewBox={`0 0 ${12 * size} ${8 * size}`} className="w-full" role="img" aria-label={`Map of ${unit} by state: ${Object.entries(values).filter(([, v]) => v).map(([s, v]) => `${s} ${v}`).join(", ") || "no data yet"}`}>
      {TILES.map(([st, cx, cy]) => {
        const v = values[st] ?? 0;
        const k = v ? 0.25 + 0.75 * Math.sqrt(v / max) : 0;
        return (
          <g key={st}>
            <rect x={cx * size + gap / 2} y={cy * size + gap / 2} width={size - gap} height={size - gap} rx="1.4"
              fill={v ? `rgb(61 255 168 / ${k * 0.85})` : "rgb(56 182 255 / 0.06)"} stroke={v ? "rgb(61 255 168 / 0.9)" : "rgb(56 182 255 / 0.22)"} strokeWidth="0.3"
              style={v ? { filter: `drop-shadow(0 0 ${1 + k * 2}px rgb(61 255 168 / 0.7))` } : undefined}>
              <title>{`${US_STATES[st] ?? st}: ${v} ${unit}`}</title>
            </rect>
            <text x={cx * size + size / 2} y={cy * size + size / 2 + (v ? -0.4 : 1.2)} textAnchor="middle" fontSize="3" fontWeight="700" className="cc-mono pointer-events-none" fill={v && k > 0.55 ? "#03140c" : v ? "#eafff5" : "rgb(143 166 180 / 0.75)"}>{st}</text>
            {v > 0 && <text x={cx * size + size / 2} y={cy * size + size / 2 + 3.4} textAnchor="middle" fontSize="2.6" className="cc-mono pointer-events-none" fill={k > 0.55 ? "#03140c" : "#eafff5"}>{v}</text>}
          </g>
        );
      })}
    </svg>
  );
}
