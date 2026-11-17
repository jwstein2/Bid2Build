import { describe, expect, it } from "vitest";
import { mapWorkspace } from "@/lib/projects/workspace";
import { toResourceRefs, type Team } from "@/lib/projects/team";
import { DRAFT_ID, draftConflicts, draftTasks, draftWindow, draftWorkdays, overlappingProjects } from "@/lib/schedule/draft-overlay";

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const perms = { edit: true, progress: true, dependencies: true, publish: true, pdf: true };
const proj = (id: string, o: Record<string, unknown> = {}) => ({
  id, estimate_id: `e-${id}`, company_id: "c1", name: `Job ${id}`, status: "active", provisional: false, start_date: "2026-12-01", target_end_date: null,
  actual_finish: null, revision: 1, sales_rep_id: null, project_manager_id: null, created_by: null, owner_id: "u1", customer_name: `Cust ${id}`,
  trades: ["siding"], calendar: CAL, finish_date: null, tasks_total: 1, tasks_done: 0, tasks_delayed: 0, tasks_overdue: 0, progress: 0,
  last_update_at: null, last_change_at: "2026-11-15T00:00:00Z", permissions: perms, ...o,
});
const task = (id: string, sid: string, start: string, end: string, o: Record<string, unknown> = {}) => ({
  id, schedule_id: sid, parent_id: null, kind: "section", name: id, sort_order: 0, planned_start: start, planned_end: end, duration_days: 3,
  actual_start: null, actual_finish: null, percent_complete: 0, status: "not_started", assignee: null, section_trade: "siding", ...o,
});
const ws = mapWorkspace({
  me: "u1", from: "2026-11-01", to: "2027-01-31", people: [],
  projects: [proj("a"), proj("b"), proj("old", { status: "completed" }), proj("arch", { status: "archived" })],
  tasks: [
    task("a1", "a", "2026-12-01", "2026-12-04", { resource_id: "crewB" }),
    task("a2", "a", "2026-12-14", "2026-12-18"),
    task("b1", "b", "2026-12-08", "2026-12-09", { resource_id: "sub1" }),
    task("b2", "b", "2026-12-03", "2026-12-03", { status: "complete", resource_id: "crewB" }),
    task("o1", "old", "2026-12-02", "2026-12-05"),
    task("x1", "arch", "2026-12-02", "2026-12-05"),
  ],
  deps: [],
});
// mapWorkspace leaves resourceId to the assignments RPC; set it like loadWorkspace does.
for (const t of ws.tasks) t.resourceId = ({ a1: "crewB", b1: "sub1", b2: "crewB" } as Record<string, string>)[t.id] ?? null;

const team = (capacity = 1): Team => ({
  companyId: "c1", canManage: true,
  resources: [
    { id: "crewB", kind: "crew", name: "Crew B", contactName: null, linkedUserId: null, trades: [], email: null, phone: null, notes: null, capacity, unavailable: [], status: "active", members: ["pat"] },
    { id: "pat", kind: "staff", name: "Pat", contactName: null, linkedUserId: null, trades: [], email: null, phone: null, notes: null, capacity: 1, unavailable: ["2026-12-04"], status: "active", members: [] },
    { id: "sub1", kind: "subcontractor", name: "Stone Works", contactName: null, linkedUserId: null, trades: [], email: null, phone: null, notes: null, capacity: 1, unavailable: [], status: "active", members: [] },
  ],
});
const plan = [
  { key: "s1", name: "Tear-off", trade: "roofing", plannedStart: "2026-12-02", plannedEnd: "2026-12-03", durationDays: 2 },
  { key: "s2", name: "Install", trade: "roofing", plannedStart: "2026-12-04", plannedEnd: "2026-12-09", durationDays: 4 },
];

