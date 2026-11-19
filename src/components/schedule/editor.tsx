"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PmLockNotice } from "@/components/billing/pm-lock";
import { AlertTriangle, CalendarRange, History, List, MoveHorizontal, RefreshCw, Send, Undo2, GanttChart } from "lucide-react";
import { Modal } from "@/components/builder/dialogs";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { formatDay, formatRange, todayIn, workdaysBetween } from "@/lib/schedule/calendar";
import {
  EDIT_MODES, editNeedsChoice, findConflicts, finishOf, itemTasksFor, previewEdit, shiftSection, splitTask, type DateEdit, type EditMode, type EditPreview,
} from "@/lib/schedule/engine";
import { PROGRESS_METHODS, progressOf, sectionProgress, timeElapsed } from "@/lib/schedule/progress";
import { statusLabel, type Dep, type ScheduleData, type ScheduleMeta, type Task } from "@/lib/schedule/types";
import { api, newId, STATUS_STYLE } from "./client";
import { Gantt, type GanttRow, type Zoom } from "./gantt";
import { TaskDialog } from "./task-dialog";
import { PublicationHistory } from "./published-update";
import type { Publication } from "@/lib/schedule/publications";
import { liveDateChanges, type LiveChange } from "@/lib/operations/live-schedule";

type UndoEntry = { tasks: Task[]; deps: Dep[]; summary: string };
type SaveMeta = Partial<Pick<ScheduleMeta, "status" | "progressMethod" | "targetEndDate">>;

