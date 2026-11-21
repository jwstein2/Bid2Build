/**
 * Schedule-projected dates for payment milestones and costs (pure).
 *
 * Verified progress comes from the existing progress engine's inputs: the % complete the contractor enters on each leaf
 * task (src/lib/schedule/progress.ts). It is never inferred from the calendar.
 *
 * Projection (shown to users as "projected", never as fact):
 *   planned(d) = the share of weighted work the baseline plan has done by day d (each task spread evenly over its planned
 *                calendar days).
 *   slip       = how far behind plan the job is today: today minus the first day the plan reached today's verified
 *                progress (0 when on or ahead of plan; being ahead never pulls dates earlier).
 *   date(T)    = the first day the plan reaches T%, plus the slip, and never before today.
 * Weighting: "duration" (working-day length, the schedule default), "weight" (the contractor's task weights) or
 * "financial" (each section's estimated cost from the signed bid, split across its tasks by length).
 */
import { leafTasks } from "@/lib/schedule/progress";
import type { Task } from "@/lib/schedule/types";
import { addDays, diffDays, maxD } from "./dates";

export type WeightMethod = "duration" | "weight" | "financial";
export const WEIGHT_METHODS: { value: WeightMethod; label: string; detail: string }[] = [
  { value: "duration", label: "By working days", detail: "Each task counts by its planned working days." },
  { value: "weight", label: "By task weight", detail: "Tasks with a weight you set count by that weight; others by working days." },
  { value: "financial", label: "By estimated cost", detail: "Each section counts by its estimated cost in the signed bid, split across its tasks by length." },
];

export interface ScheduleInput {
  id: string;
  status: string;
  tasks: Task[];
  /** Estimated cost by schedule section (estimate group id), from the job's budget lines. */
  sectionCost?: Record<string, number>;
}

interface Leaf { t: Task; w: number }

function sectionOf(t: Task, tasks: Task[]): string {
  if (!t.parentId) return t.splitFrom ? sectionOf(tasks.find((x) => x.id === t.splitFrom) ?? t, tasks) : t.sourceGroupId;
  const p = tasks.find((x) => x.id === t.parentId);
  return p ? sectionOf(p, tasks) : t.sourceGroupId;
}

export function weightedLeaves(s: ScheduleInput, method: WeightMethod, sectionKey?: string | null): { leaves: Leaf[]; method: WeightMethod; note?: string } {
  let leaves = leafTasks(s.tasks);
  if (sectionKey) leaves = leaves.filter((t) => sectionOf(t, s.tasks) === sectionKey || t.sourceGroupId === sectionKey);
  if (method === "financial") {
    const cost = s.sectionCost ?? {};
    const bySection = new Map<string, Task[]>();
    for (const t of leaves) { const k = sectionOf(t, s.tasks); bySection.set(k, [...(bySection.get(k) ?? []), t]); }
    const total = [...bySection.keys()].reduce((a, k) => a + (cost[k] ?? 0), 0);
    if (total > 0) {
      const out: Leaf[] = [];
      for (const [k, ts] of bySection) {
        const dur = ts.reduce((a, t) => a + t.durationDays, 0) || 1;
        for (const t of ts) out.push({ t, w: (cost[k] ?? 0) * (t.durationDays / dur) });
      }
      return { leaves: out, method };
    }
    return { leaves: leaves.map((t) => ({ t, w: t.durationDays })), method: "duration", note: "No estimated costs by section, so working days were used." };
  }
  return { leaves: leaves.map((t) => ({ t, w: method === "weight" && t.weight ? t.weight : t.durationDays })), method };
}

/** Verified progress (0-100, one decimal) by the chosen weighting. */
export function verifiedProgress(leaves: Leaf[]): number {
  const total = leaves.reduce((a, l) => a + l.w, 0);
  if (!total) return 0;
  return Math.round((leaves.reduce((a, l) => a + l.w * l.t.percentComplete, 0) / total) * 10) / 10;
}

function plannedAt(leaves: Leaf[], day: string): number {
  const total = leaves.reduce((a, l) => a + l.w, 0);
  if (!total) return 0;
  let done = 0;
  for (const l of leaves) {
    const span = diffDays(l.t.plannedEnd, l.t.plannedStart) + 1;
    const frac = Math.min(1, Math.max(0, (diffDays(day, l.t.plannedStart) + 1) / Math.max(1, span)));
    done += l.w * frac;
  }
  return (done / total) * 100;
}

