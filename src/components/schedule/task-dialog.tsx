"use client";
import { useState } from "react";
import { MoveHorizontal, Scissors, Trash2, X } from "lucide-react";
import { Modal } from "@/components/builder/dialogs";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { endFromStart, formatRange, isIsoDate, workdaysBetween, type WorkCalendar } from "@/lib/schedule/calendar";
import { canSplit, normalizeTask, wouldCycle } from "@/lib/schedule/engine";
import { TASK_STATUSES, type Dep, type SchedulePermissions, type Task, type TaskStatus } from "@/lib/schedule/types";

export interface TaskDialogResult { task: Task; deps: Dep[] }

/**
 * Full editor for one task: dates (start, finish or working days), status and % complete, actual
 * dates, optional weight, assignee and notes, what it waits on, split and delete. Each group of fields
 * follows its own permission (plan = edit, progress = progress, waits for = dependencies). Nothing is inferred silently: choosing Complete fills the actual dates in the form, where
 * they can be checked before saving.
 */
export function TaskDialog({ task, tasks, deps, cal, today, perms, onClose, onSave, onSplit, onDelete, onShift }: {
  task: Task; tasks: Task[]; deps: Dep[]; cal: WorkCalendar; today: string; perms: SchedulePermissions;
  onClose: () => void; onSave: (r: TaskDialogResult) => void; onSplit: (at: string) => void; onDelete: () => void; onShift?: () => void;
}) {
  const [t, setT] = useState<Task>(task);
  const [mine, setMine] = useState<Dep[]>(deps.filter((d) => d.to === task.id));
  const [splitAt, setSplitAt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<Task>) => setT((x) => ({ ...x, ...p }));
  const ids = tasks.map((x) => x.id);
  const others = deps.filter((d) => d.to !== task.id);
  const candidates = tasks.filter((x) => x.id !== task.id && !mine.some((d) => d.from === x.id) && !wouldCycle(ids, [...others, ...mine], x.id, task.id));

  const setStatus = (status: TaskStatus) => {
    if (status === "complete") {
      const finish = t.actualFinish ?? today;
      set({ status, percentComplete: 100, actualFinish: finish, actualStart: t.actualStart ?? (t.plannedStart <= finish ? t.plannedStart : finish) });
    }
    else if (status === "in_progress") set({ status, actualStart: t.actualStart ?? (today >= t.plannedStart ? today : t.plannedStart) });
    else set({ status });
  };

  const submit = () => {
    const r = normalizeTask(t, cal);
    if (r.problems.length) { setProblem(r.problems[0].message); return; }
    onSave({ task: r.task, deps: [...others, ...mine] });
  };

  const pe = perms.edit, pp = perms.progress, pd = perms.dependencies;
  const canEdit = pe || pp || pd;
  const ro = !pe;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={canEdit ? `Edit ${task.name}` : task.name} description={formatRange(task.plannedStart, task.plannedEnd)} wide>
      <div className="space-y-4" data-testid="task-dialog">
        {!canEdit ? <Notice>You can view this task. Editing needs a scheduling editor seat and permission to change schedules.</Notice>
          : !pe && <Notice>{pp ? "You can update progress" : "You can change what this task waits for"}{pp && pd ? " and what it waits for" : ""}. Dates and names need permission to edit schedules.</Notice>}
        <label className="block"><span className="label">Name</span><input className="field" value={t.name} disabled={ro} onChange={(e) => set({ name: e.target.value })} maxLength={300} /></label>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="label">Planned dates</legend>
          <label className="block"><span className="text-xs text-muted">Start</span><input type="date" className="field" value={t.plannedStart} disabled={ro} data-testid="planned-start"
            onChange={(e) => isIsoDate(e.target.value) && set({ plannedStart: e.target.value, plannedEnd: e.target.value > t.plannedEnd ? e.target.value : t.plannedEnd, durationDays: workdaysBetween(e.target.value, e.target.value > t.plannedEnd ? e.target.value : t.plannedEnd, cal) || 1 })} /></label>
          <label className="block"><span className="text-xs text-muted">Finish</span><input type="date" className="field" value={t.plannedEnd} min={t.plannedStart} disabled={ro} data-testid="planned-end"
            onChange={(e) => isIsoDate(e.target.value) && e.target.value >= t.plannedStart && set({ plannedEnd: e.target.value, durationDays: workdaysBetween(t.plannedStart, e.target.value, cal) || 1 })} /></label>
          <label className="block"><span className="text-xs text-muted">Working days</span><input type="number" min={1} max={3650} className="field" value={t.durationDays} disabled={ro} data-testid="duration"
            onChange={(e) => { const n = Math.max(1, Math.min(3650, Math.round(Number(e.target.value) || 1))); set({ durationDays: n, plannedEnd: endFromStart(t.plannedStart, n, cal) }); }} /></label>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="label">Progress</legend>
          <label className="block"><span className="text-xs text-muted">Status</span>
            <select className="field" value={t.status} disabled={!pp} onChange={(e) => setStatus(e.target.value as TaskStatus)} data-testid="status">
              {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs text-muted">Percent complete</span>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={100} step={5} className="min-w-0 flex-1" value={t.percentComplete} disabled={!pp || t.status === "complete"} onChange={(e) => set({ percentComplete: Number(e.target.value) })} aria-label="Percent complete slider" />
              <input type="number" min={0} max={100} className="field w-20" value={t.percentComplete} disabled={!pp || t.status === "complete"} onChange={(e) => set({ percentComplete: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} data-testid="percent" aria-label="Percent complete" />
            </div>
          </label>
          <label className="block"><span className="text-xs text-muted">Actual start</span><input type="date" className="field" value={t.actualStart ?? ""} disabled={!pp} onChange={(e) => set({ actualStart: e.target.value || null })} data-testid="actual-start" /></label>
          <label className="block"><span className="text-xs text-muted">Actual finish</span><input type="date" className="field" value={t.actualFinish ?? ""} disabled={!pp} onChange={(e) => set({ actualFinish: e.target.value || null })} data-testid="actual-finish" /></label>
          {t.percentComplete === 100 && t.status !== "complete" && pp && <p className="text-xs text-ink-soft sm:col-span-2">At 100%. Set the status to Complete when the work is actually finished.</p>}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Assignee <span className="font-normal text-muted">(optional)</span></span><input className="field" value={t.assignee ?? ""} disabled={ro} maxLength={200} onChange={(e) => set({ assignee: e.target.value || null })} /></label>
          <label className="block"><span className="label">Weight <span className="font-normal text-muted">(optional)</span></span><input type="number" min={0} step="0.5" className="field" value={t.weight ?? ""} disabled={ro} onChange={(e) => set({ weight: e.target.value ? Number(e.target.value) : null })} /></label>
        </div>
        <label className="block"><span className="label">Notes <span className="font-normal text-muted">(optional)</span></span><textarea className="field min-h-20" value={t.notes ?? ""} disabled={ro} maxLength={4000} onChange={(e) => set({ notes: e.target.value || null })} /></label>

        <fieldset>
          <legend className="label">Waits for</legend>
          {mine.length === 0 && <p className="text-sm text-muted">Nothing. It can start any time.</p>}
          <ul className="space-y-2">
            {mine.map((d) => {
              const p = tasks.find((x) => x.id === d.from);
              return (
                <li key={d.from} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm">
                  <span className="min-w-0 flex-1 font-semibold">{p?.name ?? "Task"}</span>
                  <label className="flex items-center gap-1">Gap / overlap
                    <input type="number" min={-365} max={365} className="field w-20" value={d.lagDays} disabled={!pd} aria-label="Working days after it finishes (negative overlaps)"
                      onChange={(e) => setMine((m) => m.map((x) => (x.from === d.from ? { ...x, lagDays: Math.max(-365, Math.min(365, Math.round(Number(e.target.value) || 0))) } : x)))} />
                    days
                  </label>
                  {pd && <button type="button" className="grid h-9 w-9 place-items-center rounded hover:bg-black/5" aria-label={`Remove dependency on ${p?.name}`} onClick={() => setMine((m) => m.filter((x) => x.from !== d.from))}><X className="h-4 w-4" aria-hidden /></button>}
                </li>
              );
            })}
          </ul>
          {pd && candidates.length > 0 && (
            <select className="field mt-2" value="" onChange={(e) => e.target.value && setMine((m) => [...m, { from: e.target.value, to: task.id, lagDays: 0, maxOverlap: 0 }])} aria-label="Add a task this one waits for" data-testid="add-dependency">
              <option value="">Add: starts after…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <p className="mt-1 text-xs text-muted">0 = starts the next working day after it finishes. Negative numbers overlap.</p>
        </fieldset>

        {pe && canSplit(tasks, task) && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3">
            <label className="block"><span className="label">Split this task: second part starts</span>
              <input type="date" className="field" value={splitAt} min={task.plannedStart} max={task.plannedEnd} onChange={(e) => setSplitAt(e.target.value)} data-testid="split-at" /></label>
            <Button type="button" variant="secondary" size="sm" disabled={!isIsoDate(splitAt) || splitAt <= task.plannedStart || splitAt > task.plannedEnd} onClick={() => onSplit(splitAt)} data-testid="split"><Scissors className="h-4 w-4" aria-hidden /> Split</Button>
          </div>
        )}

        {problem && <Notice tone="danger">{problem}</Notice>}
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
          {pe && (task.kind === "item" || task.splitFrom) ? <Button type="button" variant="ghost" size="sm" onClick={onDelete} data-testid="delete-task"><Trash2 className="h-4 w-4" aria-hidden /> Remove from schedule</Button>
            : pe && onShift ? <Button type="button" variant="ghost" size="sm" onClick={onShift} data-testid="open-shift"><MoveHorizontal className="h-4 w-4" aria-hidden /> Shift whole section</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
            {canEdit && <Button type="button" onClick={submit} data-testid="save-task">Save</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
