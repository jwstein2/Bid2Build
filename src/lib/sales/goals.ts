/**
 * Team goals and milestone bonus math. Pure, shared by the rep portal, the Sales Hub and tests.
 *
 * Team goal (James, 2026-11-19): a healthy, reachable month-over-month increase in verified paid sales.
 *   base   = average of the last 3 complete months (fewer if the team is newer), rounded
 *   target = base + max(1, 10% of base), never below the owner's floor
 * The 3-month average keeps one great or bad month from swinging the target. The owner can override.
 */
export interface GoalRaw {
  month: string; now: string; time_zone?: string; current: number; mine?: number | null;
  history: number[]; active_reps: number; floor: number; override?: { target: number; note: string | null } | null;
}

export interface TeamGoal {
  month: string; target: number; auto: number; base: number; overridden: boolean; note: string | null;
  current: number; mine: number | null; remaining: number; pct: number; daysLeft: number; daysInMonth: number;
  perRep: number; onPace: boolean; lastMonth: number;
}

export function autoTarget(history: number[], floor: number): { target: number; base: number } {
  // history[0] = last month. Months before the team existed (leading zeros at the old end) are skipped.
  let h = history.slice(0, 3);
  while (h.length > 1 && h[h.length - 1] === 0) h = h.slice(0, -1);
  const base = h.length ? Math.round(h.reduce((a, b) => a + b, 0) / h.length) : 0;
  const target = base + Math.max(1, Math.ceil(base * 0.1));
  return { target: Math.max(floor, target), base };
}

function monthDays(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day of the month in the sales time zone (America/Chicago by default). */
function dayOfMonth(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(now));
}

export function teamGoal(raw: GoalRaw): TeamGoal {
  const { target: auto, base } = autoTarget(raw.history, raw.floor);
  const target = raw.override ? raw.override.target : auto;
  const daysInMonth = monthDays(raw.month);
  const today = dayOfMonth(new Date(raw.now), raw.time_zone || "America/Chicago");
  const daysLeft = Math.max(0, daysInMonth - today + 1);
  const remaining = Math.max(0, target - raw.current);
  const reps = Math.max(1, raw.active_reps);
  const expected = (target * (today - 1)) / daysInMonth;
  return {
    month: raw.month, target, auto, base, overridden: !!raw.override, note: raw.override?.note ?? null,
    current: raw.current, mine: raw.mine ?? null, remaining, pct: target > 0 ? Math.min(100, Math.round((raw.current / target) * 100)) : 100,
    daysLeft, daysInMonth, perRep: Math.ceil(remaining / reps), onPace: raw.current >= Math.floor(expected), lastMonth: raw.history[0] ?? 0,
  };
}


/**
 * Milestone bonus rules (owner policy): early flat boxes, then a percentage box every `every` qualifying
 * customers from the first rate's threshold on. Mirrors public.sales_milestone_rule in the database, which
 * is the only place awards are actually calculated; these helpers are for display and tests.
 */
export interface MilestoneRules { every: number; rates: { from: number; pct: number }[]; min_cents: number; flat: { at: number; cents: number; badge?: string }[] }
export type MilestoneModel = "v2_window" | "v3_active_mrr";

/** Compensation Model V3 (James, 2026-11-19). */
export const DEFAULT_MILESTONES: MilestoneRules = {
  every: 25, rates: [{ from: 50, pct: 3 }, { from: 100, pct: 4 }, { from: 250, pct: 5 }], min_cents: 0,
  flat: [{ at: 10, cents: 2500, badge: "First 10" }, { at: 25, cents: 7500, badge: "25 Club" }],
};
/** The previous (V2) curve, kept for reference and for owners who switch back. */
export const V2_MILESTONES: MilestoneRules = {
  every: 50, rates: [{ from: 50, pct: 3 }, { from: 100, pct: 4 }, { from: 250, pct: 5 }], min_cents: 15000,
  flat: [{ at: 10, cents: 2500, badge: "First 10" }, { at: 25, cents: 7500, badge: "25 Club" }],
};

export function milestoneRate(rules: MilestoneRules, accounts: number): number {
  return [...rules.rates].sort((a, b) => b.from - a.from).find((r) => r.from <= accounts)?.pct ?? 0;
}

function firstPctAt(rules: MilestoneRules): number {
  const first = rules.rates.length ? Math.min(...rules.rates.map((r) => r.from)) : rules.every;
  return Math.max(first, rules.every);
}

export function isMilestone(rules: MilestoneRules, n: number): boolean {
  if (n < 1) return false;
  return rules.flat.some((f) => f.at === n) || (n >= firstPctAt(rules) && n % rules.every === 0);
}

export type MilestoneRule = { at: number; flat_cents: number; badge?: string | null } | { at: number; pct: number };

