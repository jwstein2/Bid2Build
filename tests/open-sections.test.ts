import { describe, expect, it } from "vitest";
import { initialOpenState, reconcileOpenState, toggleOpen } from "@/components/builder/open-sections";

describe("estimate section accordion state", () => {
  it("opens only the first section on first visit", () => {
    expect(initialOpenState(["a", "b", "c"])).toEqual({ open: ["a"], known: ["a", "b", "c"] });
    expect(initialOpenState([])).toEqual({ open: [], known: [] });
  });

  it("lets several sections stay open independently", () => {
    let s = initialOpenState(["a", "b", "c"]);
    s = toggleOpen(s, "c");
    s = toggleOpen(s, "b");
    expect(s.open.sort()).toEqual(["a", "b", "c"]);
    s = toggleOpen(s, "a");
    expect(s.open.sort()).toEqual(["b", "c"]);
  });

  it("opens a section the contractor just added and keeps the rest as they were", () => {
    const s = reconcileOpenState({ open: ["b"], known: ["a", "b"] }, ["a", "b", "new"]);
    expect(s).toEqual({ open: ["b", "new"], known: ["a", "b", "new"] });
  });

  it("drops deleted sections", () => {
    expect(reconcileOpenState({ open: ["a", "b"], known: ["a", "b"] }, ["b"])).toEqual({ open: ["b"], known: ["b"] });
  });

  it("returns the same object when nothing changed (no extra renders)", () => {
    const prev = { open: ["a"], known: ["a", "b"] };
    expect(reconcileOpenState(prev, ["a", "b"])).toBe(prev);
  });

  it("restores a saved state where everything was collapsed", () => {
    expect(reconcileOpenState({ open: [], known: ["a", "b"] }, ["a", "b"]).open).toEqual([]);
  });
});