/** First day the baseline plan reaches pct (searches within the plan's own span). */
function plannedDayFor(leaves: Leaf[], pct: number): string | null {
  if (!leaves.length) return null;
  const start = leaves.reduce((m, l) => (l.t.plannedStart < m ? l.t.plannedStart : m), leaves[0].t.plannedStart);
  const end = leaves.reduce((m, l) => (l.t.plannedEnd > m ? l.t.plannedEnd : m), leaves[0].t.plannedEnd);
  if (pct <= 0) return start;
  for (let d = start, i = 0; d <= end && i < 4000; d = addDays(d, 1), i++) if (plannedAt(leaves, d) + 1e-9 >= pct) return d;
  return end;
}

export interface Projection {
  progress: number;
  method: WeightMethod;
  plannedToday: number;
  slipDays: number;
  start: string | null;
  plannedEnd: string | null;
  projectedEnd: string | null;
  note?: string;
}

export function projectSchedule(s: ScheduleInput, today: string, method: WeightMethod = "duration", sectionKey?: string | null): Projection {
  const w = weightedLeaves(s, method, sectionKey);
  const leaves = w.leaves;
  if (!leaves.length) return { progress: 0, method: w.method, plannedToday: 0, slipDays: 0, start: null, plannedEnd: null, projectedEnd: null, note: w.note };
  const progress = verifiedProgress(leaves);
  const plannedToday = Math.round(plannedAt(leaves, today) * 10) / 10;
  const reachedOn = progress < plannedToday ? plannedDayFor(leaves, progress) : null;
  const slipDays = reachedOn ? Math.max(0, diffDays(today, reachedOn)) : 0;
  const start = leaves.reduce((m, l) => (l.t.plannedStart < m ? l.t.plannedStart : m), leaves[0].t.plannedStart);
  const plannedEnd = leaves.reduce((m, l) => (l.t.plannedEnd > m ? l.t.plannedEnd : m), leaves[0].t.plannedEnd);
  const done = leaves.every((l) => l.t.percentComplete >= 100);
  const actualEnd = done ? leaves.reduce<string | null>((m, l) => (l.t.actualFinish && (!m || l.t.actualFinish > m) ? l.t.actualFinish : m), null) : null;
  return { progress, method: w.method, plannedToday, slipDays, start, plannedEnd, projectedEnd: done ? (actualEnd ?? today) : maxD(addDays(plannedEnd, slipDays), today), note: w.note };
}

/** When verified progress is projected to reach `threshold` (today when it already has). */
export function projectThreshold(s: ScheduleInput, threshold: number, today: string, method: WeightMethod = "duration", sectionKey?: string | null): { date: string | null; reached: boolean; progress: number; slipDays: number; method: WeightMethod; note?: string } {
  const w = weightedLeaves(s, method, sectionKey);
  const p = projectSchedule(s, today, method, sectionKey);
  if (!w.leaves.length) return { date: null, reached: false, progress: 0, slipDays: 0, method: w.method, note: w.note };
  if (p.progress >= threshold) return { date: today, reached: true, progress: p.progress, slipDays: p.slipDays, method: w.method, note: w.note };
  const d = plannedDayFor(w.leaves, threshold);
  return { date: d ? maxD(addDays(d, p.slipDays), today) : null, reached: false, progress: p.progress, slipDays: p.slipDays, method: w.method, note: w.note };
}

/** Dates of one section (phase), shifted by the job's slip: used for subcontract payment timing. */
export function sectionDates(s: ScheduleInput, sectionKey: string, today: string, slipDays: number): { start: string; end: string; done: boolean; actualEnd: string | null } | null {
  const leaves = leafTasks(s.tasks).filter((t) => sectionOf(t, s.tasks) === sectionKey || t.sourceGroupId === sectionKey);
  if (!leaves.length) return null;
  const start = leaves.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), leaves[0].plannedStart);
  const end = leaves.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), leaves[0].plannedEnd);
  const done = leaves.every((t) => t.percentComplete >= 100);
  const actualEnd = done ? leaves.reduce<string | null>((m, t) => (t.actualFinish && (!m || t.actualFinish > m) ? t.actualFinish : m), null) : null;
  const begun = leaves.some((t) => t.actualStart || t.percentComplete > 0);
  return { start: begun ? start : maxD(addDays(start, slipDays), today), end: done ? (actualEnd ?? today) : maxD(addDays(end, slipDays), today), done, actualEnd };
}

/** Section keys that belong to a trade (from the schedule's frozen scope snapshot). */
export function sectionsForTrade(snapshotSections: { id: string; trade: string | null }[], trade: string | null): string[] {
  if (!trade) return [];
  return snapshotSections.filter((x) => x.trade === trade).map((x) => x.id);
}
