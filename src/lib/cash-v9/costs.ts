/**
 * Job cost forecast and cost timing (pure).
 *
 * Per job x cost code, the existing records give: estimated (the signed bid's frozen budget), committed (open
 * subcontracts / POs not yet billed), actual (approved bills + approved expenses + approved timesheet labor). Those come
 * from the existing fin_job_budget_v and are never changed here.
 *
 * Hierarchy (V9 spec): actual -> approved bill -> remaining binding commitment -> accepted quote (already a commitment
 * when accepted) -> estimate -> historical average -> your benchmark. In numbers:
 *   remaining (uncommitted) = max(0, basis - actual - committed)
 *   forecast at completion   = actual + committed + remaining
 * where basis = your override for that line if you set one, else by mode:
 *   known      -> the estimate (so forecast = max(estimate, actual + committed), same as the existing job page)
 *   historical -> contract x what completed jobs actually spent on that cost type / their contract (enough jobs only)
 *   benchmark  -> contract x the percent you set for that cost type
 * Actual costs stay actual in every mode; the mode only changes the assumption for spending that isn't committed yet.
 * A commitment and its bill are never both counted: billed amounts leave "committed" (fin_commitment_balances_v) and
 * show up as approved bills (cash by due date) or actual cost.
 */
import { addDays, diffDays, maxD, minD, shortDate } from "./dates";
import type { ExtraFlowV9 } from "./types";
import { sectionDates, sectionsForTrade, type Projection, type ScheduleInput } from "./schedule";
import type { CashSettings, ExpenseMode, Scenario } from "./settings";

