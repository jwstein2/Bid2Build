import { describe, expect, it } from "vitest";
import { reducer, type State } from "@/components/builder/state";
import { computeEstimate } from "@/lib/estimate/engine";
import { est, item } from "./helpers";

const init = (): State => ({ estimate: est({ items: [item("g1", "1", "10", { id: "a" }), item("g1", "1", "20", { id: "b" }), item("g2", "1", "30", { id: "c" })] }), trash: [], dirty: 0 });

describe("estimate editor state", () => {
  it("delete + undo restores an item at its position", () => {
    let s = reducer(init(), { type: "deleteItem", id: "a" });
    expect(s.estimate.items.find((i) => i.id === "a")).toBeUndefined();
    s = reducer(s, { type: "undo" });
    const g1 = s.estimate.items.filter((i) => i.groupId === "g1").sort((x, y) => x.sortOrder - y.sortOrder);
    expect(g1.map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("deleting a group can be undone with its items", () => {
    let s = reducer(init(), { type: "deleteGroup", id: "g2" });
    expect(computeEstimate(s.estimate).totalCost.toFixed(2)).toBe("30.00");
    s = reducer(s, { type: "undo" });
    expect(computeEstimate(s.estimate).totalCost.toFixed(2)).toBe("60.00");
  });
  it("duplicates, reorders, and moves items between groups", () => {
    let s = reducer(init(), { type: "duplicateItem", id: "a" });
    expect(s.estimate.items.filter((i) => i.groupId === "g1")).toHaveLength(3);
    s = reducer(s, { type: "moveItem", id: "b", dir: -1 });
    const order = s.estimate.items.filter((i) => i.groupId === "g1").sort((x, y) => x.sortOrder - y.sortOrder).map((i) => i.name);
    expect(order[order.length - 2]).toBe(s.estimate.items.find((i) => i.id === "b")!.name);
    s = reducer(s, { type: "moveItemToGroup", id: "c", groupId: "g1" });
    expect(s.estimate.items.find((i) => i.id === "c")!.groupId).toBe("g1");
    expect(computeEstimate(s.estimate).groups.g2.itemCount).toBe(0);
  });
  it("bulk override applies to selected items only", () => {
    const s = reducer(init(), { type: "bulkOverride", ids: ["a", "c"], rule: { mode: "margin", percent: "50" } });
    const t = computeEstimate(s.estimate);
    expect(t.items.a.extendedPrice.toFixed(2)).toBe("20.00");
    expect(t.items.b.extendedPrice.toFixed(2)).toBe("25.00");
    expect(t.items.c.extendedPrice.toFixed(2)).toBe("60.00");
  });
});
