/**
 * Project progress, by a documented method (shown in the app with a drilldown):
 *
 *   Duration-weighted (default): each task counts in proportion to its planned working days.
 *     progress = sum(working days x % complete) / sum(working days)
 *   Explicit weights: the contractor's weight replaces working days where one is set.
 *
 * Only "leaf" tasks count: a section with scheduled line items counts through its items, so nothing is
 * counted twice. Progress comes only from the % complete the contractor enters. It is never inferred
 * from the calendar: elapsed time is reported separately and labelled as time, not progress.
 */
import { workdaysBetween, type WorkCalendar } from "./calendar";
import type { ProgressMethod, Task } from "./types";

export interface ProgressRow { id: string; name: string; weight: number; percent: number; share: number; contribution: number }
export interface Progress { percent: number; method: ProgressMethod; totalWeight: number; rows: ProgressRow[] }

export const PROGRESS_METHODS: { value: ProgressMethod; label: string; detail: string }[] = [
  { value: "duration", label: "By working days", detail: "Each task counts in proportion to its planned working days." },
  { value: "weight", label: "By task weight", detail: "Tasks with a weight you set count by that weight; others count by working days." },
];

export function leafTasks(tasks: Task[]): Task[] {
  const hasChildren = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  return tasks.filter((t) => !hasChildren.has(t.id) && !(t.splitFrom && hasChildren.has(t.splitFrom)));
}

const weightOf = (t: Task, method: ProgressMethod) => (method === "weight" && t.weight ? t.weight : t.durationDays);

export function progressOf(tasks: Task[], method: ProgressMethod = "duration"): Progress {
  const leaves = leafTasks(tasks);
  const total = leaves.reduce((s, t) => s + weightOf(t, method), 0);
  const rows = leaves.map((t) => {
    const w = weightOf(t, method);
    const share = total ? w / total : 0;
    return { id: t.id, name: t.name, weight: w, percent: t.percentComplete, share, contribution: share * t.percentComplete };
  });
  const exact = total ? leaves.reduce((s, t) => s + weightOf(t, method) * t.percentComplete, 0) / total : 0;
  return { percent: Math.round(exact), method, totalWeight: total, rows };
}

/** Progress of one section (its line items when it has any, otherwise the section and its split parts). */
export function sectionProgress(tasks: Task[], sectionId: string, method: ProgressMethod = "duration"): number {
  const items = tasks.filter((t) => t.parentId === sectionId || t.parentId && tasks.find((p) => p.id === t.parentId)?.splitFrom === sectionId);
  const own = tasks.filter((t) => t.id === sectionId || t.splitFrom === sectionId);
  return progressOf(items.length ? items : own, method).percent;
}

/**
 * Share of the planned working days that have passed. Shown next to progress as a separate number,
 * never as progress itself (75% of the days passing doesn't make a project 75% done).
 */
export function timeElapsed(tasks: Task[], today: string, cal: WorkCalendar): number {
  if (!tasks.length) return 0;
  const start = tasks.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), tasks[0].plannedStart);
  const end = tasks.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), tasks[0].plannedEnd);
  if (today < start) return 0;
  if (today >= end) return 100;
  const total = workdaysBetween(start, end, cal);
  return total ? Math.round((workdaysBetween(start, today, cal) / total) * 100) : 0;
}
