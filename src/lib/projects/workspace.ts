/**
 * Projects workspace (V4.1): pure helpers shared by Overview, Calendar, Timeline, Workload and My Work.
 * Every view reads the SAME rows returned by pm_workspace (project_schedules + schedule_tasks), so a
 * date changed anywhere shows everywhere. Unit tested in tests/projects-workspace.test.ts.
 */
import { addDays, daysBetween, isWorkday, normalizeCalendar, weekday, type WorkCalendar } from "@/lib/schedule/calendar";
import type { TaskStatus } from "@/lib/schedule/types";

export interface WsPermissions { edit: boolean; progress: boolean; dependencies: boolean; publish: boolean; pdf: boolean }
export interface WsPerson { id: string; name: string; role: string }
export interface WsProject {
  id: string; estimateId: string; companyId: string | null; name: string; status: "draft" | "active" | "completed" | "archived"; provisional: boolean;
  startDate: string; targetEndDate: string | null; actualFinish: string | null; revision: number;
  salesRepId: string | null; projectManagerId: string | null; createdBy: string | null; ownerId: string;
  customerName: string; trades: string[]; calendar: WorkCalendar;
  finishDate: string | null; tasksTotal: number; tasksDone: number; tasksDelayed: number; tasksOverdue: number; progress: number;
  lastUpdateAt: string | null; lastChangeAt: string; permissions: WsPermissions;
}
export interface WsTask {
  id: string; scheduleId: string; parentId: string | null; kind: "section" | "item"; name: string; sortOrder: number;
  plannedStart: string; plannedEnd: string; durationDays: number; actualStart: string | null; actualFinish: string | null;
  percentComplete: number; status: TaskStatus; assignee: string | null; trade: string | null;
  /** V4.2 directory resource, when assigned. */
  resourceId?: string | null; assignmentStatus?: AssignmentStatus | null;
}
export type AssignmentStatus = "tentative" | "requested" | "confirmed" | "declined";
export interface WsDep { from: string; to: string; lagDays: number }
export interface Workspace { me: string; people: WsPerson[]; projects: WsProject[]; tasks: WsTask[]; deps: WsDep[]; from: string; to: string }

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

export function mapWorkspace(raw: Row): Workspace {
  const perms = (p: unknown): WsPermissions => {
    const r = (p ?? {}) as Row;
    return { edit: r.edit === true, progress: r.progress === true, dependencies: r.dependencies === true, publish: r.publish === true, pdf: r.pdf === true };
  };
  return {
    me: String(raw.me ?? ""),
    from: String(raw.from ?? ""), to: String(raw.to ?? ""),
    people: ((raw.people as Row[]) ?? []).map((p) => ({ id: String(p.id), name: String(p.name ?? "Team member"), role: String(p.role ?? "") })),
    projects: ((raw.projects as Row[]) ?? []).map((p): WsProject => ({
      id: String(p.id), estimateId: String(p.estimate_id), companyId: str(p.company_id), name: String(p.name ?? "Project"),
      status: (p.status as WsProject["status"]) ?? "draft", provisional: Boolean(p.provisional),
      startDate: String(p.start_date), targetEndDate: str(p.target_end_date), actualFinish: str(p.actual_finish), revision: num(p.revision) || 1,
      salesRepId: str(p.sales_rep_id), projectManagerId: str(p.project_manager_id), createdBy: str(p.created_by), ownerId: String(p.owner_id ?? ""),
      customerName: String(p.customer_name ?? ""), trades: Array.isArray(p.trades) ? (p.trades as unknown[]).map(String) : [],
      calendar: normalizeCalendar(p.calendar as never), finishDate: str(p.finish_date),
      tasksTotal: num(p.tasks_total), tasksDone: num(p.tasks_done), tasksDelayed: num(p.tasks_delayed), tasksOverdue: num(p.tasks_overdue),
      progress: Math.round(num(p.progress)), lastUpdateAt: str(p.last_update_at), lastChangeAt: String(p.last_change_at ?? ""), permissions: perms(p.permissions),
    })),
    tasks: ((raw.tasks as Row[]) ?? []).map((t): WsTask => ({
      id: String(t.id), scheduleId: String(t.schedule_id), parentId: str(t.parent_id), kind: t.kind === "item" ? "item" : "section", name: String(t.name ?? ""),
      sortOrder: num(t.sort_order), plannedStart: String(t.planned_start), plannedEnd: String(t.planned_end), durationDays: num(t.duration_days) || 1,
      actualStart: str(t.actual_start), actualFinish: str(t.actual_finish), percentComplete: num(t.percent_complete),
      status: (t.status as TaskStatus) ?? "not_started", assignee: str(t.assignee), trade: str(t.section_trade),
      resourceId: str(t.resource_id), assignmentStatus: (str(t.assignment_status) as AssignmentStatus | null) ?? null,
    })),
    deps: ((raw.deps as Row[]) ?? []).map((d) => ({ from: String(d.from), to: String(d.to), lagDays: num(d.lagDays) })),
  };
}

