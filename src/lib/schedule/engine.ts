/**
 * Scheduling rules shared by the wizard, the Gantt editor and the server (which re-validates every
 * change). Pure functions, unit tested in tests/schedule-engine.test.ts.
 *
 * Principles from the V4 brief:
 *   - Overlaps are allowed. Nothing forces sections into a strict sequence; only explicit
 *     dependencies constrain dates.
 *   - Durations are never silently compressed. Target dates are met only by overlaps the contractor
 *     allowed, otherwise the conflict is explained with choices.
 *   - Unrelated tasks never move. Every edit that would move other tasks is previewed first, and
 *     only the option the contractor picks is applied.
 */
import {
  type WorkCalendar, addDays, endFromStart, isIsoDate, isWorkday, shiftWorkdays, snapBack, snapForward, workdayDelta, workdaysBetween,
} from "./calendar";
import type { Dep, Snapshot, Task, TaskChange, TaskStatus } from "./types";

// ---------------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------------

/** Earliest start the dependency allows for its successor. */
export function requiredStart(pred: Pick<Task, "plannedEnd">, dep: Pick<Dep, "lagDays">, cal: WorkCalendar): string {
  return shiftWorkdays(pred.plannedEnd, 1 + dep.lagDays, cal);
}

/** Task ids in dependency order, or null when the dependencies contain a cycle. */
export function topoOrder(ids: string[], deps: Dep[]): string[] | null {
  const inDeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const d of deps) {
    if (!inDeg.has(d.from) || !inDeg.has(d.to)) continue;
    inDeg.set(d.to, (inDeg.get(d.to) ?? 0) + 1);
    out.set(d.from, [...(out.get(d.from) ?? []), d.to]);
  }
  const queue = ids.filter((id) => inDeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of out.get(id) ?? []) {
      inDeg.set(n, inDeg.get(n)! - 1);
      if (inDeg.get(n) === 0) queue.push(n);
    }
  }
  return order.length === ids.length ? order : null;
}

export const hasCycle = (ids: string[], deps: Dep[]) => topoOrder(ids, deps) === null;

/** Would adding from -> to create a cycle? (Used to disable choices in the dependency editor.) */
export function wouldCycle(ids: string[], deps: Dep[], from: string, to: string): boolean {
  return from === to || hasCycle(ids, [...deps, { from, to, lagDays: 0, maxOverlap: 0 }]);
}

// ---------------------------------------------------------------------------------------------------
// Wizard: build section tasks from durations and dependencies
// ---------------------------------------------------------------------------------------------------

export interface PlanSection { key: string; sourceGroupId: string; name: string; durationDays: number; sortOrder: number }
export interface PlannedSection extends PlanSection { plannedStart: string; plannedEnd: string }

/**
 * Forward pass: every section starts on the project start (so independent sections overlap) unless a
 * dependency says it must wait. Durations are kept exactly as entered.
 */
export function planSections(sections: PlanSection[], deps: Dep[], start: string, cal: WorkCalendar): PlannedSection[] | null {
  const order = topoOrder(sections.map((s) => s.key), deps);
  if (!order) return null;
  const s0 = snapForward(start, cal);
  const byKey = new Map<string, PlannedSection>();
  for (const key of order) {
    const sec = sections.find((s) => s.key === key)!;
    let st = s0;
    for (const d of deps.filter((x) => x.to === key)) {
      const p = byKey.get(d.from);
      if (p) { const r = requiredStart(p, d, cal); if (r > st) st = r; }
    }
    byKey.set(key, { ...sec, plannedStart: st, plannedEnd: endFromStart(st, sec.durationDays, cal) });
  }
  return sections.map((s) => byKey.get(s.key)!);
}

export const finishOf = (list: { plannedEnd: string }[]) => list.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), list[0]?.plannedEnd ?? "");

