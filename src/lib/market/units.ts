/**
 * Unit-of-measure normalization for pricing observations.
 *
 * Every raw unit maps to a canonical unit inside a "family". Within a family, quantities and unit
 * prices are converted to the family's base unit so "$4.50 / SF" and "$450 / square" compare.
 * Units that cannot be converted safely (packages, lump sums, days vs hours) keep their own base
 * and are only ever compared with the identical unit.
 */
export type UnitFamily = "area" | "length" | "volume" | "weight" | "liquid" | "count" | "time_hour" | "time_day" | "time_week" | "lump_sum" | "package" | "unknown";

export interface NormalizedUnit {
  /** Canonical spelling of the unit as entered (e.g. "square" for roofing squares). */
  unit: string;
  /** Base unit that normalized quantities/prices are expressed in. */
  base: string;
  family: UnitFamily;
  /** Multiply a quantity in `unit` by this to get the base unit. */
  factor: number;
  /** False when the raw text was not recognized. */
  recognized: boolean;
}

interface Def { unit: string; base: string; family: UnitFamily; factor: number; aliases: string[] }

const DEFS: Def[] = [
  { unit: "square foot", base: "square foot", family: "area", factor: 1, aliases: ["sf", "sq ft", "sqft", "sq. ft.", "sq.ft.", "ft2", "ft²", "square feet", "sq feet", "sq foot", "s.f."] },
  { unit: "square yard", base: "square foot", family: "area", factor: 9, aliases: ["sy", "sq yd", "sqyd", "yd2", "yd²", "square yards", "s.y."] },
  // Roofing/siding "square" = 100 square feet.
  { unit: "square", base: "square foot", family: "area", factor: 100, aliases: ["sq", "squares", "roofing square", "rsq"] },
  { unit: "linear foot", base: "linear foot", family: "length", factor: 1, aliases: ["lf", "lin ft", "ln ft", "linear feet", "lineal foot", "lineal feet", "l.f.", "ft", "foot", "feet"] },
  { unit: "linear yard", base: "linear foot", family: "length", factor: 3, aliases: ["ly", "lin yd"] },
  { unit: "inch", base: "linear foot", family: "length", factor: 1 / 12, aliases: ["in", "inches", "\""] },
  { unit: "cubic yard", base: "cubic yard", family: "volume", factor: 1, aliases: ["cy", "cu yd", "cuyd", "yd3", "yd³", "cubic yards", "yard", "yards", "yds"] },
  { unit: "cubic foot", base: "cubic yard", family: "volume", factor: 1 / 27, aliases: ["cf", "cu ft", "cuft", "ft3", "ft³", "cubic feet"] },
  { unit: "ton", base: "ton", family: "weight", factor: 1, aliases: ["tons", "tn"] },
  { unit: "pound", base: "ton", family: "weight", factor: 1 / 2000, aliases: ["lb", "lbs", "pounds"] },
  { unit: "gallon", base: "gallon", family: "liquid", factor: 1, aliases: ["gal", "gals", "gallons"] },
  { unit: "quart", base: "gallon", family: "liquid", factor: 0.25, aliases: ["qt", "quarts"] },
  { unit: "each", base: "each", family: "count", factor: 1, aliases: ["ea", "unit", "units", "pc", "pcs", "piece", "pieces", "item", "items", "opening", "openings", "fixture", "fixtures"] },
  { unit: "hour", base: "hour", family: "time_hour", factor: 1, aliases: ["hr", "hrs", "hours", "man hour", "man-hour", "labor hour", "mh"] },
  // Days and weeks are NOT converted to hours: crew-days are priced differently from hourly billing.
  { unit: "day", base: "day", family: "time_day", factor: 1, aliases: ["days", "crew day", "crew-day", "dy"] },
  { unit: "week", base: "week", family: "time_week", factor: 1, aliases: ["wk", "wks", "weeks"] },
  { unit: "lump sum", base: "lump sum", family: "lump_sum", factor: 1, aliases: ["ls", "lump", "lot", "job", "allowance", "flat", "flat rate"] },
];

// Package units: comparable only to the identical package unit (package sizes vary by product).
const PACKAGES = ["sheet", "box", "bundle", "roll", "bag", "load", "pallet", "case", "carton", "tube", "bucket", "pail", "set", "kit", "pair"];

const LOOKUP = new Map<string, Def>();
for (const d of DEFS) {
  LOOKUP.set(d.unit, d);
  for (const a of d.aliases) LOOKUP.set(a, d);
}

function clean(raw: string): string {
  return raw.trim().toLowerCase().replace(/^per\s+/, "").replace(/^\/\s*/, "").replace(/\s+/g, " ");
}

export function normalizeUnit(raw: string | null | undefined): NormalizedUnit {
  const s = clean(raw ?? "");
  if (!s) return { unit: "each", base: "each", family: "count", factor: 1, recognized: false };
  const direct = LOOKUP.get(s) ?? LOOKUP.get(s.replace(/\.$/, "")) ?? LOOKUP.get(s.replace(/s$/, ""));
  if (direct) return { unit: direct.unit, base: direct.base, family: direct.family, factor: direct.factor, recognized: true };
  const pkg = PACKAGES.find((p) => s === p || s === `${p}s` || s === `${p}es`);
  if (pkg) return { unit: pkg, base: pkg, family: "package", factor: 1, recognized: true };
  return { unit: s.slice(0, 40), base: s.slice(0, 40), family: "unknown", factor: 1, recognized: false };
}

/** Quantity and unit price expressed in the base unit. Price per base unit = price / factor. */
export function toBase(quantity: number, unitPrice: number, raw: string): { quantity: number; unitPrice: number; unit: NormalizedUnit } {
  const unit = normalizeUnit(raw);
  return { quantity: quantity * unit.factor, unitPrice: unit.factor === 0 ? unitPrice : unitPrice / unit.factor, unit };
}

/** Units whose per-unit price is meaningful to compare across observations. */
export function isComparableFamily(f: UnitFamily): boolean {
  return f !== "lump_sum" && f !== "unknown";
}

/**
 * Ratios that suggest the wrong unit was used (e.g. a per-square price entered per square foot).
 * Used by the anomaly engine; kept here so the TS and SQL sides share one list.
 */
export const UNIT_CONFUSION_RATIOS = [9, 12, 27, 100, 144] as const;

export function suspectedUnitConfusion(value: number, peerMedian: number, tolerance = 0.12): number | null {
  if (!(value > 0) || !(peerMedian > 0)) return null;
  const r = value > peerMedian ? value / peerMedian : peerMedian / value;
  for (const f of UNIT_CONFUSION_RATIOS) if (Math.abs(r - f) / f <= tolerance) return f;
  return null;
}
