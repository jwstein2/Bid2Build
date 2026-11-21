/**
 * V9 forecast assembly (pure). Wraps the existing V6.9 engine (src/lib/tax-banking/forecast.ts buildForecast) instead of
 * replacing it: bank balances, approved bills, outstanding checks, deposits in transit, planned events and statement
 * logic stay exactly as they were. V9 swaps in better-dated customer collections and milestones and adds what V6.9
 * didn't have: open commitments, uncommitted budget, payroll from schedules, scenarios and what-ifs.
 *
 * Certainty stays three-way: Confirmed = bank-reported balance only; Scheduled = dated obligations and receivables on
 * their due dates; Expected = everything including estimates. Unpaid invoices are never cash.
 */
import { buildForecast, type CashEvent, type Forecast, type ForecastInput, type SeriesPoint } from "@/lib/tax-banking/forecast";
import { collectionRule, projectPayment, scenarioRule, type CollectionOverride, type CustomerHistory } from "./collections";
import { commitmentFlows, forecastJobCosts, remainingFlows, type BudgetRow, type CommitmentRow, type HistoryRatio, type JobCostForecast, type JobTiming } from "./costs";
import { addDays, diffDays, shortDate } from "./dates";
import { milestoneFlow, projectMilestone, type MilestoneProjection, type MilestoneRow, type ProgressRule } from "./milestones";
import { payrollFlows, payrollPeriods, type LaborInput, type PayrollPeriod } from "./payroll";
import type { CashSettings, ExpenseMode, Scenario } from "./settings";
import type { ExtraFlowV9 } from "./types";
import { applyWhatIf, type WhatIf } from "./whatif";

export interface V9Job extends JobTiming {
  customerId: string | null; contract: number; status: string; budget: BudgetRow[];
}
export interface V9Data {
  settings: CashSettings;
  jobs: V9Job[];
  milestones: MilestoneRow[];
  rules: ProgressRule[];
  commitments: CommitmentRow[];
  costOverrides: Record<string, Record<string, number>>;   // jobId -> costCodeId -> forecast at completion
  history: Record<string, CustomerHistory>;
  collectionOverrides: Record<string, CollectionOverride>;
  costHistory: Record<string, HistoryRatio>;
  invoiceIssueDates: Record<string, string>;
  labor: LaborInput | null;
}
export interface V9Options { scenario: Scenario; mode: ExpenseMode; whatIf: WhatIf[]; jobFilter?: string | null; categories?: string[] | null }

export interface V9Result {
  forecast: Forecast;
  flows: ExtraFlowV9[];
  milestones: MilestoneProjection[];
  jobCosts: Record<string, JobCostForecast>;
  payroll: PayrollPeriod[];
  excludedPlanned: string[];
  profit: ProfitSummary;
  runway: Runway;
  contribution: Contribution[];
  confidence: string[];
  end: string;
}

export interface ProfitSummary {
  openJobs: number; contract: number; forecastCost: number; grossProfit: number; grossMargin: number | null;
  finishingInWindow: { jobs: number; contract: number; grossProfit: number };
  overheadInWindow: number; operatingProfit: number; netMargin: number | null;
}
export interface Runway { belowZeroOn: string | null; belowMinOn: string | null; days: number | null; text: string }
export interface Contribution { jobId: string; name: string; cashIn: number; cashOut: number; net: number; lowest: number; lowestOn: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildV9(base: ForecastInput, data: V9Data, opt: V9Options): V9Result {
  const today = base.today;
  const end = base.endDate ?? addDays(today, Math.max(1, Math.min(365, base.horizonDays)));
  const s = data.settings;
  const confidence: string[] = [];
  const flows: ExtraFlowV9[] = [];

