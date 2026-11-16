/** Shared owner-report controls parsed from the query string: date range and test-data toggle. */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export const RANGES = {
  "7d": { days: 7, unit: "day", buckets: 7, label: "7 days" },
  "30d": { days: 30, unit: "day", buckets: 30, label: "30 days" },
  "90d": { days: 90, unit: "week", buckets: 13, label: "90 days" },
  "12m": { days: 365, unit: "month", buckets: 12, label: "12 months" },
} as const;
export type RangeKey = keyof typeof RANGES;
export type Range = (typeof RANGES)[RangeKey] & { key: RangeKey };

export interface View { range: Range; includeTest: boolean; sp: SP }

export function parseView(sp: SP, fallback: RangeKey = "30d"): View {
  const k = one(sp.range);
  const key: RangeKey = k in RANGES ? (k as RangeKey) : fallback;
  return { range: { ...RANGES[key], key }, includeTest: one(sp.data) === "all", sp };
}

/** Build a link that keeps the current controls and applies a patch ("" removes a key). */
export function href(path: string, v: View, patch: Record<string, string | undefined> = {}): string {
  const m = new URLSearchParams();
  const base: Record<string, string | undefined> = { range: v.range.key === "30d" ? undefined : v.range.key, data: v.includeTest ? "all" : undefined };
  for (const [k, val] of Object.entries(v.sp)) if (!(k in base) && typeof val === "string" && val) base[k] = val;
  for (const [k, val] of Object.entries({ ...base, ...patch })) if (val && !(k === "range" && val === "30d")) m.set(k, val);
  const s = m.toString();
  return s ? `${path}?${s}` : path;
}

export const str = one;

/**
 * Link to another owner report that carries only the shared controls (date range, test-data toggle)
 * plus the drilldown filter, never the current page's own filters. Used by clickable KPI cards.
 */
export function carry(path: string, v: View, patch: Record<string, string | undefined> = {}, hash?: string): string {
  return href(path, { ...v, sp: {} }, patch) + (hash ? `#${hash}` : "");
}
