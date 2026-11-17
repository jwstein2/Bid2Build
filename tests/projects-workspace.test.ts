import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS, bucketOf, cleanFilters, filterWorkspace, findResourceConflicts, isOverviewFocus, mapWorkspace, matchesFocus, monthGrid, myTasks, nextAction, overviewMetrics,
  projectHue, projectWarning, sortProjects, workloadRows, type Workspace, type WsProject, type WsTask,
} from "@/lib/projects/workspace";

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const perms = (edit = true) => ({ edit, progress: edit, dependencies: edit, publish: edit, pdf: true });
const proj = (id: string, o: Record<string, unknown> = {}) => ({
  id, estimate_id: `e-${id}`, company_id: "c1", name: `Job ${id}`, status: "active", provisional: false, start_date: "2026-11-16", target_end_date: null,
  actual_finish: null, revision: 1, sales_rep_id: "rep1", project_manager_id: "pm1", created_by: "rep1", owner_id: "rep1", customer_name: `Cust ${id}`,
  trades: ["siding"], calendar: CAL, finish_date: "2026-11-27", tasks_total: 2, tasks_done: 0, tasks_delayed: 0, tasks_overdue: 0, progress: 10,
  last_update_at: null, last_change_at: "2026-11-15T00:00:00Z", permissions: perms(), ...o,
});
const task = (id: string, sid: string, start: string, end: string, o: Record<string, unknown> = {}) => ({
  id, schedule_id: sid, parent_id: null, kind: "section", name: id, sort_order: 0, planned_start: start, planned_end: end, duration_days: 3,
  actual_start: null, actual_finish: null, percent_complete: 0, status: "not_started", assignee: null, section_trade: "siding", ...o,
});
const ws = (projects: object[], tasks: object[] = [], me = "rep1"): Workspace => mapWorkspace({
  me, from: "2026-11-01", to: "2026-12-31", people: [{ id: "rep1", name: "Riley", role: "estimator" }, { id: "pm1", name: "Pat PM", role: "manager" }, { id: "rep2", name: "Sam", role: "estimator" }],
  projects, tasks, deps: [],
});

describe("filters", () => {
  const w = ws([proj("a"), proj("b", { sales_rep_id: "rep2", project_manager_id: null }), proj("c", { status: "completed", actual_finish: "2026-11-10" }), proj("d", { start_date: "2026-12-10", trades: ["roofing"] })]);
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) => filterWorkspace(w, { ...DEFAULT_FILTERS, ...f }, "2026-11-20").projects.map((p) => p.id);
  it("salesperson and PM are separate filters", () => {
    expect(ids({ rep: "mine" })).toEqual(["a", "d"]);
    expect(ids({ rep: "rep2" })).toEqual(["b"]);
    expect(ids({ pm: "pm1" })).toEqual(["a", "d"]);
    expect(ids({ pm: "none" })).toEqual(["b"]);
  });
  it("status, trade and project filters", () => {
    expect(ids({})).toEqual(["a", "b", "d"]);
    expect(ids({ status: "completed" })).toEqual(["c"]);
    expect(ids({ status: "scheduled" })).toEqual(["d"]);
    expect(ids({ status: "all" })).toHaveLength(4);
    expect(ids({ trade: "roofing" })).toEqual(["d"]);
    expect(ids({ project: "b" })).toEqual(["b"]);
  });
  it("saved filters with unknown ids fall back to all (can't reach other data)", () => {
    expect(cleanFilters({ rep: "someone-else", project: "x", status: "bogus" as never }, w)).toEqual(DEFAULT_FILTERS);
    expect(cleanFilters({ pm: "pm1" }, w).pm).toBe("pm1");
  });
});

