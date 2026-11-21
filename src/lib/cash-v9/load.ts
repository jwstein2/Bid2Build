import "server-only";
/**
 * V9 data loading. Always the signed-in user's client: RLS decides what each person sees. Builds on the V6.9 loader
 * (loadForecast) for the base forecast input, then reads schedules, milestones, commitments, settings and labor sums.
 * If the V9 SQL isn't installed, returns { installed: false } and the page shows the V6.9 forecast only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissing } from "@/lib/financials/loaders";
import { mapTask } from "@/lib/schedule/server";
import { loadForecast, type CashQuery } from "@/lib/tax-banking/load";
import type { ForecastInput } from "@/lib/tax-banking/forecast";
import { customerHistory, type CollectionOverride } from "./collections";
import { historicalRatios, type BudgetRow, type CommitmentRow } from "./costs";
import type { V9Data, V9Job } from "./engine";
import type { MilestoneRow, ProgressRule } from "./milestones";
import { mapLabor } from "./payroll";
import { projectSchedule, projectThreshold, type ScheduleInput, type WeightMethod } from "./schedule";
import { mapSettings } from "./settings";

type Db = SupabaseClient;
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const d10 = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 10));
const n = (v: unknown) => Number(v ?? 0) || 0;
const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

export const isCashV9Enabled = () => process.env.NEXT_PUBLIC_CASH_V9 === "on";

export async function loadV9(db: Db, bookId: string, perms: readonly string[], q: CashQuery, today = new Date().toISOString().slice(0, 10)) {
  const settingsRes = await db.from("fin_cash_settings").select("*").eq("book_id", bookId).maybeSingle();
  if (settingsRes.error && isMissing(settingsRes.error)) return { installed: false as const };
  const settings = mapSettings(settingsRes.data as Row | null);
  const base = await loadForecast(db, bookId, perms, q, today);
  if (!base.installed) return { installed: false as const };

  const [jobsR, budgetR, cmtR, termsR, msR, rulesR, ovR, collR, paidR, openInvR] = await Promise.all([
    db.from("fin_job_contract_v").select("job_id, estimate_id, name, job_number, status, current_contract").eq("book_id", bookId).limit(1000),
    db.from("fin_job_budget_v").select("job_id, cost_code_id, code, cost_code_name, cost_type, trade_slug, estimated, committed, actual").eq("book_id", bookId).limit(20000),
    db.from("fin_commitment_balances_v").select("commitment_id, job_id, vendor_id, cost_code_id, number, title, status, original_amount, current_amount, billed, open_committed").eq("book_id", bookId).limit(5000),
    db.from("fin_commitment_terms").select("*").eq("book_id", bookId),
    db.from("fin_milestone_status_v").select("milestone_id, job_id, seq, description, trigger_kind, due_rule, due_on, current_amount, invoiced, state, triggered_at").eq("book_id", bookId).limit(5000),
    db.from("fin_milestone_progress_rules").select("milestone_id, threshold, method, section_key").eq("book_id", bookId),
    db.from("fin_forecast_overrides").select("job_id, cost_code_id, amount").eq("book_id", bookId).is("superseded_at", null),
    db.from("fin_customer_collection_terms").select("customer_id, days, basis").eq("book_id", bookId),
    db.from("fin_invoice_balances_v").select("invoice_id, customer_id, issue_date, due_date").eq("book_id", bookId).eq("status", "issued").lte("balance", 0).limit(1000),
    db.from("fin_invoice_balances_v").select("invoice_id, issue_date").eq("book_id", bookId).eq("status", "issued").gt("balance", 0).limit(2000),
  ]);
  const jobsAll = rows(jobsR);
  const jobRows = jobsAll.filter((j) => j.status === "open");
  const [extraJobInfo, msDue, commitExtra] = await Promise.all([
    jobRows.length ? db.from("fin_jobs").select("id, customer_id").in("id", jobRows.map((j) => String(j.job_id))) : Promise.resolve({ data: [] }),
    rows(msR).length ? db.from("fin_payment_milestones").select("id, due_days").in("id", rows(msR).map((m) => String(m.milestone_id)).slice(0, 2000)) : Promise.resolve({ data: [] }),
    rows(cmtR).length ? db.from("fin_commitments").select("id, kind, quote_id").in("id", rows(cmtR).map((c) => String(c.commitment_id))) : Promise.resolve({ data: [] }),
  ]);
  const customerOf = new Map(rows(extraJobInfo).map((j) => [String(j.id), s(j.customer_id)]));

  // Schedules for open jobs (one per bid: the newest that isn't archived).
  const estIds = jobRows.map((j) => String(j.estimate_id));
  const schedR = estIds.length ? await db.from("project_schedules").select("id, estimate_id, status, source_snapshot, updated_at").in("estimate_id", estIds).neq("status", "archived").order("updated_at", { ascending: false }) : { data: [] };
  const schedByEst = new Map<string, Row>();
  for (const sc of rows(schedR)) if (!schedByEst.has(String(sc.estimate_id))) schedByEst.set(String(sc.estimate_id), sc);
  const schedIds = [...schedByEst.values()].map((x) => String(x.id));
  const tasksR = schedIds.length ? await db.from("schedule_tasks").select("*").in("schedule_id", schedIds).limit(20000) : { data: [] };
  const tasksBy = new Map<string, Row[]>();
  for (const t of rows(tasksR)) tasksBy.set(String(t.schedule_id), [...(tasksBy.get(String(t.schedule_id)) ?? []), t]);
  const budgetLinesR = jobRows.length ? await db.from("fin_budget_lines").select("job_id, group_key, amount").in("job_id", jobRows.map((j) => String(j.job_id))).limit(20000) : { data: [] };

  // Quote -> estimate group (for commitment phase timing).
  const quoteIds = rows(commitExtra).map((c) => s(c.quote_id)).filter(Boolean) as string[];
  const quotesR = quoteIds.length ? await db.from("subcontractor_quotes").select("id, group_id, vendor_name").in("id", quoteIds) : { data: [] };
  const quoteGroup = new Map(rows(quotesR).map((x) => [String(x.id), s(x.group_id)]));
  const cmtInfo = new Map(rows(commitExtra).map((c) => [String(c.id), c]));
  const vendorsR = await db.from("fin_vendors").select("id, name").eq("book_id", bookId);
  const vendorName = new Map(rows(vendorsR).map((v) => [String(v.id), String(v.name)]));
  const tradeOfCode = new Map(rows(budgetR).map((b) => [String(b.cost_code_id), s(b.trade_slug)]));

  const jobs: V9Job[] = jobsAll.map((j) => {
    const id = String(j.job_id);
    const sc = schedByEst.get(String(j.estimate_id));
    const sectionCost: Record<string, number> = {};
    for (const b of rows(budgetLinesR).filter((b) => b.job_id === id)) sectionCost[String(b.group_key)] = (sectionCost[String(b.group_key)] ?? 0) + n(b.amount);
    const schedule: ScheduleInput | null = sc ? { id: String(sc.id), status: String(sc.status), tasks: (tasksBy.get(String(sc.id)) ?? []).map(mapTask), sectionCost } : null;
    const snap = (sc?.source_snapshot ?? {}) as { sections?: { id: string; trade: string | null }[] };
    const budget: BudgetRow[] = rows(budgetR).filter((b) => b.job_id === id).map((b) => ({ costCodeId: s(b.cost_code_id), code: s(b.code), name: s(b.cost_code_name), costType: s(b.cost_type),
      trade: s(b.trade_slug), estimated: n(b.estimated), committed: n(b.committed), actual: n(b.actual) }));
    return { jobId: id, jobName: String(j.name ?? j.job_number ?? "Job"), schedule, projection: schedule && schedule.tasks.length ? projectSchedule(schedule, today) : null,
      snapshotSections: (snap.sections ?? []).map((x) => ({ id: String(x.id), trade: x.trade ?? null })), customerId: customerOf.get(id) ?? null,
      contract: n(j.current_contract), status: String(j.status), budget };
  });
  const jobName = new Map(jobs.map((j) => [j.jobId, j.jobName]));
  const dueDays = new Map(rows(msDue).map((m) => [String(m.id), m.due_days === null || m.due_days === undefined ? null : Number(m.due_days)]));
  const milestones: MilestoneRow[] = rows(msR).filter((m) => jobName.has(String(m.job_id)) && jobs.find((j) => j.jobId === String(m.job_id))?.status === "open").map((m) => ({
    id: String(m.milestone_id), jobId: String(m.job_id), jobName: jobName.get(String(m.job_id)) ?? "Job", customerId: customerOf.get(String(m.job_id)) ?? null, seq: n(m.seq),
    description: String(m.description ?? "Milestone"), triggerKind: String(m.trigger_kind), dueRule: String(m.due_rule ?? "on_trigger"), dueDays: dueDays.get(String(m.milestone_id)) ?? null,
    dueOn: d10(m.due_on), amount: n(m.current_amount), invoiced: n(m.invoiced), state: String(m.state), triggeredAt: s(m.triggered_at) }));
  const rules: ProgressRule[] = rows(rulesR).map((r) => ({ milestoneId: String(r.milestone_id), threshold: n(r.threshold), method: (String(r.method) as WeightMethod) ?? "duration", sectionKey: s(r.section_key) }));
  const termsBy = new Map(rows(termsR).map((t) => [String(t.commitment_id), t]));
  const commitments: CommitmentRow[] = rows(cmtR).filter((c) => c.status === "open").map((c) => {
    const id = String(c.commitment_id); const t = termsBy.get(id); const info = cmtInfo.get(id);
    return { id, jobId: String(c.job_id), costCodeId: s(c.cost_code_id), number: String(c.number), title: String(c.title), kind: info?.kind === "purchase_order" ? "purchase_order" : "subcontract",
      vendorName: vendorName.get(String(c.vendor_id)) ?? null, original: n(c.original_amount), current: n(c.current_amount), billed: n(c.billed), open: n(c.open_committed),
      quoteGroupId: info?.quote_id ? quoteGroup.get(String(info.quote_id)) ?? null : null, trade: tradeOfCode.get(String(c.cost_code_id)) ?? null,
      terms: t ? { payBasis: (t.pay_basis as "completion" | "start" | "date") ?? "completion", payDays: n(t.pay_days), payDate: d10(t.pay_date), sectionKey: s(t.section_key),
        retainagePct: n(t.retainage_pct), depositAmount: t.deposit_amount === null ? null : n(t.deposit_amount), depositOn: d10(t.deposit_on) } : null };
  });
  const costOverrides: Record<string, Record<string, number>> = {};
  for (const o of rows(ovR)) if (o.amount !== null) (costOverrides[String(o.job_id)] ??= {})[String(o.cost_code_id ?? "")] = n(o.amount);
  const collectionOverrides: Record<string, CollectionOverride> = Object.fromEntries(rows(collR).map((c) => [String(c.customer_id), { days: n(c.days), basis: c.basis === "issue" ? "issue" : "due" }]));

  // Paid invoices -> customer history (last payment date per invoice).
  const paid = rows(paidR);
  const paidIds = paid.map((p) => String(p.invoice_id)).slice(0, 500);
  const allocR = paidIds.length ? await db.from("fin_payment_allocations").select("invoice_id, created_at").in("invoice_id", paidIds).is("reversed_at", null) : { data: [] };
  const last = new Map<string, string>();
  for (const a of rows(allocR)) { const k = String(a.invoice_id); const dd = String(a.created_at).slice(0, 10); if (!last.has(k) || last.get(k)! < dd) last.set(k, dd); }
  const history = customerHistory(paid.map((p) => ({ customerId: s(p.customer_id), issueDate: d10(p.issue_date), dueDate: d10(p.due_date), paidOn: last.get(String(p.invoice_id)) ?? null })));

  // Completed jobs -> historical cost ratios by cost type.
  const closed = jobsAll.filter((j) => j.status === "closed");
  const costHistory = historicalRatios(closed.map((j) => {
    const costs: Record<string, number> = {};
    for (const b of rows(budgetR).filter((b) => b.job_id === j.job_id)) costs[String(b.cost_type ?? "other")] = (costs[String(b.cost_type ?? "other")] ?? 0) + n(b.actual);
    return { contract: n(j.current_contract), costs };
  }));

  // Labor sums (only when payroll from schedules is on, to keep the page light).
  let labor = null;
  if (settings.payrollFromSchedule) {
    const end = q.end ?? new Date(Date.parse(`${today}T12:00:00Z`) + Math.min(365, q.horizon) * 864e5).toISOString().slice(0, 10);
    const { data } = await db.rpc("fin_forecast_labor", { p_book_id: bookId, p_from: today, p_to: end });
    labor = mapLabor(data);
  }

  const data: V9Data = { settings, jobs, milestones, rules, commitments, costOverrides, history, collectionOverrides, costHistory,
    invoiceIssueDates: Object.fromEntries(rows(openInvR).map((i) => [String(i.invoice_id), d10(i.issue_date) ?? today])), labor };
  return { installed: true as const, base: base.input as ForecastInput, planned: base.planned, invoiceOptions: base.invoices, data, banks: base.banks, accounts: base.accounts, withBank: base.withBank, settings };
}

export interface JobProgressMilestone {
  id: string; seq: number; description: string; triggerKind: string; amount: number; state: string;
  rule: { threshold: number; method: WeightMethod; sectionKey: string | null } | null;
  progress: number | null; eligible: boolean; projectedOn: string | null; slipDays: number;
}

/**
 * One job's milestones with their progress rule and verified schedule progress, for the job billing page.
 * Read with the viewer's client (RLS). Returns null when the V9 SQL isn't installed or the job isn't visible.
 */