export interface Feasibility {
  finish: string;
  feasible: boolean;
  /** Working days past the target. */
  overBy: number;
  /** Start date that would meet the target with the current plan. */
  startBy: string | null;
  /** A plan using only the overlaps the contractor allowed (never shorter durations). */
  suggestion: { deps: Dep[]; finish: string; feasible: boolean; changed: { from: string; to: string; overlap: number }[] } | null;
}

/**
 * Can the plan finish by the target? If not, tries the overlaps the contractor allowed on the
 * dependencies along the critical path, one working day at a time, and reports what it found. It
 * never shortens a duration and never overlaps two sections beyond the allowed amount.
 */
export function checkTarget(sections: PlanSection[], deps: Dep[], start: string, target: string, cal: WorkCalendar): Feasibility | null {
  const plan = planSections(sections, deps, start, cal);
  if (!plan) return null;
  const finish = finishOf(plan);
  const t = snapBack(target, cal);
  if (finish <= target) return { finish, feasible: true, overBy: 0, startBy: null, suggestion: null };
  const overBy = workdaysBetween(addDays(t, 1), finish, cal);
  const startBy = shiftWorkdays(snapForward(start, cal), -overBy, cal);

  const cur = deps.map((d) => ({ ...d }));
  let curPlan = plan;
  for (let guard = 0; guard < 2000; guard++) {
    const end = finishOf(curPlan);
    if (end <= target) break;
    // Walk back from the latest-finishing section through the dependency that pins its start.
    let node = curPlan.reduce((a, b) => (b.plannedEnd > a.plannedEnd ? b : a));
    let moved = false;
    for (let hop = 0; hop < sections.length && !moved; hop++) {
      const binding = cur.filter((d) => d.to === node.key)
        .map((d) => ({ d, p: curPlan.find((x) => x.key === d.from)! }))
        .find(({ d, p }) => requiredStart(p, d, cal) === node.plannedStart);
      if (!binding) break;
      if (-binding.d.lagDays < Math.min(binding.d.maxOverlap, binding.p.durationDays)) {
        binding.d.lagDays -= 1;
        moved = true;
      } else node = binding.p;
    }
    if (!moved) break;
    curPlan = planSections(sections, cur, start, cal)!;
  }
  const sFinish = finishOf(curPlan);
  const changed = cur.filter((d, i) => d.lagDays !== deps[i].lagDays).map((d) => ({ from: d.from, to: d.to, overlap: -d.lagDays }));
  return {
    finish, feasible: false, overBy, startBy,
    suggestion: changed.length ? { deps: cur, finish: sFinish, feasible: sFinish <= target, changed } : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Editing: dates, delays and their effect on other tasks
// ---------------------------------------------------------------------------------------------------

export interface DateEdit { taskId: string; plannedStart?: string; plannedEnd?: string; durationDays?: number }
export type EditMode = "keep" | "dependents" | "group" | "recalc";

export const EDIT_MODES: { value: EditMode; label: string; detail: string }[] = [
  { value: "keep", label: "Keep later tasks unchanged", detail: "Only this task changes." },
  { value: "dependents", label: "Move dependent tasks", detail: "Tasks that wait on this one move just enough to keep their dependency." },
  { value: "group", label: "Shift the rest of this section", detail: "Tasks in the same section that start after this one move by the same number of working days." },
  { value: "recalc", label: "Recalculate the project finish", detail: "Re-checks every dependency in the schedule and moves only tasks that would otherwise break one." },
];

/** New start/end/duration for an edit, snapped to working days. Duration is always derived. */
export function resolveDates(t: Task, e: DateEdit, cal: WorkCalendar): { plannedStart: string; plannedEnd: string; durationDays: number } {
  let start = t.plannedStart, end = t.plannedEnd;
  if (e.plannedStart && e.plannedEnd) { start = snapForward(e.plannedStart, cal); end = snapBack(e.plannedEnd, cal); }
  else if (e.plannedStart && e.durationDays) { start = snapForward(e.plannedStart, cal); end = endFromStart(start, e.durationDays, cal); }
  else if (e.plannedStart) { start = snapForward(e.plannedStart, cal); end = endFromStart(start, t.durationDays, cal); }
  else if (e.plannedEnd) end = snapBack(e.plannedEnd, cal);
  else if (e.durationDays) end = endFromStart(start, e.durationDays, cal);
  if (end < start) end = start;
  return { plannedStart: start, plannedEnd: end, durationDays: Math.max(1, workdaysBetween(start, end, cal)) };
}

function shiftTask(t: Task, delta: number, cal: WorkCalendar): Task {
  if (!delta) return t;
  const start = shiftWorkdays(snapForward(t.plannedStart, cal), delta, cal);
  return { ...t, plannedStart: start, plannedEnd: endFromStart(start, t.durationDays, cal) };
}

function moveTo(t: Task, start: string, cal: WorkCalendar): Task {
  return { ...t, plannedStart: start, plannedEnd: endFromStart(start, t.durationDays, cal) };
}

export interface EditPreview {
  tasks: Task[];
  changes: TaskChange[];
  finishBefore: string;
  finishAfter: string;
}

/** Shows exactly which tasks an edit would move under each mode, before anything is saved. */
export function previewEdit(tasks: Task[], deps: Dep[], edit: DateEdit, mode: EditMode, cal: WorkCalendar): EditPreview {
  const before = new Map(tasks.map((t) => [t.id, t]));
  const cur = new Map(tasks.map((t) => [t.id, { ...t }]));
  const t0 = before.get(edit.taskId);
  if (!t0) return { tasks, changes: [], finishBefore: finishOf(tasks), finishAfter: finishOf(tasks) };
  const next = { ...t0, ...resolveDates(t0, edit, cal) };
  cur.set(t0.id, next);
  // Dragging a whole section moves its scheduled line items with it (resizing does not).
  const children = tasks.filter((x) => x.parentId === t0.id);
  if (t0.kind === "section" && next.durationDays === t0.durationDays && next.plannedStart !== t0.plannedStart) {
    const delta = workdayDelta(snapForward(t0.plannedStart, cal), next.plannedStart, cal);
    for (const c of children) cur.set(c.id, shiftTask(c, delta, cal));
  }

  const moveWithChildren = (t: Task, start: string) => {
    const old = cur.get(t.id)!;
    const moved = moveTo(old, start, cal);
    cur.set(t.id, moved);
    if (t.kind === "section") {
      const delta = workdayDelta(old.plannedStart, start, cal);
      for (const c of tasks.filter((x) => x.parentId === t.id)) cur.set(c.id, shiftTask(cur.get(c.id)!, delta, cal));
    }
  };

  const push = (seeds: string[]) => {
    const queue = [...seeds];
    for (let guard = 0; queue.length && guard < 10_000; guard++) {
      const id = queue.shift()!;
      for (const d of deps.filter((x) => x.from === id)) {
        const succ = cur.get(d.to);
        if (!succ) continue;
        const req = deps.filter((x) => x.to === d.to).reduce((m, x) => {
          const p = cur.get(x.from);
          if (!p) return m;
          const r = requiredStart(p, x, cal);
          return r > m ? r : m;
        }, "");
        if (req && succ.plannedStart < req) {
          moveWithChildren(succ, req);
          queue.push(succ.id, ...tasks.filter((x) => x.parentId === succ.id).map((x) => x.id));
        }
      }
    }
  };

  if (mode === "dependents") push([t0.id, ...children.map((c) => c.id)]);
  if (mode === "group") {
    const delta = workdayDelta(t0.plannedEnd, next.plannedEnd, cal);
    const groupIds = new Set([t0.id, ...children.map((c) => c.id)]);
    for (const x of tasks) {
      if (groupIds.has(x.id) || x.sourceGroupId !== t0.sourceGroupId) continue;
      if (x.plannedStart > t0.plannedStart) cur.set(x.id, shiftTask(x, delta, cal));
    }
  }
  if (mode === "recalc") {
    const order = topoOrder(tasks.map((x) => x.id), deps) ?? [];
    for (const id of order) {
      const req = deps.filter((x) => x.to === id).reduce((m, x) => {
        const r = requiredStart(cur.get(x.from)!, x, cal);
        return r > m ? r : m;
      }, "");
      const t = cur.get(id)!;
      if (req && t.plannedStart < req) moveWithChildren(t, req);
    }
  }

  const out = tasks.map((t) => cur.get(t.id)!);
  return { tasks: out, changes: diffTasks(tasks, out), finishBefore: finishOf(tasks), finishAfter: finishOf(out) };
}

/** Would this edit move a task later in a way that affects other tasks? (Then ask how to handle it.) */
export function editNeedsChoice(tasks: Task[], deps: Dep[], edit: DateEdit, cal: WorkCalendar): boolean {
  const t = tasks.find((x) => x.id === edit.taskId);
  if (!t) return false;
  const next = resolveDates(t, edit, cal);
  if (next.plannedEnd <= t.plannedEnd) return false;
  const modes: EditMode[] = ["dependents", "group"];
  const keep = previewEdit(tasks, deps, edit, "keep", cal).changes.length;
  return modes.some((m) => previewEdit(tasks, deps, edit, m, cal).changes.length > keep);
}

export function diffTasks(a: Task[], b: Task[]): TaskChange[] {
  const old = new Map(a.map((t) => [t.id, t]));
  const changes: TaskChange[] = [];
  for (const t of b) {
    const o = old.get(t.id);
    if (!o) changes.push({ id: t.id, name: t.name, from: null, to: { start: t.plannedStart, end: t.plannedEnd } });
    else if (o.plannedStart !== t.plannedStart || o.plannedEnd !== t.plannedEnd) changes.push({ id: t.id, name: t.name, from: { start: o.plannedStart, end: o.plannedEnd }, to: { start: t.plannedStart, end: t.plannedEnd } });
  }
  for (const o of a) if (!b.some((t) => t.id === o.id)) changes.push({ id: o.id, name: o.name, from: { start: o.plannedStart, end: o.plannedEnd }, to: null });
  return changes;
}

/** Group shift: a section and its line items move together by `delta` working days. */
export function shiftSection(tasks: Task[], sectionId: string, delta: number, cal: WorkCalendar): Task[] {
  return tasks.map((t) => (t.id === sectionId || t.parentId === sectionId || t.splitFrom === sectionId ? shiftTask(t, delta, cal) : t));
}

// ---------------------------------------------------------------------------------------------------
// Line items and splitting
// ---------------------------------------------------------------------------------------------------

/**
 * New item tasks for the selected estimate line items of a section. Items already scheduled are
 * skipped, so choosing them again never creates duplicates. Defaults to the section's dates.
 */
export function itemTasksFor(tasks: Task[], snapshot: Snapshot, sectionTaskId: string, itemIds: string[], newId: () => string): Task[] {
  const sec = tasks.find((t) => t.id === sectionTaskId && t.kind === "section" && !t.splitFrom);
  const src = sec && snapshot.sections.find((s) => s.id === sec.sourceGroupId);
  if (!sec || !src) return [];
  const have = new Set(tasks.filter((t) => t.sourceItemId && !t.splitFrom).map((t) => t.sourceItemId));
  return src.items.filter((i) => itemIds.includes(i.id) && !have.has(i.id)).map((i) => ({
    id: newId(), parentId: sec.id, kind: "item", sourceGroupId: sec.sourceGroupId, sourceItemId: i.id, splitFrom: null,
    name: i.name, sortOrder: i.sortOrder, plannedStart: sec.plannedStart, plannedEnd: sec.plannedEnd, durationDays: sec.durationDays,
    actualStart: null, actualFinish: null, percentComplete: 0, status: "not_started", weight: null, assignee: null, notes: null,
  }));
}

/**
 * Splits a task at `at`: the first part keeps the original dates up to the working day before `at`,
 * the second part runs from `at` to the original finish and can then be moved on its own (for
 * example to leave a gap while waiting on an inspection). Tasks that waited on the original now wait
 * on the second part.
 */
export function splitTask(tasks: Task[], deps: Dep[], id: string, at: string, cal: WorkCalendar, newId: () => string): { tasks: Task[]; deps: Dep[]; partId: string } | null {
  const t = tasks.find((x) => x.id === id);
  if (!t || !canSplit(tasks, t)) return null;
  const s2 = snapForward(at, cal);
  if (s2 <= t.plannedStart || s2 > t.plannedEnd) return null;
  const e1 = shiftWorkdays(s2, -1, cal);
  const partId = newId();
  const first: Task = { ...t, plannedEnd: e1, durationDays: workdaysBetween(t.plannedStart, e1, cal) };
  const second: Task = {
    ...t, id: partId, splitFrom: t.id, name: `${t.name.replace(/ \(part \d+\)$/, "")} (part 2)`, sortOrder: t.sortOrder,
    plannedStart: s2, plannedEnd: t.plannedEnd, durationDays: workdaysBetween(s2, t.plannedEnd, cal),
    status: t.status === "complete" ? "complete" : "not_started", percentComplete: t.status === "complete" ? 100 : 0,
    actualStart: t.status === "complete" ? t.actualStart : null, actualFinish: t.status === "complete" ? t.actualFinish : null,
  };
  return {
    tasks: tasks.flatMap((x) => (x.id === id ? [first, second] : [x])),
    deps: [...deps.map((d) => (d.from === id ? { ...d, from: partId } : d)), { from: id, to: partId, lagDays: 0, maxOverlap: 0 }],
    partId,
  };
}

/** Only tasks without scheduled line items can be split (a section with items is split by its items). */
export const canSplit = (tasks: Task[], t: Task) => !tasks.some((x) => x.parentId === t.id) && t.durationDays >= 2;

// ---------------------------------------------------------------------------------------------------
// Validation (blocks saving) and conflict warnings (shown, never auto-fixed)
// ---------------------------------------------------------------------------------------------------

export interface Problem { taskId?: string; code: string; message: string }

/** Normalizes a task's progress fields and returns problems that must be fixed before saving. */
export function normalizeTask(t: Task, cal: WorkCalendar): { task: Task; problems: Problem[] } {
  const problems: Problem[] = [];
  const p = (code: string, message: string) => problems.push({ taskId: t.id, code, message });
  if (!t.name.trim()) p("name_required", "Every task needs a name.");
  if (!isIsoDate(t.plannedStart) || !isIsoDate(t.plannedEnd)) { p("bad_date", `${t.name}: enter valid planned dates.`); return { task: t, problems }; }
  if (t.plannedEnd < t.plannedStart) p("end_before_start", `${t.name}: the planned finish is before the planned start.`);
  for (const k of ["actualStart", "actualFinish"] as const) if (t[k] !== null && !isIsoDate(t[k])) p("bad_date", `${t.name}: enter a valid actual date.`);
  if (t.actualStart && t.actualFinish && t.actualFinish < t.actualStart) p("actual_order", `${t.name}: the actual finish is before the actual start.`);
  if (t.actualFinish && !t.actualStart) p("actual_start_missing", `${t.name}: add the actual start date too.`);
  const pct = Math.max(0, Math.min(100, Math.round(Number(t.percentComplete) || 0)));
  if (t.status === "complete" && !t.actualFinish) p("finish_required", `${t.name}: add the actual finish date to mark it complete.`);
  const status: TaskStatus = t.status;
  const durationDays = Math.max(1, workdaysBetween(t.plannedStart, t.plannedEnd, cal));
  if (durationDays > 3650) p("too_long", `${t.name}: tasks can be up to 10 years long.`);
  return {
    task: {
      ...t, name: t.name.trim().slice(0, 300), durationDays,
      // Complete means 100%; reaching 100% or a planned date never rewrites the planned dates.
      percentComplete: status === "complete" ? 100 : pct,
      weight: t.weight !== null && Number(t.weight) > 0 ? Math.round(Number(t.weight) * 100) / 100 : null,
      assignee: t.assignee?.trim().slice(0, 200) || null, notes: t.notes?.trim().slice(0, 4000) || null,
    },
    problems,
  };
}

export function validateSchedule(tasks: Task[], deps: Dep[], cal: WorkCalendar): { tasks: Task[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const out = tasks.map((t) => { const r = normalizeTask(t, cal); problems.push(...r.problems); return r.task; });
  const ids = new Set(out.map((t) => t.id));
  for (const t of out) {
    if (t.kind === "item") {
      const parent = out.find((x) => x.id === t.parentId);
      if (!parent || parent.kind !== "section" || parent.sourceGroupId !== t.sourceGroupId) problems.push({ taskId: t.id, code: "bad_parent", message: `${t.name}: line items belong to their estimate section.` });
    }
  }
  const seen = new Set<string>();
  for (const d of deps) {
    if (!ids.has(d.from) || !ids.has(d.to)) problems.push({ code: "unknown_task", message: "A dependency points to a task that no longer exists." });
    if (d.from === d.to) problems.push({ code: "self_dependency", message: "A task can't depend on itself." });
    if (!Number.isInteger(d.lagDays) || Math.abs(d.lagDays) > 365 || !Number.isInteger(d.maxOverlap) || d.maxOverlap < 0 || d.maxOverlap > 365) problems.push({ code: "bad_lag", message: "Dependency gaps and overlaps must be whole working days (up to 365)." });
    const k = `${d.from}>${d.to}`;
    if (seen.has(k)) problems.push({ code: "duplicate_dependency", message: "That dependency already exists." });
    seen.add(k);
  }
  if (hasCycle([...ids], deps)) problems.push({ code: "cycle", message: "These dependencies loop back on themselves. Remove one so the tasks have an order." });
  return { tasks: out, problems };
}

/** Warnings shown in the editor. The scheduler never fixes these by itself. */
export function findConflicts(tasks: Task[], deps: Dep[], cal: WorkCalendar, opts: { target?: string | null; today?: string } = {}): Problem[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Problem[] = [];
  for (const d of deps) {
    const p = byId.get(d.from), s = byId.get(d.to);
    if (!p || !s) continue;
    const req = requiredStart(p, d, cal);
    if (s.plannedStart < req) out.push({ taskId: s.id, code: "dependency", message: `${s.name} starts before ${p.name} allows (earliest ${req}).` });
  }
  for (const t of tasks) {
    if (!isWorkday(t.plannedStart, cal) || !isWorkday(t.plannedEnd, cal)) out.push({ taskId: t.id, code: "non_working", message: `${t.name} starts or ends on a non-working day.` });
    if (t.kind === "item") {
      const sec = byId.get(t.parentId ?? "");
      const parts = tasks.filter((x) => x.id === sec?.id || x.splitFrom === sec?.id);
      if (sec && (t.plannedStart < finishOrStart(parts, "start") || t.plannedEnd > finishOrStart(parts, "end"))) out.push({ taskId: t.id, code: "outside_section", message: `${t.name} runs outside its section's dates (${sec.name}).` });
    }
    if (opts.today && t.status !== "complete" && t.plannedEnd < opts.today) out.push({ taskId: t.id, code: "past_finish", message: `${t.name} is past its planned finish and isn't marked complete.` });
  }
  if (opts.target && tasks.length) {
    const f = finishOf(tasks);
    if (f > opts.target) out.push({ code: "target", message: `The schedule finishes ${f}, after the target of ${opts.target}.` });
  }
  return out;
}

function finishOrStart(list: Task[], which: "start" | "end") {
  return which === "start" ? list.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), list[0].plannedStart) : finishOf(list);
}
