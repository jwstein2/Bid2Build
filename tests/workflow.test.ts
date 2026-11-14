import { describe, expect, it } from "vitest";
import { createEstimate } from "@/lib/estimate/factory";
import { isBuilderStep, isCompanyComplete, missingCompanyFields, resolveStartStep } from "@/lib/estimate/workflow";
import { defaultBusinessProfile } from "@/lib/proposal/types";
import { CALCULATORS, runCalculator } from "@/lib/calculators/registry";
import type { CalcId } from "@/lib/calculators/types";
import { newInput } from "@/lib/calculators/mapping";
import { item } from "./helpers";

const complete = { ...defaultBusinessProfile(), companyName: "Acme Roofing", contactName: "Sam", email: "sam@acme.test", phone: "555-0100", address: "1 Main St" };

describe("company profile completeness", () => {
  it("needs every field the company form marks required", () => {
    expect(isCompanyComplete(complete)).toBe(true);
    expect(isCompanyComplete(null)).toBe(false);
    expect(isCompanyComplete(defaultBusinessProfile())).toBe(false);
    expect(missingCompanyFields({ ...complete, phone: "  " })).toEqual(["phone"]);
    expect(isCompanyComplete({ companyName: "Acme Roofing" })).toBe(false); // a name alone is not a finished Step 1
  });
});

describe("which step a bid opens on", () => {
  const fresh = createEstimate("roofing");
  it("new visitor: trade chosen, then Company", () => {
    expect(resolveStartStep({ companyComplete: false, estimate: fresh })).toBe("company");
  });
  it("returning contractor with a complete profile: trade chosen, then Customer & project", () => {
    expect(resolveStartStep({ companyComplete: true, estimate: fresh })).toBe("project");
  });
  it("keeps the chosen trade on the new bid", () => {
    expect(fresh.trades).toEqual(["roofing"]);
    expect(fresh.groups.every((g) => g.trade === "roofing")).toBe(true);
  });
  it("resumes a draft on the step this device last showed", () => {
    expect(resolveStartStep({ companyComplete: true, estimate: fresh, saved: "scope" })).toBe("scope");
    expect(resolveStartStep({ companyComplete: false, estimate: fresh, saved: "project" })).toBe("project");
  });
  it("resumes a bid already under way at the estimate, never back at the start", () => {
    const named = { ...fresh, customer: { name: "Pat" } };
    const withItems = { ...fresh, items: [item(fresh.groups[0].id, "10", "5")] };
    expect(resolveStartStep({ companyComplete: false, estimate: named })).toBe("estimate");
    expect(resolveStartStep({ companyComplete: true, estimate: withItems })).toBe("estimate");
  });
  it("honors a step the link asks for", () => {
    expect(resolveStartStep({ companyComplete: true, estimate: fresh, requested: "proposal", saved: "company" })).toBe("proposal");
  });
  it("ignores unknown stored steps", () => {
    expect(isBuilderStep("estimate")).toBe(true);
    expect(isBuilderStep("checkout")).toBe(false);
    expect(isBuilderStep(null)).toBe(false);
  });
});

describe("calculator validation on a blank form", () => {
  it("flags blank required fields as 'empty' so the UI can hold them back while typing", () => {
    const ids = Object.keys(CALCULATORS) as CalcId[];
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const calc of ids) {
      const preset = { calc };
      const r = runCalculator(calc, newInput(preset), CALCULATORS[calc].outputs[0].id);
      // Every error on an untouched calculator is a blank entry, never a "wrong value".
      expect(r.errors.every((e) => e.empty), `${calc}: ${r.errors.map((e) => e.message).join("; ")}`).toBe(true);
    }
  });
  it("still reports wrong values as real errors", () => {
    const preset = { calc: "area" as CalcId };
    const input = newInput(preset);
    input.sections[0].values = { ...input.sections[0].values, length: "abc", width: "10" };
    const r = runCalculator("area", input, CALCULATORS.area.outputs[0].id);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.field === "length" && !e.empty)).toBe(true);
  });
});