export async function loadJobProgress(db: Db, bookId: string, jobId: string, today = new Date().toISOString().slice(0, 10)) {
  const rulesR = await db.from("fin_milestone_progress_rules").select("milestone_id, threshold, method, section_key").eq("book_id", bookId).eq("job_id", jobId);
  if (rulesR.error && isMissing(rulesR.error)) return null;
  const { data: job } = await db.from("fin_jobs").select("id, estimate_id").eq("book_id", bookId).eq("id", jobId).maybeSingle();
  if (!job) return null;
  const [msR, schedR, linesR] = await Promise.all([
    db.from("fin_milestone_status_v").select("milestone_id, seq, description, trigger_kind, current_amount, invoiced, state").eq("job_id", jobId).order("seq"),
    db.from("project_schedules").select("id, status, source_snapshot, updated_at").eq("estimate_id", String((job as Row).estimate_id)).neq("status", "archived").order("updated_at", { ascending: false }).limit(1),
    db.from("fin_budget_lines").select("group_key, amount").eq("job_id", jobId).limit(5000),
  ]);
  const sc = rows(schedR)[0];
  let schedule: ScheduleInput | null = null;
  if (sc) {
    const tasksR = await db.from("schedule_tasks").select("*").eq("schedule_id", String(sc.id)).limit(5000);
    const sectionCost: Record<string, number> = {};
    for (const b of rows(linesR)) sectionCost[String(b.group_key)] = (sectionCost[String(b.group_key)] ?? 0) + n(b.amount);
    schedule = { id: String(sc.id), status: String(sc.status), tasks: rows(tasksR).map(mapTask), sectionCost };
  }
  const sections = (schedule?.tasks ?? []).filter((t) => t.kind === "section" && !t.parentId && !t.splitFrom).sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => ({ id: t.sourceGroupId, name: t.name }));
  const ruleBy = new Map(rows(rulesR).map((r) => [String(r.milestone_id), { threshold: n(r.threshold), method: (String(r.method || "duration") as WeightMethod), sectionKey: s(r.section_key) }]));
  const overall = schedule && schedule.tasks.length ? projectSchedule(schedule, today) : null;
  const milestones: JobProgressMilestone[] = rows(msR).map((m) => {
    const id = String(m.milestone_id);
    const rule = ruleBy.get(id) ?? null;
    let progress: number | null = overall ? overall.progress : null; let eligible = false; let projectedOn: string | null = null; let slipDays = overall?.slipDays ?? 0;
    if (rule && schedule && schedule.tasks.length) {
      const t = projectThreshold(schedule, rule.threshold, today, rule.method, rule.sectionKey);
      progress = t.progress; eligible = t.reached && m.state === "not_triggered"; projectedOn = t.date; slipDays = t.slipDays;
    }
    return { id, seq: n(m.seq), description: String(m.description ?? "Milestone"), triggerKind: String(m.trigger_kind), amount: Math.max(0, n(m.current_amount) - n(m.invoiced)),
      state: String(m.state), rule, progress, eligible, projectedOn, slipDays };
  });
  return { hasSchedule: Boolean(schedule && schedule.tasks.length), scheduleDraft: schedule?.status === "draft", sections, milestones };
}

