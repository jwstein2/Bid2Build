/**
 * V7.3 Contractors & Workforce pure logic: search ("electrician" finds Red's Electric), trade filter,
 * company → worker relationships, bookings, lifecycle, availability (unknown capacity stays unknown),
 * conflict detection (each pair once, times of day respected), assign-flow guards.
 */
import { describe, expect, it } from "vitest";
import {
  availabilityOf, bookingsFor, buildEntries, conflictsFor, DEFAULT_DIR_FILTERS, describeConflict, filterEntries, lifecycleOf, mapTargets, mapWorkforce,
  matchesQuery, pickProblems, rankTasks, relationshipLabel, searchProjects, sectionCounts, sectionOf, stem, summarize, type Workforce,
} from "@/lib/workforce/model";

const TODAY = "2026-11-18";
const res = (o: Record<string, unknown>) => ({ kind: "subcontractor", trades: [], specialties: [], unavailable: [], members: [], status: "active", capacity: 1, ...o });
const asg = (o: Record<string, unknown>) => ({ kind: "section", taskStatus: "not_started", status: "tentative", projectStatus: "active", customer: "Pat", revision: 1, ...o });

function fixture(): Workforce {
  return mapWorkforce({
    companyId: "c1", me: "u1", canManage: true,
    resources: [
      res({ id: "reds", name: "Red's Electric", entity: "company", trades: ["electrical", "low voltage"], specialties: ["Panel upgrades"] }),
      res({ id: "ea", name: "Electrician A", entity: "individual", parentId: "reds", trades: ["electrical"] }),
      res({ id: "eb", name: "Electrician B", entity: "individual", parentId: "reds", trades: ["electrical"] }),
      res({ id: "paint", name: "Bright Painting", entity: "company", trades: ["painting"], capacity: 2, capacityDeclared: true }),
      res({ id: "kim", name: "Kim Lee", entity: "individual", trades: ["painting"], unavailable: ["2026-11-20"] }),
      res({ id: "jo", name: "Jo Staff", kind: "staff", trades: ["general"], linkedUserId: "u2" }),
      res({ id: "crew1", name: "Concrete Crew 1", kind: "crew", trades: ["concrete"], members: ["jo"], capacityDeclared: true }),
      res({ id: "old", name: "Old Sub", status: "archived" }),
      res({ id: "legacy", name: "Legacy Sub", entity: null, trades: ["roofing"] }),
    ],
    assignments: [
      asg({ taskId: "t1", scheduleId: "s1", task: "Rough-in", start: "2026-11-16", end: "2026-11-20", resourceId: "ea", status: "confirmed", project: "Maple St", customer: "Garcia", trade: "electrical" }),
      asg({ taskId: "t2", scheduleId: "s2", task: "Rough-in", start: "2026-11-19", end: "2026-11-21", resourceId: "ea", project: "Oak Ave", customer: "Nguyen", trade: "electrical" }),
      asg({ taskId: "t3", scheduleId: "s3", task: "Service", start: "2026-12-01", end: "2026-12-02", resourceId: "reds", project: "Pine Rd", customer: "Smith" }),
      asg({ taskId: "t4", scheduleId: "s4", task: "Walls", start: "2026-11-10", end: "2026-11-12", resourceId: "kim", taskStatus: "complete", project: "Birch Ln" }),
      asg({ taskId: "t5", scheduleId: "s5", task: "Flatwork", start: "2026-11-18", end: "2026-11-19", resourceId: "crew1", status: "confirmed", project: "Driveway" }),
      asg({ taskId: "t6", scheduleId: "s6", task: "Patio", start: "2026-11-18", end: "2026-11-18", resourceId: "jo", project: "Patio job" }),
      asg({ taskId: "t7", scheduleId: "s7", task: "AM", start: "2026-11-24", end: "2026-11-24", resourceId: "kim", startTime: "07:00:00", endTime: "11:00:00", project: "AM job" }),
      asg({ taskId: "t8", scheduleId: "s8", task: "PM", start: "2026-11-24", end: "2026-11-24", resourceId: "kim", startTime: "12:00", endTime: "16:00", project: "PM job" }),
      asg({ taskId: "t9", scheduleId: "s9", task: "Cancelled", start: "2026-11-24", end: "2026-11-24", resourceId: "kim", status: "cancelled", project: "Gone job" }),
    ],
  });
}

