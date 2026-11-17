/**
 * Schedule Now company calendar (V4.5A): pure helpers that lay the unsaved wizard plan over the
 * company's existing schedules. Nothing here writes anything: the draft lives only in the wizard's
 * state until the final Save step. Existing work comes from the same pm_workspace rows the Projects
 * Calendar and Timeline use. Unit tested in tests/schedule-draft-overlay.test.ts.
 */
import { addDays, isWorkday, type WorkCalendar } from "./calendar";
import { assigneeKey, findResourceConflicts, leafTasks, type ResourceRef, type WsProject, type WsTask } from "@/lib/projects/workspace";

/** Id used for the unsaved draft project. Never a real schedule id. */
export const DRAFT_ID = "draft";

export interface DraftSection { key: string; name: string; trade: string | null; plannedStart: string; plannedEnd: string; durationDays: number }
export interface DraftAssignment { resourceId: string | null }

/** The wizard plan as workspace tasks, so the calendar and conflict checks treat it like any project. */
export function draftTasks(plan: DraftSection[], assign: Record<string, DraftAssignment | undefined>): WsTask[] {
  return plan.map((p, i) => ({
    id: `draft:${p.key}`, scheduleId: DRAFT_ID, parentId: null, kind: "section", name: p.name, sortOrder: i,
    plannedStart: p.plannedStart, plannedEnd: p.plannedEnd, durationDays: p.durationDays, actualStart: null, actualFinish: null,
    percentComplete: 0, status: "not_started", assignee: null, trade: p.trade, resourceId: assign[p.key]?.resourceId ?? null, assignmentStatus: null,
  }));
}

/** First and last day of the draft, or null before a plan exists. */
export function draftWindow(plan: Pick<DraftSection, "plannedStart" | "plannedEnd">[]): { start: string; end: string } | null {
  if (!plan.length) return null;
  return {
    start: plan.reduce((m, p) => (p.plannedStart < m ? p.plannedStart : m), plan[0].plannedStart),
    end: plan.reduce((m, p) => (p.plannedEnd > m ? p.plannedEnd : m), plan[0].plannedEnd),
  };
}

export interface OverlapProject { project: WsProject; from: string; to: string; tasks: WsTask[] }

/**
 * Other projects with scheduled work inside the draft's dates. Overlap is information, not a problem:
 * different crews work different jobs at the same time. Completed tasks and archived projects are left out.
 */
export function overlappingProjects(window: { start: string; end: string } | null, projects: WsProject[], tasks: WsTask[]): OverlapProject[] {
  if (!window) return [];
  const live = new Map(projects.filter((p) => p.status !== "archived" && p.status !== "completed").map((p) => [p.id, p]));
  const by = new Map<string, WsTask[]>();
  for (const t of leafTasks(tasks)) {
    if (t.scheduleId === DRAFT_ID || !live.has(t.scheduleId) || t.status === "complete") continue;
    if (t.plannedStart > window.end || t.plannedEnd < window.start) continue;
    by.set(t.scheduleId, [...(by.get(t.scheduleId) ?? []), t]);
  }
  return [...by.entries()].map(([id, list]) => {
    const from = list.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), list[0].plannedStart);
    const to = list.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), list[0].plannedEnd);
    return { project: live.get(id)!, from: from < window.start ? window.start : from, to: to > window.end ? window.end : to, tasks: list };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.project.name.localeCompare(b.project.name));
}

export interface DraftConflict {
  /** confirmed: a raised capacity exceeded or a day marked unavailable. possible: capacity left at the default. */
  certainty: "confirmed" | "possible";
  kind: "double_booked" | "unavailable";
  resource: string; day: string; until: string;
  draftTasks: string[];
  others: { name: string; projectName: string }[];
}

/**
 * Resource conflicts that involve the draft: the same employee, crew (or a crew member) or subcontractor on
 * overlapping working days of another project. Uses the shared findResourceConflicts rules. A resource with
 * no declared capacity (the default of 1) is only a POSSIBLE conflict (they may run two jobs); a raised capacity that is
 * still exceeded, or a marked
 * unavailable day makes it confirmed. Never moves anything.
 */
export function draftConflicts(draft: WsTask[], calendar: WorkCalendar, projects: WsProject[], tasks: WsTask[], resources: ResourceRef[]): DraftConflict[] {
  if (!draft.some((t) => assigneeKey(t))) return [];
  const draftProject = { id: DRAFT_ID, name: "This job (draft)", calendar } as WsProject;
  // Older schedules may name a crew or sub in free text ("Crew A") instead of linking the team entry.
  // Match those by name so the draft still sees them; nothing is written back.
  const byLabel = new Map(resources.map((r) => [r.label.trim().toLowerCase(), r.key.replace(/^r:/, "")]));
  const existing = tasks.filter((t) => t.scheduleId !== DRAFT_ID).map((t) => {
    const id = !t.resourceId && t.assignee ? byLabel.get(t.assignee.trim().toLowerCase()) : undefined;
    return id ? { ...t, resourceId: id } : t;
  });
  const all = findResourceConflicts([...existing, ...draft], [...projects, draftProject], resources);
  const byKey = new Map(resources.map((r) => [r.key, r]));
  // One card per resource and kind, spanning the first to last clashing day, so a week-long clash isn't a
  // stack of daily cards.
  const merged = new Map<string, DraftConflict & { key: string; ids: Set<string> }>();
  for (const c of all) {
    if (!c.tasks.some((t) => t.scheduleId === DRAFT_ID)) continue;
    // Every team entry stores a capacity and 1 is the default, so only a raised capacity counts as declared.
    const declared = (byKey.get(c.resourceKey)?.capacity ?? 0) > 1;
    const id = `${c.resourceKey}|${c.kind}`;
    const m = merged.get(id) ?? { key: c.resourceKey, ids: new Set<string>(), certainty: c.kind === "unavailable" || declared ? "confirmed" : "possible", kind: c.kind, resource: c.resource, day: c.day, until: c.until, draftTasks: [], others: [] };
    if (c.day < m.day) m.day = c.day;
    if (c.until > m.until) m.until = c.until;
    for (const t of c.tasks) {
      if (m.ids.has(t.id)) continue;
      m.ids.add(t.id);
      if (t.scheduleId === DRAFT_ID) m.draftTasks.push(t.name); else m.others.push({ name: t.name, projectName: t.projectName });
    }
    merged.set(id, m);
  }
  const list = [...merged.values()];
  // A crew member who clashes only through that same crew adds nothing to the crew's own card.
  const redundant = (m: (typeof list)[number]) => m.kind === "double_booked" && list.some((o) => o !== m && o.kind === "double_booked" && byKey.get(o.key)?.kind === "crew"
    && (byKey.get(o.key)?.members ?? []).includes(m.key) && [...m.ids].every((i) => o.ids.has(i)));
  return list.filter((m) => !redundant(m)).sort((a, b) => a.day.localeCompare(b.day) || a.resource.localeCompare(b.resource))
    .map(({ certainty, kind, resource, day, until, draftTasks, others }) => ({ certainty, kind, resource, day, until, draftTasks, others }));
}

/** Working days of the draft (for the "N days" hint), counting only the draft's own calendar. */
export function draftWorkdays(window: { start: string; end: string } | null, cal: WorkCalendar): number {
  if (!window) return 0;
  let n = 0;
  for (let d = window.start; d <= window.end; d = addDays(d, 1)) if (isWorkday(d, cal)) n++;
  return n;
}
