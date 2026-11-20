/** V8.2 GPS timekeeping: device-side geofence logic, overtime rules and payroll exports (pure). */
import { describe, expect, it } from "vitest";
import { clientEventId, distanceM, GeofenceTracker, place, radiusGuidance, fmtRadius, type Reading } from "@/lib/workforce/gps/geofence";
import { splitWeek, overtimeByWeek } from "@/lib/workforce/gps/overtime";
import { payrollRows, payrollCsvV2, timeDetailCsv } from "@/lib/workforce/gps/export";
import { laborVariance, setupSteps, mapAdmin, disclosureText } from "@/lib/workforce/gps/model";
import type { TimeEntry } from "@/lib/team/records";

const HQ = { id: "hq", name: "HQ", lat: 44.9778, lng: -93.265, radiusM: 322 };
const SITE = { id: "a", name: "Smith roof", lat: 44.95, lng: -93.1, radiusM: 161 };
/** A point `m` metres north of a site. */
const north = (s: { lat: number; lng: number }, m: number) => ({ lat: s.lat + m / 111_195, lng: s.lng });
const T0 = Date.parse("2026-11-20T13:00:00Z");
const at = (min: number) => T0 + min * 60_000;
const r = (p: { lat: number; lng: number }, min: number, acc = 10): Reading => ({ ...p, accuracyM: acc, at: at(min) });
const kinds = (t: GeofenceTracker, readings: Reading[]) => readings.flatMap((x) => t.feed(x)).map((e) => `${e.kind}:${e.locationId}`);

describe("geofence", () => {
  it("distance is accurate to a metre over short spans", () => {
    expect(Math.round(distanceM(HQ.lat, HQ.lng, north(HQ, 322).lat, HQ.lng))).toBe(322);
  });
  it("placement is accuracy-aware: a big accuracy circle overlapping the edge is uncertain", () => {
    expect(place({ ...north(HQ, 300), accuracyM: 15, at: 0 }, HQ, 100).placement).toBe("inside");
    expect(place({ ...north(HQ, 360), accuracyM: 80, at: 0 }, HQ, 100).placement).toBe("uncertain");
    expect(place({ ...north(HQ, 500), accuracyM: 80, at: 0 }, HQ, 100).placement).toBe("outside");
    expect(place({ ...north(HQ, 10), accuracyM: 400, at: 0 }, HQ, 100).placement).toBe("uncertain");
  });
  it("arrives, stays past the dwell time, then leaves and stays away past the grace period", () => {
    const t = new GeofenceTracker({ dwellMin: 3, graceMin: 10, maxAccuracyM: 100 });
    t.setSites([HQ]);
    expect(kinds(t, [r(north(HQ, 2000), 0), r(north(HQ, 100), 5), r(north(HQ, 50), 6), r(north(HQ, 40), 8.1)])).toEqual(["enter:hq", "dwell:hq"]);
    expect(kinds(t, [r(north(HQ, 40), 30), r(north(HQ, 900), 60), r(north(HQ, 1500), 65), r(north(HQ, 3000), 70.5), r(north(HQ, 3000), 80)])).toEqual(["exit:hq", "exit_confirmed:hq"]);
  });
  it("driving past (under a minute inside) never produces a dwell", () => {
    const t = new GeofenceTracker({ dwellMin: 3, graceMin: 10, maxAccuracyM: 100 });
    t.setSites([SITE]);
    const drive = [-600, -300, -100, 0, 100, 300, 600].map((m, i) => r(north(SITE, m), i * 0.25));
    expect(kinds(t, drive)).toEqual(["enter:a", "exit:a"]);
  });
  it("a weak signal mid-shift changes nothing", () => {
    const t = new GeofenceTracker({ dwellMin: 3, graceMin: 10, maxAccuracyM: 100 });
    t.setSites([SITE]);
    kinds(t, [r(north(SITE, 20), 0), r(north(SITE, 20), 4)]);
    expect(kinds(t, [r(north(SITE, 400), 10, 900), r(north(SITE, 2000), 20, 1500), r(north(SITE, 20), 30)])).toEqual([]);
  });
  it("two sites: leaving one and arriving at the other", () => {
    const t = new GeofenceTracker({ dwellMin: 3, graceMin: 10, maxAccuracyM: 100 });
    t.setSites([HQ, SITE]);
    expect(kinds(t, [r(north(HQ, 10), 0), r(north(HQ, 10), 3), r(north(HQ, 2000), 20), r(north(SITE, 30), 45), r(north(SITE, 30), 49)]))
      .toEqual(["enter:hq", "dwell:hq", "exit:hq", "exit_confirmed:hq", "enter:a", "dwell:a"]);
  });
  it("radius guidance warns below 100 m and refuses over 0.2 mi", () => {
    expect(radiusGuidance(322).tone).toBe("ok");
    expect(radiusGuidance(80).tone).toBe("warn");
    expect(radiusGuidance(40).tone).toBe("danger");
    expect(radiusGuidance(400).tone).toBe("danger");
    expect(fmtRadius(322)).toBe("0.2 mi (322 m)");
    expect(fmtRadius(80)).toBe("0.05 mi (80 m)");
  });
});

