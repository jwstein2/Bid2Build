/**
 * Payroll cash from schedules and time clock (pure). Turned on by "payroll from schedules" in forecast settings.
 *
 * Labor sums come from fin_forecast_labor (scheduled shifts and project assignments the worker app shows, and clocked
 * time entries), costed at each person's hourly cost. Shop, office, training and other non-project hours count too.
 * For each pay period (your pay frequency and period start from workforce pay settings):
 *   days before today use clocked hours (approved or pending), today onward use scheduled hours;
 *   + your employer payroll burden % (taxes, benefits, workers' comp) when you set one;
 *   paid on the period's last day + your pay lag. Pay dates before today are already in the bank balance and skipped.
 * After the last scheduled day, if you have at least 2 weeks of clocked history, the average of the last 4 weeks of
 * clocked labor is used and labelled "estimated from recent weeks". Overtime premiums aren't estimated.
 * This is a forecast of cash out, not a payroll run: nothing is paid or sent to a payroll provider.
 */
import { payPeriod, type PayFrequency } from "@/lib/workforce/hub/pay";
import { addDays, diffDays, maxD, shortDate } from "./dates";
import type { ExtraFlowV9 } from "./types";

export interface LaborDay { date: string; category: string; scheduleId: string | null; hours: number; cost: number; approved?: boolean }
export interface LaborInput {
  payFrequency: PayFrequency; periodAnchor: string; staff: number; uncostedStaff: number;
  scheduled: LaborDay[]; actual: LaborDay[];
}
export interface PayrollPeriod { from: string; to: string; payOn: string; actualCost: number; scheduledCost: number; extrapolatedCost: number; projectCost: number; otherCost: number; burden: number; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function mapLabor(x: unknown): LaborInput | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const days = (v: unknown): LaborDay[] => (Array.isArray(v) ? v : []).map((d: Record<string, unknown>) => ({
    date: String(d.date).slice(0, 10), category: String(d.category ?? "other_paid"), scheduleId: d.scheduleId ? String(d.scheduleId) : null,
    hours: Number(d.hours ?? 0), cost: Number(d.cost ?? 0), approved: d.approved === true }));
  const freq = String(o.payFrequency ?? "biweekly");
  return { payFrequency: (["weekly", "biweekly", "semimonthly", "monthly"].includes(freq) ? freq : "biweekly") as PayFrequency, periodAnchor: String(o.periodAnchor ?? "2026-01-05").slice(0, 10),
    staff: Number(o.staff ?? 0), uncostedStaff: Number(o.uncostedStaff ?? 0), scheduled: days(o.scheduled), actual: days(o.actual) };
}

export function payrollPeriods(l: LaborInput, today: string, end: string, lagDays: number, burdenPct: number): PayrollPeriod[] {
  const set = { displayPeriod: "pay_period" as const, payFrequency: l.payFrequency, periodAnchor: l.periodAnchor };
  const lastScheduled = l.scheduled.reduce<string | null>((m, d) => (!m || d.date > m ? d.date : m), null);
  // Recent weekly average from clocked time (last 28 days before today), only with at least 14 days of history.
  const since = addDays(today, -28);
  const recent = l.actual.filter((d) => d.date >= since && d.date < today);
  const firstActual = l.actual.reduce<string | null>((m, d) => (!m || d.date < m ? d.date : m), null);
  const histDays = firstActual ? Math.min(28, diffDays(today, firstActual)) : 0;
  const dailyAvg = histDays >= 14 ? recent.reduce((a, d) => a + d.cost, 0) / histDays : 0;
  const dailyProjectShare = recent.reduce((a, d) => a + d.cost, 0) ? recent.filter((d) => d.scheduleId).reduce((a, d) => a + d.cost, 0) / recent.reduce((a, d) => a + d.cost, 0) : 0;
  const out: PayrollPeriod[] = [];
  let p = payPeriod(addDays(today, -45), set);
  for (let i = 0; i < 400 && p.from <= end; i++) {
    const payOn = addDays(p.to, lagDays);
    if (payOn >= today && payOn <= end) {
      const act = l.actual.filter((d) => d.date >= p.from && d.date <= p.to && d.date < today);
      const sch = l.scheduled.filter((d) => d.date >= p.from && d.date <= p.to && d.date >= today);
      let extrap = 0, extrapProject = 0;
      if (dailyAvg > 0 && (!lastScheduled || p.to > lastScheduled)) {
        const fromDay = maxD(maxD(p.from, today), lastScheduled ? addDays(lastScheduled, 1) : today);
        const n = fromDay <= p.to ? diffDays(p.to, fromDay) + 1 : 0;
        extrap = dailyAvg * n; extrapProject = extrap * dailyProjectShare;
      }
      const actualCost = act.reduce((a, d) => a + d.cost, 0), scheduledCost = sch.reduce((a, d) => a + d.cost, 0);
      const projectCost = [...act, ...sch].filter((d) => d.scheduleId).reduce((a, d) => a + d.cost, 0) + extrapProject;
      const gross = actualCost + scheduledCost + extrap;
      const burden = (gross * burdenPct) / 100;
      if (gross > 0) out.push({ from: p.from, to: p.to, payOn, actualCost: r2(actualCost), scheduledCost: r2(scheduledCost), extrapolatedCost: r2(extrap),
        projectCost: r2(projectCost), otherCost: r2(gross - projectCost), burden: r2(burden), total: r2(gross + burden) });
    }
    p = payPeriod(addDays(p.to, 1), set);
  }
  return out;
}

export function payrollFlows(periods: PayrollPeriod[], burdenPct: number): ExtraFlowV9[] {
  return periods.map((p) => {
    const parts = [
      p.actualCost ? `clocked $${p.actualCost.toFixed(2)}` : "", p.scheduledCost ? `scheduled $${p.scheduledCost.toFixed(2)}` : "",
      p.extrapolatedCost ? `estimated from recent weeks $${p.extrapolatedCost.toFixed(2)}` : "", p.burden ? `burden ${burdenPct}% $${p.burden.toFixed(2)}` : "",
    ].filter(Boolean).join(", ");
    return { key: `payroll:${p.to}`, label: `Payroll ${shortDate(p.from)}–${shortDate(p.to)}`, amount: (-p.total).toFixed(2), category: "payroll" as const,
      scheduledOn: null, expectedOn: p.payOn, href: "/financials/cash?v9=payroll", source: "payroll" as const,
      note: `Projects $${p.projectCost.toFixed(2)}, shop/office/other $${p.otherCost.toFixed(2)} (${parts}).${burdenPct ? "" : " No payroll burden set."}` };
  });
}
