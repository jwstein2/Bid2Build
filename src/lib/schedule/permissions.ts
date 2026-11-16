/**
 * Which permissions a schedule change needs (V4 Phase 9). Mirrors schedule_save() in
 * 20261116006000_pm_permissions.sql, which enforces the same split in the database.
 *   edit:         dates, durations, names, order, weights, assignees, notes, adding/removing tasks, schedule settings
 *   progress:     status, % complete, actual dates, and the schedule's own status (active / completed)
 *   dependencies: any change to what waits for what
 */
import type { ScheduleMeta, Task } from "./types";

export const PLAN_FIELDS = ["name", "sortOrder", "plannedStart", "plannedEnd", "durationDays", "weight", "assignee", "notes"] as const;
export const PROGRESS_FIELDS = ["status", "percentComplete", "actualStart", "actualFinish"] as const;

export function changeKinds(before: Task[], changed: Task[], removed: boolean, depsChanged: boolean, meta: Partial<ScheduleMeta> | null | undefined) {
  const old = new Map(before.map((t) => [t.id, t]));
  let edit = removed || Boolean(meta && Object.keys(meta).some((k) => k !== "status"));
  let progress = Boolean(meta && "status" in meta);
  for (const t of changed) {
    const o = old.get(t.id);
    if (!o) { edit = true; continue; }
    if (PLAN_FIELDS.some((k) => (o[k] ?? null) !== (t[k] ?? null))) edit = true;
    if (PROGRESS_FIELDS.some((k) => (o[k] ?? null) !== (t[k] ?? null))) progress = true;
  }
  return { edit, progress, dependencies: depsChanged };
}
