/** V8.3 worker hub: pay projection math, pay periods, scheduled vs actual, duty state (pure). */
import { describe, expect, it } from "vitest";
import { payPeriod, projectPay, mapPayInputs, entriesToHours, type PayInputs } from "@/lib/workforce/hub/pay";
import { breakdown, compareWeek, dutyState, mapWorkerWeek } from "@/lib/workforce/hub/model";
import type { TimeEntry } from "@/lib/team/records";

const base = (o: Partial<PayInputs> = {}, s: Partial<PayInputs["settings"]> = {}): PayInputs => ({
  available: true, audience: "worker", payType: "hourly", classification: "w2", payRate: 20, payRateUnit: "hour", employeePayFrequency: null, exempt: false, rates: {},
  projectionEnabled: true, overtimeRule: "federal", timezone: "America/Chicago",
  settings: { enabled: true, workersCanSee: true, displayPeriod: "week", payFrequency: "biweekly", periodAnchor: "2026-01-05", overtimeRule: null, otMultiplier: 1.5, dtMultiplier: 2, differentials: {}, ...s },
  ...o,
});
const days = (hrs: number[], cat = "project", from = "2026-11-16") => hrs.map((h, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0, 10), hours: h, category: cat }; });

describe("pay periods", () => {
  it("week, weekly, biweekly from the anchor, semimonthly and monthly", () => {
    expect(payPeriod("2026-11-19", { displayPeriod: "week", payFrequency: "biweekly", periodAnchor: "2026-01-05" })).toMatchObject({ from: "2026-11-16", to: "2026-11-22" });
    expect(payPeriod("2026-11-19", { displayPeriod: "pay_period", payFrequency: "biweekly", periodAnchor: "2026-01-05" })).toMatchObject({ from: "2026-11-09", to: "2026-11-22" });
    expect(payPeriod("2026-11-25", { displayPeriod: "pay_period", payFrequency: "biweekly", periodAnchor: "2026-01-12" })).toMatchObject({ from: "2026-11-16", to: "2026-11-29" });
    expect(payPeriod("2026-11-19", { displayPeriod: "pay_period", payFrequency: "semimonthly", periodAnchor: "2026-01-05" })).toMatchObject({ from: "2026-11-16", to: "2026-11-30" });
    expect(payPeriod("2026-02-03", { displayPeriod: "pay_period", payFrequency: "monthly", periodAnchor: "2026-01-05" })).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("hourly projection", () => {
  it("40 scheduled hours at $20 = $800; actual so far counted separately; never a final amount", () => {
    const p = projectPay(base(), days([8, 8, 8, 8, 8]), days([8, 8.5]), "2026-11-18");
    expect(p.method).toBe("hourly");
    expect(p.scheduled).toMatchObject({ hours: 40, regular: 40, overtime: 0, gross: 800 });
    expect(p.actual).toMatchObject({ hours: 16.5, gross: 330 });
    expect(p.final).toBeNull();
  });
  it("overtime past 40 at 1.5x the week's regular rate, including a higher training rate and a differential", () => {
    const inp = base({ rates: { training: 25 } }, { differentials: { shop: 1 } });
    const sched = [...days([10, 10, 10, 10], "project"), { date: "2026-11-20", hours: 5, category: "training" }, { date: "2026-11-21", hours: 5, category: "shop" }];
    const p = projectPay(inp, sched, [], "2026-11-18");
    // straight time: 40*20 + 5*25 + 5*21 = 1030 for 50 h -> regular rate 20.60; OT premium 10 * 20.60 * 0.5 = 103
    expect(p.scheduled).toMatchObject({ hours: 50, regular: 40, overtime: 10, gross: 1133 });
    expect(p.scheduled!.lines.find((l) => l.label.startsWith("Overtime"))!.amount).toBe(103);
  });
  it("California daily overtime and double time", () => {
    const p = projectPay(base({ overtimeRule: "california" }), days([13]), [], "2026-11-16");
    expect(p.scheduled).toMatchObject({ regular: 8, overtime: 4, double: 1, gross: 13 * 20 + 4 * 10 + 1 * 20 });
  });
  it("exempt: no overtime; unpaid time never paid; paid time off at base rate without overtime", () => {
    const p = projectPay(base({ exempt: true }), [...days([12, 12, 12, 12]), { date: "2026-11-20", hours: 1, category: "unpaid" }, { date: "2026-11-21", hours: 8, category: "time_off" }], [], "2026-11-18");
    expect(p.scheduled).toMatchObject({ hours: 48, overtime: 0, timeOff: 8, gross: 48 * 20 + 8 * 20 });
    expect(p.notes.join(" ")).toMatch(/exempt/);
  });
  it("only the days inside the period count (partial weeks / schedule changes)", () => {
    const p = projectPay(base(), [...days([8, 8]), { date: "2026-11-30", hours: 8, category: "project" }], [], "2026-11-17");
    expect(p.scheduled!.hours).toBe(16);
  });
});

describe("other pay arrangements", () => {
  it("salaried: annual / 52 for a week, / 26 for a biweekly period", () => {
    const s = base({ payType: "salary", payRate: 52000, payRateUnit: "year", exempt: true });
    expect(projectPay(s, days([8, 8]), [], "2026-11-17").scheduled!.gross).toBe(1000);
    const bi = base({ payType: "salary", payRate: 52000, payRateUnit: "year", exempt: true }, { displayPeriod: "pay_period" });
    expect(projectPay(bi, [], [], "2026-11-17").scheduled!.gross).toBe(2000);
  });
  it("no rate or an owner arrangement: no estimate", () => {
    expect(projectPay(base({ payRate: null }), days([8]), [], "2026-11-16")).toMatchObject({ method: "none", scheduled: null });
    expect(projectPay(base({ payType: "owner" }), days([8]), [], "2026-11-16").method).toBe("none");
  });
  it("hidden inputs map to null so nothing is computed", () => {
    expect(mapPayInputs({ available: false, reason: "hidden" })).toBeNull();
    expect(mapPayInputs({ available: true, payRate: "28", payRateUnit: "hour", settings: { differentials: { shop: "2" } } })!.settings.differentials).toEqual({ shop: 2 });
  });
});

describe("worker week", () => {
  const entry = (o: Partial<TimeEntry>): TimeEntry => ({ id: "e", resourceId: "r", scheduleId: null, clockIn: "2026-11-16T13:00:00Z", clockOut: "2026-11-16T21:00:00Z", breakMinutes: 30,
    note: null, status: "approved", source: "clock", inLocation: null, outLocation: null, edited: false, decisionNote: null, ...o });
  const w = mapWorkerWeek({
    resource: { id: "r", name: "Cris", classification: "w2", isMe: true }, week: "2026-11-16", today: "2026-11-17", timezone: "America/Chicago",
    schedule: [
      { kind: "task", id: "t", date: "2026-11-16", hours: 8, category: "project", scheduleId: "s1", project: "Smith roof", title: "Smith roof", startTime: "07:00", endTime: "15:00" },
      { kind: "shift", id: "w", date: "2026-11-17", hours: 4, category: "shop", title: "Shop", startTime: "07:00", endTime: "11:00" },
      { kind: "time_off", id: "o", date: "2026-11-20", hours: 8, category: "time_off" },
    ],
    entries: [
      { id: "1", resourceId: "r", scheduleId: "s1", clockIn: "2026-11-16T13:00:00Z", clockOut: "2026-11-16T22:00:00Z", breakMinutes: 30, status: "approved", source: "gps", workCategory: "project" },
      { id: "2", resourceId: "r", scheduleId: null, clockIn: "2026-11-16T22:00:00Z", clockOut: "2026-11-16T23:00:00Z", breakMinutes: 0, status: "approved", source: "manual", workCategory: "unpaid" },
    ],
    locations: [{ id: "L", name: "Main shop", kind: "business", category: "shop" }],
  });
  it("compares scheduled and actual per day, leaving out unpaid time and time off", () => {
    const c = compareWeek(w, new Date("2026-11-18T00:00:00Z"));
    expect(c[0]).toMatchObject({ date: "2026-11-16", scheduled: 8, actual: 8.5, diff: 0.5 });
    expect(c[1]).toMatchObject({ scheduled: 4, actual: 0, diff: -4 });
    expect(c[4].scheduled).toBe(0);
  });
  it("breaks hours down by project and internal category", () => {
    const b = breakdown(w, {}, new Date("2026-11-18T00:00:00Z"));
    expect(b.map((x) => [x.label, x.scheduled, x.actual])).toEqual([["Smith roof", 8, 8.5], ["Shop / warehouse", 4, 0]]);
  });
  it("says whether the worker is on a customer project, internal work, or off duty", () => {
    expect(dutyState(w).kind).toBe("off");
    expect(dutyState({ ...w, open: entry({ scheduleId: "s1", clockOut: null, status: "open", workCategory: "project" }) }).label).toMatch(/Smith roof/);
    const shop = dutyState({ ...w, open: entry({ clockOut: null, status: "open", workCategory: "shop", locationId: "L" }) });
    expect(shop).toMatchObject({ kind: "internal", label: "Shop / warehouse: Main shop" });
  });
  it("actual hours from entries skip sent-back time and stay in range", () => {
    expect(entriesToHours([entry({}), entry({ id: "x", status: "rejected" }), entry({ id: "y", clockIn: "2026-12-01T13:00:00Z", clockOut: "2026-12-01T15:00:00Z" })], "America/Chicago", "2026-11-16", "2026-11-22"))
      .toEqual([{ date: "2026-11-16", hours: 7.5, category: "other_paid" }]);
  });
});
