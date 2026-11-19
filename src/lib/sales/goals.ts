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


/** Milestone bonus rules (owner policy): early flat boxes, then a percentage box every `every` accounts. */
export interface MilestoneRules { every: number; rates: { from: number; pct: number }[]; min_cents: number; flat: { at: number; cents: number; badge?: string }[] }
export const DEFAULT_MILESTONES: MilestoneRules = {
  every: 50, rates: [{ from: 50, pct: 3 }, { from: 100, pct: 4 }, { from: 250, pct: 5 }], min_cents: 15000,
  flat: [{ at: 10, cents: 2500, badge: "First 10" }, { at: 25, cents: 7500, badge: "25 Club" }],
};

export function milestoneRate(rules: MilestoneRules, accounts: number): number {
  return [...rules.rates].sort((a, b) => b.from - a.from).find((r) => r.from <= accounts)?.pct ?? 0;
}

export function isMilestone(rules: MilestoneRules, n: number): boolean {
  return rules.flat.some((f) => f.at === n) || (n >= rules.every && n % rules.every === 0);
}

/** The next box after `accounts` sold, the previous box (for the progress bar) and what the next one pays. */
export function nextMilestone(rules: MilestoneRules, accounts: number): { at: number; label: string; prev: number } {
  let at = accounts + 1;
  while (!isMilestone(rules, at)) at++;
  let prev = accounts;
  while (prev > 0 && !isMilestone(rules, prev)) prev--;
  const flat = rules.flat.find((f) => f.at === at);
  return { at, prev, label: flat ? `$${(flat.cents / 100).toFixed(0)} bonus` : `${milestoneRate(rules, at)}% bonus (at least $${(rules.min_cents / 100).toFixed(0)})` };
}

export function milestoneBonus(rules: MilestoneRules, accounts: number, revenueCents: number): number {
  const flat = rules.flat.find((f) => f.at === accounts);
  if (flat) return flat.cents;
  return Math.max(rules.min_cents, Math.round((revenueCents * milestoneRate(rules, accounts)) / 100));
}

export interface ExampleBox { milestone: number; pct: number; flat: boolean; revenueCents: number; bonusCents: number; minApplied: boolean }
export interface PayExample { accounts: number; months: number; perMonth: number; monthlyCents: number; activeShare: number; boxes: ExampleBox[]; totalBonusCents: number; commissionCents: number }

/**
 * Illustrative only: a rep sells `perMonth` accounts a month at `monthlyCents`; `activeShare` of customers
 * stay active (only active accounts' revenue counts). Each percentage box covers what active customers
 * paid since the previous percentage box. Commission shown = sale-month commission on every account.
 */
export function payExample(rules: MilestoneRules, accounts = 300, perMonth = 25, monthlyCents = 1999, activeShare = 0.8): PayExample {
  const months = Math.ceil(accounts / perMonth);
  const boxes: ExampleBox[] = [];
  let prevMonth = 0;
  for (let n = 1; n <= accounts; n++) {
    if (!isMilestone(rules, n)) continue;
    const month = Math.ceil(n / perMonth);
    const flat = rules.flat.find((f) => f.at === n);
    if (flat) { boxes.push({ milestone: n, pct: 0, flat: true, revenueCents: 0, bonusCents: flat.cents, minApplied: false }); continue; }
    let revenue = 0;
    for (let m = prevMonth + 1; m <= month; m++) revenue += Math.round(Math.min(m * perMonth, accounts) * monthlyCents * activeShare);
    const pct = milestoneRate(rules, n);
    const raw = Math.round((revenue * pct) / 100);
    boxes.push({ milestone: n, pct, flat: false, revenueCents: revenue, bonusCents: Math.max(rules.min_cents, raw), minApplied: raw < rules.min_cents });
    prevMonth = month;
  }
  return { accounts, months, perMonth, monthlyCents, activeShare, boxes, totalBonusCents: boxes.reduce((a, b) => a + b.bonusCents, 0), commissionCents: accounts * monthlyCents };
}
