/**
 * Rep quests, XP and the monthly rank (James, 2026-11-19). Three loops: daily/weekly quests (short),
 * a monthly Bronze→Diamond rank that resets each month (medium), milestone boxes (long). XP comes only
 * from real work; email volume never counts. No cash here.
 */
export interface PeriodCounts { calls: number; meetings: number; follow_ups: number; tasks_done: number; paid_accounts: number }
export interface Progress { now: string; periods: { day: PeriodCounts; week: PeriodCounts; month: PeriodCounts } }

export interface Quest { id: string; label: string; period: "day" | "week"; done: number; goal: number; xp: number; complete: boolean }

const QUESTS: { id: string; label: string; period: "day" | "week"; key: keyof PeriodCounts; goal: number; xp: number }[] = [
  { id: "d-follow", label: "Follow up with 5 leads", period: "day", key: "follow_ups", goal: 5, xp: 25 },
  { id: "d-call", label: "Make 3 calls", period: "day", key: "calls", goal: 3, xp: 15 },
  { id: "d-tasks", label: "Finish 2 tasks", period: "day", key: "tasks_done", goal: 2, xp: 10 },
  { id: "w-demo", label: "Book 1 demo", period: "week", key: "meetings", goal: 1, xp: 50 },
  { id: "w-follow", label: "Follow up with 20 leads", period: "week", key: "follow_ups", goal: 20, xp: 60 },
  { id: "w-sale", label: "Close 1 paid account", period: "week", key: "paid_accounts", goal: 1, xp: 100 },
];

export function quests(p: Progress): Quest[] {
  return QUESTS.map((q) => {
    const done = p.periods[q.period][q.key];
    return { id: q.id, label: q.label, period: q.period, done: Math.min(done, q.goal), goal: q.goal, xp: q.xp, complete: done >= q.goal };
  });
}

/** Monthly XP. Per-action XP is capped per month so volume alone can't climb the ranks. */
export function monthXp(m: PeriodCounts): number {
  return Math.min(m.follow_ups, 200) * 2 + Math.min(m.calls, 150) * 1 + Math.min(m.meetings, 30) * 15 + Math.min(m.tasks_done, 100) * 1 + m.paid_accounts * 100;
}

export const RANKS = [
  { name: "Bronze", xp: 0 }, { name: "Silver", xp: 200 }, { name: "Gold", xp: 500 }, { name: "Platinum", xp: 1000 }, { name: "Diamond", xp: 1800 },
] as const;

export function rankFor(xp: number): { name: string; xp: number; next: { name: string; xp: number } | null; pct: number } {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k].xp) i = k;
  const cur = RANKS[i], next = RANKS[i + 1] ?? null;
  const pct = next ? Math.round(((xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100;
  return { name: cur.name, xp, next: next ? { name: next.name, xp: next.xp } : null, pct };
}