describe("search and filters", () => {
  const wf = fixture();
  const entries = buildEntries(wf, TODAY);
  const names = (f: Partial<typeof DEFAULT_DIR_FILTERS>) => filterEntries(entries, { ...DEFAULT_DIR_FILTERS, ...f }).map((e) => e.r.name);

  it("stems trade words so 'electrician' finds electrical companies and workers", () => {
    expect(stem("electrician")).toBe(stem("electrical"));
    expect(stem("painter")).toBe(stem("painting"));
    expect(stem("plumber")).toBe(stem("plumbing"));
    expect(names({ q: "Electrician" })).toEqual(["Electrician A", "Electrician B", "Red's Electric"]);
    expect(names({ q: "painter" })).toEqual(["Bright Painting", "Kim Lee"]);
  });

  it("finds by company, specialty, assigned customer, project and status", () => {
    expect(names({ q: "red's" })).toContain("Electrician A"); // worker found by their company
    expect(names({ q: "panel upgrades" })).toEqual(["Red's Electric"]);
    expect(names({ q: "garcia" })).toEqual(["Electrician A", "Red's Electric"]); // company sees its workers' jobs
    expect(names({ q: "oak ave" })).toEqual(["Electrician A", "Red's Electric"]);
    expect(names({ q: "completed" })).toEqual(["Kim Lee"]);
    expect(names({ q: "zzz" })).toEqual([]);
  });

  it("filters by section, trade, assignment and archived; counts sections", () => {
    expect(names({ section: "companies" })).toEqual(["Bright Painting", "Legacy Sub", "Red's Electric"]);
    expect(names({ section: "individuals" })).toEqual(["Electrician A", "Electrician B", "Kim Lee"]);
    expect(names({ section: "employees" })).toEqual(["Jo Staff"]);
    expect(names({ section: "crews" })).toEqual(["Concrete Crew 1"]);
    expect(names({ trade: "painting" })).toEqual(["Bright Painting", "Kim Lee"]);
    expect(names({ assigned: "free" })).toEqual(["Bright Painting", "Electrician B", "Legacy Sub"]);
    expect(names({ archived: true })).toEqual(["Old Sub"]);
    expect(sectionCounts(entries, false)).toEqual({ all: 8, companies: 3, individuals: 3, employees: 1, crews: 1 });
    expect(names({ sort: "busiest" })[0]).toBe("Red's Electric"); // 3 bookings incl. its workers'
  });

  it("matchesQuery needs every word", () => {
    expect(matchesQuery("red's electric electrical maple st", "electric maple")).toBe(true);
    expect(matchesQuery("red's electric electrical maple st", "electric oak")).toBe(false);
  });
});

describe("relationships and bookings", () => {
  const wf = fixture();
  const R = (id: string) => wf.resources.find((r) => r.id === id)!;

  it("labels sections and relationships; legacy subs without an entity sit with companies", () => {
    expect(sectionOf(R("legacy"))).toBe("companies");
    expect(relationshipLabel(R("ea"), R("reds"))).toBe("Worker at Red's Electric");
    expect(relationshipLabel(R("jo"), null)).toBe("Employee · Built2Bid user");
  });

  it("a company shows its own and its workers' bookings; a person shows their crews'", () => {
    expect(bookingsFor(wf, R("reds"), TODAY).map((b) => [b.taskId, b.via?.name ?? null])).toEqual([["t1", "Electrician A"], ["t2", "Electrician A"], ["t3", null]]);
    expect(bookingsFor(wf, R("jo"), TODAY).map((b) => [b.taskId, b.via?.relation ?? null])).toEqual([["t5", "crew"], ["t6", null]]);
  });

  it("derives lifecycle from the task: planned, confirmed, in progress, completed, cancelled", () => {
    const base = { taskStatus: "not_started", projectStatus: "active", start: "2026-11-25", end: "2026-11-26" };
    expect(lifecycleOf({ ...base, status: "tentative" }, TODAY)).toBe("planned");
    expect(lifecycleOf({ ...base, status: "requested" }, TODAY)).toBe("planned");
    expect(lifecycleOf({ ...base, status: "confirmed" }, TODAY)).toBe("confirmed");
    expect(lifecycleOf({ ...base, status: "confirmed", start: "2026-11-17" }, TODAY)).toBe("in_progress");
    expect(lifecycleOf({ ...base, status: "tentative", taskStatus: "in_progress" }, TODAY)).toBe("in_progress");
    expect(lifecycleOf({ ...base, status: "confirmed", taskStatus: "complete" }, TODAY)).toBe("completed");
    expect(lifecycleOf({ ...base, status: "cancelled" }, TODAY)).toBe("cancelled");
    expect(lifecycleOf({ ...base, status: "declined" }, TODAY)).toBe("cancelled");
  });

  it("card summary counts active, upcoming and completed work and the next job", () => {
    const s = summarize(wf, R("ea"), TODAY);
    expect([s.active, s.upcoming]).toEqual([1, 1]);
    expect(s.next?.project).toBe("Maple St");
    expect(s.projects).toEqual(["Maple St", "Oak Ave"]);
    expect(summarize(wf, R("kim"), TODAY).completed).toBe(1);
  });
});