  // 1. Customer invoices (issued, unpaid): collection rule per customer. Invoices tied to a planned deposit are left to it.
  const plannedInvoices = new Set(base.planned.filter((p) => p.invoiceId && p.direction === "in").map((p) => p.invoiceId!));
  for (const inv of base.invoices) {
    if (plannedInvoices.has(inv.id) || Number(inv.balance) <= 0) continue;
    const issue = data.invoiceIssueDates[inv.id] ?? inv.dueDate ?? today;
    const cr = scenarioRule(collectionRule(inv.customerId, s, data.history, data.collectionOverrides), opt.scenario, s);
    const pay = projectPayment(issue, inv.dueDate, cr, today);
    const overdue = inv.dueDate !== null && inv.dueDate < today;
    flows.push({ key: `inv:${inv.id}`, label: `Invoice ${inv.number}${inv.customerName ? ` · ${inv.customerName}` : ""}`, amount: inv.balance, category: "customer_payment",
      scheduledOn: overdue || !inv.dueDate ? null : inv.dueDate, expectedOn: pay.date, href: `/financials/records?view=invoices&invoice=${inv.id}`, jobId: inv.jobId ?? null,
      source: "collection", note: `${overdue ? `Overdue ${diffDays(today, inv.dueDate!)} days. ` : ""}${pay.text}` });
  }

  // 2. Milestones not invoiced yet, dated by the schedule.
  const jobById = new Map(data.jobs.map((j) => [j.jobId, j]));
  const ruleBy = new Map(data.rules.map((r) => [r.milestoneId, r]));
  const msProj = data.milestones.filter((m) => m.invoiced < m.amount && m.state !== "paid").map((m) => {
    const j = jobById.get(m.jobId);
    return projectMilestone(m, ruleBy.get(m.id) ?? null, j?.schedule ?? null, j?.projection ?? null, s, data.history, data.collectionOverrides, today, opt.scenario);
  });
  for (const p of msProj) { const f = milestoneFlow(p); if (f) flows.push(f); }
  const undated = msProj.filter((p) => !p.payOn && p.amount > 0).length;
  if (undated) confidence.push(`${undated} payment milestone${undated === 1 ? " has" : "s have"} no date (no schedule and no contract date), so ${undated === 1 ? "it is" : "they are"} left out.`);

  // 3. Costs: open commitments by schedule + payment terms; uncommitted budget by mode.
  const jobCosts: Record<string, JobCostForecast> = {};
  for (const j of data.jobs) {
    if (j.status !== "open") continue;
    const jc = forecastJobCosts(j.contract, j.budget, opt.mode, s, data.costHistory, data.costOverrides[j.jobId] ?? {}, opt.scenario, s.conservativeCostPct);
    jobCosts[j.jobId] = jc;
    for (const c of data.commitments.filter((c) => c.jobId === j.jobId)) flows.push(...commitmentFlows(c, j, s, today));
    flows.push(...remainingFlows(j.jobId, j.jobName, jc.lines, j, s, today));
    for (const l of jc.lowConfidence) if (!confidence.includes(l)) confidence.push(l);
    if (!j.schedule) confidence.push(`${j.jobName}: no schedule, so its costs and milestones use rough dates.`);
    else if (j.schedule.status === "draft") confidence.push(`${j.jobName}: the schedule is still a draft.`);
  }

  // 4. Payroll from schedules (replaces manual payroll plan entries so the same payroll isn't counted twice).
  let payroll: PayrollPeriod[] = [];
  const excludedPlanned: string[] = [];
  if (s.payrollFromSchedule && data.labor) {
    payroll = payrollPeriods(data.labor, today, end, s.payrollPayLagDays, s.payrollBurdenPct);
    flows.push(...payrollFlows(payroll, s.payrollBurdenPct));
    excludedPlanned.push(...base.planned.filter((p) => p.kind === "payroll").map((p) => p.label));
    if (!s.payrollBurdenPct) confidence.push("Payroll burden (employer taxes, benefits, workers' comp) is set to 0%.");
    if (data.labor.uncostedStaff) confidence.push(`${data.labor.uncostedStaff} active staff ${data.labor.uncostedStaff === 1 ? "has" : "have"} no hourly cost, so their hours count as $0.`);
  }

