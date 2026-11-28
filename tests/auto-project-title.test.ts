import { describe, expect, it } from "vitest";
import { autoTitleFor, createEstimate, defaultTitleFor, isDefaultTitle, titleDate } from "@/lib/estimate/factory";
import { reducer, type State } from "@/components/builder/state";

const start = (): State => {
  const e = createEstimate("roofing", { now: new Date("2026-11-24T12:00:00Z") });
  return { estimate: e, trash: [], dirty: 0 };
};

describe("automatic project title (customer name + estimate date)", () => {
  it("formats the estimate date as MM/DD/YYYY", () => {
    expect(titleDate("2026-11-24")).toBe("11/24/2026");
    expect(titleDate("")).toBe("");
  });

  it("follows the customer name while the title is automatic", () => {
    let s = start();
    expect(s.estimate.title).toBe(defaultTitleFor("roofing"));
    s = reducer(s, { type: "patchCustomer", patch: { name: "Jane Smith" } });
    expect(s.estimate.title).toBe("Jane Smith – 11/24/2026");
    expect(isDefaultTitle(s.estimate)).toBe(true);
    s = reducer(s, { type: "patchCustomer", patch: { name: "Jane Smithers" } });
    expect(s.estimate.title).toBe("Jane Smithers – 11/24/2026");
    s = reducer(s, { type: "patch", patch: { estimateDate: "2026-12-01" } });
    expect(s.estimate.title).toBe("Jane Smithers – 12/01/2026");
    s = reducer(s, { type: "patchCustomer", patch: { name: "" } });
    expect(s.estimate.title).toBe(defaultTitleFor("roofing"));
  });

  it("never changes a title the contractor typed", () => {
    let s = start();
    s = reducer(s, { type: "patch", patch: { title: "Smith garage reroof" } });
    s = reducer(s, { type: "patchCustomer", patch: { name: "Jane Smith" } });
    expect(s.estimate.title).toBe("Smith garage reroof");
    s = reducer(s, { type: "patch", patch: { title: "" } });
    s = reducer(s, { type: "patchCustomer", patch: { name: "Jane Smith B" } });
    expect(s.estimate.title).toBe("");
  });

  it("a stale automatic title for another customer is a real title", () => {
    const e = { ...createEstimate("roofing"), estimateDate: "2026-11-24", customer: { ...createEstimate("roofing").customer, name: "Pat Lee" } };
    expect(isDefaultTitle({ ...e, title: autoTitleFor(e) })).toBe(true);
    expect(isDefaultTitle({ ...e, title: "Jane Smith – 11/24/2026" })).toBe(false);
  });
});
