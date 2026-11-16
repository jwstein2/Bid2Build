import { describe, expect, it } from "vitest";
import {
  endFromStart, normalizeCalendar, shiftWorkdays, todayIn, workdayDelta, workdaysBetween, type WorkCalendar,
} from "@/lib/schedule/calendar";
import {
  checkTarget, editNeedsChoice, findConflicts, itemTasksFor, planSections, previewEdit, shiftSection, splitTask, topoOrder, validateSchedule, wouldCycle,
  type PlanSection,
} from "@/lib/schedule/engine";
import { leafTasks, progressOf, timeElapsed } from "@/lib/schedule/progress";
import type { Dep, Snapshot, Task } from "@/lib/schedule/types";

const MF: WorkCalendar = normalizeCalendar({ workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" });
// 2026-11-13 is a Friday.
const task = (id: string, start: string, end: string, o: Partial<Task> = {}): Task => ({
  id, parentId: null, kind: "section", sourceGroupId: `g-${id}`, sourceItemId: null, splitFrom: null, name: id, sortOrder: 0,
  plannedStart: start, plannedEnd: end, durationDays: workdaysBetween(start, end, o.kind ? MF : MF), actualStart: null, actualFinish: null,
  percentComplete: 0, status: "not_started", weight: null, assignee: null, notes: null, ...o,
});
const dep = (from: string, to: string, lagDays = 0, maxOverlap = 0): Dep => ({ from, to, lagDays, maxOverlap });
let n = 0;
const nid = () => `new-${++n}`;

describe("working-day calendar", () => {
  it("counts working days inclusively and skips weekends", () => {
    expect(workdaysBetween("2026-11-13", "2026-11-18", MF)).toBe(4); // Fri, Mon, Tue, Wed
    expect(endFromStart("2026-11-13", 4, MF)).toBe("2026-11-18");
    expect(shiftWorkdays("2026-11-13", 1, MF)).toBe("2026-11-16");
    expect(shiftWorkdays("2026-11-16", -1, MF)).toBe("2026-11-13");
  });
  it("doesn't assume Monday-Friday: a Mon-Sat crew and holidays", () => {
    const sat = normalizeCalendar({ workdays: [1, 2, 3, 4, 5, 6], holidays: ["2026-11-26"], timezone: "America/Chicago" });
    expect(endFromStart("2026-11-13", 4, sat)).toBe("2026-11-17"); // Fri, Sat, Mon, Tue
    expect(workdaysBetween("2026-11-23", "2026-11-28", sat)).toBe(5); // Thanksgiving off
  });
  it("snaps a weekend start to the next working day", () => {
    expect(endFromStart("2026-11-14", 1, MF)).toBe("2026-11-16");
  });
  it("measures signed working-day moves", () => {
    expect(workdayDelta("2026-11-13", "2026-11-17", MF)).toBe(2);
    expect(workdayDelta("2026-11-17", "2026-11-13", MF)).toBe(-2);
  });
  it("uses the business time zone for today", () => {
    const late = new Date("2026-11-16T04:30:00Z"); // still Nov 15 in Chicago
    expect(todayIn("America/Chicago", late)).toBe("2026-11-15");
    expect(todayIn("UTC", late)).toBe("2026-11-16");
  });
  it("never loops on a calendar without working days", () => {
    expect(normalizeCalendar({ workdays: [] }).workdays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("generating a schedule from estimate sections", () => {
  const secs: PlanSection[] = [
    { key: "demo", sourceGroupId: "g1", name: "Demolition", durationDays: 2, sortOrder: 0 },
    { key: "frame", sourceGroupId: "g2", name: "Framing", durationDays: 4, sortOrder: 1 },
    { key: "elec", sourceGroupId: "g3", name: "Electrical", durationDays: 3, sortOrder: 2 },
    { key: "floor", sourceGroupId: "g4", name: "Flooring", durationDays: 3, sortOrder: 3 },
  ];
  it("sections without dependencies overlap (no forced sequence)", () => {
    const plan = planSections(secs, [], "2026-11-16", MF)!;
    expect(new Set(plan.map((p) => p.plannedStart))).toEqual(new Set(["2026-11-16"]));
  });
  it("dependencies, allowed overlaps and gaps", () => {
    const plan = planSections(secs, [dep("demo", "frame"), dep("frame", "elec", -2), dep("frame", "floor", 1)], "2026-11-16", MF)!;
    const by = Object.fromEntries(plan.map((p) => [p.key, p]));
    expect(by.demo).toMatchObject({ plannedStart: "2026-11-16", plannedEnd: "2026-11-17" });
    expect(by.frame).toMatchObject({ plannedStart: "2026-11-18", plannedEnd: "2026-11-23" });
    expect(by.elec.plannedStart).toBe("2026-11-20"); // overlaps framing by 2 days
    expect(by.floor.plannedStart).toBe("2026-11-25"); // 1-day gap
  });
  it("refuses dependency loops", () => {
    expect(planSections(secs, [dep("demo", "frame"), dep("frame", "demo")], "2026-11-16", MF)).toBeNull();
    expect(wouldCycle(["a", "b", "c"], [dep("a", "b"), dep("b", "c")], "c", "a")).toBe(true);
    expect(topoOrder(["a", "b"], [dep("a", "b")])).toEqual(["a", "b"]);
  });
  it("target date: meets it with allowed overlaps, never by shortening work", () => {
    const deps = [dep("demo", "frame", 0, 1), dep("frame", "elec", 0, 2), dep("elec", "floor", 0, 0)];
    const r = checkTarget(secs, deps, "2026-11-16", "2026-11-27", MF)!;
    expect(r.feasible).toBe(false);
    expect(r.finish).toBe("2026-12-01");
    expect(r.overBy).toBe(2);
    expect(r.suggestion?.feasible).toBe(true);
    expect(r.suggestion!.finish <= "2026-11-27").toBe(true);
    for (const c of r.suggestion!.changed) expect(c.overlap).toBeLessThanOrEqual(deps.find((d) => d.from === c.from && d.to === c.to)!.maxOverlap);
    // Durations are untouched in the suggested plan.
    const plan = planSections(secs, r.suggestion!.deps, "2026-11-16", MF)!;
    expect(plan.map((p) => workdaysBetween(p.plannedStart, p.plannedEnd, MF))).toEqual([2, 4, 3, 3]);
  });
  it("target date it can't meet: explains, suggests a start date, no impossible overlap", () => {
    const deps = [dep("demo", "frame"), dep("frame", "elec"), dep("elec", "floor")];
    const r = checkTarget(secs, deps, "2026-11-16", "2026-11-20", MF)!;
    expect(r.feasible).toBe(false);
    expect(r.suggestion).toBeNull();
    expect(r.startBy! < "2026-11-16").toBe(true);
    expect(planSections(secs, deps, r.startBy!, MF)!.at(-1)!.plannedEnd <= "2026-11-20").toBe(true);
  });
});

describe("editing and delays", () => {
  // Framing Nov 13-18, delayed. Drywall waits on framing. Paint waits on drywall. Gutters are unrelated.
  const base = () => [
    task("framing", "2026-11-13", "2026-11-18"),
    task("drywall", "2026-11-19", "2026-11-23"),
    task("paint", "2026-11-24", "2026-11-25"),
    task("gutters", "2026-11-16", "2026-11-17"),
  ];
  const deps = [dep("framing", "drywall"), dep("drywall", "paint")];
  const ext = { taskId: "framing", plannedEnd: "2026-11-20" };

  it("dragging the end, typing a date or changing duration resolve to the same delay", () => {
    const a = previewEdit(base(), deps, ext, "keep", MF).tasks[0];
    const b = previewEdit(base(), deps, { taskId: "framing", durationDays: 6 }, "keep", MF).tasks[0];
    expect(a).toMatchObject({ plannedEnd: "2026-11-20", durationDays: 6 });
    expect(b).toMatchObject({ plannedEnd: "2026-11-20", durationDays: 6 });
  });
  it("keep: only the delayed task changes", () => {
    const p = previewEdit(base(), deps, ext, "keep", MF);
    expect(p.changes.map((c) => c.id)).toEqual(["framing"]);
  });
  it("move dependents: later tasks move just enough; unrelated tasks never move", () => {
    const p = previewEdit(base(), deps, ext, "dependents", MF);
    expect(p.changes.map((c) => c.id).sort()).toEqual(["drywall", "framing", "paint"]);
    const by = Object.fromEntries(p.tasks.map((t) => [t.id, t]));
    expect(by.drywall).toMatchObject({ plannedStart: "2026-11-23", plannedEnd: "2026-11-25" });
    expect(by.gutters).toEqual(base()[3]);
    expect(p.finishAfter > p.finishBefore).toBe(true);
  });
  it("doesn't pull tasks earlier when a task gets shorter", () => {
    const p = previewEdit(base(), deps, { taskId: "framing", plannedEnd: "2026-11-16" }, "dependents", MF);
    expect(p.changes.map((c) => c.id)).toEqual(["framing"]);
  });
  it("asks how to handle a delay only when other tasks could move", () => {
    expect(editNeedsChoice(base(), deps, ext, MF)).toBe(true);
    expect(editNeedsChoice(base(), deps, { taskId: "gutters", plannedEnd: "2026-11-19" }, MF)).toBe(false);
    expect(editNeedsChoice(base(), deps, { taskId: "framing", plannedEnd: "2026-11-17" }, MF)).toBe(false);
  });
  it("group shift moves the rest of the section by the same working days", () => {
    const tasks = [
      task("frame", "2026-11-13", "2026-11-20"),
      task("walls", "2026-11-13", "2026-11-16", { kind: "item", parentId: "frame", sourceGroupId: "g-frame" }),
      task("roof", "2026-11-17", "2026-11-18", { kind: "item", parentId: "frame", sourceGroupId: "g-frame" }),
    ];
    const p = previewEdit(tasks, [], { taskId: "walls", plannedEnd: "2026-11-17" }, "group", MF);
    const roof = p.tasks.find((t) => t.id === "roof")!;
    expect(roof).toMatchObject({ plannedStart: "2026-11-18", plannedEnd: "2026-11-19" });
    expect(shiftSection(tasks, "frame", 1, MF).map((t) => t.plannedStart)).toEqual(["2026-11-16", "2026-11-16", "2026-11-18"]);
  });
  it("dragging a whole section moves its line items with it", () => {
    const tasks = [task("frame", "2026-11-16", "2026-11-18"), task("walls", "2026-11-16", "2026-11-17", { kind: "item", parentId: "frame", sourceGroupId: "g-frame" })];
    const p = previewEdit(tasks, [], { taskId: "frame", plannedStart: "2026-11-18" }, "keep", MF);
    expect(p.tasks.map((t) => t.plannedStart)).toEqual(["2026-11-18", "2026-11-18"]);
    expect(p.tasks[0].plannedEnd).toBe("2026-11-20");
  });
  it("recalculate fixes broken dependencies and reports the new finish", () => {
    const tasks = base();
    tasks[1] = task("drywall", "2026-11-17", "2026-11-19"); // already overlaps framing
    const p = previewEdit(tasks, deps, { taskId: "gutters", plannedEnd: "2026-11-18" }, "recalc", MF);
    expect(p.tasks.find((t) => t.id === "drywall")!.plannedStart).toBe("2026-11-19");
  });
  it("warns about conflicts instead of fixing them", () => {
    const tasks = base();
    tasks[1] = task("drywall", "2026-11-17", "2026-11-19");
    const c = findConflicts(tasks, deps, MF, { target: "2026-11-24", today: "2026-11-20" });
    expect(c.map((x) => x.code)).toEqual(expect.arrayContaining(["dependency", "target", "past_finish"]));
    expect(tasks[1].plannedStart).toBe("2026-11-17");
  });
});

describe("line items and splitting", () => {
  const snap: Snapshot = {
    estimate: { id: "e", title: "t", number: "1", customerName: "c", projectAddress: null }, trades: ["framing"], version: null,
    sections: [{ id: "g-frame", name: "Framing", trade: "framing", sortOrder: 0, items: [
      { id: "i1", name: "Wall framing", quantity: 1, unit: "each", sortOrder: 0 },
      { id: "i2", name: "Roof framing", quantity: 1, unit: "each", sortOrder: 1 },
    ] }],
  };
  it("schedules chosen line items once, linked to the estimate line item", () => {
    const tasks = [task("frame", "2026-11-16", "2026-11-20")];
    const add = itemTasksFor(tasks, snap, "frame", ["i1", "i2"], nid);
    expect(add.map((t) => [t.name, t.sourceItemId, t.parentId])).toEqual([["Wall framing", "i1", "frame"], ["Roof framing", "i2", "frame"]]);
    expect(itemTasksFor([...tasks, ...add], snap, "frame", ["i1", "i2"], nid)).toEqual([]);
  });
  it("splits a task into two segments and keeps successors waiting on the last part", () => {
    const r = splitTask([task("a", "2026-11-16", "2026-11-20"), task("b", "2026-11-23", "2026-11-24")], [dep("a", "b")], "a", "2026-11-18", MF, nid)!;
    const [first, second] = r.tasks;
    expect(first).toMatchObject({ plannedEnd: "2026-11-17", durationDays: 2 });
    expect(second).toMatchObject({ plannedStart: "2026-11-18", plannedEnd: "2026-11-20", splitFrom: "a" });
    expect(r.deps).toEqual(expect.arrayContaining([dep(second.id, "b"), dep("a", second.id)]));
  });
});

describe("validation", () => {
  it("complete needs an actual finish; 100% never rewrites planned dates", () => {
    const t = task("a", "2026-11-16", "2026-11-20", { status: "complete", percentComplete: 40 });
    const r = validateSchedule([t], [], MF);
    expect(r.problems.map((p) => p.code)).toContain("finish_required");
    const ok = validateSchedule([{ ...t, actualStart: "2026-11-16", actualFinish: "2026-11-24" }], [], MF);
    expect(ok.problems).toEqual([]);
    expect(ok.tasks[0]).toMatchObject({ percentComplete: 100, plannedStart: "2026-11-16", plannedEnd: "2026-11-20" });
  });
  it("reaching the planned finish date doesn't mark a task complete", () => {
    const r = validateSchedule([task("a", "2026-11-02", "2026-11-04")], [], MF);
    expect(r.tasks[0].status).toBe("not_started");
  });
  it("rejects loops, bad dates and items outside their section", () => {
    const r = validateSchedule([
      task("a", "2026-11-16", "2026-11-20"), task("b", "2026-11-20", "2026-11-16"),
      task("c", "2026-11-16", "2026-11-17", { kind: "item", parentId: "a", sourceGroupId: "other" }),
    ], [dep("a", "b"), dep("b", "a")], MF);
    expect(r.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["end_before_start", "bad_parent", "cycle"]));
  });
  it("recomputes duration from the dates and calendar", () => {
    expect(validateSchedule([{ ...task("a", "2026-11-13", "2026-11-18"), durationDays: 99 }], [], MF).tasks[0].durationDays).toBe(4);
  });
});

describe("progress", () => {
  it("is duration-weighted and not the share of days elapsed", () => {
    const tasks = [task("a", "2026-11-16", "2026-11-25", { percentComplete: 50 }), task("b", "2026-11-16", "2026-11-17", { percentComplete: 0 })];
    const p = progressOf(tasks);
    expect(p.percent).toBe(40); // (8*50 + 2*0) / 10
    expect(p.rows.map((r) => r.weight)).toEqual([8, 2]);
    // 75% of the days can pass with nothing done.
    expect(timeElapsed(tasks, "2026-11-23", MF)).toBe(75);
    expect(progressOf(tasks.map((t) => ({ ...t, percentComplete: 0 }))).percent).toBe(0);
  });
  it("explicit weights where set", () => {
    const tasks = [task("a", "2026-11-16", "2026-11-25", { percentComplete: 50, weight: 1 }), task("b", "2026-11-16", "2026-11-17", { percentComplete: 100, weight: 1 })];
    expect(progressOf(tasks, "weight").percent).toBe(75);
  });
  it("counts a section through its line items, never twice", () => {
    const tasks = [task("s", "2026-11-16", "2026-11-20", { percentComplete: 100 }), task("i", "2026-11-16", "2026-11-17", { kind: "item", parentId: "s", sourceGroupId: "g-s" })];
    expect(leafTasks(tasks).map((t) => t.id)).toEqual(["i"]);
    expect(progressOf(tasks).percent).toBe(0);
  });
});