  // 5. What-if adjustments (a copy; nothing saved).
  let adjusted = applyWhatIf(flows, opt.whatIf, today, end, s.payrollPayLagDays);
  if (opt.jobFilter) adjusted = adjusted.filter((f) => f.jobId === opt.jobFilter);
  if (opt.categories?.length) adjusted = adjusted.filter((f) => opt.categories!.includes(f.category));

  const input: ForecastInput = {
    ...base,
    invoices: [], milestones: [],
    // A job filter shows that job's own money only (bank balance stays as the start, company-level items drop out).
    bills: opt.jobFilter ? [] : base.bills, checks: opt.jobFilter ? [] : base.checks, planned: opt.jobFilter ? [] : base.planned,
    depositsInTransit: opt.jobFilter ? [] : base.depositsInTransit, recordedOutflows: opt.jobFilter ? [] : base.recordedOutflows,
    extra: adjusted, excludePlannedKinds: s.payrollFromSchedule && data.labor ? ["payroll"] : [],
  };
  if (opt.categories?.length && !opt.jobFilter) {
    input.bills = base.bills.filter((b) => opt.categories!.includes(b.vendorKind === "subcontractor" ? "subcontractor" : "supplier"));
    if (!opt.categories.includes("check")) input.checks = [];
  }
  const forecast = buildForecast(input);

  if (forecast.stale) confidence.push("The bank balance may be out of date.");
  if (!forecast.startsFromBank) confidence.push("No bank balance: the forecast shows the net change from today.");

