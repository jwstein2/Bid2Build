import { describe, expect, it } from "vitest";
import { activatedAt, checklistSteps, inActivationWindow, isMeaningfulItem, meaningfulItemCount, showChecklist } from "@/lib/growth/activation";

const item = (name: string, quantity: string, unitCost: string, isExample = false) => ({ name, quantity, unitCost, isExample });

describe("meaningful line items", () => {
  it("needs a name, a quantity and a unit cost above zero", () => {
    expect(isMeaningfulItem(item("Joists", "10", "12.5"))).toBe(true);
    expect(isMeaningfulItem(item("  ", "10", "12.5"))).toBe(false);
    expect(isMeaningfulItem(item("Joists", "0", "12.5"))).toBe(false);
    expect(isMeaningfulItem(item("Joists", "10", "0"))).toBe(false);
    expect(isMeaningfulItem(item("Joists", "abc", "1"))).toBe(false);
  });
  it("never counts example rows", () => {
    expect(isMeaningfulItem(item("Example", "1", "1", true))).toBe(false);
  });
  it("counts per estimate", () => {
    expect(meaningfulItemCount({ items: [item("a", "1", "1"), item("b", "1", "0"), item("c", "2", "3")] as never })).toBe(2);
  });
});

describe("7-day activation", () => {
  const created = "2026-11-10T12:00:00Z";
  it("uses the earliest qualifying action inside 7 days", () => {
    expect(activatedAt(created, { meaningful: "2026-11-12T00:00:00Z", exported: "2026-11-11T00:00:00Z" })).toBe("2026-11-11T00:00:00.000Z");
    expect(activatedAt(created, { sent: "2026-11-16T00:00:00Z" })).toBe("2026-11-16T00:00:00.000Z");
  });
  it("ignores actions after the window", () => {
    expect(activatedAt(created, { exported: "2026-11-17T12:00:01Z" })).toBeNull();
    expect(activatedAt(created, {})).toBeNull();
  });
  it("knows when the window is still open", () => {
    expect(inActivationWindow(created, Date.parse("2026-11-16T00:00:00Z"))).toBe(true);
    expect(inActivationWindow(created, Date.parse("2026-11-18T00:00:00Z"))).toBe(false);
  });
});

describe("first bid checklist", () => {
  const base = { companyName: false, estimates: 0, meaningfulEstimates: 0, previewed: false, delivered: false };
  it("starts empty and points a new account at picking a trade", () => {
    const s = checklistSteps(base);
    expect(s.map((x) => x.done)).toEqual([false, false, false, false, false]);
    expect(s[1].href).toBe("/bids");
    expect(showChecklist(s, false)).toBe(true);
  });
  it("delivering a bid completes the bid steps and links to the latest bid", () => {
    const s = checklistSteps({ ...base, companyName: true, estimates: 1, delivered: true, latestEstimateId: "e1" });
    expect(s.every((x) => x.done)).toBe(true);
    expect(showChecklist(s, false)).toBe(false);
  });
  it("stays hidden once dismissed", () => {
    expect(showChecklist(checklistSteps(base), true)).toBe(false);
  });
  it("continues the latest bid on its proposal step", () => {
    const s = checklistSteps({ ...base, estimates: 2, meaningfulEstimates: 1, latestEstimateId: "e9" });
    expect(s.find((x) => x.key === "preview")?.href).toBe("/estimates/e9?step=proposal");
  });
});