describe("availability and conflicts", () => {
  const wf = fixture();
  const R = (id: string) => wf.resources.find((r) => r.id === id)!;

  it("a company without a stated capacity is 'unknown', never 'unavailable'", () => {
    const a = availabilityOf(R("reds"), bookingsFor(wf, R("reds"), TODAY), TODAY);
    expect(a.state).toBe("unknown");
    expect(a.detail).toBe("1 job today");
    expect(conflictsFor(wf, R("reds"), TODAY)).toEqual([]);
  });

  it("individuals: booked today, off days, free", () => {
    expect(availabilityOf(R("ea"), bookingsFor(wf, R("ea"), TODAY), TODAY).state).toBe("busy");
    expect(availabilityOf(R("kim"), bookingsFor(wf, R("kim"), "2026-11-20"), "2026-11-20").state).toBe("off");
    expect(availabilityOf(R("eb"), [], TODAY)).toEqual({ state: "available", label: "Available", detail: null });
  });

  it("a person on two projects at once is one conflict (not one per day or per side)", () => {
    const c = conflictsFor(wf, R("ea"), TODAY);
    expect(c).toHaveLength(1);
    expect([c[0].from, c[0].to]).toEqual(["2026-11-19", "2026-11-20"]);
    // Jo is on a crew job and a direct job the same day.
    expect(conflictsFor(wf, R("jo"), TODAY)).toHaveLength(1);
    expect(summarize(wf, R("ea"), TODAY).conflicts).toBe(1);
  });

  it("times of day that don't overlap and cancelled bookings aren't conflicts", () => {
    expect(conflictsFor(wf, R("kim"), TODAY)).toEqual([]);
  });

  it("stated company capacity: over it is a possible overbooking", () => {
    const over = mapWorkforce({ ...fixture(), assignments: [
      asg({ taskId: "a", scheduleId: "p1", task: "x", start: "2026-12-01", end: "2026-12-03", resourceId: "paint", project: "P1" }),
      asg({ taskId: "b", scheduleId: "p2", task: "x", start: "2026-12-02", end: "2026-12-04", resourceId: "paint", project: "P2" }),
      asg({ taskId: "c", scheduleId: "p3", task: "x", start: "2026-12-02", end: "2026-12-03", resourceId: "paint", project: "P3" }),
    ] });
    const c = conflictsFor(over, over.resources.find((r) => r.id === "paint")!, TODAY);
    expect(c.map((x) => [x.kind, x.from, x.to])).toEqual([["possible_overbooking", "2026-12-02", "2026-12-03"]]);
  });
});

describe("assign flow helpers", () => {
  const targets = mapTargets([
    { id: "s1", name: "Maple St", status: "active", revision: 3, startDate: "2026-11-16", customer: "Garcia", canEdit: true, tasks: [
      { id: "sec", kind: "section", name: "Electrical", start: "2026-11-16", end: "2026-11-20", status: "not_started", trade: "electrical" },
      { id: "it", parentId: "sec", kind: "item", name: "Rough-in", start: "2026-11-16", end: "2026-11-17", status: "not_started" },
      { id: "pt", kind: "section", name: "Painting", start: "2026-11-21", end: "2026-11-22", status: "not_started", trade: "painting", resourceId: "kim", assignee: "Kim" },
      { id: "dn", kind: "section", name: "Demo", start: "2026-11-01", end: "2026-11-02", status: "complete", trade: "demolition" },
    ] },
    { id: "s2", name: "Locked Job", status: "active", revision: 1, startDate: "2026-12-01", customer: "Ito", canEdit: false, tasks: [] },
  ]);

  it("ranks matching sections first, leaves out completed ones, and searches projects", () => {
    const r = rankTasks(targets[0], { trades: ["electrical"] });
    expect(r.match.map((t) => t.id)).toEqual(["sec", "it"]);
    expect(r.others.map((t) => t.id)).toEqual(["pt"]);
    expect(searchProjects(targets, "garcia").map((p) => p.id)).toEqual(["s1"]);
    expect(searchProjects(targets, "").map((p) => p.id)).toEqual(["s1", "s2"]); // editable first
  });

  it("blocks the same task twice, the same person twice, and missing picks", () => {
    expect(pickProblems([{ resourceId: "a", taskId: "x" }, { resourceId: "b", taskId: "y" }])).toEqual([]);
    expect(pickProblems([{ resourceId: "a", taskId: "x" }, { resourceId: "b", taskId: "x" }])[0]).toMatch(/same section/);
    expect(pickProblems([{ resourceId: "a", taskId: "x" }, { resourceId: "a", taskId: "y" }])[0]).toMatch(/twice/);
    expect(pickProblems([{ resourceId: "a", taskId: null }])[0]).toMatch(/Pick/);
  });

  it("describes server conflicts; unknown capacity is information, not a warning", () => {
    expect(describeConflict({ kind: "double_booked", resource: "Jo", resourceId: "jo", tasks: [{ taskId: "t", project: "Maple St", task: "x", start: "2026-12-01", end: "2026-12-02", via: null }] }))
      .toEqual({ text: "Jo is already booked on Maple St (2026-12-01 to 2026-12-02).", warn: true });
    expect(describeConflict({ kind: "capacity_unknown", resource: "Red's", resourceId: "r", jobs: 2, tasks: [] }).warn).toBe(false);
  });
});
