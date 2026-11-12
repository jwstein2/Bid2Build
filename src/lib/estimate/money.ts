import Decimal from "decimal.js";

/**
 * Financial arithmetic rules
 * - All math uses decimal.js (no binary floats).
 * - Currency values are rounded to cents with ROUND_HALF_UP ("commercial rounding").
 * - Customer unit price = round2(unitCost × factor).
 * - Customer extended price = round2(quantity × customer unit price), so every itemized
 *   line on a proposal multiplies out exactly as printed.
 * - Group price = sum of its extended prices; project subtotal = sum of group prices
 *   + fixed adjustment. Every display mode therefore shows the same totals.
 * - Tax = round2(taxable base × rate).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

export function toDec(value: string | number | null | undefined): { value: Dec; valid: boolean } {
  if (value === null || value === undefined) return { value: ZERO, valid: true };
  const s = typeof value === "number" ? String(value) : value.trim().replace(/[$,\s]/g, "");
  if (s === "") return { value: ZERO, valid: true };
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === "-" || s === "." || s === "-.") {
    return { value: ZERO, valid: false };
  }
  const d = new D(s);
  return d.isFinite() ? { value: d, valid: true } : { value: ZERO, valid: false };
}

export const round2 = (d: Dec): Dec => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

export function formatCurrency(amount: string | Dec, opts: { cents?: boolean } = {}): string {
  const d = typeof amount === "string" ? new D(amount || 0) : amount;
  const cents = opts.cents ?? true;
  const fixed = cents ? round2(d) : d.toDecimalPlaces(0, D.ROUND_HALF_UP);
  const negative = fixed.isNegative() && !fixed.isZero();
  const [int, frac] = fixed.abs().toFixed(cents ? 2 : 0).split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${withCommas}${cents ? "." + frac : ""}`;
}

export function formatPercent(p: string | Dec, dp = 1): string {
  const d = typeof p === "string" ? new D(p || 0) : p;
  return `${d.toDecimalPlaces(dp, D.ROUND_HALF_UP).toFixed(dp)}%`;
}