// ---------------------------------------------------------------------------------------------------
// Colors: one per project, the same in calendar, timeline and detail. Always shown with a text label.
// ---------------------------------------------------------------------------------------------------
const HUES = [200, 160, 28, 280, 340, 95, 230, 50, 310, 130, 10, 185];
export function projectHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
/** Inline style for a project-colored chip/bar: readable on light, dark and black themes. */
export const projectStyle = (id: string) => {
  const h = projectHue(id);
  return { backgroundColor: `hsl(${h} 75% 50% / 0.16)`, borderColor: `hsl(${h} 65% 45%)`, ["--proj" as string]: `hsl(${h} 65% 45%)` };
};
export const projectDot = (id: string) => ({ backgroundColor: `hsl(${projectHue(id)} 65% 45%)` });

// ---------------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------------
export type StatusFilter = "active" | "scheduled" | "completed" | "all";
export interface Filters {
  rep: "all" | "mine" | string;
  pm: "all" | "mine" | "none" | string;
  project: "all" | string;
  status: StatusFilter;
  trade: "all" | string;
  member: "all" | string;
}
export const DEFAULT_FILTERS: Filters = { rep: "all", pm: "all", project: "all", status: "active", trade: "all", member: "all" };
export const isDefaultFilters = (f: Filters) => (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).every((k) => f[k] === DEFAULT_FILTERS[k]);

/** Active = not completed (draft or in progress). Scheduled = has not started yet. */
export function projectMatches(p: WsProject, f: Filters, me: string, today: string): boolean {
  if (f.project !== "all" && p.id !== f.project) return false;
  if (f.rep === "mine" ? p.salesRepId !== me : f.rep !== "all" && p.salesRepId !== f.rep) return false;
  if (f.pm === "mine" ? p.projectManagerId !== me : f.pm === "none" ? p.projectManagerId !== null : f.pm !== "all" && p.projectManagerId !== f.pm) return false;
  if (f.trade !== "all" && !p.trades.includes(f.trade)) return false;
  if (f.status === "active" && p.status === "completed") return false;
  if (f.status === "completed" && p.status !== "completed") return false;
  if (f.status === "scheduled" && (p.status === "completed" || p.startDate <= today)) return false;
  return true;
}

/** Sanitizes filters read from storage or the URL: unknown ids fall back to "all" (never widens access). */
export function cleanFilters(raw: Partial<Filters> | null | undefined, ws: Pick<Workspace, "projects" | "people">): Filters {
  const f = { ...DEFAULT_FILTERS, ...(raw ?? {}) };
  const people = new Set(ws.people.map((p) => p.id));
  const projects = new Set(ws.projects.map((p) => p.id));
  const out: Filters = { ...DEFAULT_FILTERS };
  out.rep = f.rep === "all" || f.rep === "mine" || people.has(f.rep) ? f.rep : "all";
  out.pm = f.pm === "all" || f.pm === "mine" || f.pm === "none" || people.has(f.pm) ? f.pm : "all";
  out.project = f.project === "all" || projects.has(f.project) ? f.project : "all";
  out.status = (["active", "scheduled", "completed", "all"] as const).includes(f.status as StatusFilter) ? f.status : "active";
  out.trade = typeof f.trade === "string" && f.trade.length <= 60 ? f.trade : "all";
  out.member = typeof f.member === "string" && f.member.length <= 200 ? f.member : "all";
  return out;
}

