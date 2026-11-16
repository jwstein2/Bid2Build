import { describe, expect, it } from "vitest";
import { normalizeCalendar, type WorkCalendar } from "@/lib/schedule/calendar";
import { applyReviewEdit, planSections, type PlanSection } from "@/lib/schedule/engine";
import type { Dep } from "@/lib/schedule/types";

const MF: WorkCalendar = normalizeCalendar({ workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" });
const dep = (from: string, to: string, lagDays = 0, maxOverlap = 0): Dep => ({ from, to, lagDays, maxOverlap });
// Mon 2026-12-07 start, like the Full Siding Replacement example: Removal 4d -> Materials 3d -> Labor 8d.
const secs: PlanSection[] = [
  { key: "rem", sourceGroupId: "g1", name: "Removal", durationDays: 4, sortOrder: 0 },
  { key: "mat", sourceGroupId: "g2", name: "Siding Materials", durationDays: 3, sortOrder: 1 },
  { key: "lab", sourceGroupId: "g3", name: "Labor", durationDays: 8, sortOrder: 2 },
];
const deps = [dep("rem", "mat"), dep("mat", "lab")];
const START = "2026-12-07";
const by = (s: PlanSection[], d: Dep[]) => Object.fromEntries(planSections(s, d, START, MF)!.map((p) => [p.key, p]));

function apply(key: string, edit: { start?: string; end?: string; durationDays?: number }, s = secs, d = deps) {
  const r = applyReviewEdit(s, d, START, MF, { key, ...edit })!;
  const s2 = s.map((x) => (x.key === key ? { ...x, durationDays: r.durationDays, offsetDays: r.offsetDays } : x));
  const d2 = r.dep ? d.map((x) => (x.to === key ? r.dep! : x)) : d;
  return { r, plan: by(s2, d2) };
}

describe("review step: dragging bars", () => {
  it("baseline matches the wizard plan", () => {
    const p = by(secs, deps);
    expect(p.rem).toMatchObject({ plannedStart: "2026-12-07", plannedEnd: "2026-12-10" });
    expect(p.mat).toMatchObject({ plannedStart: "2026-12-11", plannedEnd: "2026-12-15" });
    expect(p.lab).toMatchObject({ plannedStart: "2026-12-16", plannedEnd: "2026-12-25" });
  });
  it("moving an independent section sets a start offset; dependents follow", () => {
    const { r, plan } = apply("rem", { start: "2026-12-09" });
    expect(r.offsetDays).toBe(2);
    expect(plan.rem).toMatchObject({ plannedStart: "2026-12-09", plannedEnd: "2026-12-14" });
    expect(plan.mat.plannedStart).toBe("2026-12-15");
  });
  it("can't move before the project start", () => {
    expect(apply("rem", { start: "2026-12-01" }).r.offsetDays).toBe(0);
  });
  it("moving a dependent section later adds a wait; earlier records an overlap", () => {
    const later = apply("mat", { start: "2026-12-14" });
    expect(later.r.dep).toMatchObject({ lagDays: 1 });
    expect(later.plan.mat.plannedStart).toBe("2026-12-14");
    const earlier = apply("mat", { start: "2026-12-09" });
    expect(earlier.r.dep).toMatchObject({ lagDays: -2, maxOverlap: 2 });
    expect(earlier.plan.mat.plannedStart).toBe("2026-12-09");
    // Never before the predecessor's own start.
    expect(apply("mat", { start: "2026-12-01" }).plan.mat.plannedStart).toBe("2026-12-07");
  });
  it("resizing the finish changes only the duration", () => {
    const { r, plan } = apply("lab", { end: "2026-12-29" });
    expect(r.durationDays).toBe(10);
    expect(plan.lab).toMatchObject({ plannedStart: "2026-12-16", plannedEnd: "2026-12-29" });
    expect(plan.rem.plannedEnd).toBe("2026-12-10");
  });
  it("resizing the start keeps the finish", () => {
    const { plan } = apply("rem", { start: "2026-12-08", end: "2026-12-10" });
    expect(plan.rem).toMatchObject({ plannedStart: "2026-12-08", plannedEnd: "2026-12-10", durationDays: 3 });
  });
  it("date editor sets start and working days", () => {
    const { plan } = apply("lab", { start: "2026-12-17", durationDays: 5 });
    expect(plan.lab).toMatchObject({ plannedStart: "2026-12-17", plannedEnd: "2026-12-23" });
  });
});
