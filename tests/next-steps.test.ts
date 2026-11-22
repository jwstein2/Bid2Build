import { describe, expect, it } from "vitest";
import { stepsAfterSigning } from "../src/lib/guide/next-steps";

describe("what's next after signing", () => {
  it("countersign comes first, then schedule, bill and update", () => {
    const s = stepsAfterSigning({ estimateId: "e1", awaitingContractor: true, scheduling: true, financials: true });
    expect(s.map((x) => x.id)).toEqual(["countersign", "schedule", "bill", "update"]);
    expect(s[1].href).toBe("/projects/new?estimate=e1");
    expect(s[2].href).toBe("/financials/jobs/e1");
  });
  it("only lists what's switched on", () => {
    expect(stepsAfterSigning({ estimateId: "e1", awaitingContractor: false, scheduling: false, financials: true }).map((x) => x.id)).toEqual(["bill"]);
    expect(stepsAfterSigning({ estimateId: "e1", awaitingContractor: false, scheduling: false, financials: false })).toEqual([]);
  });
});
