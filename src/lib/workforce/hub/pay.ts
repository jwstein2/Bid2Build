/**
 * Projected pay (pure, runs on the server only). ESTIMATED GROSS PAY, NOT A PAYCHECK: no taxes, deductions or
 * benefits, and never a processed payroll amount. Three separate numbers:
 *   1. scheduled — what the schedule would pay if worked as planned
 *   2. actual    — what the hours recorded so far would pay (pending + approved; sent-back and unpaid time left out)
 *   3. final     — only when a connected payroll provider confirms it (none is connected today, so always null)
 *
 * Hourly: each category's rate (a per-worker rate for that category, else the base pay rate) plus any company
 * differential for the category. Overtime / double time come from the company's overtime rule (same engine as the
 * payroll export) and are paid at the multiplier times the week's regular rate (straight-time pay / hours, the
 * FLSA "regular rate"), so multiple rates and differentials are handled. Paid time off is paid at the base rate and
 * doesn't count toward overtime. FLSA-exempt workers never get overtime.
 * Salaried: annual pay / pay periods per year (weekly 52, biweekly 26, semimonthly 24, monthly 12), or / 52 for a week.
 * Owner / other arrangements: no estimate.
 */
import { splitWeek, type OvertimeRule } from "@/lib/workforce/gps/overtime";
import { entryHours, localDay, weekStart, type TimeEntry, type WorkCategory } from "@/lib/team/records";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";
export interface PaySettings {
  enabled: boolean; workersCanSee: boolean; displayPeriod: "week" | "pay_period"; payFrequency: PayFrequency; periodAnchor: string;
  overtimeRule: OvertimeRule | null; otMultiplier: number; dtMultiplier: number; differentials: Record<string, number>;
}
export interface PayInputs {
  available: true; audience: "admin" | "worker"; payType: "hourly" | "salary" | "owner" | "other"; classification: string | null;
  payRate: number | null; payRateUnit: "hour" | "year" | null; employeePayFrequency: PayFrequency | null; exempt: boolean;
  rates: Partial<Record<WorkCategory, number>>; projectionEnabled: boolean; settings: PaySettings; overtimeRule: OvertimeRule; timezone: string;
}
export interface ScheduleHours { date: string; hours: number; category: string }
export interface PayLine { label: string; hours: number; rate: number; amount: number }
export interface PayEstimate { hours: number; regular: number; overtime: number; double: number; timeOff: number; gross: number; lines: PayLine[] }
export interface PayProjection {
  method: "hourly" | "salary" | "none"; reason: string | null; period: { from: string; to: string; label: string };
  scheduled: PayEstimate | null; actual: PayEstimate | null; final: null; notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
export const PERIODS_PER_YEAR: Record<PayFrequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/** The week (Mon–Sun) or the pay period that contains `day`. */
export function payPeriod(day: string, s: Pick<PaySettings, "displayPeriod" | "payFrequency" | "periodAnchor">): { from: string; to: string; label: string } {
  if (s.displayPeriod === "week") { const from = weekStart(day); return { from, to: addDays(from, 6), label: "This week" }; }
  if (s.payFrequency === "weekly" || s.payFrequency === "biweekly") {
    const len = s.payFrequency === "weekly" ? 7 : 14;
    const off = ((daysBetween(s.periodAnchor, day) % len) + len) % len;
    const from = addDays(day, -off);
    return { from, to: addDays(from, len - 1), label: "This pay period" };
  }
  const [y, m, dd] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  if (s.payFrequency === "semimonthly") return dd <= 15 ? { from: `${y}-${mm}-01`, to: `${y}-${mm}-15`, label: "This pay period" } : { from: `${y}-${mm}-16`, to: `${y}-${mm}-${last}`, label: "This pay period" };
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}`, label: "This pay period" };
}

const CAT_LABEL: Record<string, string> = { project: "Project work", shop: "Shop / warehouse", office: "Office", training: "Training", admin: "Admin", travel: "Paid travel", other_paid: "Other paid work" };

function hourlyEstimate(rows: ScheduleHours[], inp: PayInputs): PayEstimate | null {
  const base = inp.payRate ?? 0;
  const rateFor = (cat: string) => (inp.rates[cat as WorkCategory] ?? base) + (inp.settings.differentials[cat] ?? 0);
  const paid = rows.filter((x) => x.hours > 0 && x.category !== "unpaid");
  const work = paid.filter((x) => x.category !== "time_off");
  const timeOff = r2(paid.filter((x) => x.category === "time_off").reduce((s, x) => s + x.hours, 0));
  // Straight-time pay by category.
  const byCat = new Map<string, number>();
  for (const x of work) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.hours);
  const lines: PayLine[] = [...byCat.entries()].map(([cat, h]) => ({ label: CAT_LABEL[cat] ?? cat, hours: r2(h), rate: r2(rateFor(cat)), amount: r2(h * rateFor(cat)) }));
  // Overtime per workweek using the company rule; premium at the week's regular rate.
  const weeks = new Map<string, { day: string; hours: number; pay: number }[]>();
  for (const x of work) {
    const w = weekStart(x.date);
    const list = weeks.get(w) ?? [];
    const d = list.find((q) => q.day === x.date);
    if (d) { d.hours += x.hours; d.pay += x.hours * rateFor(x.category); } else list.push({ day: x.date, hours: x.hours, pay: x.hours * rateFor(x.category) });
    weeks.set(w, list);
  }
  let regular = 0, overtime = 0, double = 0, premium = 0;
  for (const list of weeks.values()) {
    const split = splitWeek(list.map((d) => ({ day: d.day, hours: d.hours })), inp.overtimeRule, inp.exempt);
    const hours = list.reduce((s, d) => s + d.hours, 0), pay = list.reduce((s, d) => s + d.pay, 0);
    const regRate = hours > 0 ? pay / hours : base;
    regular += split.regular; overtime += split.overtime; double += split.double;
    premium += split.overtime * regRate * (inp.settings.otMultiplier - 1) + split.double * regRate * (inp.settings.dtMultiplier - 1);
  }
  if (overtime > 0) lines.push({ label: `Overtime premium (${inp.settings.otMultiplier}x)`, hours: r2(overtime), rate: 0, amount: 0 });
  if (double > 0) lines.push({ label: `Double-time premium (${inp.settings.dtMultiplier}x)`, hours: r2(double), rate: 0, amount: 0 });
  const otLines = lines.filter((l) => l.label.includes("premium"));
  if (otLines.length) { const share = premium / otLines.reduce((s, l) => s + l.hours, 0); for (const l of otLines) { l.amount = r2(l.hours * share); l.rate = r2(share); } }
  if (timeOff > 0) lines.push({ label: "Paid time off", hours: timeOff, rate: r2(base), amount: r2(timeOff * base) });
  const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
  const hours = r2(work.reduce((s, x) => s + x.hours, 0));
  return { hours, regular: r2(regular), overtime: r2(overtime), double: r2(double), timeOff, gross, lines };
}

/** Hours from recorded entries, by local day and category (open entries count up to now). */
export function entriesToHours(entries: TimeEntry[], tz: string, from: string, to: string, now: Date = new Date()): ScheduleHours[] {
  return entries.filter((e) => e.status !== "rejected").map((e) => ({ date: localDay(e.clockIn, tz), hours: entryHours(e, now), category: e.workCategory ?? (e.scheduleId ? "project" : "other_paid") }))
    .filter((x) => x.date >= from && x.date <= to);
}

export function projectPay(inp: PayInputs, schedule: ScheduleHours[], actual: ScheduleHours[], today: string): PayProjection {
  const period = payPeriod(today, inp.settings);
  const inRange = (x: ScheduleHours) => x.date >= period.from && x.date <= period.to;
  const notes: string[] = [];
  if (inp.payType === "owner" || inp.payType === "other") return { method: "none", reason: "This pay arrangement isn't hourly or salaried, so there's no estimate.", period, scheduled: null, actual: null, final: null, notes };
  if (inp.payRate === null || inp.payRate <= 0) return { method: "none", reason: "No pay rate on file in the HR record yet.", period, scheduled: null, actual: null, final: null, notes };
  if (inp.payType === "salary" || inp.payRateUnit === "year") {
    const freq = inp.employeePayFrequency ?? inp.settings.payFrequency;
    const amount = inp.payRateUnit === "year" ? (inp.settings.displayPeriod === "week" ? inp.payRate / 52 : inp.payRate / PERIODS_PER_YEAR[freq]) : 0;
    if (inp.payRateUnit !== "year") return { method: "none", reason: "Salaried, but the pay rate isn't an annual amount.", period, scheduled: null, actual: null, final: null, notes };
    const hrs = (rows: ScheduleHours[]) => r2(rows.filter(inRange).filter((x) => x.category !== "unpaid" && x.category !== "time_off").reduce((s, x) => s + x.hours, 0));
    const est = (h: number): PayEstimate => ({ hours: h, regular: h, overtime: 0, double: 0, timeOff: 0, gross: r2(amount), lines: [{ label: inp.settings.displayPeriod === "week" ? "Salary (annual / 52)" : `Salary (annual / ${PERIODS_PER_YEAR[freq]})`, hours: h, rate: 0, amount: r2(amount) }] });
    if (!inp.exempt) notes.push("Salaried but not marked exempt: overtime may also be owed. Check with whoever runs payroll.");
    return { method: "salary", reason: null, period, scheduled: est(hrs(schedule)), actual: est(hrs(actual)), final: null, notes };
  }
  if (inp.exempt) notes.push("Marked FLSA exempt, so no overtime is estimated.");
  if (Object.keys(inp.settings.differentials).some((k) => k === "night" || k === "weekend")) notes.push("Night and weekend differentials aren't included in the estimate yet.");
  if (inp.settings.displayPeriod === "pay_period" && weekStart(period.from) !== period.from) notes.push("This pay period starts mid-week, so overtime for the split week is estimated from the days inside it.");
  return { method: "hourly", reason: null, period, scheduled: hourlyEstimate(schedule.filter(inRange), inp), actual: hourlyEstimate(actual.filter(inRange), inp), final: null, notes };
}

/** Map the database's pay inputs (pm_pay_inputs) or null when not available. */
export function mapPayInputs(x: unknown): PayInputs | null {
  const o = (x ?? {}) as Record<string, unknown>;
  if (o.available !== true) return null;
  const s = (o.settings ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const freq = (v: unknown): PayFrequency | null => (["weekly", "biweekly", "semimonthly", "monthly"].includes(String(v)) ? (v as PayFrequency) : null);
  const obj = (v: unknown) => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, n]) => [k, Number(n)]).filter(([, n]) => Number.isFinite(n)));
  return {
    available: true, audience: o.audience === "admin" ? "admin" : "worker",
    payType: (["hourly", "salary", "owner", "other"].includes(String(o.payType)) ? o.payType : "hourly") as PayInputs["payType"],
    classification: typeof o.classification === "string" ? o.classification : null, payRate: num(o.payRate),
    payRateUnit: o.payRateUnit === "year" ? "year" : o.payRateUnit === "hour" ? "hour" : null, employeePayFrequency: freq(o.employeePayFrequency),
    exempt: o.exempt === true, rates: obj(o.rates), projectionEnabled: o.projectionEnabled !== false,
    settings: {
      enabled: s.enabled === true, workersCanSee: s.workersCanSee === true, displayPeriod: s.displayPeriod === "pay_period" ? "pay_period" : "week",
      payFrequency: freq(s.payFrequency) ?? "biweekly", periodAnchor: typeof s.periodAnchor === "string" ? s.periodAnchor : "2026-01-05",
      overtimeRule: (s.overtimeRule as OvertimeRule) ?? null, otMultiplier: num(s.otMultiplier) ?? 1.5, dtMultiplier: num(s.dtMultiplier) ?? 2, differentials: obj(s.differentials),
    },
    overtimeRule: (["federal", "california", "colorado", "alaska", "nevada", "none"].includes(String(o.overtimeRule)) ? o.overtimeRule : "federal") as OvertimeRule,
    timezone: typeof o.timezone === "string" ? o.timezone : "America/Chicago",
  };
}

export const PAY_DISCLAIMER = "Estimated gross pay — not a guaranteed paycheck. Before taxes and deductions; your actual pay comes from payroll.";
