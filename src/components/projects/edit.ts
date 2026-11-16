"use client";
import { editNeedsChoice, previewEdit, type DateEdit, type EditMode, type EditPreview } from "@/lib/schedule/engine";
import type { ScheduleData, Task } from "@/lib/schedule/types";
import { api } from "@/components/schedule/client";

/**
 * Workspace edits go through the SAME schedule save API as the Gantt editor: load the schedule, apply
 * the change with the shared engine, and PATCH it with the revision we read (so two people can't
 * overwrite each other). There is no second copy of any schedule.
 */
export async function loadFull(scheduleId: string) {
  return api<ScheduleData>(`/api/schedules/${scheduleId}`);
}

export interface PlannedEdit { data: ScheduleData; needsChoice: boolean; previews: Record<EditMode, EditPreview> }

export function planEdit(data: ScheduleData, edit: DateEdit): PlannedEdit {
  const cal = data.schedule.calendar;
  const modes: EditMode[] = ["keep", "dependents", "group", "recalc"];
  return {
    data,
    needsChoice: editNeedsChoice(data.tasks, data.deps, edit, cal),
    previews: Object.fromEntries(modes.map((m) => [m, previewEdit(data.tasks, data.deps, edit, m, cal)])) as Record<EditMode, EditPreview>,
  };
}

export async function saveTasks(data: ScheduleData, tasks: Task[], summary: string) {
  return api<{ revision: number; schedule?: ScheduleData; unchanged?: boolean }>(`/api/schedules/${data.schedule.id}`, {
    method: "PATCH",
    body: JSON.stringify({ baseRevision: data.schedule.revision, summary, tasks, deps: data.deps }),
  });
}

/** Progress from the drawer / My Work. Complete always records an actual finish; nothing is inferred. */
export function withProgress(t: Task, pct: number, today: string): Task {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (p >= 100) return { ...t, percentComplete: 100, status: "complete", actualStart: t.actualStart ?? t.plannedStart, actualFinish: t.actualFinish ?? today };
  return { ...t, percentComplete: p, status: p > 0 ? (t.status === "delayed" || t.status === "on_hold" ? t.status : "in_progress") : t.status === "complete" ? "not_started" : t.status,
    actualStart: p > 0 ? t.actualStart ?? today : t.actualStart, actualFinish: null };
}
