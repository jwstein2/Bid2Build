import { describe, expect, it } from "vitest";
import { buildPayload, faultMessage, planExport, splitHours, type WorkerLink } from "@/lib/quickbooks/mapping";
import { qbConfigured, qbEnvironment } from "@/lib/quickbooks/config";
import type { TimeEntry } from "@/lib/team/records";

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? "e1", resourceId: "r1", scheduleId: null, clockIn: "2026-11-16T14:00:00Z", clockOut: "2026-11-16T22:30:00Z", breakMinutes: 30,
  note: null, status: "approved", source: "clock", inLocation: null, outLocation: null, edited: false, decisionNote: null, ...over,
});
const emp: WorkerLink = { resourceId: "r1", qbType: "Employee", qbId: "55", qbName: "Ana" };
const tz = "America/Chicago";

describe("QuickBooks hours mapping", () => {
  it("splits decimal hours into whole hours and minutes", () => {
    expect(splitHours(8)).toEqual({ Hours: 8, Minutes: 0 });
    expect(splitHours(7.75)).toEqual({ Hours: 7, Minutes: 45 });
    expect(splitHours(0.016)).toEqual({ Hours: 0, Minutes: 1 });
    expect(splitHours(-1)).toEqual({ Hours: 0, Minutes: 0 });
  });

  it("builds an employee time activity on the local work date, minus the unpaid break", () => {
    const { payload, hours, txnDate } = buildPayload(entry(), emp, { scheduleId: "s1", qbCustomerId: "9", qbName: "Smith deck" }, tz, "Smith deck");
    expect(hours).toBe(8);
    expect(txnDate).toBe("2026-11-16");
    expect(payload).toMatchObject({ NameOf: "Employee", EmployeeRef: { value: "55" }, CustomerRef: { value: "9" }, Hours: 8, Minutes: 0, BillableStatus: "NotBillable" });
    expect(payload.VendorRef).toBeUndefined();
    expect(payload.Description).toContain("Smith deck");
  });

  it("uses the local date for late-evening punches", () => {
    const { txnDate } = buildPayload(entry({ clockIn: "2026-11-17T03:00:00Z", clockOut: "2026-11-17T05:00:00Z", breakMinutes: 0 }), emp, undefined, tz);
    expect(txnDate).toBe("2026-11-16");
  });

  it("sends 1099 workers as vendors", () => {
    const { payload } = buildPayload(entry(), { ...emp, qbType: "Vendor", qbId: "77" }, undefined, tz);
    expect(payload).toMatchObject({ NameOf: "Vendor", VendorRef: { value: "77" } });
    expect(payload.EmployeeRef).toBeUndefined();
    expect(payload.CustomerRef).toBeUndefined();
  });

  it("sends only approved, closed, paid, matched, unsent entries", () => {
    const entries = [
      entry({ id: "ok" }),
      entry({ id: "pending", status: "pending" }),
      entry({ id: "open", status: "open", clockOut: null }),
      entry({ id: "rejected", status: "rejected" }),
      entry({ id: "unpaid", workCategory: "unpaid" }),
      entry({ id: "sent" }),
      entry({ id: "nomatch", resourceId: "r2" }),
      entry({ id: "zero", clockOut: "2026-11-16T14:20:00Z", breakMinutes: 20 }),
    ];
    const plan = planExport(entries, { workers: [emp], jobs: [], sent: new Set(["sent"]), tz });
    expect(plan.send.map((s) => s.entry.id)).toEqual(["ok"]);
    expect(plan.skipped).toEqual({ not_approved: 1, still_open: 1, unpaid: 1, no_match: 1, already_sent: 1, zero_hours: 1 });
  });

  it("keeps only entries whose local date is inside the chosen days", () => {
    const entries = [entry({ id: "in" }), entry({ id: "before", clockIn: "2026-11-15T14:00:00Z", clockOut: "2026-11-15T16:00:00Z" })];
    const plan = planExport(entries, { workers: [emp], jobs: [], sent: new Set(), tz, days: { from: "2026-11-16", to: "2026-11-22" } });
    expect(plan.send.map((s) => s.entry.id)).toEqual(["in"]);
  });

  it("reads a QuickBooks fault without echoing anything else", () => {
    expect(faultMessage({ Fault: { Error: [{ Message: "Object Not Found", Detail: "Employee 55 is inactive" }] } })).toBe("Object Not Found: Employee 55 is inactive");
    expect(faultMessage(null)).toMatch(/didn't accept/);
  });

  it("is only configured with both Intuit keys and a 32-byte token key", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(qbConfigured({ QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", BANK_TOKEN_KEY: key })).toBe(true);
    expect(qbConfigured({ QBO_CLIENT_ID: "a", BANK_TOKEN_KEY: key })).toBe(false);
    expect(qbConfigured({ QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", BANK_TOKEN_KEY: "short" })).toBe(false);
    expect(qbEnvironment(undefined)).toBe("sandbox");
    expect(qbEnvironment("production")).toBe("production");
  });
});