const LABOR_TYPES = new Set(["labor", "labor_burden"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BudgetRow { costCodeId: string | null; code: string | null; name: string | null; costType: string | null; trade: string | null; estimated: number; committed: number; actual: number }
export interface CommitmentRow {
  id: string; jobId: string; costCodeId: string | null; number: string; title: string; kind: "subcontract" | "purchase_order"; vendorName: string | null;
  original: number; current: number; billed: number; open: number; quoteGroupId: string | null; trade: string | null;
  terms: { payBasis: "completion" | "start" | "date"; payDays: number; payDate: string | null; sectionKey: string | null; retainagePct: number; depositAmount: number | null; depositOn: string | null } | null;
}
export interface HistoryRatio { ratio: number; jobs: number }

export interface CostLine {
  costCodeId: string | null; label: string; costType: string; trade: string | null;
  estimated: number; committed: number; actual: number; basis: number; basisSource: "override" | "estimate" | "historical" | "benchmark";
  remaining: number; forecast: number; note?: string;
}
export interface JobCostForecast { lines: CostLine[]; estimated: number; committed: number; actual: number; remaining: number; forecast: number; lowConfidence: string[] }

/** What completed jobs spent per cost type, as a share of their contract. */
export function historicalRatios(closed: { contract: number; costs: Record<string, number> }[]): Record<string, HistoryRatio> {
  const jobs = closed.filter((j) => j.contract > 0);
  const total = jobs.reduce((a, j) => a + j.contract, 0);
  if (!total) return {};
  const types = new Set(jobs.flatMap((j) => Object.keys(j.costs)));
  return Object.fromEntries([...types].map((t) => [t, { ratio: jobs.reduce((a, j) => a + (j.costs[t] ?? 0), 0) / total, jobs: jobs.length }]));
}

export function forecastJobCosts(contract: number, rows: BudgetRow[], mode: ExpenseMode, s: Pick<CashSettings, "benchmark" | "historyMinSample">,
  history: Record<string, HistoryRatio>, overrides: Record<string, number>, scenario: Scenario = "expected", conservativePct = 0): JobCostForecast {
  const low = new Set<string>();
  const byType = new Map<string, BudgetRow[]>();
  for (const r of rows) { const t = r.costType ?? "other"; byType.set(t, [...(byType.get(t) ?? []), r]); }
  const lines: CostLine[] = [];
  for (const [type, rs] of byType) {
    const estType = rs.reduce((a, r) => a + r.estimated, 0);
    let typeBasis: number | null = null;
    let src: CostLine["basisSource"] = "estimate";
    if (mode === "historical") {
      const h = history[type];
      if (h && h.jobs >= s.historyMinSample) { typeBasis = contract * h.ratio; src = "historical"; }
      else low.add(`Not enough completed jobs to average ${type.replace(/_/g, " ")} costs (${h?.jobs ?? 0} of ${s.historyMinSample}); the estimate is used.`);
    } else if (mode === "benchmark") {
      const b = s.benchmark[type];
      if (typeof b === "number") { typeBasis = (contract * b) / 100; src = "benchmark"; }
      else if (estType > 0) low.add(`No benchmark set for ${type.replace(/_/g, " ")}; the estimate is used.`);
    }
    for (const r of rs) {
      const share = typeBasis === null ? null : estType > 0 ? (typeBasis * r.estimated) / estType : typeBasis / rs.length;
      const ov = overrides[r.costCodeId ?? ""];
      const basis = ov !== undefined ? ov : share !== null ? share : r.estimated;
      const source: CostLine["basisSource"] = ov !== undefined ? "override" : share !== null ? src : "estimate";
      let remaining = Math.max(0, basis - r.actual - r.committed);
      if (scenario === "conservative" && source !== "override") remaining *= 1 + conservativePct / 100;
      lines.push({ costCodeId: r.costCodeId, label: r.name ?? r.code ?? "Uncoded cost", costType: type, trade: r.trade, estimated: r2(r.estimated), committed: r2(r.committed), actual: r2(r.actual),
        basis: r2(basis), basisSource: source, remaining: r2(remaining), forecast: r2(r.actual + r.committed + remaining),
        note: r.actual + r.committed > basis + 0.005 ? "Actual + committed already exceed the basis" : undefined });
    }
  }
  const sum = (k: keyof CostLine) => r2(lines.reduce((a, l) => a + (l[k] as number), 0));
  return { lines, estimated: sum("estimated"), committed: sum("committed"), actual: sum("actual"), remaining: sum("remaining"), forecast: sum("forecast"), lowConfidence: [...low] };
}

export interface JobTiming {
  jobId: string; jobName: string; schedule: ScheduleInput | null; projection: Projection | null; snapshotSections: { id: string; trade: string | null }[];
}

/** Cash-out timing of open commitments (when you'll pay the sub / supplier, not when work starts). */
export function commitmentFlows(c: CommitmentRow, t: JobTiming, s: Pick<CashSettings, "subPayDays" | "supplierPayDays">, today: string): ExtraFlowV9[] {
  if (c.open <= 0) return [];
  const out: ExtraFlowV9[] = [];
  const payDays = c.terms?.payDays ?? (c.kind === "purchase_order" ? s.supplierPayDays : s.subPayDays);
  const slip = t.projection?.slipDays ?? 0;
  const section = c.terms?.sectionKey ?? c.quoteGroupId ?? sectionsForTrade(t.snapshotSections, c.trade)[0] ?? null;
  const sd = section && t.schedule ? sectionDates(t.schedule, section, today, slip) : null;
  const jobEnd = t.projection?.projectedEnd ?? null;
  let open = c.open;
  const who = `${c.vendorName ?? "Vendor"} · ${c.title}`;
  const href = `/financials/jobs/${c.jobId}#fin-commitments`;
  if (c.terms?.depositAmount && c.terms.depositOn && c.billed === 0) {
    const dep = Math.min(open, c.terms.depositAmount);
    out.push({ key: `cmt-dep:${c.id}`, label: `Deposit · ${who}`, amount: (-dep).toFixed(2), category: c.kind === "purchase_order" ? "supplier" : "subcontractor",
      scheduledOn: maxD(c.terms.depositOn, today), expectedOn: maxD(c.terms.depositOn, today), href, jobId: c.jobId, source: "commitment",
      note: `Deposit you set on commitment ${c.number}` });
    open -= dep;
  }
  const ret = c.terms?.retainagePct ? r2((open * c.terms.retainagePct) / 100) : 0;
  let on: string; let why: string; let scheduled = false;
  if (c.terms?.payBasis === "date" && c.terms.payDate) { on = c.terms.payDate; why = `Pay date you set`; scheduled = true; }
  else if (sd) {
    const anchor = c.terms?.payBasis === "start" ? sd.start : sd.end;
    on = addDays(anchor, payDays);
    why = `${c.terms?.payBasis === "start" ? "Work starts" : sd.done ? "Work finished" : "Work projected to finish"} ${shortDate(anchor)}, paid ${payDays} days after`;
  } else if (jobEnd) { on = addDays(jobEnd, payDays); why = `Not linked to a schedule phase: assumed ${payDays} days after the job's projected finish (${shortDate(jobEnd)})`; }
  else { on = addDays(today, 30); why = "No schedule for this job: assumed in about 30 days"; }
  if (on < today) { why += `; that date has passed with no bill entered, so it is shown as due now`; on = today; }
  if (open - ret > 0) out.push({ key: `cmt:${c.id}`, label: who, amount: (-(open - ret)).toFixed(2), category: c.kind === "purchase_order" ? "supplier" : "subcontractor",
    scheduledOn: scheduled ? on : null, expectedOn: on, href, jobId: c.jobId, source: "commitment", note: `Committed $${(open - ret).toFixed(2)} (${c.number}). ${why}.` });
  if (ret > 0) {
    const rOn = addDays(jobEnd ?? on, payDays);
    out.push({ key: `cmt-ret:${c.id}`, label: `Retainage · ${who}`, amount: (-ret).toFixed(2), category: c.kind === "purchase_order" ? "supplier" : "subcontractor",
      scheduledOn: null, expectedOn: maxD(rOn, today), href, jobId: c.jobId, source: "commitment", note: `${c.terms!.retainagePct}% held until the job finishes` });
  }
  return out;
}

/**
 * Uncommitted remaining cost, spread evenly by week over the job's remaining projected schedule and paid on your usual
 * terms after each week. Labor is left out when payroll comes from schedules (payroll already carries it).
 */
export function remainingFlows(jobId: string, jobName: string, lines: CostLine[], t: JobTiming, s: Pick<CashSettings, "subPayDays" | "supplierPayDays" | "payrollFromSchedule" | "payrollPayLagDays">, today: string): ExtraFlowV9[] {
  const out: ExtraFlowV9[] = [];
  const start = t.projection?.start ? maxD(t.projection.start, today) : null;
  const end = t.projection?.projectedEnd ? maxD(t.projection.projectedEnd, today) : null;
  for (const l of lines) {
    if (l.remaining <= 0.005) continue;
    if (s.payrollFromSchedule && LABOR_TYPES.has(l.costType)) continue;
    const lag = l.costType === "subcontractor" ? s.subPayDays : LABOR_TYPES.has(l.costType) ? s.payrollPayLagDays : s.supplierPayDays;
    const cat = l.costType === "subcontractor" ? "subcontractor" as const : LABOR_TYPES.has(l.costType) ? "payroll" as const : "supplier" as const;
    const srcText = l.basisSource === "override" ? "your override" : l.basisSource === "historical" ? "your completed jobs' average" : l.basisSource === "benchmark" ? "your benchmark" : "the signed bid's estimate";
    if (!start || !end) {
      out.push({ key: `rem:${jobId}:${l.costCodeId ?? l.costType}`, label: `${jobName} · ${l.label} (not committed yet)`, amount: (-l.remaining).toFixed(2), category: cat,
        scheduledOn: null, expectedOn: addDays(today, 30), href: `/financials/jobs/${jobId}#fin-budget`, jobId, source: "estimate",
        note: `Estimated from ${srcText}. No schedule, so assumed in about 30 days.` });
      continue;
    }
    const weeks = Math.min(52, Math.max(1, Math.ceil((diffDays(end, start) + 1) / 7)));
    const per = Math.floor((l.remaining / weeks) * 100) / 100;
    for (let i = 0; i < weeks; i++) {
      const wkEnd = minD(addDays(start, i * 7 + 6), end);
      const amt = i === weeks - 1 ? r2(l.remaining - per * (weeks - 1)) : per;
      if (amt <= 0) continue;
      out.push({ key: `rem:${jobId}:${l.costCodeId ?? l.costType}:${i}`, label: `${jobName} · ${l.label} (not committed yet)`, amount: (-amt).toFixed(2), category: cat,
        scheduledOn: null, expectedOn: addDays(wkEnd, lag), href: `/financials/jobs/${jobId}#fin-budget`, jobId, source: "estimate",
        note: `Estimated from ${srcText}, spread over the remaining schedule (week ${i + 1} of ${weeks}), paid ${lag} days later.` });
    }
  }
  return out;
}
