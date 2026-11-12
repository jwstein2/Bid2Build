/** Admin report filters: parsed from the URL, whitelisted, and passed to the database as JSON. */
export const FILTER_KEYS = [
  "dataset", "date_from", "date_to", "state", "metro", "trade", "project_type", "work_type", "sector", "complexity",
  "status", "material_category", "brand", "material_key", "price_min", "price_max", "size_min", "size_max", "basis", "tax",
  "q", "level", "detail_key", "detail_unit", "kind", "review_status",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

const PATTERNS: Partial<Record<FilterKey, RegExp>> = {
  dataset: /^(real|synthetic)$/,
  date_from: /^\d{4}-\d{2}-\d{2}$/,
  date_to: /^\d{4}-\d{2}-\d{2}$/,
  state: /^[A-Z]{2}$/,
  status: /^(all|quoted|accepted|declined|completed)$/,
  basis: /^(price|cost)$/,
  tax: /^(excluded|included)$/,
  level: /^(national|state|metro|zip3|zip5)$/,
  complexity: /^(standard|complex)$/,
  sector: /^(residential|commercial)$/,
  price_min: /^\d{1,9}(\.\d+)?$/,
  price_max: /^\d{1,9}(\.\d+)?$/,
  size_min: /^\d{1,9}(\.\d+)?$/,
  size_max: /^\d{1,9}(\.\d+)?$/,
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const out: Filters = {};
  for (const k of FILTER_KEYS) {
    const raw = sp[k];
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!v || v.length > 120) continue;
    const re = PATTERNS[k];
    if (re && !re.test(v)) continue;
    out[k] = v;
  }
  return out;
}

/** Defaults that are implicit in the database are made explicit for display. */
export function isSynthetic(f: Filters) {
  return f.dataset === "synthetic";
}

export function toQuery(f: Filters, patch: Filters = {}): string {
  const merged = { ...f, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}
