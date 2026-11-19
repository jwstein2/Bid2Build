import { describe, expect, it } from "vitest";
import { addDays, agendaFor, DEFAULT_OOO, hashToken, icsInvite, isoDow, newToken, slotsByDay, viewDays, ymd, zonedMidnight, zonedTime } from "@/lib/sales/calendar";
import { bookingText } from "@/lib/sales/booking-email";

describe("V8.4 calendar time zones", () => {
  it("finds local midnight and times across daylight saving changes", () => {
    expect(zonedMidnight("2026-11-23", "America/Chicago").toISOString()).toBe("2026-11-23T06:00:00.000Z");
    expect(zonedMidnight("2026-07-01", "America/Chicago").toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(zonedTime("2026-11-01", "09:00", "America/Chicago").toISOString()).toBe("2026-11-01T15:00:00.000Z"); // DST ended at 2 AM that day
    expect(zonedTime("2026-03-08", "09:00", "America/Chicago").toISOString()).toBe("2026-03-08T14:00:00.000Z"); // DST started
    expect(ymd(new Date("2026-11-24T04:30:00Z"), "America/Chicago")).toBe("2026-11-23");
  });

  it("lays out day, week and month views Monday-first", () => {
    expect(viewDays("day", "2026-11-19")).toEqual(["2026-11-19"]);
    expect(viewDays("week", "2026-11-19")[0]).toBe("2026-11-16");
    expect(isoDow("2026-11-22")).toBe(7);
    const m = viewDays("month", "2026-11-19");
    expect(m[0]).toBe("2026-10-26");
    expect(m.length % 7).toBe(0);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("groups slots by the customer's chosen zone", () => {
    const g = slotsByDay(["2026-11-24T04:00:00Z", "2026-11-24T15:00:00Z"], "America/Chicago");
    expect(g.map((d) => d.day)).toEqual(["2026-11-23", "2026-11-24"]);
    expect(g[0].times[0].label).toBe("10:00 PM");
  });
});

describe("V8.4 scheduling content", () => {
  it("shows add-on topics only to customers whose plan includes them", () => {
    expect(agendaFor("run", null)).not.toContain("Schedule crews and subcontractors in Project Command Center");
    expect(agendaFor("run", "standard+pm")).toContain("Schedule crews and subcontractors in Project Command Center");
    expect(agendaFor("grow", "enterprise")).toContain("Team reporting across estimators");
  });

  it("uses the approved out-of-office text with the verified support address and no reason", () => {
    const t = DEFAULT_OOO("Rita Rep", "December 1");
    expect(t).toContain("returning on December 1");
    expect(t).toContain("support@built2bid.org");
    expect(t).not.toMatch(/built2bid\.com/);
  });

  it("stores only a hash of the private booking link", () => {
    const { token, hash } = newToken();
    expect(token.length).toBeGreaterThanOrEqual(30);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
  });

  it("writes a valid calendar invite", () => {
    const ics = icsInvite({ uid: "abc", start: "2026-11-23T15:30:00Z", end: "2026-11-23T16:00:00Z", summary: "Win the Job; with Rita", description: "Line 1\nLine 2", location: "https://meet.example.test/x" });
    expect(ics).toContain("DTSTART:20261123T153000Z");
    expect(ics).toContain(String.raw`SUMMARY:Win the Job\; with Rita`);
    expect(ics).toContain(String.raw`DESCRIPTION:Line 1\nLine 2`);
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(icsInvite({ uid: "abc", start: "2026-11-23T15:30:00Z", end: "2026-11-23T16:00:00Z", summary: "x", description: "y", canceled: true })).toContain("STATUS:CANCELLED");
  });

  it("writes booking emails in plain language", () => {
    const m = bookingText({ id: "1", kind: "confirmed", to: "pat@roof.test", name: "Pat Roofer", session: "win", start: "2026-11-23T15:30:00Z", end: "2026-11-23T16:00:00Z", tz: "America/Chicago", repName: "Rita Rep", repEmail: "rita@sales.test", manageUrl: "https://built2bid.org/meet/booking/x" });
    expect(m.subject).toBe("You're booked: Win the Job");
    expect(m.text).toContain("Monday, November 23 at 9:30 AM (America/Chicago)");
    expect(m.text).toContain("Need a different time? https://built2bid.org/meet/booking/x");
  });
});

describe("V8.4 My Business helpers", async () => {
  const { attentionFor, retention, scenario } = await import("@/lib/sales/business");
  const c = (o: Record<string, unknown>) => ({ business: null, email: null, tier: "standard", plan: null, sub_status: "active", signed_up_at: null, attributed_at: "2026-10-01", first_paid_at: "2026-10-01", last_paid_at: null, basis_cents: 1999, has_estimate: true, ended: false, next_anniversary: null, ...o });
  it("flags only relationships that need a check-in", () => {
    const now = new Date("2026-11-20");
    expect(attentionFor(c({ sub_status: "past_due" }), true, now)).toBe("past_due");
    expect(attentionFor(c({}), false, now)).toBe("not_onboarded");
    expect(attentionFor(c({ first_paid_at: "2026-11-15" }), false, now)).toBeNull();
    expect(attentionFor(c({ ended: true, sub_status: "past_due" }), false, now)).toBeNull();
  });
  it("hides retention until there are enough customers and never invents any", () => {
    expect(retention([c({}), c({})]).pct).toBeNull();
    expect(retention([c({}), c({}), c({ sub_status: "canceled" }), c({ first_paid_at: null })])).toEqual({ acquired: 3, active: 2, pct: 67 });
    expect(scenario(0, 1999).every((m) => m.cents === 0)).toBe(true);
    expect(scenario(3, 1999)[11]).toEqual({ month: 12, cents: 5997, customers: 36 });
  });
});
