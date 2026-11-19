import { describe, expect, it } from "vitest";
import { autoReference, categoryFromLine, nextOccurrence, overheadLine, parseRecurringNote, payStatus, recurringNote } from "@/lib/financials/overhead";

describe("overhead helpers", () => {
  it("writes and reads the category on a bill line", () => {
    expect(overheadLine("insurance", "General liability")).toBe("Insurance: General liability");
    expect(overheadLine("software", " ")).toBe("Software & subscriptions");
    expect(categoryFromLine("Insurance: General liability")).toBe("insurance");
    expect(categoryFromLine("Software & subscriptions")).toBe("software");
    expect(categoryFromLine("Lumber for the Smith job")).toBeNull();
  });
  it("tags recurring plans so the next bill can be prefilled", () => {
    const v = "0b6f7c55-1a2b-4c3d-8e9f-001122334455";
    expect(parseRecurringNote(recurringNote("rent_utilities", v))).toEqual({ category: "rent_utilities", vendorId: v });
    expect(parseRecurringNote("payroll")).toBeNull();
    expect(parseRecurringNote(`overhead:bogus:${v}`)).toBeNull();
  });
  it("finds the next date for repeating costs (month ends clamp)", () => {
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextOccurrence("2026-12-15", "monthly")).toBe("2027-01-15");
    expect(nextOccurrence("2026-11-25", "weekly")).toBe("2026-12-02");
    expect(nextOccurrence("2026-12-25", "biweekly")).toBe("2027-01-08");
  });
  it("labels paid, partly paid and unpaid", () => {
    expect(payStatus(2000, 0)).toBe("unpaid");
    expect(payStatus(2000, 500)).toBe("partial");
    expect(payStatus(2000, 2000)).toBe("paid");
  });
  it("makes a stable-looking reference when the bill has none", () => {
    expect(autoReference("2026-11-19", 0.5)).toMatch(/^OH-20261119-[0-9A-Z]{3}$/);
  });
});
