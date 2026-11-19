/**
 * Rep quests and XP. Three loops: daily/weekly quests (short), this month against the rep's own best
 * month (medium; V8.4 replaced the Bronze→Diamond rank, James 2026-11-19: no tiers), milestone boxes
 * (long). XP comes only from real work; email volume never counts. No cash here.
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

/** Monthly XP. Per-action XP is capped per month so volume alone can't inflate it. */
export function monthXp(m: PeriodCounts): number {
  return Math.min(m.follow_ups, 200) * 2 + Math.min(m.calls, 150) * 1 + Math.min(m.meetings, 30) * 15 + Math.min(m.tasks_done, 100) * 1 + m.paid_accounts * 100;
}
