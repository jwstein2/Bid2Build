import type { WorkCalendar } from "./calendar";

export type TaskStatus = "not_started" | "in_progress" | "complete" | "delayed" | "on_hold";
export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
  { value: "delayed", label: "Delayed" },
  { value: "on_hold", label: "On hold" },
];
export const statusLabel = (s: TaskStatus) => TASK_STATUSES.find((x) => x.value === s)?.label ?? s;

export type ScheduleStatus = "draft" | "active" | "completed" | "archived";
export type ProgressMethod = "duration" | "weight";

export interface Task {
  id: string;
  parentId: string | null;
  kind: "section" | "item";
  sourceGroupId: string;
  sourceItemId: string | null;
  /** Second (or later) segment of a split task. */
  splitFrom: string | null;
  name: string;
  sortOrder: number;
  plannedStart: string;
  plannedEnd: string;
  /** Working days, inclusive. Always recomputed from the dates and calendar on the server. */
  durationDays: number;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number;
  status: TaskStatus;
  weight: number | null;
  assignee: string | null;
  notes: string | null;
}

/** Successor may start `lagDays` working days after the predecessor's finish (negative = overlap). */
export interface Dep {
  from: string;
  to: string;
  lagDays: number;
  /** Overlap (working days) the contractor allows when the scheduler suggests ways to hit a target. */
  maxOverlap: number;
}

export interface SnapshotItem { id: string; name: string; quantity: number | null; unit: string | null; sortOrder: number }
export interface SnapshotSection { id: string; name: string; trade: string | null; sortOrder: number; items: SnapshotItem[] }
/** Frozen copy of the estimate's scope when the schedule was created (never costs or prices). */
export interface Snapshot {
  estimate: { id: string; title: string; number: string; customerName: string; projectAddress: string | null };
  trades: string[];
  version: { id: string; number: number } | null;
  sections: SnapshotSection[];
}

export interface ScheduleMeta {
  id: string;
  estimateId: string;
  companyId: string | null;
  name: string;
  status: ScheduleStatus;
  provisional: boolean;
  calendar: WorkCalendar;
  startDate: string;
  targetEndDate: string | null;
  progressMethod: ProgressMethod;
  revision: number;
  updatedAt: string;
}

export interface Revision { revision: number; summary: string; createdAt: string; actorId: string | null; changes: TaskChange[] }

export interface TaskChange {
  id: string;
  name: string;
  from: { start: string; end: string } | null;
  to: { start: string; end: string } | null;
}

export interface ScheduleData {
  schedule: ScheduleMeta;
  snapshot: Snapshot;
  tasks: Task[];
  deps: Dep[];
  revisions: Revision[];
  canEdit: boolean;
}