export function filterWorkspace(ws: Workspace, f: Filters, today: string): { projects: WsProject[]; tasks: WsTask[] } {
  const projects = ws.projects.filter((p) => projectMatches(p, f, ws.me, today));
  const ids = new Set(projects.map((p) => p.id));
  const tasks = ws.tasks.filter((t) => ids.has(t.scheduleId) && (f.member === "all" || assigneeKey(t) === f.member));
  return { projects, tasks };
}

/** The resource a task is assigned to: a directory resource (V4.2) or the free-text assignee. */
export const assigneeKey = (t: Pick<WsTask, "resourceId" | "assignee">) => (t.resourceId ? `r:${t.resourceId}` : t.assignee ? `t:${t.assignee.trim().toLowerCase()}` : null);

/** Leaf tasks only (a section with scheduled line items is represented by its items). */
export function leafTasks(tasks: WsTask[]): WsTask[] {
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  return tasks.filter((t) => !parents.has(t.id));
}

// ---------------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------------
export interface Metrics { active: number; startingSoon: number; delayed: number; needsUpdate: number; completed: number }

/**
 * Five operational numbers. "Needs a customer update": active project whose schedule changed after the
 * last published update (or never published once work has started).
 */
export function overviewMetrics(projects: WsProject[], today: string, periodStart: string): Metrics {
  const live = projects.filter((p) => p.status !== "completed");
  return {
    active: live.length,
    startingSoon: live.filter((p) => p.startDate >= today && p.startDate <= addDays(today, 14)).length,
    delayed: live.filter((p) => p.tasksDelayed > 0 || p.tasksOverdue > 0).length,
    needsUpdate: live.filter((p) => needsCustomerUpdate(p, today)).length,
    completed: projects.filter((p) => p.status === "completed" && (p.actualFinish ?? "") >= periodStart).length,
  };
}

export function needsCustomerUpdate(p: WsProject, today: string): boolean {
  if (p.status === "completed" || p.provisional) return false;
  if (!p.lastUpdateAt) return p.startDate <= addDays(today, 7);
  return p.lastChangeAt > p.lastUpdateAt;
}

export function forecastFinish(p: WsProject): string | null {
  return p.status === "completed" ? p.actualFinish : p.finishDate;
}

/** One warning per project (the most important), in plain words. */
export function projectWarning(p: WsProject, today: string): string | null {
  if (p.status === "completed") return null;
  if (p.tasksDelayed > 0) return `${p.tasksDelayed} delayed task${p.tasksDelayed === 1 ? "" : "s"}`;
  if (p.tasksOverdue > 0) return `${p.tasksOverdue} task${p.tasksOverdue === 1 ? "" : "s"} past planned finish`;
  if (p.targetEndDate && p.finishDate && p.finishDate > p.targetEndDate) return "Finishes after the target date";
  if (!p.projectManagerId && p.companyId) return "No project manager";
  if (p.provisional) return "Provisional: bid not accepted yet";
  if (needsCustomerUpdate(p, today)) return "Customer hasn't seen the latest schedule";
  return null;
}

export type NextAction = "schedule_now" | "update_progress" | "update_customer" | "close_out" | "view";
export function nextAction(p: WsProject, today: string): NextAction {
  if (p.status === "completed") return "view";
  if (p.tasksTotal > 0 && p.tasksDone === p.tasksTotal) return p.permissions.edit ? "close_out" : "view";
  if ((p.permissions.progress || p.permissions.edit) && p.startDate <= today) return "update_progress";
  if (p.permissions.publish && needsCustomerUpdate(p, today)) return "update_customer";
  return "view";
}