  return { forecast, flows: adjusted, milestones: msProj, jobCosts, payroll, excludedPlanned, end,
    profit: profitSummary(data, jobCosts, forecast.events, end, payroll, s.payrollBurdenPct), runway: runway(forecast, s.minCash), contribution: contribution(forecast.events, data.jobs), confidence };
}

function profitSummary(data: V9Data, costs: Record<string, JobCostForecast>, events: CashEvent[], end: string, payroll: PayrollPeriod[], burdenPct: number): ProfitSummary {
  const open = data.jobs.filter((j) => j.status === "open" && costs[j.jobId]);
  const contract = open.reduce((a, j) => a + j.contract, 0);
  const cost = open.reduce((a, j) => a + costs[j.jobId].forecast, 0);
  const finishing = open.filter((j) => j.projection?.projectedEnd && j.projection.projectedEnd <= end);
  const fc = finishing.reduce((a, j) => a + j.contract, 0), fgp = finishing.reduce((a, j) => a + j.contract - costs[j.jobId].forecast, 0);
  // Overhead in the window = recurring and other company-level cash out not tied to a job (your cash plan and overhead
  // plans) + the shop/office/other share of payroll. Approved bills are left out: they are costs already incurred.
  const overhead = -events.filter((e) => !e.jobId && Number(e.amount) < 0 && (e.category === "recurring" || e.category === "other") && !e.key.startsWith("bill:"))
    .reduce((a, e) => a + Number(e.amount), 0) + payroll.reduce((a, p) => a + p.otherCost * (1 + burdenPct / 100), 0);
  const op = fgp - overhead;
  return { openJobs: open.length, contract: r2(contract), forecastCost: r2(cost), grossProfit: r2(contract - cost), grossMargin: contract ? r2(((contract - cost) / contract) * 100) : null,
    finishingInWindow: { jobs: finishing.length, contract: r2(fc), grossProfit: r2(fgp) }, overheadInWindow: r2(overhead), operatingProfit: r2(op), netMargin: fc ? r2((op / fc) * 100) : null };
}

/** Cash runway from dated flows (not an average burn rate): the first day the expected balance goes below $0 / your minimum. */
export function runway(f: Forecast, minCash: number | null): Runway {
  if (!f.startsFromBank) return { belowZeroOn: null, belowMinOn: null, days: null, text: "Needs a bank balance to estimate." };
  const zero = f.series.find((p) => Number(p.expected) < 0)?.date ?? null;
  const min = minCash !== null ? f.series.find((p) => Number(p.expected) < minCash)?.date ?? null : null;
  const first = f.series[0]?.date, last = f.series[f.series.length - 1]?.date;
  if (!first || !last) return { belowZeroOn: null, belowMinOn: null, days: null, text: "" };
  if (zero) return { belowZeroOn: zero, belowMinOn: min, days: diffDays(zero, first), text: `At expected dates, cash runs out on ${shortDate(zero)} (${diffDays(zero, first)} days).` };
  return { belowZeroOn: null, belowMinOn: min, days: null, text: `Cash stays above $0 through ${shortDate(last)}${min ? `, but drops below your minimum on ${shortDate(min)}` : ""}.` };
}

/** Which jobs bring cash in and which use it, inside the window (running total shows temporary cash use). */
export function contribution(events: CashEvent[], jobs: { jobId: string; jobName: string }[]): Contribution[] {
  const name = new Map(jobs.map((j) => [j.jobId, j.jobName]));
  const by = new Map<string, CashEvent[]>();
  for (const e of events) if (e.jobId) by.set(e.jobId, [...(by.get(e.jobId) ?? []), e]);
  return [...by.entries()].map(([jobId, es]) => {
    let run = 0, lowest = 0, lowestOn: string | null = null, inn = 0, out = 0;
    for (const e of [...es].sort((a, b) => a.date.localeCompare(b.date))) {
      const a = Number(e.amount); run += a; if (a > 0) inn += a; else out += a;
      if (run < lowest) { lowest = run; lowestOn = e.date; }
    }
    return { jobId, name: name.get(jobId) ?? "Job", cashIn: r2(inn), cashOut: r2(-out), net: r2(inn + out), lowest: r2(lowest), lowestOn };
  }).sort((a, b) => b.net - a.net);
}

export type Granularity = "day" | "week" | "month";
export interface Bucket { from: string; to: string; label: string; open: number; inflow: number; outflow: number; close: number; scheduledClose: number; events: CashEvent[] }

/** Daily, weekly or monthly buckets of the expected view (each bucket lists the events in it for drill-down). */
export function bucketize(series: SeriesPoint[], events: CashEvent[], g: Granularity): Bucket[] {
  if (!series.length) return [];
  const keyOf = (d: string) => (g === "day" ? d : g === "month" ? d.slice(0, 7) : weekKey(d));
  const out: Bucket[] = [];
  let prevClose = Number(series[0].expected) - events.filter((e) => e.date === series[0].date).reduce((a, e) => a + Number(e.amount), 0);
  for (const p of series) {
    const k = keyOf(p.date);
    let b = out[out.length - 1];
    if (!b || keyOf(b.from) !== k) { b = { from: p.date, to: p.date, label: g === "day" ? shortDate(p.date) : g === "month" ? monthLabel(p.date) : `Week of ${shortDate(p.date)}`, open: prevClose, inflow: 0, outflow: 0, close: prevClose, scheduledClose: Number(p.scheduled), events: [] }; out.push(b); }
    b.to = p.date;
    for (const e of events.filter((x) => x.date === p.date)) { b.events.push(e); if (Number(e.amount) > 0) b.inflow += Number(e.amount); else b.outflow -= Number(e.amount); }
    b.close = Number(p.expected); b.scheduledClose = Number(p.scheduled); prevClose = b.close;
  }
  return out.map((b) => ({ ...b, open: r2(b.open), inflow: r2(b.inflow), outflow: r2(b.outflow), close: r2(b.close), scheduledClose: r2(b.scheduledClose) }));
}
function weekKey(d: string) { const x = new Date(`${d}T12:00:00Z`); const dow = (x.getUTCDay() + 6) % 7; return addDays(d, -dow); }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(d: string) { return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`; }
