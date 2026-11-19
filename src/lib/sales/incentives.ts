/**
 * V8.4 incentives shared by the rep dashboard, the admin Recognition & Incentives view and tests.
 * Money is decided in the database (sales_accelerators_evaluate); these helpers only explain and
 * preview it. Projections are always labeled as projections.
 */
import { monthXp, type PeriodCounts } from "./quests";

export interface Tier { from: number; pct: number }
export const DEFAULT_TIERS: Tier[] = [{ from: 5, pct: 5 }, { from: 10, pct: 10 }, { from: 15, pct: 15 }, { from: 20, pct: 20 }];

/** Rate for a month's qualifying new sales (same rule as sales_accelerator_rate). */
export function tierRate(tiers: Tier[], count: number): number {
  let rate = 0;
  for (const t of [...tiers].sort((a, b) => a.from - b.from)) if (count >= t.from) rate = t.pct;
  return rate;
}

/** The next tier above the current count, if any. */
export function nextTier(tiers: Tier[], count: number): (Tier & { needed: number }) | null {
  const t = [...tiers].sort((a, b) => a.from - b.from).find((x) => x.from > count);
  return t ? { ...t, needed: t.from - count } : null;
}

/** Whole-month bonus in cents, rounded half up (the database splits it across sales to add up exactly). */
export const accelBonus = (baseCents: number, rate: number) => Math.round((baseCents * rate) / 100);

/**
 * Split a total across lines so the parts add up exactly (largest remainder, ties by order). Mirrors the
 * database: 10 sales x $19.99 at 10% pays $19.99 in total, not 10 x $2.00.
 */
export function splitBonus(bases: number[], rate: number): number[] {
  const total = accelBonus(bases.reduce((t, b) => t + b, 0), rate);
  const raw = bases.map((b) => (b * rate) / 100);
  const parts = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const remainder = total - parts.reduce((t, p) => t + p, 0);
  for (let k = 0; k < remainder; k++) parts[order[k][1]] += 1;
  return parts;
}

export interface MonthCounts extends PeriodCounts { month: string }

/**
 * Personal bests: this month against the rep's own best earlier month, never against other reps.
 * A metric with no earlier activity shows "first month" instead of a record, so newer reps aren't
 * measured against nothing.
 */
export function personalBests(months: MonthCounts[]) {
  if (months.length === 0) return [];
  const cur = months[months.length - 1], prior = months.slice(0, -1);
  const metric = (label: string, get: (m: MonthCounts) => number) => {
    const now = get(cur);
    const best = prior.length ? Math.max(...prior.map(get)) : 0;
    const bestMonth = best > 0 ? prior.filter((m) => get(m) === best).at(-1)?.month ?? null : null;
    return { label, now, best, bestMonth, hasHistory: best > 0, pct: best > 0 ? Math.min(100, Math.round((now / best) * 100)) : now > 0 ? 100 : 0, beaten: best > 0 && now > best };
  };
  return [
    metric("Monthly XP", (m) => monthXp(m)),
    metric("Paid accounts", (m) => m.paid_accounts),
    metric("Follow-ups", (m) => m.follow_ups),
    metric("Demos and meetings", (m) => m.meetings),
  ];
}

export const ACHIEVEMENT_LABEL: Record<string, (v: number | null, d: Record<string, unknown> | null) => string> = {
  first_sale: () => "First paid sale",
  month_first_sale: () => "First sale of the month",
  record_sales: (v, d) => `Personal record: ${v} paid accounts in a month (previous best ${d?.previous_best ?? "—"})`,
  record_follow_ups: (v, d) => `Personal record: ${v} follow-ups in a month (previous best ${d?.previous_best ?? "—"})`,
  accelerator_tier: (v, d) => `Reached the ${v}% accelerator with ${d?.sales ?? "?"} sales`,
};
export const achievementText = (kind: string, value: number | string | null, detail: Record<string, unknown> | null) =>
  ACHIEVEMENT_LABEL[kind]?.(value == null ? null : Number(value), detail) ?? kind.replace(/_/g, " ");
