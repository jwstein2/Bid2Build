/**
 * Financial early warnings (pure). Evaluated from the forecast; stored by fin_cash_alerts_sync (server only), which keeps
 * an unchanged condition from notifying twice (same key + same fingerprint) and resolves conditions that cleared.
 * Alerts suggest next steps; they never take a financial action.
 */
import type { CashEvent, Forecast } from "@/lib/tax-banking/forecast";
import { diffDays, shortDate } from "./dates";
import type { V9Result } from "./engine";
import type { CashSettings } from "./settings";

export type AlertKind = "low_cash" | "payroll_coverage" | "milestone_delayed" | "milestone_progress_reached" | "cost_overrun" | "margin_low" | "receivable_late" | "expense_concentration" | "forecast_confidence";
export interface CashAlert {
  kind: AlertKind; key: string; fingerprint: string; severity: "info" | "warning" | "critical"; title: string; body: string;
  details: Record<string, unknown>; actions: { label: string; href: string }[];
}
export const ALERT_LABELS: Record<AlertKind, string> = {
  low_cash: "Low cash", payroll_coverage: "Payroll coverage", milestone_delayed: "Delayed payment milestone", milestone_progress_reached: "Milestone ready to confirm",
  cost_overrun: "Cost overrun", margin_low: "Profit margin", receivable_late: "Late receivable", expense_concentration: "Expenses close together", forecast_confidence: "Forecast confidence",
};

export interface AlertInputs {
  v9: V9Result;
  settings: CashSettings;
  today: string;
  /** Previous snapshot item dates by key (ms:<id> -> date), for delayed-milestone warnings. */
  previous: Record<string, string>;
  commitments: { id: string; jobId: string; jobName: string; title: string; vendorName: string | null; original: number; current: number }[];
  openInvoices: { id: string; number: string; customerName: string | null; balance: number; dueDate: string | null; usualDays: number }[];
  jobs: { jobId: string; jobName: string; contract: number }[];
}

const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const bucket = (n: number, step: number) => String(Math.round(n / step) * step);

function balanceBefore(f: Forecast, day: string): number {
  const prev = f.series.filter((p) => p.date < day).pop();
  return Number(prev?.expected ?? f.series[0]?.expected ?? 0);
}