describe("overview", () => {
  it("metrics use real task states, not elapsed time", () => {
    const w = ws([proj("a", { tasks_delayed: 1 }), proj("b", { start_date: "2026-11-25" }), proj("c", { status: "completed", actual_finish: "2026-11-12" }), proj("d", { last_update_at: "2026-11-16T00:00:00Z" })]);
    expect(overviewMetrics(w.projects, "2026-11-20", "2026-11-01")).toEqual({ active: 3, startingSoon: 1, delayed: 1, needsUpdate: 2, completed: 1 });
  });
  it("warnings and next actions respect permissions", () => {
    const [a, b] = ws([proj("a", { tasks_overdue: 2 }), proj("b", { permissions: perms(false), last_update_at: "2026-11-20T00:00:00Z" })]).projects;
    expect(projectWarning(a, "2026-11-20")).toBe("2 tasks past planned finish");
    expect(nextAction(a, "2026-11-20")).toBe("update_progress");
    expect(nextAction(b, "2026-11-20")).toBe("view");
    const done = ws([proj("x", { tasks_done: 2 })]).projects[0];
    expect(nextAction(done, "2026-11-20")).toBe("close_out");
  });
  it("table sorts by any column", () => {
    const list = ws([proj("a", { progress: 50 }), proj("b", { progress: 5 })]).projects;
    expect(sortProjects(list, "progress", 1, () => "").map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("project colors are stable", () => {
    expect(projectHue("abc")).toBe(projectHue("abc"));
  });
});

describe("calendar", () => {
  it("month grid covers whole weeks without time-zone drift", () => {
    const g = monthGrid("2026-11-16");
    expect(g[0]).toBe("2026-11-01"); // Sunday
    expect(g.length % 7).toBe(0);
    expect(g).toContain("2026-11-30");
    // DST ends Nov 1 2026 in the US: date-only math must not skip or repeat a day.
    expect(new Set(g).size).toBe(g.length);
  });
});

describe("workload and conflicts", () => {
  const projects = [proj("a"), proj("b")];
  it("same crew on two jobs at once is a conflict; overlapping work in one project or unassigned work is not", () => {
    const w = ws(projects, [
      task("a1", "a", "2026-11-16", "2026-11-18", { assignee: "Crew A" }),
      task("a2", "a", "2026-11-16", "2026-11-18", { assignee: "Crew A" }),
      task("b1", "b", "2026-11-18", "2026-11-20", { assignee: "crew a" }),
      task("b2", "b", "2026-11-16", "2026-11-20"),
    ]);
    const c = findResourceConflicts(w.tasks, w.projects, []);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ day: "2026-11-18", until: "2026-11-18", kind: "double_booked" });
    expect(c[0].tasks.map((t) => t.id).sort()).toEqual(["a1", "a2", "b1"]);
  });
  it("declared capacity and unavailable days are respected; weekends don't count", () => {
    const w = ws(projects, [
      task("a1", "a", "2026-11-20", "2026-11-23", { resource_id: "r1" }),
      task("b1", "b", "2026-11-20", "2026-11-23", { resource_id: "r1" }),
    ]);
    expect(findResourceConflicts(w.tasks, w.projects, [{ key: "r:r1", label: "Big crew", kind: "crew", capacity: 2 }])).toEqual([]);
    const c = findResourceConflicts(w.tasks, w.projects, [{ key: "r:r1", label: "Alex", kind: "staff", unavailable: ["2026-11-23"] }]);
    expect(c.map((x) => x.kind)).toEqual(["double_booked", "unavailable"]);
    expect(c[0].day).toBe("2026-11-20"); // Sat/Sun skipped
  });
  it("crew members booked elsewhere are caught", () => {
    const w = ws(projects, [task("a1", "a", "2026-11-16", "2026-11-16", { resource_id: "crew" }), task("b1", "b", "2026-11-16", "2026-11-16", { resource_id: "alex" })]);
    const c = findResourceConflicts(w.tasks, w.projects, [{ key: "r:crew", label: "Crew", kind: "crew", members: ["r:alex"] }, { key: "r:alex", label: "Alex", kind: "staff" }]);
    expect(c.map((x) => x.resource)).toEqual(["Alex"]);
  });
  it("workload shows booked days, and utilization only when capacity is declared", () => {
    const w = ws(projects, [task("a1", "a", "2026-11-16", "2026-11-20", { resource_id: "r1" }), task("b1", "b", "2026-11-16", "2026-11-17")]);
    const rows = workloadRows(w.tasks, w.projects, [{ key: "r:r1", label: "Alex", kind: "staff" }], "2026-11-16", "2026-11-22");
    expect(rows[0]).toMatchObject({ label: "Alex", days: 5, projects: 1, capacityDays: null });
    expect(rows.at(-1)).toMatchObject({ key: "unassigned", days: 2 });
    const cap = workloadRows(w.tasks, w.projects, [{ key: "r:r1", label: "Alex", kind: "staff", capacity: 1 }], "2026-11-16", "2026-11-22");
    expect(cap[0].capacityDays).toBe(5);
  });
});

describe("my work", () => {
  it("buckets by explicit status and dates; completion is never inferred", () => {
    const t = (o: Partial<WsTask>) => ({ plannedStart: "2026-11-10", plannedEnd: "2026-11-12", status: "not_started", ...o }) as WsTask;
    expect(bucketOf(t({}), "2026-11-20")).toBe("overdue");
    expect(bucketOf(t({ status: "complete" }), "2026-11-20")).toBe("completed");
    expect(bucketOf(t({ plannedStart: "2026-11-20", plannedEnd: "2026-11-25" }), "2026-11-20")).toBe("today");
    expect(bucketOf(t({ plannedStart: "2026-11-24", plannedEnd: "2026-11-25" }), "2026-11-20")).toBe("week");
    expect(bucketOf(t({ plannedStart: "2026-12-24", plannedEnd: "2026-12-25" }), "2026-11-20")).toBe("upcoming");
  });
  it("includes my assignments and projects I manage", () => {
    const w = ws([proj("a", { project_manager_id: "me" }), proj("b", { project_manager_id: "x" })], [
      task("a1", "a", "2026-11-20", "2026-11-21"), task("b1", "b", "2026-11-20", "2026-11-21", { assignee: "Jo Smith" }), task("b2", "b", "2026-11-20", "2026-11-21", { resource_id: "r9" }), task("b3", "b", "2026-11-20", "2026-11-21"),
    ], "me");
    const m = myTasks(w, "jo smith", ["r:r9"], "2026-11-20");
    expect(m.today.map((x) => x.id).sort()).toEqual(["a1", "b1", "b2"]);
  });
  it("types line up", () => {
    const p: WsProject = ws([proj("a")]).projects[0];
    expect(p.calendar.workdays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("overview KPI drilldowns", () => {
  it("each card's filter lists exactly the projects it counts", () => {
    const w = ws([proj("a", { tasks_delayed: 1 }), proj("b", { start_date: "2026-11-25" }), proj("c", { status: "completed", actual_finish: "2026-11-12" }), proj("d", { last_update_at: "2026-11-16T00:00:00Z" }), proj("e", { status: "completed", actual_finish: "2026-10-01" })]);
    const m = overviewMetrics(w.projects, "2026-11-20", "2026-11-01");
    const n = (f: Parameters<typeof matchesFocus>[1]) => w.projects.filter((p) => matchesFocus(p, f, "2026-11-20", "2026-11-01")).length;
    expect({ active: n("active"), startingSoon: n("starting"), delayed: n("delayed"), needsUpdate: n("update"), completed: n("completed") }).toEqual(m);
  });
  it("validates the ?focus= value", () => {
    expect(isOverviewFocus("delayed")).toBe(true);
    expect(isOverviewFocus("toString")).toBe(false);
    expect(isOverviewFocus(null)).toBe(false);
  });
});
