/** V4 Phase 9: permission groups cover every key, change classification, and the pre-migration fallback. */
import { describe, expect, it } from "vitest";
import { OWNER_ONLY_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_KEYS, PERMISSION_LABELS, ROLE_PERMISSIONS } from "@/lib/enterprise/permissions";
import { changeKinds } from "@/lib/schedule/permissions";
import { mapPermissions } from "@/lib/schedule/server";
import { seatBilling, SEAT_TYPE_LABEL, parsePmSeats } from "@/lib/pm/seats";
import type { Task } from "@/lib/schedule/types";

const task = (p: Partial<Task> = {}): Task => ({
  id: "t1", parentId: null, kind: "section", sourceGroupId: "g1", sourceItemId: null, splitFrom: null, name: "Framing", sortOrder: 0,
  plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, actualStart: null, actualFinish: null, percentComplete: 0, status: "not_started",
  weight: null, assignee: null, notes: null, ...p,
});

describe("permission catalog", () => {
  it("every permission is in exactly one group and has a label", () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const k of PERMISSION_KEYS) expect(PERMISSION_LABELS[k]).toBeTruthy();
  });
  it("defaults follow the brief: admins don't edit schedules by role alone; publishing and internal documents are separate", () => {
    expect(OWNER_ONLY_PERMISSIONS).toEqual(expect.arrayContaining(["manage_pm_seats", "manage_pm_addons"]));
    expect(ROLE_PERMISSIONS.viewer).toEqual(expect.arrayContaining(["view_schedules"]));
    expect(ROLE_PERMISSIONS.viewer).not.toContain("edit_assigned_schedules");
    expect(ROLE_PERMISSIONS.viewer).not.toContain("view_internal_reports");
    expect(ROLE_PERMISSIONS.estimator).not.toContain("publish_customer_updates");
    expect(ROLE_PERMISSIONS.estimator).not.toContain("send_internal_reports");
    for (const r of ["manager", "estimator", "viewer"] as const) for (const k of OWNER_ONLY_PERMISSIONS) expect(ROLE_PERMISSIONS[r]).not.toContain(k);
  });
});

describe("changeKinds", () => {
  const before = [task()];
  it("dates, names and notes are edits; status and % complete are progress", () => {
    expect(changeKinds(before, [task({ plannedEnd: "2026-11-20", durationDays: 5 })], false, false, null)).toEqual({ edit: true, progress: false, dependencies: false });
    expect(changeKinds(before, [task({ notes: "x" })], false, false, null).edit).toBe(true);
    expect(changeKinds(before, [task({ status: "in_progress", percentComplete: 30, actualStart: "2026-11-16" })], false, false, null)).toEqual({ edit: false, progress: true, dependencies: false });
  });
  it("new or removed tasks and schedule settings are edits; the schedule's status is progress; deps are their own kind", () => {
    expect(changeKinds(before, [task({ id: "new" })], false, false, null).edit).toBe(true);
    expect(changeKinds(before, [], true, false, null).edit).toBe(true);
    expect(changeKinds(before, [], false, false, { status: "active" })).toEqual({ edit: false, progress: true, dependencies: false });
    expect(changeKinds(before, [], false, false, { name: "New" }).edit).toBe(true);
    expect(changeKinds(before, [], false, true, null)).toEqual({ edit: false, progress: false, dependencies: true });
  });
});

describe("pre-migration fallback and seat labels", () => {
  it("before the Phase 9 SQL runs, everything follows canEdit", () => {
    expect(mapPermissions(undefined, true)).toEqual({ edit: true, progress: true, dependencies: true, publish: true, pdf: true });
    expect(mapPermissions(undefined, false)).toMatchObject({ edit: false, publish: false, pdf: true });
    expect(mapPermissions({ edit: false, progress: true }, true)).toEqual({ edit: false, progress: true, dependencies: false, publish: false, pdf: false });
  });
  it("seat types read honestly and never show prices", () => {
    const seat = { userId: "u", rank: 2, covered: true, assignedAt: "2026-11-01T00:00:00Z", changedAt: "2026-11-02T00:00:00Z", changedBy: null };
    expect(seatBilling({ ...seat, seatType: "paid" })).toMatch(/Billed monthly/);
    expect(seatBilling({ ...seat, seatType: "uncovered", covered: false })).toMatch(/View only/);
    for (const v of Object.values(SEAT_TYPE_LABEL)) expect(v).not.toMatch(/\$/);
    expect(parsePmSeats(null)).toBeNull();
    expect(parsePmSeats({ limit: 3, seats: [] })).toMatchObject({ limit: 3, paid: false, extraPaid: 0, schedules: {} });
  });
});