export function ScheduleEditor({ initial, tradeLabels, editHint, created, publications = [] }: { initial: ScheduleData; tradeLabels: Record<string, string>; editHint: "addon" | "upgrade" | "seat" | null; created?: boolean; publications?: Publication[] }) {
  const [data, setData] = useState(initial);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; stale?: boolean } | null>(null);
  const [zoom, setZoom] = useState<Zoom>("day");
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [delay, setDelay] = useState<{ edit: DateEdit; base: Task[]; deps: Dep[]; summary: string; mode: EditMode } | null>(null);
  const [itemsFor, setItemsFor] = useState<string | null>(null);
  const [shiftFor, setShiftFor] = useState<string | null>(null);
  const [panel, setPanel] = useState<"progress" | "history" | "updates" | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // V4.3: a date change on a LIVE (active) schedule waits here for one explicit confirmation.
  const [pendingLive, setPendingLive] = useState<{ tasks: Task[]; deps: Dep[]; summary: string; meta?: SaveMeta; changes: LiveChange[] } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  // Deep link from a task review notice: /projects/<id>?task=<taskId> opens that task.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time ?task= deep link read from the URL after mount
    if (id && initial.tasks.some((t) => t.id === id)) { setOpen(id); setHighlight(id); }
  }, [initial.tasks]);

  const { schedule: meta, tasks, deps, snapshot, permissions: perms } = data;
  // Phase 9: each control follows its own permission; the server enforces the same split.
  const canEdit = perms.edit || perms.progress || perms.dependencies;
  const cal = meta.calendar;
  const today = todayIn(cal.timezone);
  const progress = useMemo(() => progressOf(tasks, meta.progressMethod), [tasks, meta.progressMethod]);
  const conflicts = useMemo(() => findConflicts(tasks, deps, cal, { target: meta.targetEndDate, today }), [tasks, deps, cal, meta.targetEndDate, today]);
  const finish = finishOf(tasks);
  const multiTrade = new Set(snapshot.sections.map((s) => s.trade)).size > 1;

  const rows: GanttRow[] = useMemo(() => {
    const sections = tasks.filter((t) => t.kind === "section" && !t.splitFrom).sort((a, b) => a.sortOrder - b.sortOrder);
    // Index once (was a nested find per task per section: slow on schedules with many line items).
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const tradeOf = new Map(snapshot.sections.map((x) => [x.id, x.trade ?? null]));
    const kidsOf = new Map<string, Task[]>();
    for (const t of tasks) {
      // Same rule as before: split from it, a child of it, or a child of one of its split pieces.
      const heads = new Set([t.splitFrom, t.parentId, t.parentId ? byId.get(t.parentId)?.splitFrom : null].filter((x): x is string => Boolean(x)));
      for (const head of heads) {
        const list = kidsOf.get(head);
        if (list) list.push(t); else kidsOf.set(head, [t]);
      }
    }
    const out: GanttRow[] = [];
    let lastTrade: string | null | undefined;
    for (const s of sections) {
      const trade = tradeOf.get(s.sourceGroupId) ?? null;
      const kids = [...(kidsOf.get(s.id) ?? [])]
        .sort((a, b) => Number(a.kind === "item") - Number(b.kind === "item") || a.sortOrder - b.sortOrder || a.plannedStart.localeCompare(b.plannedStart));
      out.push({ task: s, depth: 0, isSectionHead: true, childCount: kids.length, progress: sectionProgress(tasks, s.id, meta.progressMethod), trade, tradeHeader: multiTrade && trade !== lastTrade ? (tradeLabels[trade ?? ""] ?? trade ?? "Other") : undefined });
      lastTrade = trade;
      if (!collapsed.has(s.id)) for (const k of kids) out.push({ task: k, depth: k.kind === "item" ? 1 : 0, isSectionHead: false, childCount: 0, progress: k.percentComplete });
    }
    return out;
  }, [tasks, collapsed, snapshot, multiTrade, tradeLabels, meta.progressMethod]);

  async function commit(nextTasks: Task[], nextDeps: Dep[], summary: string, scheduleMeta?: SaveMeta, isUndo = false, confirmed = false) {
    if (!canEdit) return;
    if (!confirmed && meta.status === "active") {
      const changes = liveDateChanges(tasks, nextTasks, deps);
      if (changes.length) { setPendingLive({ tasks: nextTasks, deps: nextDeps, summary, meta: scheduleMeta, changes }); return; }
    }
    const prev = data;
    setData({ ...data, tasks: nextTasks, deps: nextDeps, schedule: { ...meta, ...scheduleMeta } });
    setSaving(true); setError(null);
    const r = await api<{ revision: number; schedule?: ScheduleData; unchanged?: boolean }>(`/api/schedules/${meta.id}`, {
      method: "PATCH",
      body: JSON.stringify({ baseRevision: meta.revision, summary, tasks: nextTasks, deps: nextDeps, ...(scheduleMeta ? { schedule: scheduleMeta } : {}), ...(confirmed ? { confirmLive: true } : {}) }),
    });
    setSaving(false);
    if (!r.ok) { setData(prev); setError({ message: r.message, stale: r.code === "stale_revision" }); return; }
    if (r.data.schedule) setData(r.data.schedule);
    if (!isUndo && !r.data.unchanged) setUndo((u) => [...u.slice(-29), { tasks: prev.tasks, deps: prev.deps, summary }]);
  }

  /** Undo restores the task list from before the last change (re-creating anything that was removed). */
  function undoLast() {
    const last = undo.at(-1);
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    const live = new Set(tasks.map((t) => t.id));
    const remap = new Map(last.tasks.filter((t) => !live.has(t.id)).map((t) => [t.id, newId()]));
    const m = (id: string | null) => (id && remap.get(id)) || id;
    const restored = last.tasks.map((t) => ({ ...t, id: m(t.id)!, parentId: m(t.parentId), splitFrom: m(t.splitFrom) }));
    void commit(restored, last.deps.map((d) => ({ ...d, from: m(d.from)!, to: m(d.to)! })), `Undo: ${last.summary}`, undefined, true);
  }

  function applyEdit(edit: DateEdit, base: Task[] = tasks, baseDeps: Dep[] = deps, summary?: string) {
    const t = base.find((x) => x.id === edit.taskId);
    if (!t) return;
    const label = summary ?? `Changed dates for ${t.name}`;
    if (editNeedsChoice(base, baseDeps, edit, cal)) { setDelay({ edit, base, deps: baseDeps, summary: label, mode: "dependents" }); return; }
    const p = previewEdit(base, baseDeps, edit, "keep", cal);
    if (!p.changes.length && base === tasks && baseDeps === deps) return;
    void commit(p.tasks, baseDeps, label);
  }

  const openTask = tasks.find((t) => t.id === open) ?? null;
  const reload = () => window.location.reload();

  return (
    <div className="space-y-4" data-testid="schedule-editor" data-guide="project.schedule">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold text-navy sm:text-3xl"><CalendarRange className="h-7 w-7 text-accent-ink" aria-hidden />{meta.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              {snapshot.estimate.customerName && <span>{snapshot.estimate.customerName}</span>}
              {tasks.length > 0 && <span>{formatRange(tasks.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), tasks[0].plannedStart), finish)}</span>}
              <Badge tone={meta.status === "active" ? "accent" : meta.status === "completed" ? "ok" : "neutral"}>{meta.status === "draft" ? "Draft" : meta.status === "active" ? "Active" : meta.status === "completed" ? "Completed" : "Archived"}</Badge>
              {meta.provisional && <Badge tone="warn">Provisional: bid not yet accepted</Badge>}
            </p>
            <p className="mt-1 text-xs text-muted">From estimate {snapshot.estimate.number || snapshot.estimate.title}{snapshot.version ? `, version ${snapshot.version.number}` : ""}. Later edits to the bid don&apos;t change this schedule.</p>
          </div>
          {(perms.publish || perms.progress) && (
            <div className="flex flex-wrap gap-2">
              {perms.publish && <Link href={`/projects/${meta.id}/update`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white hover:bg-navy/90" data-testid="customer-update"><Send className="h-4 w-4" aria-hidden /> Preview customer update</Link>}
              {perms.progress && meta.status === "draft" && <Button size="sm" variant="accent" onClick={() => setConfirmPublish(true)} data-testid="publish-schedule">Publish as active schedule</Button>}
              {perms.progress && meta.status === "active" && <Button size="sm" variant="secondary" onClick={() => commit(tasks, deps, "Marked the project completed", { status: "completed" })}>Mark project completed</Button>}
              {perms.progress && meta.status === "completed" && <Button size="sm" variant="secondary" onClick={() => commit(tasks, deps, "Reopened the project", { status: "active" })}>Reopen</Button>}
            </div>
          )}
        </div>
      </div>

      {created && <Notice tone="ok" title="Draft schedule saved">Your customer hasn&apos;t been notified. Drag tasks to adjust dates, or use the list icon on a section to schedule individual line items.</Notice>}
      {!canEdit && (editHint === "addon" || editHint === "upgrade"
        ? <PmLockNotice kind={editHint === "addon" ? "unlimited" : "free"} title="View only: your schedules and data stay here" />
        : (
          <Notice title="View only">
            {editHint === "seat" ? "Ask your company admin to assign you a scheduling editor seat to make changes." : "You can view this schedule but can't edit it."}
          </Notice>
        ))}
      {canEdit && !perms.edit && (
        <div data-testid="progress-only"><Notice title="Progress updates only">Your company role lets you update status and % complete. Changing dates, tasks or dependencies needs permission to edit this schedule.</Notice></div>
      )}
      {error && (
        <Notice tone="danger">{error.message} {error.stale && <button type="button" className="font-semibold underline" onClick={reload}>Reload</button>}</Notice>
      )}

      {/* Progress summary */}
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Progress">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Project progress</p>
          <p className="mt-1 text-3xl font-extrabold text-navy" data-testid="project-progress">{progress.percent}%</p>
          <div className="mt-2 h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-teal" style={{ width: `${progress.percent}%` }} /></div>
          <button type="button" className="mt-2 text-xs font-semibold text-accent-ink underline" onClick={() => setPanel(panel === "progress" ? null : "progress")} data-testid="progress-how">How this is calculated</button>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Time elapsed</p>
          <p className="mt-1 text-3xl font-extrabold text-ink-soft">{timeElapsed(tasks, today, cal)}%</p>
          <p className="mt-1 text-xs text-muted">Share of planned working days passed. This is time, not progress.</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Planned finish</p>
          <p className="mt-1 text-xl font-extrabold text-navy">{finish ? formatDay(finish, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
          {meta.targetEndDate && <p className={cn("mt-1 text-xs", finish > meta.targetEndDate ? "font-semibold text-warn" : "text-muted")}>Target {formatDay(meta.targetEndDate)}{finish > meta.targetEndDate ? ` · ${workdaysBetween(meta.targetEndDate, finish, cal) - 1} working days late` : ""}</p>}
        </div>
      </section>

      {panel === "progress" && (
        <section className="rounded-xl border border-line bg-surface p-4" data-testid="progress-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-extrabold text-navy">How progress is calculated</h2>
            {perms.edit && (
              <select className="field w-auto" value={meta.progressMethod} onChange={(e) => commit(tasks, deps, "Changed how progress is calculated", { progressMethod: e.target.value as ScheduleMeta["progressMethod"] })} aria-label="Progress method">
                {PROGRESS_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-soft">{PROGRESS_METHODS.find((m) => m.value === meta.progressMethod)?.detail} Progress = sum of (weight × % complete) ÷ total weight. Sections with scheduled line items count through their items. Dates passing never change progress; only the % complete you enter does.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="py-1">Task</th><th>Weight</th><th>Share</th><th>Complete</th><th>Adds</th></tr></thead>
              <tbody>
                {progress.rows.map((r) => (
                  <tr key={r.id} className="border-t border-line"><td className="py-1.5 pr-2">{r.name}</td><td>{r.weight}{meta.progressMethod === "duration" ? (r.weight === 1 ? " day" : " days") : ""}</td><td>{Math.round(r.share * 100)}%</td><td>{r.percent}%</td><td>{r.contribution.toFixed(1)} pts</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {conflicts.length > 0 && (
        <details className="rounded-xl border border-warn/30 bg-warn-tint px-4 py-3 text-sm" data-testid="conflicts">
          <summary className="cursor-pointer font-semibold text-warn"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />{conflicts.length} thing{conflicts.length === 1 ? "" : "s"} to check</summary>
          <ul className="mt-2 space-y-1 text-ink-soft">
            {conflicts.slice(0, 30).map((c, i) => (
              <li key={i}>{c.message} {c.taskId && <button type="button" className="font-semibold text-accent-ink underline" onClick={() => { setHighlight(c.taskId!); setView("timeline"); document.querySelector(`[data-testid="bar-${c.taskId}"]`)?.scrollIntoView({ block: "center", inline: "center" }); }}>Show</button>}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The scheduler warns but never moves tasks by itself.</p>
        </details>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "timeline"} onClick={() => setView("timeline")} className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-3 text-sm font-semibold", view === "timeline" ? "bg-navy text-white" : "text-ink-soft")}><GanttChart className="h-4 w-4" aria-hidden /> Timeline</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-3 text-sm font-semibold", view === "list" ? "bg-navy text-white" : "text-ink-soft")} data-testid="list-view"><List className="h-4 w-4" aria-hidden /> List</button>
        </div>
        {view === "timeline" && (
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Zoom">
            {(["day", "week", "month"] as Zoom[]).map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cn("min-h-9 rounded-md px-3 text-sm font-semibold capitalize", zoom === z ? "bg-navy text-white" : "text-ink-soft")} data-testid={`zoom-${z}`}>{z}</button>)}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {saving && <span className="inline-flex items-center gap-1 text-xs text-muted"><RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…</span>}
          {canEdit && <Button size="sm" variant="secondary" onClick={undoLast} disabled={!undo.length || saving} data-testid="undo"><Undo2 className="h-4 w-4" aria-hidden /> Undo</Button>}
          <Button size="sm" variant="secondary" onClick={() => setPanel(panel === "updates" ? null : "updates")} data-testid="updates-button"><Send className="h-4 w-4" aria-hidden /> Customer updates{publications.length ? ` (${publications.length})` : ""}</Button>
          <Button size="sm" variant="secondary" onClick={() => setPanel(panel === "history" ? null : "history")} data-testid="history-button"><History className="h-4 w-4" aria-hidden /> History</Button>
        </div>
      </div>

      {panel === "updates" && <PublicationHistory scheduleId={meta.id} publications={publications} canEdit={perms.publish} timezone={cal.timezone} />}

      {panel === "history" && (
        <section className="rounded-xl border border-line bg-surface p-4" data-testid="history-panel">
          <h2 className="font-display font-extrabold text-navy">Schedule history</h2>
          <ol className="mt-2 divide-y divide-line text-sm">
            {data.revisions.map((r) => (
              <li key={r.revision} className="py-2">
                <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{r.summary}</span><span className="text-xs text-muted">Revision {r.revision} · {new Date(r.createdAt).toLocaleString("en-US", { timeZone: cal.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></p>
                {r.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                    {r.changes.slice(0, 12).map((c, i) => <li key={i}>{c.name}: {c.from ? formatRange(c.from.start, c.from.end) : "added"} → {c.to ? formatRange(c.to.start, c.to.end) : "removed"}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {view === "timeline" ? (
        <Gantt rows={rows} deps={deps} cal={cal} zoom={zoom} today={today} target={meta.targetEndDate} canEdit={perms.edit && !saving} collapsed={collapsed} highlight={highlight}
          onToggle={(id) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onEdit={(e) => applyEdit(e)} onOpen={setOpen} onItems={setItemsFor} />
      ) : (
        <ListView rows={rows} canEdit={canEdit} canPlan={perms.edit} onOpen={setOpen} onItems={setItemsFor} onShift={setShiftFor} />
      )}
      <p className="text-xs text-muted">
        {perms.edit && <>Drag a bar to move it, or drag its ends to change dates. Keyboard: Tab to a bar, arrow keys move it a day, Shift + arrow keys change its finish, Enter edits.{" "}</>}
        Work week: {cal.workdays.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}{cal.holidays.length ? ` · ${cal.holidays.length} non-working date${cal.holidays.length === 1 ? "" : "s"}` : ""} · {cal.timezone.replace("_", " ")}
      </p>

      <Modal open={confirmPublish} onOpenChange={setConfirmPublish} title="Publish this schedule?" description="It becomes the project's active schedule.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>The project moves to <strong>Scheduled</strong> everywhere (Bids, Projects and the pipeline). In Progress and Completed projects stay where they are.</li>
          <li>From now on, date changes ask for confirmation and are recorded in the activity log.</li>
          <li>Your customer is <strong>not</strong> notified. Customer updates still go through Preview customer update.</li>
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmPublish(false)}>Cancel</Button>
          <Button variant="accent" onClick={() => { setConfirmPublish(false); void commit(tasks, deps, "Published as the active schedule", { status: "active" }); }} data-testid="confirm-publish">Publish schedule</Button>
        </div>
      </Modal>

      <Modal open={pendingLive !== null} onOpenChange={(o) => { if (!o) setPendingLive(null); }} title="Confirm schedule change" description={`${meta.name} is a live schedule.`}>
        {pendingLive && (
          <div className="space-y-3 text-sm" data-testid="live-confirm">
            <p className="text-ink-soft">{pendingLive.summary}</p>
            <table className="w-full">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="py-1">Task</th><th>Previous</th><th>Proposed</th></tr></thead>
              <tbody>
                {pendingLive.changes.map((c) => (
                  <tr key={c.taskId} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2 font-semibold">{c.name}{c.downstream && <span className="block text-[11px] font-normal text-muted">Downstream task</span>}</td>
                    <td className="py-1.5 pr-2 text-ink-soft">{formatRange(c.from.start, c.from.end)}</td>
                    <td className="py-1.5 font-semibold">{formatRange(c.to.start, c.to.end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendingLive.changes.some((c) => c.downstream) ? <p className="text-xs text-muted">Tasks marked downstream move because they depend on the changed task.</p> : null}
            <p className="text-xs text-muted">The change is recorded in the project activity. Your customer isn&apos;t emailed.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingLive(null)}>Cancel</Button>
              <Button onClick={() => { const p = pendingLive; setPendingLive(null); void commit(p.tasks, p.deps, p.summary, p.meta, false, true); }} data-testid="confirm-live-change">Confirm Schedule Change</Button>
            </div>
          </div>
        )}
      </Modal>

      {openTask && (
        <TaskDialog key={openTask.id} task={openTask} tasks={tasks} deps={deps} cal={cal} today={today} perms={perms} onClose={() => setOpen(null)}
          onSave={({ task, deps: nd }) => {
            setOpen(null);
            const base = tasks.map((t) => (t.id === task.id ? { ...task, plannedStart: openTask.plannedStart, plannedEnd: openTask.plannedEnd, durationDays: openTask.durationDays } : t));
            const datesChanged = task.plannedStart !== openTask.plannedStart || task.plannedEnd !== openTask.plannedEnd;
            if (datesChanged) applyEdit({ taskId: task.id, plannedStart: task.plannedStart, plannedEnd: task.plannedEnd }, base, nd, `Updated ${task.name}`);
            else void commit(base, nd, task.status !== openTask.status ? `${task.name}: ${statusLabel(task.status)}` : `Updated ${task.name}`);
          }}
          onSplit={(at) => {
            const r = splitTask(tasks, deps, openTask.id, at, cal, newId);
            setOpen(null);
            if (r) void commit(r.tasks, r.deps, `Split ${openTask.name}`);
          }}
          onShift={openTask.kind === "section" && !openTask.splitFrom ? () => { setOpen(null); setShiftFor(openTask.id); } : undefined}
          onDelete={() => {
            setOpen(null);
            const gone = new Set([openTask.id, ...tasks.filter((t) => t.splitFrom === openTask.id || t.parentId === openTask.id).map((t) => t.id)]);
            void commit(tasks.filter((t) => !gone.has(t.id)), deps.filter((d) => !gone.has(d.from) && !gone.has(d.to)), `Removed ${openTask.name} from the schedule`);
          }}
        />
      )}

      {delay && <DelayDialog state={delay} cal={cal} onMode={(mode) => setDelay({ ...delay, mode })} onCancel={() => setDelay(null)}
        onApply={(p) => { setDelay(null); void commit(p.tasks, delay.deps, `${delay.summary} (${EDIT_MODES.find((m) => m.value === delay.mode)!.label.toLowerCase()})`); }} />}

      {itemsFor && (() => {
        const sec = tasks.find((t) => t.id === itemsFor)!;
        const src = snapshot.sections.find((s) => s.id === sec.sourceGroupId);
        return <ItemsDialog section={sec} items={src?.items ?? []} scheduled={new Set(tasks.filter((t) => t.sourceItemId && !t.splitFrom).map((t) => t.sourceItemId!))}
          onClose={() => setItemsFor(null)} onAdd={(ids) => {
            setItemsFor(null);
            const add = itemTasksFor(tasks, snapshot, sec.id, ids, newId);
            if (add.length) { setCollapsed((c) => { const n = new Set(c); n.delete(sec.id); return n; }); void commit([...tasks, ...add], deps, `Scheduled ${add.length} line item${add.length === 1 ? "" : "s"} in ${sec.name}`); }
          }} />;
      })()}

      {shiftFor && (() => {
        const sec = tasks.find((t) => t.id === shiftFor)!;
        return <ShiftDialog section={sec} onClose={() => setShiftFor(null)} preview={(n) => previewOf(tasks, shiftSection(tasks, sec.id, n, cal))}
          onApply={(n) => { setShiftFor(null); void commit(shiftSection(tasks, sec.id, n, cal), deps, `Shifted ${sec.name} by ${n} working day${Math.abs(n) === 1 ? "" : "s"}`); }} />;
      })()}
    </div>
  );
}

function previewOf(before: Task[], after: Task[]): EditPreview {
  const changes = after.filter((t) => { const o = before.find((x) => x.id === t.id); return o && (o.plannedStart !== t.plannedStart || o.plannedEnd !== t.plannedEnd); })
    .map((t) => { const o = before.find((x) => x.id === t.id)!; return { id: t.id, name: t.name, from: { start: o.plannedStart, end: o.plannedEnd }, to: { start: t.plannedStart, end: t.plannedEnd } }; });
  return { tasks: after, changes, finishBefore: finishOf(before), finishAfter: finishOf(after) };
}

function Changes({ p }: { p: EditPreview }) {
  return (
    <div className="space-y-2">
      <ul className="max-h-56 space-y-1 overflow-y-auto text-sm" data-testid="preview-changes">
        {p.changes.map((c) => <li key={c.id} className="rounded-md bg-paper px-2 py-1"><span className="font-semibold">{c.name}</span>: {c.from ? formatRange(c.from.start, c.from.end) : "new"} → {c.to ? formatRange(c.to.start, c.to.end) : "removed"}</li>)}
      </ul>
      <p className="text-sm text-ink-soft">Project finish: {formatDay(p.finishBefore)} → <strong>{formatDay(p.finishAfter)}</strong></p>
    </div>
  );
}

/** "This task now ends later. What should happen to the rest?" Each choice is previewed before saving. */
function DelayDialog({ state, cal, onMode, onCancel, onApply }: { state: { edit: DateEdit; base: Task[]; deps: Dep[]; summary: string; mode: EditMode }; cal: ScheduleData["schedule"]["calendar"]; onMode: (m: EditMode) => void; onCancel: () => void; onApply: (p: EditPreview) => void }) {
  const previews = Object.fromEntries(EDIT_MODES.map((m) => [m.value, previewEdit(state.base, state.deps, state.edit, m.value, cal)])) as Record<EditMode, EditPreview>;
  const t = state.base.find((x) => x.id === state.edit.taskId)!;
  const p = previews[state.mode];
  const next = p.tasks.find((x) => x.id === t.id)!;
  return (
    <Modal open onOpenChange={(o) => !o && onCancel()} title={`${t.name} now finishes ${formatDay(next.plannedEnd)}`} description={`Was ${formatRange(t.plannedStart, t.plannedEnd)}. Choose what happens to other tasks. Nothing is saved until you apply.`} wide>
      <div className="space-y-4" data-testid="delay-dialog">
        <fieldset className="space-y-2">
          <legend className="sr-only">How to handle later tasks</legend>
          {EDIT_MODES.map((m) => (
            <label key={m.value} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", state.mode === m.value ? "border-navy bg-brand-tint" : "border-line")}>
              <input type="radio" name="mode" className="mt-1" checked={state.mode === m.value} onChange={() => onMode(m.value)} data-testid={`mode-${m.value}`} />
              <span><span className="block font-semibold text-navy">{m.label}</span><span className="block text-xs text-ink-soft">{m.detail} {previews[m.value].changes.length - 1 > 0 ? `Moves ${previews[m.value].changes.length - 1} other task${previews[m.value].changes.length - 1 === 1 ? "" : "s"}.` : "No other task moves."}</span></span>
            </label>
          ))}
        </fieldset>
        <div><p className="label">Preview</p><Changes p={p} /></div>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onApply(p)} data-testid="apply-delay">Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

function ItemsDialog({ section, items, scheduled, onClose, onAdd }: { section: Task; items: { id: string; name: string; quantity: number | null; unit: string | null }[]; scheduled: Set<string>; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const [pick, setPick] = useState<string[]>([]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Schedule individual items: ${section.name}`} description="Choose estimate line items to schedule as their own tasks. They start with the section's dates; adjust them after.">
      <div className="space-y-3" data-testid="items-dialog">
        {items.length === 0 && <p className="text-sm text-muted">This section has no line items in the estimate.</p>}
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {items.map((i) => {
            const done = scheduled.has(i.id);
            return (
              <li key={i.id}>
                <label className={cn("flex min-h-11 items-center gap-3 rounded-lg border border-line px-3", done && "bg-paper text-muted")}>
                  <input type="checkbox" className="h-4 w-4" disabled={done} checked={done || pick.includes(i.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
                  <span className="min-w-0 flex-1 text-sm font-semibold">{i.name}</span>
                  <span className="text-xs">{done ? "Scheduled" : i.quantity ? `${Number(i.quantity).toLocaleString("en-US")} ${i.unit ?? ""}` : ""}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onAdd(pick)} disabled={!pick.length} data-testid="add-items">Schedule {pick.length || ""} item{pick.length === 1 ? "" : "s"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ShiftDialog({ section, onClose, preview, onApply }: { section: Task; onClose: () => void; preview: (n: number) => EditPreview; onApply: (n: number) => void }) {
  const [n, setN] = useState(1);
  const p = preview(n);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Shift ${section.name}`} description="Moves the section and all of its scheduled line items together.">
      <div className="space-y-3" data-testid="shift-dialog">
        <label className="block max-w-xs"><span className="label">Working days (negative moves earlier)</span>
          <input type="number" min={-365} max={365} className="field" value={n} onChange={(e) => setN(Math.max(-365, Math.min(365, Math.round(Number(e.target.value) || 0))))} data-testid="shift-days" /></label>
        <Changes p={p} />
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApply(n)} disabled={!n} data-testid="apply-shift">Shift</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Touch-friendly alternative to dragging: one card per task with Edit, Items and Shift buttons. */
function ListView({ rows, canEdit, canPlan, onOpen, onItems, onShift }: { rows: GanttRow[]; canEdit: boolean; canPlan: boolean; onOpen: (id: string) => void; onItems: (id: string) => void; onShift: (id: string) => void }) {
  return (
    <ul className="space-y-2" data-testid="schedule-list">
      {rows.map((r) => {
        const t = r.task;
        return (
          <li key={t.id} className={cn("rounded-xl border border-line bg-surface p-3", r.depth && "ml-4 sm:ml-8")}>
            {r.tradeHeader && <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{r.tradeHeader}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("min-w-0 flex-1", r.isSectionHead ? "font-bold text-navy" : "font-semibold")}>{t.name}</p>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[t.status].chip)}>{statusLabel(t.status)}</span>
            </div>
            <p className="mt-0.5 text-sm text-ink-soft">{formatRange(t.plannedStart, t.plannedEnd)} · {t.durationDays} working day{t.durationDays === 1 ? "" : "s"} · {r.progress}%</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onOpen(t.id)}>{canEdit ? "Edit" : "Details"}</Button>
              {canPlan && r.isSectionHead && <Button size="sm" variant="secondary" onClick={() => onItems(t.id)}>Schedule items</Button>}
              {canPlan && r.isSectionHead && <Button size="sm" variant="secondary" onClick={() => onShift(t.id)} data-testid={`shift-${t.id}`}><MoveHorizontal className="h-4 w-4" aria-hidden /> Shift section</Button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