export type SortKey = "name" | "customer" | "rep" | "pm" | "status" | "start" | "finish" | "progress";
export function sortProjects(list: WsProject[], key: SortKey, dir: 1 | -1, nameOf: (id: string | null) => string): WsProject[] {
  const v = (p: WsProject): string | number => {
    switch (key) {
      case "name": return p.name.toLowerCase();
      case "customer": return p.customerName.toLowerCase();
      case "rep": return nameOf(p.salesRepId).toLowerCase();
      case "pm": return nameOf(p.projectManagerId).toLowerCase();
      case "status": return p.status;
      case "start": return p.startDate;
      case "finish": return forecastFinish(p) ?? "9999";
      case "progress": return p.progress;
    }
  };
  return [...list].sort((a, b) => (v(a) < v(b) ? -dir : v(a) > v(b) ? dir : a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------
// Calendar: date-only tasks laid out on a grid without time zones (no off-by-one).
// ---------------------------------------------------------------------------------------------------
export const startOfWeek = (d: string) => addDays(d, -weekday(d));
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export function monthGrid(anchor: string): string[] {
  const first = monthStart(anchor);
  const start = startOfWeek(first);
  const next = monthStart(addDays(first, 32));
  const days = daysBetween(start, next);
  const weeks = Math.ceil(days / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}
export const tasksOn = (tasks: WsTask[], day: string) => tasks.filter((t) => t.plannedStart <= day && t.plannedEnd >= day);
export const overlaps = (a: { plannedStart: string; plannedEnd: string }, from: string, to: string) => a.plannedStart <= to && a.plannedEnd >= from;

// ---------------------------------------------------------------------------------------------------
// Workload and conflicts
// ---------------------------------------------------------------------------------------------------
export interface ResourceRef { key: string; label: string; kind: "staff" | "subcontractor" | "crew" | "text"; members?: string[]; unavailable?: string[]; capacity?: number | null }

export interface Conflict {
  resource: string; resourceKey: string; day: string; until: string; tasks: { id: string; name: string; scheduleId: string; projectName: string }[];
  kind: "double_booked" | "unavailable";
}

/**
 * Real conflicts only: the same resource (or a crew member through two crews) on overlapping working
 * days of two tasks in DIFFERENT projects, beyond declared capacity (default 1 job at a time), or work
 * on a day the resource marked unavailable. Several projects for one PM is not a conflict; tasks with
 * no assignee never conflict; nothing is rescheduled.
 */
export function findResourceConflicts(tasks: WsTask[], projects: WsProject[], resources: ResourceRef[]): Conflict[] {
  const byKey = new Map(resources.map((r) => [r.key, r]));
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  const cal = new Map(projects.map((p) => [p.id, p.calendar]));
  // Expand crews to their members so a person booked directly and through a crew is caught too.
  const atoms = (key: string): string[] => {
    const r = byKey.get(key);
    return r?.kind === "crew" && r.members?.length ? [key, ...r.members] : [key];
  };
  const live = leafTasks(tasks).filter((t) => t.status !== "complete" && assigneeKey(t));
  const daily = new Map<string, Map<string, WsTask[]>>(); // atom -> day -> tasks
  for (const t of live) {
    const c = cal.get(t.scheduleId);
    for (const a of atoms(assigneeKey(t)!)) {
      const m = daily.get(a) ?? new Map<string, WsTask[]>();
      for (let d = t.plannedStart; d <= t.plannedEnd; d = addDays(d, 1)) {
        if (c && !isWorkday(d, c)) continue;
        m.set(d, [...(m.get(d) ?? []), t]);
      }
      daily.set(a, m);
    }
  }
  const raw: Conflict[] = [];
  for (const [atom, days] of daily) {
    const r = byKey.get(atom);
    const first = [...days.values()][0]?.[0];
    const label = r?.label ?? (atom.startsWith("t:") && first?.assignee?.trim() ? first.assignee.trim() : atom.replace(/^[tr]:/, ""));
    const cap = Math.max(1, r?.capacity ?? 1);
    for (const [day, list] of [...days.entries()].sort()) {
      const uniq = [...new Map(list.map((t) => [t.id, t])).values()];
      const projectsThatDay = new Set(uniq.map((t) => t.scheduleId));
      if (r?.unavailable?.includes(day)) raw.push({ resource: label, resourceKey: atom, day, until: day, kind: "unavailable", tasks: uniq.map((t) => ({ id: t.id, name: t.name, scheduleId: t.scheduleId, projectName: projName.get(t.scheduleId) ?? "" })) });
      else if (projectsThatDay.size > cap) raw.push({ resource: label, resourceKey: atom, day, until: day, kind: "double_booked", tasks: uniq.map((t) => ({ id: t.id, name: t.name, scheduleId: t.scheduleId, projectName: projName.get(t.scheduleId) ?? "" })) });
    }
  }
  // Merge consecutive days with the same tasks into one warning.
  const merged: Conflict[] = [];
  for (const c of raw) {
    const prev = merged.at(-1);
    const sig = (x: Conflict) => `${x.resourceKey}|${x.kind}|${x.tasks.map((t) => t.id).sort().join(",")}`;
    if (prev && sig(prev) === sig(c) && daysBetween(prev.until, c.day) <= 3) prev.until = c.day;
    else merged.push({ ...c });
  }
  return merged;
}

export interface LoadRow { key: string; label: string; kind: ResourceRef["kind"]; tasks: WsTask[]; days: number; projects: number; capacityDays: number | null }

/** Booked working days per resource in a window. Utilization is shown only when capacity was declared. */
export function workloadRows(tasks: WsTask[], projects: WsProject[], resources: ResourceRef[], from: string, to: string): LoadRow[] {
  const cal = new Map(projects.map((p) => [p.id, p.calendar]));
  const byKey = new Map(resources.map((r) => [r.key, r]));
  const rows = new Map<string, LoadRow>();
  for (const t of leafTasks(tasks)) {
    const key = assigneeKey(t) ?? "unassigned";
    if (!overlaps(t, from, to)) continue;
    const r = byKey.get(key);
    const row = rows.get(key) ?? { key, label: key === "unassigned" ? "Unassigned" : r?.label ?? (t.assignee ?? "").trim(), kind: r?.kind ?? "text", tasks: [], days: 0, projects: 0, capacityDays: null };
    row.tasks.push(t);
    rows.set(key, row);
  }
  for (const row of rows.values()) {
    const days = new Set<string>();
    for (const t of row.tasks) {
      const c = cal.get(t.scheduleId);
      for (let d = t.plannedStart > from ? t.plannedStart : from; d <= (t.plannedEnd < to ? t.plannedEnd : to); d = addDays(d, 1)) if (!c || isWorkday(d, c)) days.add(d);
    }
    row.days = days.size;
    row.projects = new Set(row.tasks.map((t) => t.scheduleId)).size;
    const r = byKey.get(row.key);
    if (r?.capacity) {
      // Capacity is jobs at once; capacity days = working days in the window x capacity (Mon-Fri if unknown).
      let wd = 0; const c = normalizeCalendar(null);
      for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, c) && !r.unavailable?.includes(d)) wd++;
      row.capacityDays = wd * r.capacity;
    }
  }
  return [...rows.values()].sort((a, b) => (a.key === "unassigned" ? 1 : b.key === "unassigned" ? -1 : b.days - a.days || a.label.localeCompare(b.label)));
}

// ---------------------------------------------------------------------------------------------------
// My Work
// ---------------------------------------------------------------------------------------------------
export type Bucket = "overdue" | "today" | "week" | "upcoming" | "completed";
export const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "Next 7 days" }, { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" }, { key: "completed", label: "Completed" },
];
export function bucketOf(t: WsTask, today: string): Bucket {
  if (t.status === "complete") return "completed";
  if (t.plannedEnd < today) return "overdue";
  if (t.plannedStart <= today) return "today";
  if (t.plannedStart <= addDays(today, 7)) return "week";
  return "upcoming";
}

/**
 * Tasks that are "mine": assigned to me (directory resource linked to my account, or my name in the
 * free-text assignee), or every open task on projects I manage.
 */
export function myTasks(ws: Workspace, myName: string, myResourceKeys: string[], today: string): Record<Bucket, WsTask[]> {
  const pmOf = new Set(ws.projects.filter((p) => p.projectManagerId === ws.me && p.status !== "completed").map((p) => p.id));
  const name = myName.trim().toLowerCase();
  const keys = new Set(myResourceKeys);
  const mine = leafTasks(ws.tasks).filter((t) => {
    const k = assigneeKey(t);
    return (k && keys.has(k)) || (name.length > 1 && t.assignee?.trim().toLowerCase() === name) || pmOf.has(t.scheduleId);
  });
  const out: Record<Bucket, WsTask[]> = { overdue: [], today: [], week: [], upcoming: [], completed: [] };
  for (const t of mine) out[bucketOf(t, today)].push(t);
  for (const k of Object.keys(out) as Bucket[]) out[k].sort((a, b) => (k === "completed" ? b.plannedEnd.localeCompare(a.plannedEnd) : a.plannedStart.localeCompare(b.plannedStart)));
  out.completed = out.completed.slice(0, 20);
  return out;
}
