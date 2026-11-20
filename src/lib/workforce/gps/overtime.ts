/**
 * Overtime for payroll-ready exports (pure). This prepares hours for whoever runs payroll; it is not a pay or tax
 * calculation, and the company picks the rule for its state. Nothing here deducts lunch or any break: only the
 * unpaid break minutes actually recorded on an entry come off. Paid breaks stay inside worked time.
 *
 *   federal    : hours over 40 in the workweek (FLSA)
 *   california : over 8 in a day to 12 = OT, over 12 = double time; 7th consecutive workday in the week: first 8 OT,
 *                beyond 8 double time; plus over 40 in the week
 *   colorado   : over 12 in a day, or over 40 in the week
 *   alaska     : over 8 in a day, or over 40 in the week (employers of 4+)
 *   nevada     : over 8 in a day (employees paid under 1.5x minimum wage), or over 40 in the week
 *   none       : no overtime split (e.g. exempt staff)
 * Entries count on the local day they start. FLSA-exempt employees are never split.
 */
import { entryHours, localDay, round2, weekStart, type TimeEntry } from "@/lib/team/records";

export type OvertimeRule = "federal" | "california" | "colorado" | "alaska" | "nevada" | "none";
export const OVERTIME_RULES: { value: OvertimeRule; label: string }[] = [
  { value: "federal", label: "Federal: over 40 hours a week" },
  { value: "california", label: "California: daily 8 / 12, 7th day, and weekly 40" },
  { value: "colorado", label: "Colorado: over 12 a day or 40 a week" },
  { value: "alaska", label: "Alaska: over 8 a day or 40 a week" },
  { value: "nevada", label: "Nevada: over 8 a day (lower-wage) or 40 a week" },
  { value: "none", label: "No overtime split" },
];

export interface DaySplit { day: string; hours: number; regular: number; overtime: number; double: number }
export interface WeekSplit { resourceId: string; week: string; hours: number; regular: number; overtime: number; double: number; days: DaySplit[] }

function dailyLimit(rule: OvertimeRule): { ot: number; dt: number } | null {
  if (rule === "california") return { ot: 8, dt: 12 };
  if (rule === "colorado") return { ot: 12, dt: Infinity };
  if (rule === "alaska" || rule === "nevada") return { ot: 8, dt: Infinity };
  return null;
}

/** Split one person's week (hours per local day, Monday first) into regular / overtime / double time. */
export function splitWeek(perDay: { day: string; hours: number }[], rule: OvertimeRule, exempt = false): Omit<WeekSplit, "resourceId" | "week"> {
  const days = [...perDay].sort((a, b) => a.day.localeCompare(b.day));
  const total = days.reduce((s, d) => s + d.hours, 0);
  if (exempt || rule === "none") {
    return { hours: round2(total), regular: round2(total), overtime: 0, double: 0, days: days.map((d) => ({ ...d, hours: round2(d.hours), regular: round2(d.hours), overtime: 0, double: 0 })) };
  }
  const lim = dailyLimit(rule);
  const worked = days.filter((d) => d.hours > 0);
  const seventh = rule === "california" && worked.length === 7 ? days[days.length - 1].day : null;
  let weeklyRegular = 0;
  const out: DaySplit[] = days.map((d) => {
    let regular = d.hours, overtime = 0, double = 0;
    if (seventh && d.day === seventh) {
      regular = 0; overtime = Math.min(8, d.hours); double = Math.max(0, d.hours - 8);
    } else if (lim) {
      regular = Math.min(lim.ot, d.hours);
      overtime = Math.max(0, Math.min(lim.dt, d.hours) - lim.ot);
      double = Math.max(0, d.hours - lim.dt);
    }
    // Weekly 40: regular hours past 40 for the week become overtime.
    const room = Math.max(0, 40 - weeklyRegular);
    if (regular > room) { overtime += regular - room; regular = room; }
    weeklyRegular += regular;
    return { day: d.day, hours: round2(d.hours), regular: round2(regular), overtime: round2(overtime), double: round2(double) };
  });
  return { hours: round2(total), regular: round2(out.reduce((s, d) => s + d.regular, 0)), overtime: round2(out.reduce((s, d) => s + d.overtime, 0)),
    double: round2(out.reduce((s, d) => s + d.double, 0)), days: out };
}

/** Every person-week in a set of entries (rejected ones left out, open ones up to now). */
export function overtimeByWeek(entries: TimeEntry[], tz: string, rule: OvertimeRule, exempt: Set<string> = new Set(), now: Date = new Date()): WeekSplit[] {
  const map = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (e.status === "rejected") continue;
    const day = localDay(e.clockIn, tz);
    const key = `${e.resourceId}|${weekStart(day)}`;
    const m = map.get(key) ?? new Map<string, number>();
    m.set(day, (m.get(day) ?? 0) + entryHours(e, now));
    map.set(key, m);
  }
  return [...map.entries()].map(([key, m]) => {
    const [resourceId, week] = key.split("|");
    return { resourceId, week, ...splitWeek([...m.entries()].map(([day, hours]) => ({ day, hours })), rule, exempt.has(resourceId)) };
  }).sort((a, b) => a.week.localeCompare(b.week) || a.resourceId.localeCompare(b.resourceId));
}
