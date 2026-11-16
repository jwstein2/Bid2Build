"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, CalendarDays, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { formatRange, isIsoDate } from "@/lib/schedule/calendar";
import { EDIT_MODES, type EditMode } from "@/lib/schedule/engine";
import { statusLabel, type ScheduleData } from "@/lib/schedule/types";
import { projectDot, type WsProject, type WsTask } from "@/lib/projects/workspace";
import { STATUS_STYLE } from "@/components/schedule/client";
import { statusLabelOf } from "@/lib/projects/team";
import { loadFull, planEdit, saveTasks, withProgress, type PlannedEdit } from "./edit";

export function Drawer({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-5 shadow-2xl" data-testid="task-drawer">
          <Dialog.Title className="pr-8 font-display text-lg font-extrabold text-navy">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Task details and quick actions</Dialog.Description>
          <div className="mt-3 flex-1">{children}</div>
          <Dialog.Close className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-black/5" aria-label="Close"><X className="h-5 w-5" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ResourceInfo { id?: string; label: string; kind: string; email?: string | null; phone?: string | null; trade?: string | null }

/**
 * Quick detail for a calendar/timeline/My Work task, with the actions the viewer is allowed: move
 * dates (with a preview of what else moves), update progress, open the project. Saves through the
 * same revision-checked schedule API as the Gantt editor.
 */
export function TaskDrawer({ task, project, people, resource, today, onClose, onSaved, initialStart, initialEnd, extra }: {
  task: WsTask; project: WsProject; people: Map<string, string>; resource?: ResourceInfo | null; today: string;
  onClose: () => void; onSaved: () => void;
  /** Dates proposed by a drag in the calendar or timeline (previewed, never saved silently). */
  initialStart?: string; initialEnd?: string;
  /** Extra section (V4.2 assignment controls). */
  extra?: ReactNode;
}) {
  const [full, setFull] = useState<ScheduleData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [start, setStart] = useState(initialStart ?? task.plannedStart);
  const [end, setEnd] = useState(initialEnd ?? task.plannedEnd);
  const [plan, setPlan] = useState<PlannedEdit | null>(null);
  const [mode, setMode] = useState<EditMode>("dependents");
  const [pct, setPct] = useState(task.percentComplete);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canDates = project.permissions.edit;
  const canProgress = project.permissions.progress;

  useEffect(() => {
    if (!canDates && !canProgress) return;
    let live = true;
    void loadFull(project.id).then((r) => {
      if (!live) return;
      if (!r.ok) { setLoadErr(r.message); return; }
      setFull(r.data);
      // A drag proposed new dates: show what would change right away.
      if (initialStart && initialEnd && project.permissions.edit) setPlan(planEdit(r.data, { taskId: task.id, plannedStart: initialStart, plannedEnd: initialEnd }));
    });
    return () => { live = false; };
  }, [project.id, canDates, canProgress, initialStart, initialEnd, task.id, project.permissions.edit]);

  const datesChanged = start !== task.plannedStart || end !== task.plannedEnd;
  function preview() {
    if (!full || !isIsoDate(start) || !isIsoDate(end) || end < start) return;
    setPlan(planEdit(full, { taskId: task.id, plannedStart: start, plannedEnd: end }));
  }
  async function saveDates() {
    if (!plan) return;
    const p = plan.needsChoice ? plan.previews[mode] : plan.previews.keep;
    setBusy(true); setMsg(null);
    const r = await saveTasks(plan.data, p.tasks, `Moved ${task.name} to ${formatRange(start, end)}`);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: "Dates saved. Every view now shows the new dates." });
    onSaved();
  }
  async function saveProgress(value: number) {
    if (!full) return;
    const t = full.tasks.find((x) => x.id === task.id);
    if (!t) return;
    setBusy(true); setMsg(null);
    const r = await saveTasks(full, full.tasks.map((x) => (x.id === t.id ? withProgress(t, value, today) : x)), value >= 100 ? `Completed ${t.name}` : `Progress ${value}% on ${t.name}`);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    if (r.data.schedule) setFull(r.data.schedule);
    setMsg({ ok: true, text: value >= 100 ? "Marked complete." : "Progress saved." });
    onSaved();
  }

  const st = STATUS_STYLE[task.status];
  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }} title={task.name}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={projectDot(project.id)} aria-hidden />
          <Link href={`/projects/${project.id}`} className="font-semibold text-accent-ink hover:underline">{project.name}</Link></div>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted">Customer</dt><dd>{project.customerName || "—"}</dd>
          <dt className="text-muted">Dates</dt><dd className="font-semibold">{formatRange(task.plannedStart, task.plannedEnd)}</dd>
          <dt className="text-muted">Status</dt><dd><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.chip}`}>{statusLabel(task.status)}</span> · {task.percentComplete}%</dd>
          <dt className="text-muted">Assigned</dt><dd data-testid="drawer-assignee">{resource ? <>{resource.label} <Badge>{resource.kind}</Badge>{task.assignmentStatus && <> <Badge tone={task.assignmentStatus === "confirmed" ? "ok" : task.assignmentStatus === "declined" ? "danger" : "neutral"}>{statusLabelOf(task.assignmentStatus)}</Badge></>}</> : task.assignee || "Unassigned"}</dd>
          {resource?.trade && <><dt className="text-muted">Trade</dt><dd>{resource.trade}</dd></>}
          {resource?.phone && <><dt className="text-muted">Phone</dt><dd><a className="text-accent-ink underline" href={`tel:${resource.phone}`}>{resource.phone}</a></dd></>}
          {resource?.email && <><dt className="text-muted">Email</dt><dd className="break-all"><a className="text-accent-ink underline" href={`mailto:${resource.email}`}>{resource.email}</a></dd></>}
          <dt className="text-muted">Project manager</dt><dd>{people.get(project.projectManagerId ?? "") ?? "Not assigned"}</dd>
        </dl>

        {loadErr && <Notice tone="warn">{loadErr}</Notice>}
        {!canDates && !canProgress && <Notice>You can view this task. Ask your company admin if you need to change it.</Notice>}

        {canDates && (
          <section className="rounded-lg border border-line p-3" aria-labelledby="move-h">
            <h3 id="move-h" className="flex items-center gap-1.5 font-semibold text-navy"><CalendarDays className="h-4 w-4" aria-hidden /> Move task</h3>
            <div className="mt-2 grid gap-2 min-[380px]:grid-cols-2">
              <label><span className="label">Start</span><input type="date" className="field" value={start} onChange={(e) => { setStart(e.target.value); setPlan(null); }} data-testid="drawer-start" /></label>
              <label><span className="label">Finish</span><input type="date" className="field" value={end} min={start} onChange={(e) => { setEnd(e.target.value); setPlan(null); }} data-testid="drawer-end" /></label>
            </div>
            {!plan && <Button size="sm" variant="secondary" className="mt-2" disabled={!datesChanged || !full} onClick={preview} data-testid="drawer-preview">Preview change</Button>}
            {plan && (
              <div className="mt-2 space-y-2">
                {plan.needsChoice ? (
                  <fieldset className="space-y-1" data-testid="drawer-modes">
                    <legend className="text-xs font-semibold text-ink-soft">Other tasks are affected. What should happen?</legend>
                    {EDIT_MODES.map((m) => (
                      <label key={m.value} className="flex items-start gap-2 rounded border border-line p-2">
                        <input type="radio" name="mode" className="mt-1" checked={mode === m.value} onChange={() => setMode(m.value)} />
                        <span><span className="font-semibold">{m.label}</span> <span className="text-xs text-muted">({plan.previews[m.value].changes.length} task{plan.previews[m.value].changes.length === 1 ? "" : "s"} change, finish {plan.previews[m.value].finishAfter})</span></span>
                      </label>
                    ))}
                  </fieldset>
                ) : <p className="text-xs text-ink-soft">Only this task changes.</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveDates} disabled={busy} data-testid="drawer-save-dates">{busy ? "Saving…" : "Save dates"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setPlan(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </section>
        )}

        {extra}
        {canProgress && (
          <section className="rounded-lg border border-line p-3" aria-labelledby="prog-h">
            <h3 id="prog-h" className="font-semibold text-navy">Update progress</h3>
            <div className="mt-2 flex items-center gap-2">
              <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Percent complete" className="flex-1" />
              <span className="w-12 text-right font-semibold">{pct}%</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy || !full || pct === task.percentComplete} onClick={() => saveProgress(pct)} data-testid="drawer-save-progress">Save progress</Button>
              {task.status !== "complete" && <Button size="sm" variant="accent" disabled={busy || !full} onClick={() => saveProgress(100)} data-testid="drawer-complete">Mark complete</Button>}
            </div>
            <p className="mt-1 text-xs text-muted">Complete records today as the actual finish. Tasks are never marked complete automatically.</p>
          </section>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Saving" />}
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</p>}
        <Link href={`/projects/${project.id}`} className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline">Open project <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    </Drawer>
  );
}
