/**
 * Personal sales pay calculator: a planning estimate only. It never changes a bid, its costs or the
 * customer's price, and it is not payroll. Settings are private to each user (RLS: own row only).
 */
export const PAY_METHODS = {
  percent_sale: "Percent of sale",
  percent_profit: "Percent of gross profit",
  percent_base: "Percent of a commissionable base",
  flat: "Flat fee per project",
} as const;
export type PayMethod = keyof typeof PAY_METHODS;
export const isPayMethod = (s: unknown): s is PayMethod => typeof s === "string" && s in PAY_METHODS;

export interface PaySettings {
  method: PayMethod;
  /** Percent rate (0–100) for the percent methods; any custom rate is allowed. */
  rate: number;
  flatFee: number;
  /** Base pay for the selected period, added once. */
  baseSalary: number;
  /** For percent_base: share of the sale excluded from the base (permits, pass-through materials…), 0–100. */
  baseExclusions: number;
}
export const DEFAULT_PAY: PaySettings = { method: "percent_sale", rate: 10, flatFee: 0, baseSalary: 0, baseExclusions: 0 };

export interface PayBid { id: string; value: number | null; subtotal: number | null; cost: number | null }
export interface PayLine { id: string; basis: number | null; earnings: number | null; note?: string }

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function sanitizePay(s: Partial<PaySettings>): PaySettings {
  return {
    method: isPayMethod(s.method) ? s.method : DEFAULT_PAY.method,
    rate: clamp(Number(s.rate), 0, 100),
    flatFee: clamp(Number(s.flatFee), 0, 1_000_000),
    baseSalary: clamp(Number(s.baseSalary), 0, 10_000_000),
    baseExclusions: clamp(Number(s.baseExclusions), 0, 100),
  };
}

/**
 * Sale = pre-tax selling price (subtotal) when known, else the bid total. Gross profit = subtotal − direct cost.
 * Returns a line per bid and the total including base pay.
 */
export function salesPay(settings: PaySettings, bids: PayBid[]): { lines: PayLine[]; commission: number; total: number; skipped: number } {
  const s = sanitizePay(settings);
  const lines: PayLine[] = bids.map((b) => {
    const sale = b.subtotal ?? b.value;
    switch (s.method) {
      case "flat": return { id: b.id, basis: null, earnings: r2(s.flatFee) };
      case "percent_sale":
        return sale === null ? { id: b.id, basis: null, earnings: null, note: "No price yet" } : { id: b.id, basis: r2(sale), earnings: r2(sale * s.rate / 100) };
      case "percent_base": {
        if (sale === null) return { id: b.id, basis: null, earnings: null, note: "No price yet" };
        const base = r2(sale * (1 - s.baseExclusions / 100));
        return { id: b.id, basis: base, earnings: r2(base * s.rate / 100) };
      }
      case "percent_profit": {
        if (b.subtotal === null || b.cost === null) return { id: b.id, basis: null, earnings: null, note: "Cost not available for this version" };
        const gp = r2(b.subtotal - b.cost);
        // A loss earns nothing rather than a negative commission.
        return { id: b.id, basis: gp, earnings: r2(Math.max(0, gp) * s.rate / 100) };
      }
    }
  });
  const commission = r2(lines.reduce((t, l) => t + (l.earnings ?? 0), 0));
  return { lines, commission, total: r2(commission + s.baseSalary), skipped: lines.filter((l) => l.earnings === null).length };
}