export function milestoneRule(rules: MilestoneRules, n: number): MilestoneRule | null {
  if (!isMilestone(rules, n)) return null;
  const flat = rules.flat.find((f) => f.at === n);
  return flat ? { at: n, flat_cents: flat.cents, badge: flat.badge ?? null } : { at: n, pct: milestoneRate(rules, n) };
}

/** Every threshold from 1 to `upTo`, in order. */
export function milestoneSchedule(rules: MilestoneRules, upTo: number): MilestoneRule[] {
  const out: MilestoneRule[] = [];
  for (let n = 1; n <= upTo; n++) { const r = milestoneRule(rules, n); if (r) out.push(r); }
  return out;
}

export function ruleLabel(r: MilestoneRule, rules: MilestoneRules, model: MilestoneModel = "v3_active_mrr"): string {
  if ("flat_cents" in r) return `$${(r.flat_cents / 100).toFixed(0)} bonus`;
  const min = rules.min_cents > 0 ? ` (at least $${(rules.min_cents / 100).toFixed(0)})` : "";
  return model === "v3_active_mrr" ? `${r.pct}% of active MRR${min}` : `${r.pct}% bonus${min}`;
}

/** The next box after `accounts`, the previous box (for the progress bar) and what the next one pays. */
export function nextMilestone(rules: MilestoneRules, accounts: number, model: MilestoneModel = "v3_active_mrr"): { at: number; label: string; prev: number } {
  let at = Math.max(0, accounts) + 1;
  while (!isMilestone(rules, at)) at++;
  let prev = accounts;
  while (prev > 0 && !isMilestone(rules, prev)) prev--;
  return { at, prev, label: ruleLabel(milestoneRule(rules, at)!, rules, model) };
}

/** Round half up to the cent (amounts are never negative). Matches Postgres round(numeric). */
export function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
}

/** V3: one-time bonus at threshold n = qualifying active attributed MRR x rate (flat boxes pay their amount). */
export function v3Bonus(rules: MilestoneRules, n: number, mrrCents: number): number | null {
  const r = milestoneRule(rules, n);
  if (!r) return null;
  if ("flat_cents" in r) return r.flat_cents;
  return Math.max(rules.min_cents, roundCents((mrrCents * r.pct) / 100));
}

/** V2: rate x still-active revenue since the previous percentage box, with a minimum. */
export function milestoneBonus(rules: MilestoneRules, accounts: number, revenueCents: number): number {
  const flat = rules.flat.find((f) => f.at === accounts);
  if (flat) return flat.cents;
  return Math.max(rules.min_cents, Math.round((revenueCents * milestoneRate(rules, accounts)) / 100));
}

export interface ExampleBox { milestone: number; pct: number; flat: boolean; revenueCents: number; bonusCents: number; minApplied: boolean }
export interface PayExample { accounts: number; months: number; perMonth: number; monthlyCents: number; activeShare: number; boxes: ExampleBox[]; totalBonusCents: number; commissionCents: number }

/**
 * Illustrative only. V3: at each percentage box the rep's active MRR is round(qualifying customers x
 * `activeShare`) x `monthlyCents` (that MRR is the row's revenueCents). V2: what active customers paid
 * since the previous percentage box. Commission shown = sale-month commission on every account.
 */
export function payExample(rules: MilestoneRules, accounts = 300, perMonth = 25, monthlyCents = 1999, activeShare = 0.8, model: MilestoneModel = "v3_active_mrr"): PayExample {
  const months = Math.ceil(accounts / perMonth);
  const boxes: ExampleBox[] = [];
  let prevMonth = 0;
  for (let n = 1; n <= accounts; n++) {
    if (!isMilestone(rules, n)) continue;
    const month = Math.ceil(n / perMonth);
    const flat = rules.flat.find((f) => f.at === n);
    if (flat) { boxes.push({ milestone: n, pct: 0, flat: true, revenueCents: 0, bonusCents: flat.cents, minApplied: false }); continue; }
    const pct = milestoneRate(rules, n);
    let revenue = 0;
    if (model === "v3_active_mrr") revenue = Math.round(n * activeShare) * monthlyCents;
    else for (let m = prevMonth + 1; m <= month; m++) revenue += Math.round(Math.min(m * perMonth, accounts) * monthlyCents * activeShare);
    const raw = model === "v3_active_mrr" ? roundCents((revenue * pct) / 100) : Math.round((revenue * pct) / 100);
    boxes.push({ milestone: n, pct, flat: false, revenueCents: revenue, bonusCents: Math.max(rules.min_cents, raw), minApplied: raw < rules.min_cents });
    prevMonth = month;
  }
  return { accounts, months, perMonth, monthlyCents, activeShare, boxes, totalBonusCents: boxes.reduce((a, b) => a + b.bonusCents, 0), commissionCents: accounts * monthlyCents };
}
