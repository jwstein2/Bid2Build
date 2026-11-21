/**
 * V9 cash forecasting engine (pure). The scenarios from the V9 spec, with controlled data:
 * 30% milestone from verified progress (not elapsed time), delayed schedule moving collections, the Nov 17 -> Nov 22
 * collection example, the $2,300 electrical commitment paid Dec 19, bills replacing commitments without double counting,
 * payroll incl. shop hours, overhead, scenario and expense-mode toggles, what-ifs, alerts and buckets.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/schedule/types";
import type { ForecastInput } from "@/lib/tax-banking/forecast";
import { projectSchedule, projectThreshold, type ScheduleInput } from "@/lib/cash-v9/schedule";
import { collectionRule, customerHistory, projectPayment } from "@/lib/cash-v9/collections";
import { projectMilestone, type MilestoneRow } from "@/lib/cash-v9/milestones";
import { commitmentFlows, forecastJobCosts, historicalRatios, type CommitmentRow } from "@/lib/cash-v9/costs";
import { payrollPeriods } from "@/lib/cash-v9/payroll";
import { bucketize, buildV9, type V9Data, type V9Job } from "@/lib/cash-v9/engine";
import { evaluateAlerts } from "@/lib/cash-v9/alerts";
import { applyWhatIf, parseWhatIf, serializeWhatIf } from "@/lib/cash-v9/whatif";
import { DEFAULT_SETTINGS, type CashSettings } from "@/lib/cash-v9/settings";

const task = (id: string, start: string, end: string, pct: number, extra: Partial<Task> = {}): Task => ({
  id, parentId: null, kind: "section", sourceGroupId: id, sourceItemId: null, splitFrom: null, name: id, sortOrder: 0, plannedStart: start, plannedEnd: end,
  durationDays: Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1, actualStart: pct > 0 ? start : null, actualFinish: pct >= 100 ? end : null,
  percentComplete: pct, status: pct >= 100 ? "complete" : pct > 0 ? "in_progress" : "not_started", weight: null, assignee: null, notes: null, ...extra,
});
// 10 equal 10-day phases from Nov 1: the plan reaches 30% at the end of Nov 30.
const tenPhases = (pcts: number[], shift = 0): ScheduleInput => ({
  id: "s1", status: "active",
  tasks: pcts.map((p, i) => {
    const s = new Date(Date.UTC(2026, 10, 1 + i * 10 + shift)).toISOString().slice(0, 10);
    const e = new Date(Date.UTC(2026, 10, 10 + i * 10 + shift)).toISOString().slice(0, 10);
    return task(`p${i}`, s, e, p);
  }),
});
const S = (o: Partial<CashSettings> = {}): CashSettings => ({ ...DEFAULT_SETTINGS, ...o });

describe("verified progress, not elapsed time", () => {
  it("reaches the 30% milestone only when entered % complete says so", () => {
    const done30 = tenPhases([100, 100, 100, 0, 0, 0, 0, 0, 0, 0]);
    expect(projectThreshold(done30, 30, "2026-11-20", "duration")).toMatchObject({ reached: true, progress: 30 });
    // Calendar says 60% of the time passed, but only 20% of work is done: not reached.
    const behind = tenPhases([100, 100, 0, 0, 0, 0, 0, 0, 0, 0]);
    const t = projectThreshold(behind, 30, "2026-12-30", "duration");
    expect(t.reached).toBe(false);
    expect(t.progress).toBe(20);
    expect(t.slipDays).toBeGreaterThan(0);
    expect(t.date! >= "2026-12-30").toBe(true);
  });
  it("financial weighting uses section estimated cost", () => {
    const s = { ...tenPhases([100, 0, 0, 0, 0, 0, 0, 0, 0, 0]), sectionCost: { p0: 90000, p1: 10000 } };
    s.tasks = s.tasks.slice(0, 2);
    expect(projectThreshold(s, 30, "2026-11-12", "financial")).toMatchObject({ reached: true, progress: 90, method: "financial" });
    expect(projectThreshold(s, 30, "2026-11-12", "duration").progress).toBe(50);
  });
  it("a schedule that slips 6 days moves the projected finish 6 days", () => {
    const a = projectSchedule(tenPhases(Array(10).fill(0)), "2026-10-20");
    const b = projectSchedule(tenPhases(Array(10).fill(0), 6), "2026-10-20");
    expect(Number(new Date(b.projectedEnd!)) - Number(new Date(a.projectedEnd!))).toBe(6 * 864e5);
  });
});

describe("collections", () => {
  it("Nov 17 invoice, due on receipt, customer pays 5 days after the invoice -> Nov 22", () => {
    const r = collectionRule("c1", S({ collectionBasis: "issue", collectionDays: 5, useHistory: false }), {}, {});
    expect(projectPayment("2026-11-17", "2026-11-17", r, "2026-11-10").date).toBe("2026-11-22");
  });
  it("history wins when there's enough of it; an override wins over history", () => {
    const hist = customerHistory([
      { customerId: "c1", issueDate: "2026-01-01", dueDate: "2026-01-01", paidOn: "2026-01-11" },
      { customerId: "c1", issueDate: "2026-02-01", dueDate: "2026-02-01", paidOn: "2026-02-11" },
      { customerId: "c1", issueDate: "2026-03-01", dueDate: "2026-03-01", paidOn: "2026-03-11" },
    ]);
    expect(collectionRule("c1", S({ collectionBasis: "issue" }), hist, {})).toMatchObject({ days: 10, source: "history", sample: 3 });
    expect(collectionRule("c1", S({ historyMinSample: 5 }), hist, {})).toMatchObject({ source: "default", days: 7 });
    expect(collectionRule("c1", S(), hist, { c1: { days: 3, basis: "due" } })).toMatchObject({ source: "override", days: 3 });
  });
});

const ms = (o: Partial<MilestoneRow>): MilestoneRow => ({ id: "m2", jobId: "j1", jobName: "Kitchen Remodel", customerId: "c1", seq: 2, description: "At 30% complete",
  triggerKind: "phase_completed_verified", dueRule: "on_trigger", dueDays: null, dueOn: null, amount: 30000, invoiced: 0, state: "not_triggered", triggeredAt: null, ...o });

describe("milestones", () => {
  it("projects the 30% milestone date from the schedule, then the payment from the customer's terms", () => {
    const s = S({ collectionBasis: "issue", collectionDays: 5, useHistory: false });
    const p = projectMilestone(ms({}), { milestoneId: "m2", threshold: 30, method: "duration", sectionKey: null }, tenPhases(Array(10).fill(0)), null, s, {}, {}, "2026-10-20");
    expect(p.invoiceOn).toBe("2026-11-30");
    expect(p.payOn).toBe("2026-12-05");
    expect(p.eligible).toBe(false);
    // Delayed 6 days -> invoice and payment 6 days later.
    const q = projectMilestone(ms({}), { milestoneId: "m2", threshold: 30, method: "duration", sectionKey: null }, tenPhases(Array(10).fill(0), 6), null, s, {}, {}, "2026-10-20");
    expect(q.payOn).toBe("2026-12-11");
  });
  it("reached threshold = eligible for confirmation (not invoiced automatically)", () => {
    const p = projectMilestone(ms({}), { milestoneId: "m2", threshold: 30, method: "duration", sectionKey: null }, tenPhases([100, 100, 100, 0, 0, 0, 0, 0, 0, 0]), null, S(), {}, {}, "2026-11-25");
    expect(p).toMatchObject({ eligible: true, triggered: false, invoiceOn: "2026-11-25" });
  });
  it("net-days due rule and a partially invoiced milestone", () => {
    const p = projectMilestone(ms({ triggerKind: "calendar_date", dueRule: "date", dueOn: "2026-12-01", invoiced: 10000 }), null, null, null, S({ collectionDays: 0 }), {}, {}, "2026-11-01");
    expect(p).toMatchObject({ amount: 20000, invoiceOn: "2026-12-01", payOn: "2026-12-01" });
  });
});

const commitment = (o: Partial<CommitmentRow> = {}): CommitmentRow => ({ id: "c-el", jobId: "j1", costCodeId: "cc-el", number: "SC-1", title: "Electrical", kind: "subcontract", vendorName: "Sparky",
  original: 2300, current: 2300, billed: 0, open: 2300, quoteGroupId: "elec", trade: "electrical", terms: null, ...o });

describe("costs", () => {
  const sched: ScheduleInput = { id: "s1", status: "active", tasks: [task("demo", "2026-12-01", "2026-12-05", 0), task("elec", "2026-12-08", "2026-12-12", 0)] };
  const timing = { jobId: "j1", jobName: "Kitchen Remodel", schedule: sched, projection: projectSchedule(sched, "2026-11-21"), snapshotSections: [] };
  it("$2,300 electrical commitment is paid 7 days after the work finishes (Dec 19), at cost not selling price", () => {
    const f = commitmentFlows(commitment(), timing, S({ subPayDays: 7 }), "2026-11-21");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ amount: "-2300.00", expectedOn: "2026-12-19", category: "subcontractor" });
  });
  it("a fully billed commitment adds nothing (the approved bill carries it)", () => {
    expect(commitmentFlows(commitment({ billed: 2300, open: 0 }), timing, S(), "2026-11-21")).toHaveLength(0);
  });
  it("retainage and deposit terms split the payment", () => {
    const f = commitmentFlows(commitment({ terms: { payBasis: "completion", payDays: 7, payDate: null, sectionKey: null, retainagePct: 10, depositAmount: 300, depositOn: "2026-12-01" } }), timing, S(), "2026-11-21");
    expect(f.map((x) => x.amount)).toEqual(["-300.00", "-1800.00", "-200.00"]);
  });
  it("modes change only uncommitted spending; actual stays actual", () => {
    const rows = [{ costCodeId: "m", code: "M", name: "Materials", costType: "material", trade: null, estimated: 20000, committed: 2000, actual: 5000 }];
    const known = forecastJobCosts(100000, rows, "known", S(), {}, {});
    expect(known).toMatchObject({ actual: 5000, committed: 2000, remaining: 13000, forecast: 20000 });
    const hist = historicalRatios([{ contract: 100000, costs: { material: 25000 } }, { contract: 50000, costs: { material: 12500 } }, { contract: 50000, costs: { material: 12500 } }]);
    expect(forecastJobCosts(100000, rows, "historical", S(), hist, {})).toMatchObject({ actual: 5000, remaining: 18000, forecast: 25000 });
    expect(forecastJobCosts(100000, rows, "historical", S({ historyMinSample: 5 }), hist, {}).lowConfidence[0]).toMatch(/Not enough completed jobs/);
    expect(forecastJobCosts(100000, rows, "benchmark", S({ benchmark: { material: 30 } }), {}, {})).toMatchObject({ remaining: 23000, forecast: 30000 });
    expect(forecastJobCosts(100000, rows, "known", S(), {}, { m: 9000 })).toMatchObject({ remaining: 2000, forecast: 9000 });
  });
});

describe("payroll", () => {
  it("includes shop hours, uses clocked hours for past days, pays at period end + lag, adds burden", () => {
    const l = { payFrequency: "weekly" as const, periodAnchor: "2026-11-16", staff: 2, uncostedStaff: 0,
      actual: [{ date: "2026-11-17", category: "project", scheduleId: "s1", hours: 8, cost: 240 }],
      scheduled: [{ date: "2026-11-23", category: "shop", scheduleId: null, hours: 8, cost: 200 }, { date: "2026-11-17", category: "project", scheduleId: "s1", hours: 8, cost: 999 }] };
    const p = payrollPeriods(l, "2026-11-20", "2026-12-31", 5, 10);
    expect(p[0]).toMatchObject({ from: "2026-11-16", to: "2026-11-22", payOn: "2026-11-27", actualCost: 240, scheduledCost: 0, total: 264 });
    expect(p[1]).toMatchObject({ from: "2026-11-23", payOn: "2026-12-04", otherCost: 200, total: 220 });
  });
});

const baseInput = (o: Partial<ForecastInput> = {}): ForecastInput => ({
  today: "2026-11-21", horizonDays: 60, includeBankBalance: true,
  accounts: [{ id: "a1", name: "Checking", current: "20000.00", available: "20000.00", asOf: new Date().toISOString(), status: "active", included: true }],
  invoices: [], milestones: [], bills: [], checks: [], depositsInTransit: [], planned: [], ...o,
});
const job = (o: Partial<V9Job> = {}): V9Job => {
  const sched: ScheduleInput = { id: "s1", status: "active", tasks: [task("demo", "2026-12-01", "2026-12-05", 0), task("elec", "2026-12-08", "2026-12-12", 0)] };
  return { jobId: "j1", jobName: "Kitchen Remodel", schedule: sched, projection: projectSchedule(sched, "2026-11-21"), snapshotSections: [], customerId: "c1", contract: 15000, status: "open",
    budget: [{ costCodeId: "cc-el", code: "EL", name: "Electrical", costType: "subcontractor", trade: "electrical", estimated: 2300, committed: 2300, actual: 0 }], ...o };
};
const data = (o: Partial<V9Data> = {}): V9Data => ({ settings: S(), jobs: [job()], milestones: [], rules: [], commitments: [commitment()], costOverrides: {}, history: {},
  collectionOverrides: {}, costHistory: {}, invoiceIssueDates: {}, labor: null, ...o });

describe("assembled forecast", () => {
  it("commitment + approved bill for the same work count once", () => {
    const billed = buildV9(baseInput({ bills: [{ id: "b1", label: "Bill · Sparky", balance: "2300.00", dueDate: "2026-12-19", vendorKind: "subcontractor" }] }),
      data({ commitments: [commitment({ billed: 2300, open: 0 })], jobs: [job({ budget: [{ costCodeId: "cc-el", code: "EL", name: "Electrical", costType: "subcontractor", trade: null, estimated: 2300, committed: 0, actual: 2300 }] })] }),
      { scenario: "expected", mode: "known", whatIf: [] });
    expect(billed.forecast.totals.expectedOut).toBe("-2300.00");
    const committed = buildV9(baseInput(), data(), { scenario: "expected", mode: "known", whatIf: [] });
    expect(committed.forecast.totals.expectedOut).toBe("-2300.00");
    expect(committed.forecast.series.find((p) => p.date === "2026-12-19")?.expected).toBe("17700.00");
  });
  it("unpaid invoices are never cash; partial payments use the balance; conservative pays later", () => {
    const inv = [{ id: "i1", number: "INV-1", balance: "4000.00", dueDate: "2026-11-25", customerId: "c1", jobId: "j1" }];
    const exp = buildV9(baseInput({ invoices: inv }), data({ commitments: [], jobs: [] }), { scenario: "expected", mode: "known", whatIf: [] });
    expect(exp.forecast.end.confirmed).toBe("20000.00");
    expect(exp.forecast.events[0]).toMatchObject({ date: "2026-12-02", amount: "4000.00", certainty: "scheduled" });
    const cons = buildV9(baseInput({ invoices: inv }), data({ commitments: [], jobs: [] }), { scenario: "conservative", mode: "known", whatIf: [] });
    expect(cons.forecast.events[0].date).toBe("2026-12-16");
    const opt = buildV9(baseInput({ invoices: inv }), data({ commitments: [], jobs: [] }), { scenario: "optimistic", mode: "known", whatIf: [] });
    expect(opt.forecast.events[0].date).toBe("2026-11-25");
  });
  it("recurring overhead counts; manual payroll is replaced when payroll comes from schedules", () => {
    const planned = [
      { id: "rent", kind: "recurring_expense", label: "Shop rent", amount: "2000.00", direction: "out" as const, expectedOn: "2026-12-01", recurrence: "monthly" as const, recurUntil: null, certainty: "scheduled" as const, accountId: null, toAccountId: null, invoiceId: null },
      { id: "pay", kind: "payroll", label: "Manual payroll", amount: "5000.00", direction: "out" as const, expectedOn: "2026-11-27", recurrence: "none" as const, recurUntil: null, certainty: "scheduled" as const, accountId: null, toAccountId: null, invoiceId: null },
    ];
    const labor = { payFrequency: "weekly" as const, periodAnchor: "2026-11-16", staff: 1, uncostedStaff: 0, actual: [], scheduled: [{ date: "2026-11-23", category: "shop", scheduleId: null, hours: 40, cost: 1000 }] };
    const r = buildV9(baseInput({ planned }), data({ commitments: [], jobs: [], labor, settings: S({ payrollFromSchedule: true }) }), { scenario: "expected", mode: "known", whatIf: [] });
    const labels = r.forecast.events.map((e) => e.label);
    expect(labels).toContain("Shop rent");
    expect(labels).not.toContain("Manual payroll");
    expect(r.excludedPlanned).toEqual(["Manual payroll"]);
    expect(r.forecast.events.find((e) => e.category === "payroll")).toMatchObject({ amount: "-1000.00", date: "2026-12-04" });
    expect(r.confidence.join(" ")).toMatch(/burden/);
  });
  it("what-ifs change a copy only", () => {
    const d = data();
    const before = JSON.stringify(d);
    const r = buildV9(baseInput(), d, { scenario: "expected", mode: "known", whatIf: [{ kind: "expense", amount: 5000, date: "2026-12-01" }, { kind: "delay", days: 14, jobId: "j1" }] });
    expect(JSON.stringify(d)).toBe(before);
    expect(r.forecast.events.find((e) => e.label.startsWith("Unexpected"))?.amount).toBe("-5000.00");
    expect(r.forecast.events.find((e) => e.key === "cmt:c-el")?.date).toBe("2027-01-02");
    expect(parseWhatIf(serializeWhatIf([{ kind: "late", days: 15 }, { kind: "hire", hourlyCost: 25, hoursPerWeek: 40, start: "2026-12-01" }]))).toHaveLength(2);
    expect(parseWhatIf("late:abc,delay:5:not-a-uuid,expense:100:2026-13-01")).toHaveLength(0);
    expect(applyWhatIf([{ key: "inv:1", label: "x", amount: "100", category: "customer_payment", scheduledOn: null, expectedOn: "2026-12-01", href: null, jobId: "j1", source: "collection" }],
      [{ kind: "remove_job", jobId: "j1" }], "2026-11-21", "2027-01-01")).toHaveLength(1);
  });
  it("job filter and runway / contribution", () => {
    const r = buildV9(baseInput({ bills: [{ id: "b9", label: "Overhead bill", balance: "100.00", dueDate: "2026-11-30" }] }), data(), { scenario: "expected", mode: "known", whatIf: [], jobFilter: "j1" });
    expect(r.forecast.events.every((e) => e.jobId === "j1")).toBe(true);
    expect(r.contribution[0]).toMatchObject({ jobId: "j1", cashOut: 2300, net: -2300 });
    expect(r.runway.text).toMatch(/stays above \$0/);
  });
});

describe("alerts", () => {
  it("low cash, payroll coverage, $2,300 -> $3,100 overrun, late receivable, confidence; kinds can be turned off", () => {
    const labor = { payFrequency: "weekly" as const, periodAnchor: "2026-11-16", staff: 1, uncostedStaff: 0, actual: [], scheduled: [{ date: "2026-11-23", category: "shop", scheduleId: null, hours: 40, cost: 25000 }] };
    const s = S({ minCash: 15000, payrollFromSchedule: true });
    const v9 = buildV9(baseInput(), data({ settings: s, labor }), { scenario: "expected", mode: "known", whatIf: [] });
    const alerts = evaluateAlerts({ v9, settings: s, today: "2026-11-21", previous: {}, jobs: [{ jobId: "j1", jobName: "Kitchen Remodel", contract: 15000 }],
      commitments: [{ id: "c-el", jobId: "j1", jobName: "Kitchen Remodel", title: "Electrical", vendorName: null, original: 2300, current: 3100 }],
      openInvoices: [{ id: "i1", number: "INV-1", customerName: "Pat", balance: 1000, dueDate: "2026-10-01", usualDays: 5 }] });
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["low_cash", "payroll_coverage", "cost_overrun", "receivable_late", "forecast_confidence"]));
    const over = alerts.find((a) => a.key === "overrun:commitment:c-el")!;
    expect(over.title).toMatch(/increased from \$2,300 to \$3,100/);
    expect(over.body).toMatch(/decreases by \$800/);
    expect(alerts.find((a) => a.kind === "low_cash")!.title).toMatch(/below your \$15,000 minimum on Dec 4/);
    const off = evaluateAlerts({ v9, settings: { ...s, alertKindsOff: ["low_cash"] }, today: "2026-11-21", previous: {}, jobs: [], commitments: [], openInvoices: [] });
    expect(off.map((a) => a.kind)).not.toContain("low_cash");
  });
  it("delayed milestone compares with the last snapshot", () => {
    const s = S({ useHistory: false, collectionDays: 0 });
    const v9 = buildV9(baseInput(), data({ settings: s, milestones: [ms({ triggerKind: "final_completion_confirmed", amount: 12000 })], commitments: [] }), { scenario: "expected", mode: "known", whatIf: [] });
    const payOn = v9.milestones[0].payOn!;
    const prev = new Date(Date.parse(payOn) - 6 * 864e5).toISOString().slice(0, 10);
    const a = evaluateAlerts({ v9, settings: s, today: "2026-11-21", previous: { "ms:m2": prev }, jobs: [], commitments: [], openInvoices: [] });
    expect(a.find((x) => x.kind === "milestone_delayed")!.title).toBe("Kitchen Remodel: $12,000 payment now expected 6 days later");
  });
});

describe("buckets", () => {
  it("weekly buckets add up and keep their events", () => {
    const r = buildV9(baseInput(), data(), { scenario: "expected", mode: "known", whatIf: [] });
    const w = bucketize(r.forecast.series, r.forecast.events, "week");
    expect(w.reduce((a, b) => a + b.outflow, 0)).toBe(2300);
    expect(w[w.length - 1].close).toBe(Number(r.forecast.end.expected));
    expect(bucketize(r.forecast.series, r.forecast.events, "month").map((b) => b.label)).toEqual(["November 2026", "December 2026", "January 2027"]);
  });
});
