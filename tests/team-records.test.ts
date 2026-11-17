import { describe, expect, it } from "vitest";
import {
  accuracyLabel, complianceBadges, entryHours, expiryState, laborByProject, localDay, map1099, mapEmployees, mapSubRecord, mapSuppliers, mapTimesheet,
  maskTin, payrollCsv, recordsDbError, threshold1099, timeEntriesCsv, totals1099Csv, websiteHref, weekStart, weeklyTotals, type TimeEntry,
} from "@/lib/team/records";

const e = (o: Partial<TimeEntry>): TimeEntry => ({
  id: Math.random().toString(36), resourceId: "a", scheduleId: null, clockIn: "2026-11-16T14:00:00Z", clockOut: "2026-11-16T22:00:00Z", breakMinutes: 0,
  note: null, status: "approved", source: "clock", inLocation: null, outLocation: null, edited: false, decisionNote: null, ...o,
});

describe("time math", () => {
  it("hours subtract the break and never go negative; open shifts count to now", () => {
    expect(entryHours(e({ breakMinutes: 30 }))).toBe(7.5);
    expect(entryHours(e({ clockOut: "2026-11-16T14:10:00Z", breakMinutes: 60 }))).toBe(0);
    expect(entryHours(e({ clockOut: null }), new Date("2026-11-16T16:00:00Z"))).toBe(2);
  });
  it("weeks start Monday in the company time zone", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday → Monday before
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    // 02:00 UTC Monday is still Sunday evening in Chicago
    expect(localDay("2026-11-23T02:00:00Z", "America/Chicago")).toBe("2026-11-22");
  });
  it("weekly totals split hours over 40, cost only on approved hours, rejected left out", () => {
    const days = [16, 17, 18, 19, 20, 21].map((d) => e({ clockIn: `2026-11-${d}T13:00:00Z`, clockOut: `2026-11-${d}T21:00:00Z` })); // 6 x 8 = 48
    const w = weeklyTotals([...days, e({ clockIn: "2026-11-21T22:00:00Z", clockOut: "2026-11-21T23:00:00Z", status: "rejected" }), e({ resourceId: "b", status: "pending" })], "America/Chicago", { a: 30 });
    expect(w.find((x) => x.resourceId === "a")).toMatchObject({ hours: 48, regular: 40, overtime: 8, approvedHours: 48, cost: 1440, entries: 6 });
    expect(w.find((x) => x.resourceId === "b")).toMatchObject({ hours: 8, approvedHours: 0, cost: null });
  });
  it("labor by project uses each person's rate; unknown rate leaves cost blank", () => {
    const l = laborByProject([e({ scheduleId: "p1" }), e({ scheduleId: "p1", resourceId: "b", status: "pending" }), e({ scheduleId: "p2", resourceId: "c" })], { a: 40 });
    expect(l.find((x) => x.scheduleId === "p1")).toMatchObject({ hours: 16, approvedHours: 8, cost: 320, people: 2 });
    expect(l.find((x) => x.scheduleId === "p2")).toMatchObject({ approvedHours: 8, cost: null });
  });
  it("CSV exports quote cells and neutralize formulas", () => {
    const csv = payrollCsv(weeklyTotals([e({})], "UTC", { a: 10 }), { a: "=HYPERLINK(\"x\")" }, true);
    expect(csv.split("\r\n")[0]).toContain("Hours over 40");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"80.00"`);
    expect(payrollCsv([], {}, false)).not.toContain("Labor cost");
    const t = timeEntriesCsv([e({ note: "+1 call", source: "manual", edited: true })], { a: "Cris" }, {}, "UTC");
    expect(t).toContain(`"'+1 call"`);
    expect(t).toContain("Added by manager");
  });
  it("maps timesheet numbers given as strings or numbers", () => {
    const s = mapTimesheet({ canManage: true, entries: [{ id: "1", resourceId: "a", clockIn: "2026-11-16T14:00:00Z", clockOut: null, breakMinutes: "15", status: "open", inLocation: { lat: "44.9", lng: -93.2, accuracyM: 8 } }], rates: { a: "38.50", b: null }, projects: { p: "Kitchen" } });
    expect(s.entries[0]).toMatchObject({ breakMinutes: 15, status: "open", inLocation: { lat: 44.9, lng: -93.2, accuracyM: 8 } });
    expect(s.rates).toEqual({ a: 38.5 });
    expect(accuracyLabel(s.entries[0].inLocation)).toBe("within 8 m");
    expect(accuracyLabel({ lat: 0, lng: 0, accuracyM: 2500 })).toBe("within 2.5 km (rough)");
  });
});

describe("directory mappers", () => {
  it("suppliers and employees default safely", () => {
    expect(mapSuppliers({ canManage: true, suppliers: [{ id: "s", name: "ABC", imports: 2, pricedItems: "4", trades: ["roofing", 3] }] }).suppliers[0]).toMatchObject({ imports: 2, pricedItems: 4, trades: ["roofing"], status: "active" });
    expect(mapEmployees({ employees: [{ id: "e", name: "Cris", payType: "weird", hourlyCost: "42.5" }] }).employees[0]).toMatchObject({ payType: "hourly", hourlyCost: 42.5, clockEnabled: true });
  });
  it("website links only allow http(s)", () => {
    expect(websiteHref("abcsupply.com")).toBe("https://abcsupply.com/");
    expect(websiteHref("javascript:alert(1)")).toBeNull();
    expect(websiteHref(null)).toBeNull();
  });
});

describe("subcontractor records", () => {
  it("masks the tax ID and never needs more than 4 digits", () => {
    expect(maskTin("ein", "6789")).toBe("EIN ••-•••6789");
    expect(maskTin("ssn", "4321")).toBe("SSN •••-••-4321");
    expect(maskTin(null, null)).toBe("Not recorded");
  });
  it("expiry: expired, within 30 days, fine, none", () => {
    expect(expiryState("2026-11-16", "2026-11-17")).toBe("expired");
    expect(expiryState("2026-12-17", "2026-11-17")).toBe("soon");
    expect(expiryState("2026-12-18", "2026-11-17")).toBe("ok");
    expect(expiryState(null, "2026-11-17")).toBe("none");
  });
  it("badges say 'on file', never 'verified'", () => {
    const b = complianceBadges({ w9OnFile: true, insuranceOnFile: true, agreementOnFile: false, nextExpiry: null, expired: 1, expiringSoon: 2 });
    expect(b.map((x) => x.text)).toEqual(["1 expired", "2 expiring within 30 days", "W-9 on file"]);
    expect(JSON.stringify(complianceBadges({ w9OnFile: false, insuranceOnFile: false, agreementOnFile: false, nextExpiry: null, expired: 0, expiringSoon: 0 }))).not.toMatch(/verif/i);
  });
  it("maps a record", () => {
    const r = mapSubRecord({ resourceId: "r", name: "Stone", tax: { tinType: "ein", tinLast4: "6789", tracks1099: false, track1099: false }, documents: [{ id: "d", docType: "w9", hasFile: true, status: "replaced", coverageAmount: "1000000" }] });
    expect(r.tax).toMatchObject({ tinType: "ein", tracks1099: false, track1099: false });
    expect(r.documents[0]).toMatchObject({ status: "replaced", hasFile: true, coverageAmount: 1000000 });
  });
});

describe("1099 totals", () => {
  it("threshold is $600 through 2025 and $2,000 from 2026", () => {
    expect(threshold1099(2025)).toBe(600);
    expect(threshold1099(2026)).toBe(2000);
  });
  it("maps rows and builds the CSV with masked IDs", () => {
    const t = map1099({ year: 2026, threshold: 2000, rows: [{ vendorId: "v", vendorName: "Stone", paid: "2500", cardPaid: 1000, needs1099: true, w9OnFile: true, tinType: "ein", tinLast4: "6789" }] });
    expect(t.rows[0]).toMatchObject({ paid: 2500, cardPaid: 1000, needs1099: true });
    const csv = totals1099Csv(t);
    expect(csv).toContain("EIN ••-•••6789");
    expect(csv).toContain(`"2500.00"`);
    expect(csv).not.toMatch(/\d{9}/);
  });
  it("database errors become friendly messages", () => {
    expect(recordsDbError({ message: "forbidden_own" }).message).toMatch(/approve your own/);
    expect(recordsDbError({ message: "overlap" }).status).toBe(409);
    expect(recordsDbError({ message: "boom" }).status).toBe(500);
  });
});
