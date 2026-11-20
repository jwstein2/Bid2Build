/**
 * Owner analytics for the affiliate program. Pure. Separates cash (paid), liabilities (earned, unpaid) and forecasts.
 * The forecast is a simple cohort model: each active customer's current eligible monthly value, paid once per
 * remaining term year, reduced by monthly churn (compounded to an annual survival rate) and grown by an assumed
 * annual upgrade rate. Owner-set assumptions, clearly labeled; not accounting entries.
 */
export interface PortfolioRow { value: number; years_left: number; anniversary_date: string | null; affiliate_id: string }

export interface Exposure {
  maxCents: number;                 // every active customer pays every remaining year at today's value (worst case)
  expectedCents: number;            // after churn / upgrades
  byYear: { year: number; maxCents: number; expectedCents: number }[];
}

export function annualSurvival(monthlyChurnBps: number): number {
  const m = Math.min(Math.max(monthlyChurnBps, 0), 10_000) / 10_000;
  return Math.pow(1 - m, 12);
}

export function projectExposure(rows: PortfolioRow[], o: { monthlyChurnBps: number; annualUpgradeBps: number; today: string }): Exposure {
  const surv = annualSurvival(o.monthlyChurnBps), up = 1 + Math.max(o.annualUpgradeBps, 0) / 10_000;
  const map = new Map<number, { max: number; exp: number }>();
  for (const r of rows) {
    if (!r.anniversary_date || r.value <= 0) continue;
    // Remaining term years start at the customer's next anniversary (this year if it hasn't passed yet).
    const first = Number(o.today.slice(0, 4)) + (r.anniversary_date.slice(5, 10) >= o.today.slice(5, 10) ? 0 : 1);
    for (let k = 0; k < r.years_left; k++) {
      const year = first + k;
      const e = map.get(year) ?? { max: 0, exp: 0 };
      e.max += r.value;
      e.exp += r.value * Math.pow(surv, k) * Math.pow(up, k);
      map.set(year, e);
    }
  }
  const byYear = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, maxCents: Math.round(v.max), expectedCents: Math.round(v.exp) }));
  return { maxCents: byYear.reduce((s, y) => s + y.maxCents, 0), expectedCents: byYear.reduce((s, y) => s + y.expectedCents, 0), byYear };
}

/** Commission cost as a share of referred revenue (basis points), and contribution after commissions + payout fees. */
export function unitEconomics(r: { revenueYearCents: number; paidYearCents: number; payoutFeesCents: number }) {
  const cost = r.paidYearCents + r.payoutFeesCents;
  return {
    commissionToRevenueBps: r.revenueYearCents > 0 ? Math.round((r.paidYearCents / r.revenueYearCents) * 10_000) : 0,
    contributionCents: r.revenueYearCents - cost,
    contributionMarginBps: r.revenueYearCents > 0 ? Math.round(((r.revenueYearCents - cost) / r.revenueYearCents) * 10_000) : 0,
  };
}