describe("overtime", () => {
  const days = (h: number[]) => h.map((hours, i) => ({ day: `2026-11-${String(16 + i).padStart(2, "0")}`, hours }));
  it("federal: only weekly hours over 40", () => {
    expect(splitWeek(days([10, 10, 10, 10, 6]), "federal")).toMatchObject({ hours: 46, regular: 40, overtime: 6, double: 0 });
  });
  it("california: daily 8/12 and weekly 40, without double counting", () => {
    expect(splitWeek(days([13, 8, 8, 8, 8]), "california")).toMatchObject({ hours: 45, regular: 40, overtime: 4, double: 1 });
    expect(splitWeek(days([9, 9, 9, 9, 9]), "california")).toMatchObject({ regular: 40, overtime: 5 });
  });
  it("california: seventh consecutive day", () => {
    expect(splitWeek(days([8, 8, 8, 8, 8, 0, 0]), "california").overtime).toBe(0);
    const s = splitWeek(days([4, 4, 4, 4, 4, 4, 10]), "california");
    expect(s.days[6]).toMatchObject({ overtime: 8, double: 2, regular: 0 });
  });
  it("exempt employees and 'none' are never split", () => {
    expect(splitWeek(days([12, 12, 12, 12]), "federal", true)).toMatchObject({ regular: 48, overtime: 0 });
    expect(splitWeek(days([12, 12, 12, 12]), "none")).toMatchObject({ regular: 48, overtime: 0 });
  });
  it("colorado and alaska daily limits", () => {
    expect(splitWeek(days([13]), "colorado")).toMatchObject({ regular: 12, overtime: 1 });
    expect(splitWeek(days([9]), "alaska")).toMatchObject({ regular: 8, overtime: 1 });
  });
});

const entry = (o: Partial<TimeEntry>): TimeEntry => ({ id: Math.random().toString(36), resourceId: "p1", scheduleId: null, clockIn: "2026-11-16T14:00:00Z", clockOut: "2026-11-16T23:00:00Z",
  breakMinutes: 0, note: null, status: "approved", source: "gps", inLocation: null, outLocation: null, edited: false, decisionNote: null, workType: "regular", paidBreakMinutes: 0, ...o });

describe("payroll export", () => {
  it("keeps every non-rejected hour, splits overtime, and lists travel and breaks; never deducts lunch", () => {
    const es = [0, 1, 2, 3, 4].map((d) => entry({ clockIn: `2026-11-${16 + d}T13:00:00Z`, clockOut: `2026-11-${16 + d}T23:00:00Z`, paidBreakMinutes: 15 }));
    es.push(entry({ clockIn: "2026-11-20T23:00:00Z", clockOut: "2026-11-20T23:30:00Z", workType: "travel", source: "travel", status: "pending" }));
    es.push(entry({ clockIn: "2026-11-19T12:00:00Z", clockOut: "2026-11-19T12:30:00Z", status: "rejected" }));
    const rows = payrollRows(es, "America/Chicago", "federal", { rates: { p1: 30 }, signoffs: [{ resourceId: "p1", week: "2026-11-16", signedAt: "2026-11-23T01:00:00Z", hours: 50.5 }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 50.5, regular: 40, overtime: 10.5, travel: 0.5, approved: 50, pending: 0.5, paidBreakMin: 75, unpaidBreakMin: 0, cost: 1500 });
    const text = payrollCsvV2(rows, { p1: "Cris" }, "federal", false);
    expect(text).toContain('"Cris","50.50","40.00","10.50"');
    expect(text).not.toContain("Labor cost");
    const detail = timeDetailCsv(es, { p1: "Cris" }, {}, {}, "America/Chicago");
    expect(detail).toContain("Travel between sites");
    expect(detail.split("\r\n").length).toBe(9);
  });
  it("overtimeByWeek attributes entries to the local day they start", () => {
    const w = overtimeByWeek([entry({ clockIn: "2026-11-17T04:00:00Z", clockOut: "2026-11-17T06:00:00Z" })], "America/Chicago", "federal");
    expect(w[0].days[0].day).toBe("2026-11-16");
  });
});

describe("model", () => {
  it("labor variance: over budget lowers expected profit", () => {
    const v = laborVariance({ canSeeCost: true, estimatedHours: 16, estimatedCost: 480, actualHours: 18, approvedHours: 18, openHours: 0, actualCost: 500, allocatedCost: 500, uncostedHours: 0, people: 2 });
    expect(v).toEqual({ hours: 2, cost: 20, profitImpact: -20 });
  });
  it("setup steps reflect the overview", () => {
    const a = mapAdmin({ settings: { saved: true, disclosureAckAt: "x" }, locations: [{ id: "1", kind: "business", name: "HQ", ready: true }], employees: [{ id: "e", kind: "staff", status: "active", enrolled: false }] });
    expect(setupSteps(a).map((s) => s.done)).toEqual([true, true, true, false]);
  });
  it("the disclosure says what's stored, who sees it, and that it can be refused", () => {
    const t = disclosureText("Acme", { entryDwellMin: 3, exitGraceMin: 10, exitAction: "ask", retentionDays: 90 }).join(" ");
    expect(t).toMatch(/does not store a trail/);
    expect(t).toMatch(/deleted after 90 days/);
    expect(t).toMatch(/say no or turn this off/);
  });
});

describe("event idempotency key", () => {
  it("fits the 80-character limit the API and database enforce, and differs per event", () => {
    const loc = "c4469737-133b-4e4c-9b43-0cf3c904b5e9";
    const a = clientEventId({ locationId: loc, kind: "exit_confirmed", occurredAt: "2026-11-20T15:03:40.569Z" });
    const b = clientEventId({ locationId: loc, kind: "exit_confirmed", occurredAt: "2026-11-20T15:03:41.569Z" });
    expect(a.length).toBeLessThanOrEqual(80);
    expect(a).not.toBe(b);
  });
});