describe("draft overlay", () => {
  it("turns the unsaved plan into draft tasks with assignments, never a real schedule id", () => {
    const d = draftTasks(plan, { s2: { resourceId: "sub1" } });
    expect(d.map((t) => [t.id, t.scheduleId, t.resourceId])).toEqual([["draft:s1", DRAFT_ID, null], ["draft:s2", DRAFT_ID, "sub1"]]);
    expect(draftWindow(plan)).toEqual({ start: "2026-12-02", end: "2026-12-09" });
    expect(draftWindow([])).toBeNull();
    expect(draftWorkdays(draftWindow(plan), CAL)).toBe(6);
  });

  it("lists other live projects inside the draft dates, clipped to the window", () => {
    const o = overlappingProjects(draftWindow(plan), ws.projects, ws.tasks);
    // a (Dec 1-4 overlaps) and b (Dec 8-9); completed tasks, completed and archived projects are left out.
    expect(o.map((x) => [x.project.id, x.from, x.to, x.tasks.length])).toEqual([["a", "2026-12-02", "2026-12-04", 1], ["b", "2026-12-08", "2026-12-09", 1]]);
    expect(overlappingProjects(null, ws.projects, ws.tasks)).toEqual([]);
  });

  it("no assignments means no conflicts, only overlap", () => {
    expect(draftConflicts(draftTasks(plan, {}), CAL, ws.projects, ws.tasks, toResourceRefs(team()))).toEqual([]);
  });

  it("same crew on overlapping days is a POSSIBLE conflict when capacity isn't declared", () => {
    const c = draftConflicts(draftTasks(plan, { s1: { resourceId: "crewB" } }), CAL, ws.projects, ws.tasks, toResourceRefs(team(1)));
    const crew = c.filter((x) => x.resource === "Crew B");
    expect(crew).toHaveLength(1);
    expect(crew[0]).toMatchObject({ certainty: "possible", kind: "double_booked", day: "2026-12-02", until: "2026-12-03", draftTasks: ["Tear-off"] });
    expect(crew[0].others).toEqual([{ name: "a1", projectName: "Job a" }]);
    // Pat clashes only through Crew B, so there's no second card for Pat; the two days are one card.
    expect(c.filter((x) => x.resource === "Pat" && x.kind === "double_booked")).toEqual([]);
  });

  it("capacity 2 allows two jobs; a raised capacity that is still exceeded is confirmed", () => {
    const refs = toResourceRefs(team(2));
    expect(draftConflicts(draftTasks(plan, { s1: { resourceId: "crewB" } }), CAL, ws.projects, ws.tasks, refs).filter((x) => x.resource === "Crew B")).toEqual([]);
    // Conflicts count jobs, not sections: the draft, b1 and a third job on Dec 8-9 exceed a capacity of 2.
    const c3 = mapWorkspace({ me: "u1", from: "2026-11-01", to: "2027-01-31", people: [], projects: [proj("c")], tasks: [task("c1", "c", "2026-12-08", "2026-12-08")], deps: [] });
    c3.tasks[0].resourceId = "sub1";
    const refs2 = toResourceRefs({ ...team(), resources: team().resources.map((r) => (r.id === "sub1" ? { ...r, capacity: 2 } : r)) });
    const c = draftConflicts(draftTasks(plan, { s2: { resourceId: "sub1" } }), CAL, [...ws.projects, ...c3.projects], [...ws.tasks, ...c3.tasks], refs2);
    expect(c).toEqual([expect.objectContaining({ certainty: "confirmed", resource: "Stone Works", day: "2026-12-08", until: "2026-12-08" })]);
    // Left at the default capacity, the same overlap is only possible.
    const p = draftConflicts(draftTasks(plan, { s2: { resourceId: "sub1" } }), CAL, ws.projects, ws.tasks, toResourceRefs(team()));
    expect(p).toEqual([expect.objectContaining({ certainty: "possible", resource: "Stone Works" })]);
  });

  it("a crew member's unavailable day is a confirmed conflict", () => {
    const c = draftConflicts(draftTasks(plan, { s2: { resourceId: "crewB" } }), CAL, ws.projects, ws.tasks, toResourceRefs(team()));
    expect(c.some((x) => x.kind === "unavailable" && x.certainty === "confirmed" && x.resource === "Pat" && x.day === "2026-12-04")).toBe(true);
  });

  it("an older task that names the crew in free text still counts as that crew", () => {
    const legacy = ws.tasks.map((t) => (t.id === "a1" ? { ...t, resourceId: null, assignee: "crew b" } : t));
    const c = draftConflicts(draftTasks(plan, { s1: { resourceId: "crewB" } }), CAL, ws.projects, legacy, toResourceRefs(team()));
    expect(c.filter((x) => x.resource === "Crew B").map((x) => x.others)).toEqual([[{ name: "a1", projectName: "Job a" }]]);
  });

  it("weekends are not counted against the draft", () => {
    const weekend = [{ key: "s1", name: "Tear-off", trade: null, plannedStart: "2026-12-05", plannedEnd: "2026-12-06", durationDays: 0 }];
    expect(draftConflicts(draftTasks(weekend, { s1: { resourceId: "crewB" } }), CAL, ws.projects, ws.tasks, toResourceRefs(team()))).toEqual([]);
  });
});