/** One job's open commitments with payment terms, and cost codes with forecast overrides, for the job costs page. */
export async function loadJobCostTiming(db: Db, bookId: string, jobId: string) {
  const termsProbe = await db.from("fin_commitment_terms").select("commitment_id, pay_basis, pay_days, pay_date, section_key, retainage_pct, deposit_amount, deposit_on").eq("book_id", bookId);
  if (termsProbe.error && isMissing(termsProbe.error)) return null;
  const [cmtR, budgetR, ovR] = await Promise.all([
    db.from("fin_commitment_balances_v").select("commitment_id, number, title, vendor_id, status, current_amount, open_committed").eq("job_id", jobId).eq("status", "open").limit(500),
    db.from("fin_job_budget_v").select("cost_code_id, code, cost_code_name, estimated, committed, actual").eq("job_id", jobId).limit(2000),
    db.from("fin_forecast_overrides").select("cost_code_id, amount, reason, created_at").eq("job_id", jobId).is("superseded_at", null),
  ]);
  const vendorIds = [...new Set(rows(cmtR).map((c) => s(c.vendor_id)).filter(Boolean) as string[])];
  const vendR = vendorIds.length ? await db.from("fin_vendors").select("id, name").in("id", vendorIds) : { data: [] };
  const vendor = new Map(rows(vendR).map((v) => [String(v.id), String(v.name)]));
  const terms = new Map(rows(termsProbe).map((t) => [String(t.commitment_id), t]));
  const ov = new Map(rows(ovR).map((o) => [String(o.cost_code_id ?? ""), { amount: o.amount === null ? null : n(o.amount), reason: String(o.reason ?? ""), at: String(o.created_at ?? "") }]));
  return {
    commitments: rows(cmtR).map((c) => {
      const t = terms.get(String(c.commitment_id));
      return { id: String(c.commitment_id), number: String(c.number ?? ""), title: String(c.title ?? ""), vendorName: vendor.get(String(c.vendor_id)) ?? null, open: n(c.open_committed),
        terms: t ? { payBasis: String(t.pay_basis), payDays: n(t.pay_days), payDate: d10(t.pay_date), sectionKey: s(t.section_key), retainagePct: n(t.retainage_pct),
          depositAmount: t.deposit_amount === null ? null : n(t.deposit_amount), depositOn: d10(t.deposit_on) } : null };
    }),
    costCodes: rows(budgetR).filter((b) => b.cost_code_id).map((b) => ({ id: String(b.cost_code_id), code: s(b.code), name: s(b.cost_code_name) ?? "Cost code",
      estimated: n(b.estimated), committed: n(b.committed), actual: n(b.actual), override: ov.get(String(b.cost_code_id)) ?? null })),
  };
}
