import { describe, expect, it } from "vitest";
import { autoTarget, DEFAULT_MILESTONES, isMilestone, milestoneBonus, milestoneRate, nextMilestone, payExample, teamGoal } from "@/lib/sales/goals";
import { monthXp, quests } from "@/lib/sales/quests";

describe("team goal", () => {
  it("grows 10% (at least one sale) from the 3-month average", () => {
    expect(autoTarget([10, 10, 10], 0)).toEqual({ target: 11, base: 10 });
    expect(autoTarget([40, 30, 20], 0)).toEqual({ target: 33, base: 30 });
    expect(autoTarget([3, 2, 1], 0)).toEqual({ target: 3, base: 2 });
  });
  it("ignores months before the team started and respects the floor", () => {
    expect(autoTarget([12, 0, 0], 0)).toEqual({ target: 14, base: 12 });
    expect(autoTarget([0, 0, 0], 5).target).toBe(5);
    expect(autoTarget([2, 2, 2], 5).target).toBe(5);
  });
  it("builds the board with days left, per-rep share and override", () => {
    const g = teamGoal({ month: "2026-11-01", now: "2026-11-20T18:00:00Z", current: 6, mine: 2, history: [10, 10, 10], active_reps: 2, floor: 0, override: null });
    expect(g.target).toBe(11);
    expect(g.remaining).toBe(5);
    expect(g.perRep).toBe(3);
    expect(g.daysLeft).toBe(11);
    const o = teamGoal({ month: "2026-11-01", now: "2026-11-20T18:00:00Z", current: 6, history: [10, 10, 10], active_reps: 2, floor: 0, override: { target: 20, note: "Push" } });
    expect(o.target).toBe(20);
    expect(o.overridden).toBe(true);
    expect(o.auto).toBe(11);
  });
});

describe("milestone boxes", () => {
  const r = DEFAULT_MILESTONES;
  it("follows the progressive curve 10, 25, 50, 100, 150 ...", () => {
    const boxes = Array.from({ length: 300 }, (_, i) => i + 1).filter((n) => isMilestone(r, n));
    expect(boxes).toEqual([10, 25, 50, 100, 150, 200, 250, 300]);
  });
  it("pays flat early boxes, then 3% / 4% / 5% with a $150 minimum", () => {
    expect(milestoneBonus(r, 10, 999999)).toBe(2500);
    expect(milestoneBonus(r, 25, 0)).toBe(7500);
    expect(milestoneRate(r, 50)).toBe(3);
    expect(milestoneRate(r, 200)).toBe(4);
    expect(milestoneRate(r, 250)).toBe(5);
    expect(milestoneBonus(r, 50, 100000)).toBe(15000); // 3% of $1,000 = $30 -> $150 minimum
    expect(milestoneBonus(r, 100, 1000000)).toBe(40000);
  });
  it("always shows the next reward", () => {
    expect(nextMilestone(r, 0)).toMatchObject({ at: 10, prev: 0, label: "$25 bonus" });
    expect(nextMilestone(r, 38)).toMatchObject({ at: 50, prev: 25 });
    expect(nextMilestone(r, 50).label).toBe("4% bonus (at least $150)");
  });
  it("account 300 example is reasonable", () => {
    const e = payExample(r);
    expect(e.boxes.map((b) => b.milestone)).toEqual([10, 25, 50, 100, 150, 200, 250, 300]);
    // Bonuses stay a small share of what those customers paid.
    const revenue = e.boxes.reduce((t, b) => t + b.revenueCents, 0);
    expect(e.totalBonusCents / revenue).toBeLessThan(0.06);
  });
});

describe("quests and XP", () => {
  const zero = { calls: 0, meetings: 0, follow_ups: 0, tasks_done: 0, paid_accounts: 0 };
  it("tracks daily and weekly quests", () => {
    const q = quests({ now: "", periods: { day: { ...zero, follow_ups: 5, calls: 1 }, week: { ...zero, meetings: 1 }, month: zero } });
    expect(q.find((x) => x.id === "d-follow")?.complete).toBe(true);
    expect(q.find((x) => x.id === "d-call")).toMatchObject({ done: 1, goal: 3, complete: false });
    expect(q.find((x) => x.id === "w-demo")?.complete).toBe(true);
  });
  it("caps volume XP", () => {
    expect(monthXp({ ...zero, calls: 10000 })).toBe(150);
  });
});
