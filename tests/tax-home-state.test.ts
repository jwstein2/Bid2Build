import { describe, expect, it } from "vitest";
import { withHomeState } from "@/components/tax-banking/tax";

const base = { primaryState: null as string | null, serviceStates: [] as string[] };

describe("Tax setup home state auto-check", () => {
  it("checks the home state when it is chosen", () => {
    expect(withHomeState(base, "MN")).toEqual({ primaryState: "MN", serviceStates: ["MN"] });
  });
  it("keeps other states and the old home state when the home state changes", () => {
    const r = withHomeState({ primaryState: "MN", serviceStates: ["IA", "MN"] }, "WI");
    expect(r).toEqual({ primaryState: "WI", serviceStates: ["IA", "MN", "WI"] });
  });
  it("leaves a manually unchecked home state alone until it is chosen again", () => {
    // MN unchecked by the user; the form state keeps primaryState MN with no MN box.
    const unchecked = { primaryState: "MN", serviceStates: ["IA"] };
    expect(unchecked.serviceStates).not.toContain("MN");
    expect(withHomeState(unchecked, "MN").serviceStates).toEqual(["IA", "MN"]);
  });
  it("clearing the home state changes no boxes", () => {
    expect(withHomeState({ primaryState: "MN", serviceStates: ["MN"] }, null)).toEqual({ primaryState: null, serviceStates: ["MN"] });
  });
  it("does not duplicate an already checked state", () => {
    expect(withHomeState({ primaryState: null, serviceStates: ["WI"] }, "WI").serviceStates).toEqual(["WI"]);
  });
});
