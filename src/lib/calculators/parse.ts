import { D, type Dec } from "../estimate/money";

/**
 * Measurement input parsing for the quantity calculators.
 *
 * Inputs are kept as the strings the contractor typed (so a reloaded calculator shows exactly what
 * was entered) and parsed with decimal.js, never binary floats. Feet fields also accept
 * feet-and-inches notation: 12'6", 12' 6, 12ft 6in, 6" (inches only).
 */
export type ParseError = "empty" | "invalid" | "negative" | "too_large";
export type Parsed = { ok: true; value: Dec } | { ok: false; error: ParseError };

const PLAIN = /^\d*\.?\d+$|^\d+\.$/;
const FEET_INCHES = /^(?:(\d*\.?\d+)\s*(?:'|ft\.?|feet|foot))?\s*(?:(\d*\.?\d+)\s*(?:"|''|in\.?|inch(?:es)?)?)?$/i;

export function parseNumber(raw: string | undefined | null, opts: { feet?: boolean; max?: number } = {}): Parsed {
  const s = (raw ?? "").trim().replace(/,/g, "");
  if (!s) return { ok: false, error: "empty" };
  if (s.startsWith("-")) return { ok: false, error: "negative" };
  let value: Dec | null = null;
  if (PLAIN.test(s)) value = new D(s);
  else if (opts.feet) {
    const m = FEET_INCHES.exec(s);
    // Require a unit marker somewhere so a bare "12 6" is not silently read as 12 ft 6 in.
    if (m && (m[1] !== undefined || /("|''|in)/i.test(s)) && (m[1] !== undefined || m[2] !== undefined)) {
      const ft = m[1] !== undefined ? new D(m[1]) : new D(0);
      const inch = m[2] !== undefined ? new D(m[2]) : new D(0);
      value = ft.plus(inch.div(12));
    }
  }
  if (!value || !value.isFinite()) return { ok: false, error: "invalid" };
  if (value.isNegative()) return { ok: false, error: "negative" };
  if (opts.max !== undefined && value.gt(opts.max)) return { ok: false, error: "too_large" };
  return { ok: true, value };
}

/** Plain-language message for a parse error on a labeled field. */
export function parseMessage(error: ParseError, label: string, max?: number): string {
  switch (error) {
    case "empty": return `Enter ${label.toLowerCase()}.`;
    case "negative": return `${label} cannot be negative.`;
    case "too_large": return `${label} is larger than ${max?.toLocaleString("en-US") ?? "allowed"}. Check the measurement.`;
    default: return `${label} is not a number.`;
  }
}

/** Trim trailing zeros for display: 12.50 → "12.5", 3.00 → "3". */
export function fmt(d: Dec, dp = 2): string {
  const fixed = d.toDecimalPlaces(dp, D.ROUND_HALF_UP);
  const [int, frac] = fixed.toFixed(dp).split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = (frac ?? "").replace(/0+$/, "");
  return f ? `${withCommas}.${f}` : withCommas;
}
