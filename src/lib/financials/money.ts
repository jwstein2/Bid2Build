/**
 * Decimal-safe money helpers for the Financial Command Center.
 *
 * Same rules as the estimate engine (src/lib/estimate/money.ts) and Postgres numeric round():
 *   - all math in decimal.js, never binary floats;
 *   - cents rounded half away from zero (ROUND_HALF_UP on the absolute value, as PG round() does);
 *   - percent splits put the rounding remainder on the LAST part so the parts sum to the total exactly
 *     (src/lib/proposal/build.ts, public.fin_schedule_amounts);
 *   - amounts cross the API as strings with two decimals ("1234.50").
 */
import { D, type Dec, round2 } from "@/lib/estimate/money";

export type Money = string;
export { D, round2 };
export type { Dec };

const MONEY_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

/** A canonical money string: up to 12 integer digits and at most 2 decimals (numeric(14,2)). */
export function isMoney(value: unknown): value is Money {
  return typeof value === "string" && MONEY_RE.test(value.trim());
}

/** Parse user / API input ("$1,234.5", "1234.50", 12) into a Decimal; throws on garbage or more than 2 decimals unless rounding is asked for. */
export function money(value: string | number | Dec, opts: { round?: boolean } = {}): Dec {
  let d: Dec;
  if (D.isDecimal(value)) d = value as Dec;
  else {
    const s = typeof value === "number" ? String(value) : value.trim().replace(/[$,\s]/g, "");
    if (!/^-?\d*(\.\d*)?$/.test(s) || s === "" || s === "-" || s === "." || s === "-.") throw new Error(`invalid_money:${String(value)}`);
    d = new D(s);
  }
  if (!d.isFinite()) throw new Error(`invalid_money:${String(value)}`);
  if (!opts.round && d.decimalPlaces() > 2) throw new Error(`too_many_decimals:${d.toString()}`);
  return round2(d);
}

/** Two-decimal string for the API / database. */
export const toMoney = (d: Dec | string | number): Money => money(d, { round: true }).toFixed(2);

export const add = (...xs: (Dec | string | number)[]): Money => toMoney(xs.reduce<Dec>((s, x) => s.plus(money(x, { round: true })), new D(0)));
export const sub = (a: Dec | string | number, b: Dec | string | number): Money => toMoney(money(a, { round: true }).minus(money(b, { round: true })));
export const sum = (xs: readonly (Dec | string | number)[]): Money => add(...xs);
export const cmp = (a: Dec | string | number, b: Dec | string | number): -1 | 0 | 1 => money(a, { round: true }).comparedTo(money(b, { round: true })) as -1 | 0 | 1;
export const isZero = (a: Dec | string | number) => money(a, { round: true }).isZero();

/** round2(quantity x unitPrice): an invoice line amount (numeric(14,4) inputs). */
export function lineAmount(quantity: string | number, unitPrice: string | number): Money {
  return toMoney(new D(String(quantity)).times(new D(String(unitPrice))));
}

/** Tax on a taxable base; rate is a percent ("8.25"). */
export function taxOn(base: string | number | Dec, ratePercent: string | number): Money {
  return toMoney(money(base, { round: true }).times(new D(String(ratePercent))).div(100));
}

/**
 * Split a total by percents. When the percents sum to exactly 100 the last part absorbs the rounding
 * remainder (sum === total). Otherwise every part is round2(total x pct) and `remainder` is what is left
 * (the database turns a non-zero remainder into a "Balance due" milestone).
 */
export function splitByPercents(total: string | number | Dec, percents: readonly (string | number)[]): { parts: Money[]; remainder: Money } {
  const t = money(total, { round: true });
  const pcts = percents.map((p) => new D(String(p)));
  const pctSum = pcts.reduce<Dec>((s, p) => s.plus(p), new D(0));
  let allocated = new D(0);
  const parts = pcts.map((p, i) => {
    const amt = i === pcts.length - 1 && pctSum.eq(100) ? t.minus(allocated) : round2(t.times(p).div(100));
    allocated = allocated.plus(amt);
    return amt.toFixed(2);
  });
  return { parts, remainder: t.minus(allocated).toFixed(2) };
}

/** Split a total into parts that are either a percent or a fixed amount; the last part absorbs the remainder so Σ = total. */
export function splitMixed(total: string | number | Dec, parts: readonly ({ percent: string | number } | { fixed: string | number })[]): Money[] {
  const t = money(total, { round: true });
  let allocated = new D(0);
  return parts.map((p, i) => {
    const amt = i === parts.length - 1 ? t.minus(allocated)
      : "fixed" in p ? money(p.fixed, { round: true }) : round2(t.times(new D(String(p.percent))).div(100));
    allocated = allocated.plus(amt);
    return amt.toFixed(2);
  });
}
