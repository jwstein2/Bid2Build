/**
 * Payroll-ready timesheet exports (pure). Hours only, prepared for whoever runs payroll; Built2Bid never calculates
 * pay or tax. Every recorded hour is included: pending and GPS-flagged entries are listed with their status so
 * nothing compensable is dropped, and only "Sent back" (rejected) entries and time marked Unpaid are left out of the
 * totals (unpaid time is shown in its own column).
 */
import { csvCell } from "@/lib/financials/csv";
import { entryHours, localDay, TIME_SOURCE_LABEL, TIME_STATUS_LABEL, WORK_CATEGORY_LABEL, WORK_TYPE_LABEL, type Signoff, type TimeEntry } from "@/lib/team/records";
import { overtimeByWeek, type OvertimeRule } from "./overtime";

const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const f2 = (n: number) => n.toFixed(2);

export interface PayrollRow {
  resourceId: string; week: string; total: number; regular: number; overtime: number; double: number; travel: number; offsite: number;
  approved: number; pending: number; unpaidBreakMin: number; paidBreakMin: number; entries: number; signedOffAt: string | null; cost: number | null;
  nonProject: number; unpaid: number;
}

export function payrollRows(entries: TimeEntry[], tz: string, rule: OvertimeRule, opts: { exempt?: string[]; signoffs?: Signoff[]; rates?: Record<string, number>; now?: Date } = {}): PayrollRow[] {
  const now = opts.now ?? new Date();
  const splits = overtimeByWeek(entries, tz, rule, new Set(opts.exempt ?? []), now);
  return splits.map((w) => {
    const all = entries.filter((e) => e.resourceId === w.resourceId && e.status !== "rejected" && w.days.some((d) => d.day === localDay(e.clockIn, tz)));
    const mine = all.filter((e) => e.workCategory !== "unpaid");
    const unpaid = all.filter((e) => e.workCategory === "unpaid").reduce((s, e) => s + entryHours(e, now), 0);
    const sum = (pred: (e: TimeEntry) => boolean) => mine.filter(pred).reduce((s, e) => s + entryHours(e, now), 0);
    const approved = sum((e) => e.status === "approved");
    const rate = opts.rates?.[w.resourceId];
    return {
      resourceId: w.resourceId, week: w.week, total: w.hours, regular: w.regular, overtime: w.overtime, double: w.double,
      travel: Math.round(sum((e) => e.workType === "travel") * 100) / 100, offsite: Math.round(sum((e) => e.workType === "offsite") * 100) / 100,
      approved: Math.round(approved * 100) / 100, pending: Math.round(sum((e) => e.status !== "approved") * 100) / 100,
      unpaidBreakMin: mine.reduce((s, e) => s + (e.breakMinutes || 0), 0), paidBreakMin: mine.reduce((s, e) => s + (e.paidBreakMinutes || 0), 0),
      entries: mine.length, signedOffAt: opts.signoffs?.find((s) => s.resourceId === w.resourceId && s.week === w.week)?.signedAt ?? null,
      cost: rate === undefined ? null : Math.round(approved * rate * 100) / 100,
      nonProject: Math.round(sum((e) => !e.scheduleId) * 100) / 100, unpaid: Math.round(unpaid * 100) / 100,
    };
  });
}

/** One row per employee per week. */
export function payrollCsvV2(rows: PayrollRow[], names: Record<string, string>, rule: OvertimeRule, includeCost: boolean): string {
  const head = ["Week starting (Mon)", "Employee", "Total hours", "Regular", "Overtime (1.5x)", "Double time (2x)", "Travel between sites", "Paid offsite", "Paid non-project (shop, office, training...)", "Approved hours",
    "Not yet approved", "Unpaid breaks (min)", "Paid breaks (min)", "Entries", "Employee confirmed week", "Overtime rule", "Unpaid time recorded (not counted)", ...(includeCost ? ["Labor cost (approved x cost rate)"] : [])];
  return csv([head, ...rows.map((r) => [r.week, names[r.resourceId] ?? "Unknown", f2(r.total), f2(r.regular), f2(r.overtime), f2(r.double), f2(r.travel), f2(r.offsite), f2(r.nonProject), f2(r.approved),
    f2(r.pending), r.unpaidBreakMin, r.paidBreakMin, r.entries, r.signedOffAt ? r.signedOffAt.slice(0, 10) : "", rule, f2(r.unpaid), ...(includeCost ? [r.cost === null ? "" : f2(r.cost)] : [])])]);
}

/** Every entry with site, project, method and the original punch when it was changed. */
export function timeDetailCsv(entries: TimeEntry[], names: Record<string, string>, projects: Record<string, string>, locations: Record<string, string>, tz: string, now: Date = new Date()): string {
  const fmt = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");
  const head = ["Employee", "Date", "Work location", "Project", "Work category", "Work type", "Clock in", "Clock out", "Unpaid break (min)", "Paid break (min)", "Hours", "Status", "Method",
    "Original clock in", "Original clock out", "Shift ref", "Note"];
  return csv([head, ...[...entries].sort((a, b) => a.clockIn.localeCompare(b.clockIn)).map((e) => [
    names[e.resourceId] ?? "Unknown", localDay(e.clockIn, tz), e.locationId ? locations[e.locationId] ?? "" : "", e.scheduleId ? projects[e.scheduleId] ?? "" : "",
    WORK_CATEGORY_LABEL[e.workCategory ?? (e.scheduleId ? "project" : "other_paid")], WORK_TYPE_LABEL[e.workType ?? "regular"], fmt(e.clockIn), fmt(e.clockOut), e.breakMinutes, e.paidBreakMinutes ?? 0, f2(entryHours(e, now)), TIME_STATUS_LABEL[e.status],
    TIME_SOURCE_LABEL[e.source], fmt(e.originalClockIn), fmt(e.originalClockOut), e.shiftId ? e.shiftId.slice(0, 8) : "", e.note ?? "",
  ])]);
}
