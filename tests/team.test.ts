import { describe, expect, it } from "vitest";
import { assignmentNotice, busyElsewhere, mapTeam, myResourceKeys, reportAssignee, suggestFor, toResourceRefs, type TeamResource } from "@/lib/projects/team";
import { findResourceConflicts, type WsProject, type WsTask } from "@/lib/projects/workspace";

const res = (o: Partial<TeamResource> & { id: string; name: string }): TeamResource => ({
  kind: "subcontractor", contactName: null, linkedUserId: null, trades: [], email: null, phone: null, notes: null, capacity: 1, unavailable: [], status: "active", members: [], ...o,
});
const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const proj = (id: string): WsProject => ({
  id, estimateId: id, companyId: null, name: `P ${id}`, status: "active", provisional: false, startDate: "2026-11-16", targetEndDate: null, actualFinish: null, revision: 1,
  salesRepId: null, projectManagerId: null, createdBy: null, ownerId: "u", customerName: "", trades: [], calendar: CAL, finishDate: null, tasksTotal: 1, tasksDone: 0,
  tasksDelayed: 0, tasksOverdue: 0, progress: 0, lastUpdateAt: null, lastChangeAt: "2026-11-16", permissions: { edit: true, progress: true, dependencies: true, publish: true, pdf: true },
});
const task = (id: string, scheduleId: string, start: string, end: string, resourceId: string | null): WsTask => ({
  id, scheduleId, parentId: null, kind: "section", name: id, sortOrder: 0, plannedStart: start, plannedEnd: end, durationDays: 1, actualStart: null, actualFinish: null,
  percentComplete: 0, status: "not_started", assignee: null, trade: null, resourceId,
});

describe("Team & Subcontractors helpers", () => {
  it("maps the RPC payload defensively", () => {
    const t = mapTeam({ companyId: null, canManage: true, resources: [{ id: "a", kind: "weird", name: "X", trades: ["tile", 3], capacity: "2", status: "archived" }] });
    expect(t.canManage).toBe(true);
    expect(t.resources[0]).toMatchObject({ kind: "staff", trades: ["tile"], capacity: 2, status: "archived" });
  });

  it("suggests trade matches first (subs and crews before staff) and never hides anyone", () => {
    const list = [res({ id: "1", name: "Zed Tile", trades: ["tile"] }), res({ id: "2", name: "Amy", kind: "staff", trades: ["tile"] }), res({ id: "3", name: "Bob Roofing", trades: ["roofing"] }),
      res({ id: "4", name: "Old Tile", trades: ["tile"], status: "archived" })];
    const s = suggestFor(list, "Tile");
    expect(s.match.map((r) => r.name)).toEqual(["Zed Tile", "Amy"]);
    expect(s.others.map((r) => r.name)).toEqual(["Bob Roofing"]);
    expect(suggestFor(list, "kitchen_remodel").match).toEqual([]);
    expect(suggestFor([res({ id: "5", name: "K", trades: ["kitchen remodel"] })], "kitchen_remodel").match.length).toBe(1);
    // The section name helps when the project trade is broad.
    expect(suggestFor([res({ id: "6", name: "Stone", trades: ["countertops"] }), res({ id: "7", name: "Roofer", trades: ["roofing"] })], "kitchen-remodeling", "Countertops").match.map((r) => r.name)).toEqual(["Stone"]);
    expect(suggestFor([res({ id: "8", name: "Tops", trades: ["countertop"] })], null, "Countertops").match.length).toBe(1);
  });

  it("crew members count for double-booking across projects; capacity is respected", () => {
    const team = mapTeam({ resources: [
      { id: "crew", kind: "crew", name: "Crew A", members: ["al"], capacity: 1 }, { id: "al", kind: "staff", name: "Al" },
      { id: "big", kind: "crew", name: "Big Crew", capacity: 2 },
    ] });
    const refs = toResourceRefs(team);
    const projects = [proj("p1"), proj("p2")];
    const c = findResourceConflicts([task("t1", "p1", "2026-11-17", "2026-11-18", "crew"), task("t2", "p2", "2026-11-18", "2026-11-19", "al")], projects, refs);
    expect(c.map((x) => [x.resource, x.day])).toEqual([["Al", "2026-11-18"]]);
    expect(findResourceConflicts([task("a", "p1", "2026-11-17", "2026-11-17", "big"), task("b", "p2", "2026-11-17", "2026-11-17", "big")], projects, refs)).toEqual([]);
  });

  it("My Work includes linked staff and their crews; busy hints skip this project and completed work", () => {
    const team = mapTeam({ resources: [{ id: "me", kind: "staff", name: "Me", linkedUserId: "u1" }, { id: "c", kind: "crew", name: "C", members: ["me"] }, { id: "x", kind: "crew", name: "X" }] });
    expect(myResourceKeys(team, "u1")).toEqual(["r:me", "r:c"]);
    expect(myResourceKeys(team, null)).toEqual([]);
    const done = { ...task("d", "p2", "2026-11-17", "2026-11-17", "me"), status: "complete" as const };
    const busy = busyElsewhere([task("a", "p1", "2026-11-17", "2026-11-17", "me"), task("b", "p2", "2026-11-17", "2026-11-20", "me"), done], "me", "p1", "2026-11-16", "2026-11-18");
    expect(busy.map((t) => t.id)).toEqual(["b"]);
  });

  it("assignment notice has dates and scope only, and a mailto only with an email", () => {
    const n = assignmentNotice({ resource: { name: "Stone Works", contactName: "Sam", email: "sam@stone.test" }, project: "Ortiz Kitchen", work: "Countertops", start: "2026-11-26", end: "2026-11-27", sender: "James" });
    expect(n.body).toContain("Hi Sam,");
    expect(n.body).toContain("2026-11-26 to 2026-11-27");
    expect(n.body).not.toMatch(/\$|price|cost/i);
    expect(n.mailto).toMatch(/^mailto:sam%40stone\.test\?subject=/);
    expect(assignmentNotice({ resource: { name: "X", contactName: null, email: null }, project: "P", work: "W", start: "2026-11-26", end: "2026-11-26", sender: "J" }).mailto).toBeNull();
  });

  it("customer report shows names by default and contact info only when chosen", () => {
    const r = { name: "Stone Works", phone: "555-0100", email: "sam@stone.test" };
    expect(reportAssignee("hidden", r, null)).toBeNull();
    expect(reportAssignee("names", r, null)).toBe("Stone Works");
    expect(reportAssignee("names_contacts", r, null)).toBe("Stone Works · 555-0100 · sam@stone.test");
  });
});
