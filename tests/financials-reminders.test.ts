import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, describeRule, localNow, mapRule, nextReminderDate, reminderToPlan, type ReminderKind, type ReminderRule } from "@/lib/financials/reminders";

const rules = (b: Partial<ReminderRule> = {}, o: Partial<ReminderRule> = {}): Record<ReminderKind, ReminderRule> => ({
  balance_reminder: { ...DEFAULT_RULES.balance_reminder, enabled: true, ...b },
  overdue_reminder: { ...DEFAULT_RULES.overdue_reminder, enabled: true, ...o },
});
const inv = (p: Partial<Parameters<typeof reminderToPlan>[1]> = {}) => ({ dueDate: "2026-12-10", balance: 500, sentByKind: {}, lastSentOn: null, ...p });

describe("payment reminder schedule", () => {
  it("defaults are off", () => {
    expect(mapRule(null, "balance_reminder").enabled).toBe(false);
    expect(mapRule(null, "overdue_reminder").enabled).toBe(false);
    expect(reminderToPlan({ balance_reminder: DEFAULT_RULES.balance_reminder, overdue_reminder: DEFAULT_RULES.overdue_reminder }, inv(), "2026-12-12")).toBeNull();
  });

  it("before-due reminder starts offsetDays before the due date and stops at the due date", () => {
    const r = rules({ offsetDays: 3 });
    expect(reminderToPlan(r, inv(), "2026-12-06")).toBeNull();
    expect(reminderToPlan(r, inv(), "2026-12-07")).toEqual({ kind: "balance_reminder", sequence: 1 });
    expect(reminderToPlan(r, inv({ sentByKind: { balance_reminder: 1 }, lastSentOn: "2026-12-07" }), "2026-12-09")).toBeNull(); // max 1
  });

  it("past-due reminders repeat up to the max, with at least a 2-day gap", () => {
    const r = rules({ enabled: false }, { offsetDays: 0, repeatEveryDays: 7, maxReminders: 3 });
    expect(reminderToPlan(r, inv(), "2026-12-10")).toBeNull(); // due today isn't past due
    expect(reminderToPlan(r, inv(), "2026-12-11")).toEqual({ kind: "overdue_reminder", sequence: 1 }); // offset 0 -> at least 1 day late
    expect(reminderToPlan(r, inv({ sentByKind: { overdue_reminder: 1 }, lastSentOn: "2026-12-11" }), "2026-12-17")).toBeNull();
    expect(reminderToPlan(r, inv({ sentByKind: { overdue_reminder: 1 }, lastSentOn: "2026-12-11" }), "2026-12-18")).toEqual({ kind: "overdue_reminder", sequence: 2 });
    expect(reminderToPlan(r, inv({ sentByKind: { overdue_reminder: 3 }, lastSentOn: "2026-12-25" }), "2027-02-01")).toBeNull();
  });

  it("never sends a before-due reminder once past due, and respects the gap across kinds", () => {
    const r = rules({ offsetDays: 3 }, { offsetDays: 1 });
    expect(reminderToPlan(r, inv(), "2026-12-11")).toEqual({ kind: "overdue_reminder", sequence: 1 });
    expect(reminderToPlan(r, inv({ sentByKind: { balance_reminder: 1 }, lastSentOn: "2026-12-10" }), "2026-12-11")).toBeNull();
  });

  it("nothing for paid invoices or invoices without a due date", () => {
    expect(reminderToPlan(rules(), inv({ balance: 0 }), "2026-12-20")).toBeNull();
    expect(reminderToPlan(rules(), inv({ dueDate: null }), "2026-12-20")).toBeNull();
  });

  it("no repeat without a repeat interval", () => {
    expect(nextReminderDate({ ...DEFAULT_RULES.overdue_reminder, enabled: true, repeatEveryDays: null, maxReminders: 3 }, "2026-12-10", 1)).toBeNull();
  });

  it("local time in the book's zone", () => {
    expect(localNow(new Date("2026-12-10T14:30:00Z"), "America/Chicago")).toEqual({ date: "2026-12-10", hour: 8 });
    expect(localNow(new Date("2026-12-11T03:00:00Z"), "America/Chicago").date).toBe("2026-12-10");
    expect(localNow(new Date("2026-12-10T14:30:00Z"), "Not/AZone").hour).toBe(8);
  });

  it("describes rules in plain words", () => {
    expect(describeRule(DEFAULT_RULES.balance_reminder)).toBe("Off");
    expect(describeRule({ ...DEFAULT_RULES.overdue_reminder, enabled: true })).toBe("3 days after the due date, then every 7 days (up to 3)");
  });
});