export function evaluateAlerts(a: AlertInputs): CashAlert[] {
  const { v9, settings: s, today } = a;
  const f = v9.forecast;
  const out: CashAlert[] = [];

  // Low cash: first projected day below the minimum.
  if (s.minCash !== null && f.startsFromBank) {
    const p = f.series.find((x) => Number(x.expected) < s.minCash!);
    if (p) {
      const neg = Number(p.expected) < 0;
      out.push({ kind: "low_cash", key: "low_cash", fingerprint: p.date, severity: neg ? "critical" : "warning",
        title: `Projected cash falls below your ${usd(s.minCash)} minimum on ${shortDate(p.date)}`,
        body: `Expected balance that day: ${Number(p.expected) < 0 ? "−" : ""}${usd(Number(p.expected))}. This uses expected dates; scheduled-only is ${usd(Number(p.scheduled))}.`,
        details: { date: p.date, expected: p.expected, scheduled: p.scheduled, min: s.minCash },
        actions: [{ label: "See what's coming that week", href: `/financials/cash?focus=${p.date}#events` }, { label: "Review receivables", href: "/financials/receivables" }] });
    }
  }

  // Payroll coverage: for payroll in the next 45 days, is the expected balance before payday enough?
  for (const e of f.events.filter((x) => x.category === "payroll" && Number(x.amount) < 0 && diffDays(x.date, today) <= 45)) {
    const before = balanceBefore(f, e.date) + f.events.filter((x) => x.date === e.date && Number(x.amount) > 0).reduce((t, x) => t + Number(x.amount), 0);
    if (f.startsFromBank && before < -Number(e.amount)) {
      out.push({ kind: "payroll_coverage", key: `payroll:${e.date}`, fingerprint: bucket(before, 500), severity: "critical",
        title: `Projected cash may not cover ${shortDate(e.date)} payroll`,
        body: `Payroll about ${usd(Number(e.amount))}; expected cash available that day about ${before < 0 ? "−" : ""}${usd(before)}.`,
        details: { date: e.date, payroll: e.amount, available: before }, actions: [{ label: "Check collections due before payday", href: "/financials/receivables" }, { label: "Open cash flow", href: `/financials/cash?focus=${e.date}#events` }] });
    }
  }

  // Milestones: ready to confirm, or later than in the previous snapshot.
  for (const m of v9.milestones) {
    if (m.eligible && !m.triggered && m.rule) {
      out.push({ kind: "milestone_progress_reached", key: `milestone_progress_reached:${m.milestoneId}`, fingerprint: "reached", severity: "warning",
        title: `${m.jobName}: ${m.rule.threshold}% milestone reached (${usd(m.amount)})`,
        body: `Verified schedule progress is ${m.progress}%. Confirm it to make "${m.description}" ready to invoice; the invoice is prefilled from the signed schedule and nothing is sent until you send it.`,
        details: { milestoneId: m.milestoneId, jobId: m.jobId, progress: m.progress, threshold: m.rule.threshold }, actions: [{ label: "Confirm and invoice", href: `/financials/jobs/${m.jobId}#fin-milestones` }] });
    }
    const prev = a.previous[`ms:${m.milestoneId}`];
    if (prev && m.payOn && diffDays(m.payOn, prev) >= 3) {
      const d = diffDays(m.payOn, prev);
      out.push({ kind: "milestone_delayed", key: `milestone_delayed:${m.milestoneId}`, fingerprint: m.payOn, severity: "warning",
        title: `${m.jobName}: ${usd(m.amount)} payment now expected ${d} days later`,
        body: `"${m.description}" moved from ${shortDate(prev)} to ${shortDate(m.payOn)}. ${m.basis}.`,
        details: { milestoneId: m.milestoneId, jobId: m.jobId, from: prev, to: m.payOn, days: d }, actions: [{ label: "Open the payment schedule", href: `/financials/jobs/${m.jobId}` }] });
    }
  }

  // Cost overruns: a commitment revised above its original, or a job's forecast cost above its estimate.
  for (const c of a.commitments) {
    if (c.current > c.original + 0.005) {
      out.push({ kind: "cost_overrun", key: `overrun:commitment:${c.id}`, fingerprint: c.current.toFixed(2), severity: "warning",
        title: `${c.jobName}: ${c.vendorName ? `${c.vendorName} · ` : ""}${c.title} increased from ${usd(c.original)} to ${usd(c.current)}`,
        body: `Expected gross profit decreases by ${usd(c.current - c.original)} unless it's covered by a change order.`,
        details: { commitmentId: c.id, jobId: c.jobId, from: c.original, to: c.current }, actions: [{ label: "Review job costs", href: `/financials/jobs/${c.jobId}#fin-budget` }, { label: "Create a change order", href: `/financials/jobs/${c.jobId}` }] });
    }
  }
  for (const j of a.jobs) {
    const jc = v9.jobCosts[j.jobId];
    if (!jc) continue;
    if (jc.estimated > 0 && jc.actual + jc.committed > jc.estimated + Math.max(100, jc.estimated * 0.02)) {
      out.push({ kind: "cost_overrun", key: `overrun:job:${j.jobId}`, fingerprint: bucket(jc.actual + jc.committed, 250), severity: "warning",
        title: `${j.jobName}: actual + committed cost ${usd(jc.actual + jc.committed)} is over the ${usd(jc.estimated)} estimate`,
        body: `Over by ${usd(jc.actual + jc.committed - jc.estimated)} so far.`, details: { jobId: j.jobId }, actions: [{ label: "Budget vs actual", href: `/financials/jobs/${j.jobId}#fin-budget` }] });
    }
    const margin = j.contract > 0 ? ((j.contract - jc.forecast) / j.contract) * 100 : null;
    if (s.targetGrossMargin !== null && margin !== null && margin < s.targetGrossMargin) {
      out.push({ kind: "margin_low", key: `margin:job:${j.jobId}`, fingerprint: String(Math.floor(margin)), severity: margin < 0 ? "critical" : "warning",
        title: `${j.jobName}: projected gross margin ${margin.toFixed(1)}% is below your ${s.targetGrossMargin}% target`,
        body: `Contract ${usd(j.contract)}, forecast cost ${usd(jc.forecast)} (${v9.jobCosts[j.jobId].lines.length} cost lines).`, details: { jobId: j.jobId, margin }, actions: [{ label: "Review job costs", href: `/financials/jobs/${j.jobId}#fin-budget` }] });
    }
  }
  if (s.targetNetMargin !== null && v9.profit.netMargin !== null && v9.profit.netMargin < s.targetNetMargin) {
    out.push({ kind: "margin_low", key: "margin:company", fingerprint: String(Math.floor(v9.profit.netMargin)), severity: "warning",
      title: `Projected operating margin ${v9.profit.netMargin.toFixed(1)}% is below your ${s.targetNetMargin}% target`,
      body: `Jobs finishing in this window: gross profit ${usd(v9.profit.finishingInWindow.grossProfit)}, overhead ${usd(v9.profit.overheadInWindow)}. Interest and income tax aren't included.`,
      details: {}, actions: [{ label: "Profit & Loss", href: "/financials/reports" }] });
  }

  // Receivables past this customer's usual payment time + grace.
  for (const i of a.openInvoices) {
    if (!i.dueDate) continue;
    const late = diffDays(today, i.dueDate);
    if (late > i.usualDays + s.arGraceDays) {
      out.push({ kind: "receivable_late", key: `ar:${i.id}`, fingerprint: String(Math.floor(late / 14)), severity: late > 60 ? "critical" : "warning",
        title: `Invoice ${i.number}${i.customerName ? ` (${i.customerName})` : ""}: ${usd(i.balance)} is ${late} days past due`,
        body: `This customer usually pays ${i.usualDays} days after the due date.`, details: { invoiceId: i.id, late }, actions: [{ label: "Send a reminder", href: `/financials/records?view=invoices&invoice=${i.id}` }] });
    }
  }

  // Expense concentration: outflows in any N-day window above X% of the starting balance.
  if (f.startsFromBank && f.opening !== null && Number(f.opening) > 0) {
    const outs = f.events.filter((e) => Number(e.amount) < 0);
    const limit = (Number(f.opening) * s.concentrationPct) / 100;
    let worst: { from: string; sum: number; items: CashEvent[] } | null = null;
    for (const e of outs) {
      const win = outs.filter((x) => x.date >= e.date && diffDays(x.date, e.date) < s.concentrationDays);
      const sum = -win.reduce((t, x) => t + Number(x.amount), 0);
      if (sum > limit && (!worst || sum > worst.sum)) worst = { from: e.date, sum, items: win };
    }
    if (worst) {
      out.push({ kind: "expense_concentration", key: `concentration:${worst.from.slice(0, 7)}`, fingerprint: worst.from, severity: "warning",
        title: `${usd(worst.sum)} of payments fall within ${s.concentrationDays} days starting ${shortDate(worst.from)}`,
        body: `That's more than ${s.concentrationPct}% of today's balance. Largest: ${worst.items.sort((x, y) => Number(x.amount) - Number(y.amount)).slice(0, 3).map((x) => `${x.label} ${usd(Number(x.amount))}`).join("; ")}.`,
        details: { from: worst.from, total: worst.sum }, actions: [{ label: "See those payments", href: `/financials/cash?focus=${worst.from}#events` }] });
    }
  }

  // Confidence.
  if (v9.confidence.length) {
    out.push({ kind: "forecast_confidence", key: "confidence", fingerprint: v9.confidence.map((c) => c.slice(0, 20)).sort().join("|").slice(0, 200), severity: "info",
      title: `The forecast has ${v9.confidence.length} assumption${v9.confidence.length === 1 ? "" : "s"} to check`, body: v9.confidence.slice(0, 8).join(" "),
      details: { reasons: v9.confidence.slice(0, 20) }, actions: [{ label: "Forecast settings", href: "/financials/cash/settings" }] });
  }
  return out.filter((x) => !s.alertKindsOff.includes(x.kind));
}
