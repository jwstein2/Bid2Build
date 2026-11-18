import { describe, expect, it } from "vitest";
import { describeHistory, hrChanges, hrFormValues, mapHrFile } from "@/lib/team/hr";

describe("HR file helpers", () => {
  it("form values come from columns; only changed fields are sent, typed", () => {
    const before = hrFormValues({ legal_first_name: "Cris", pto_hours_per_year: 80, rehire_eligible: null, employment_status: null });
    expect(before.legalFirstName).toBe("Cris");
    expect(before.employmentStatus).toBe("active");
    const after = { ...before, legalFirstName: "Cristina", ptoHoursPerYear: "", rehireEligible: "no", city: " Austin " };
    expect(hrChanges(before, after)).toEqual({ legalFirstName: "Cristina", ptoHoursPerYear: null, rehireEligible: false, city: "Austin" });
    expect(hrChanges(before, before)).toEqual({});
  });
  it("history reads in plain words, without values", () => {
    expect(describeHistory("hr_file.updated", ["emergency1_name", "emergency1_phone", "city"])).toBe("Updated emergency contact, city");
    expect(describeHistory("ssn.revealed", [])).toBe("Social Security number viewed");
    expect(describeHistory("document.added", ["i9"])).toBe("I-9 (work eligibility) added");
  });
  it("maps the file and never carries a full SSN", () => {
    const f = mapHrFile({ resourceId: "r1", name: "Cris", ssn: { onFile: true, last4: "6789" }, balances: { year: 2026, ptoAllowance: "80", ptoUsed: "24" }, history: [{ action: "a", at: "2026-01-01" }, { action: "b", at: "2026-02-01" }] });
    expect(f.ssn).toEqual({ onFile: true, last4: "6789" });
    expect(f.balances).toMatchObject({ ptoAllowance: 80, ptoUsed: 24, sickAllowance: null, sickUsed: 0 });
    expect(f.history.map((h) => h.action)).toEqual(["b", "a"]);
  });
});
