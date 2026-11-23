import "server-only";
/**
 * Server side of the personalized dashboard: who the viewer is (access), which layout applies to them, and the
 * data for the widgets they actually show. Every read uses the signed-in user's client, so row-level security
 * decides what comes back; widgets a person can't access never get a load in the first place.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEsignEnabled } from "@/lib/esign/config";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { loadMyCompany } from "@/lib/enterprise/server";
import { canUseAccountantMode } from "@/lib/financials/permissions";
import { isMissing, loadFinState, loadHome, type FinContext } from "@/lib/financials/loaders";
import { loadAccountantMetrics, loadBank, loadLookups, loadQueue, queueTotal } from "@/lib/financials/accounting-load";
import { loadPl, type PlResult } from "@/lib/financials/reports-load";
import { isStage, stageColumn, type Column } from "@/lib/pipeline/board";
import { listSchedules, type ScheduleListRow } from "@/lib/schedule/server";
import { loadReviewQueue, type QueueItem } from "@/lib/operations/queue-server";
import type { ArRow } from "@/lib/financials/receivables";
import type { VerifiedPayment } from "./previews";
import type { ReportBasis } from "@/lib/financials/reports";
import { loadEffectiveAccess } from "@/lib/access/server";
import { accessFromFacts, allowed, withEffectiveAccess, type DashboardAccess } from "./access";
import { chartRange, type ChartPeriod } from "./charts";
import { widgetDef, type DashboardPage, type Source } from "./registry";
import { LAYOUT_VERSION, parseLayout, type DashboardMode, type Layout, type WidgetInstance } from "./schema";
import { buildTemplate, defaultTemplate, type TemplateKey } from "./templates";

type Db = SupabaseClient;
type Row = Record<string, unknown>;

export interface DashboardViewer {
  userId: string;
  access: DashboardAccess;
  fin: FinContext | null;
  mode: DashboardMode;
  accountantModeAllowed: boolean;
}

/** One pass over today's permission sources. V6.7 replaces the facts with loadEffectiveAccess(). */
export async function loadViewer(db: Db, userId: string, finState?: Awaited<ReturnType<typeof loadFinState>>): Promise<DashboardViewer> {
  const finOn = isFinancialsEnabled();
  const [company, fin, effective] = await Promise.all([
    loadMyCompany(db), finOn ? (finState ? Promise.resolve(finState) : loadFinState(db)) : Promise.resolve(null),
    loadEffectiveAccess(db).catch((e: Error) => { console.error(JSON.stringify({ level: "error", scope: "dashboard.effective_access", message: e.message })); return null; }),
  ]);
  const ctx = fin && fin.kind === "ready" ? fin.ctx : null;
  const perms = ctx?.access.permissions ?? [];
  const accountantModeAllowed = Boolean(ctx && canUseAccountantMode(perms) && perms.includes("view_company_financials"));
  // V6.7 effective access decides which widgets show (per-employee settings included); the raw facts supply the
  // company and Financials context, and stand in if effective access can't be computed.
  const access = withEffectiveAccess(accessFromFacts({
    pmEnabled: isPmEnabled(), financialsEnabled: finOn,
    company: company ? { id: company.id, role: company.role, isOwner: company.isOwner, permissions: company.permissions } : null,
    fin: ctx ? { role: ctx.access.role ?? "view_only", permissions: perms, active: ctx.access.active, readOnly: ctx.access.readOnly, sandbox: Boolean(ctx.access.sandbox) } : null,
    accountantModeAllowed,
  }), effective);
  // The mode is the Financials view preference (fin_user_preferences). It only picks which saved layout shows;
  // without accounting authority it is always Contractor Mode.
  const mode: DashboardMode = accountantModeAllowed && ctx?.layout.mode === "accountant" ? "accountant" : "contractor";
  return { userId, access, fin: ctx, mode, accountantModeAllowed };
}

export interface LoadedLayout {
  layout: Layout;
  /** Revision of the person's own saved layout; null when they have none yet. */
  revision: number | null;
  origin: "mine" | "company" | "template";
  /** The dashboard SQL is applied (saving works). */
  ready: boolean;
  isCompanyOwner: boolean;
  companyDefaultRole: string | null | undefined;
}

/**
 * RPC arguments for a page. Home leaves p_page out (the database default is 'home'), so Home keeps working on a
 * database from before page layouts existed.
 */
export const pageArgs = (page: DashboardPage) => (page === "home" ? {} : { p_page: page });

/**
 * The person's layout for the page and mode, else their assigned Home, else their company's default, else the
 * best built-in template (Home) or the page's own starting layout (`start`, e.g. the Financials page).
 */
export async function loadLayout(db: Db, viewer: DashboardViewer, mode: DashboardMode, page: DashboardPage = "home", start?: () => Layout): Promise<LoadedLayout> {
  const { data, error } = await db.rpc("dashboard_layout_get", { p_mode: mode, ...pageArgs(page) });
  const fallback = (): Layout => (start ? start() : buildTemplate(defaultTemplate(viewer.access, mode), viewer.access));
  if (error) {
    if (!isMissing(error)) console.error(JSON.stringify({ level: "error", scope: "dashboard.layout_get", code: error.code }));
    return { layout: fallback(), revision: null, origin: "template", ready: !isMissing(error), isCompanyOwner: false, companyDefaultRole: undefined };
  }
  const d = (data ?? {}) as { mine?: Row | null; companyDefault?: Row | null; isCompanyOwner?: boolean };
  const isCompanyOwner = Boolean(d.isCompanyOwner);
  if (d.mine) {
    return { layout: parseLayout(d.mine as never), revision: Number(d.mine.revision), origin: "mine", ready: true, isCompanyOwner, companyDefaultRole: d.companyDefault ? (d.companyDefault.role as string | null) : undefined };
  }
  // A Home page assigned to this person (Team & Access) is more specific than the company's per-role default.
  if (d.companyDefault && (page !== "home" || !viewer.access.home)) {
    const parsed = parseLayout(d.companyDefault as never);
    // A company default applies within the person's own access: widgets they can't see are left out.
    const widgets = parsed.widgets.filter((w) => { const def = widgetDef(w.type); return def && allowed(viewer.access, def.requires); });
    if (widgets.length) return { layout: { ...parsed, widgets }, revision: null, origin: "company", ready: true, isCompanyOwner, companyDefaultRole: d.companyDefault.role as string | null };
  }
  return { layout: fallback(), revision: null, origin: "template", ready: true, isCompanyOwner, companyDefaultRole: undefined };
}

export type SaveResult = { ok: true; revision: number } | { ok: false; code: "conflict" | "not_installed" | "invalid" | "error"; message: string };

export async function saveLayout(db: Db, mode: DashboardMode, layout: Layout, expectedRevision: number | null, source: "user" | "setup" | "template" | "company_default", page: DashboardPage = "home"): Promise<SaveResult> {
  const { data, error } = await db.rpc("dashboard_layout_save", {
    p_mode: mode, p_template: layout.template, p_widgets: layout.widgets, p_schema_version: LAYOUT_VERSION, p_expected_revision: expectedRevision, p_source: source, ...pageArgs(page),
  });
  if (!error) return { ok: true, revision: Number(data) };
  if (isMissing(error)) return { ok: false, code: "not_installed", message: "Saving layouts turns on after a short database update." };
  if (/layout_conflict/.test(error.message ?? "")) return { ok: false, code: "conflict", message: "Your dashboard changed in another tab or device." };
  if (/bad_layout|bad_mode/.test(error.message ?? "")) return { ok: false, code: "invalid", message: "That layout couldn't be saved." };
  console.error(JSON.stringify({ level: "error", scope: "dashboard.layout_save", code: error.code }));
  return { ok: false, code: "error", message: "Couldn't save your dashboard. Your changes are kept on this device; try again." };
}

/** Widgets the viewer may see right now, in order. The rest stay in the saved layout, untouched. */
export function visibleWidgets(layout: Layout, access: DashboardAccess): { shown: WidgetInstance[]; hidden: WidgetInstance[]; unknown: WidgetInstance[] } {
  const shown: WidgetInstance[] = [], hidden: WidgetInstance[] = [], unknown: WidgetInstance[] = [];
  for (const w of layout.widgets) {
    const def = widgetDef(w.type);
    if (!def) unknown.push(w);
    else if (allowed(access, def.requires)) shown.push(w);
    else hidden.push(w);
  }
  return { shown, hidden, unknown };
}

// ---- Data -----------------------------------------------------------------------------------------------------
export interface BidFact { id: string; title: string; customer: string; number: string; column: Column; createdAt: string; updatedAt: string; total: number | null; stageAt: string | null }
export interface TaskFact { id: string; scheduleId: string; project: string; name: string; start: string; end: string; status: string; assignee: string | null }
export interface TimeFact { resourceId: string; name: string; clockIn: string; clockOut: string | null; breakMinutes: number; status: string; scheduleId: string | null }

/**
 * Lazy, memoized loaders: a source loads at most once per render, however many widgets read it (two expense
 * charts over the same period share one P&L roll-up). Nothing loads unless a shown widget asks for it.
 */
export function dataFor(db: Db, viewer: DashboardViewer) {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (!memo.has(key)) memo.set(key, fn().catch((e) => { console.error(JSON.stringify({ level: "error", scope: "dashboard.source", key, message: (e as Error).message })); return null; }));
    return memo.get(key) as Promise<T>;
  };
  const ctx = viewer.fin;
  const uid = viewer.userId;
  return {
    bids: () => once("bids", async (): Promise<BidFact[]> => {
      const [{ data: ests }, { data: versions }] = await Promise.all([
        db.from("estimates").select("id, title, customer_name, estimate_number, status, pipeline_stage, stage_changed_at, created_at, updated_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(2000),
        // Same read as My Bids (RLS decides), kept to this person's own bids below.
        db.from("estimate_versions").select("estimate_id, version_number, total").order("version_number", { ascending: false }).limit(10000),
      ]);
      const own = new Set(((ests ?? []) as Row[]).map((e) => String(e.id)));
      const latest = new Map<string, number>();
      for (const v of (versions ?? []) as Row[]) if (own.has(String(v.estimate_id)) && !latest.has(String(v.estimate_id))) latest.set(String(v.estimate_id), Number(v.total));
      return ((ests ?? []) as Row[]).map((e) => ({
        id: String(e.id), title: String(e.title || "Untitled bid"), customer: String(e.customer_name ?? ""), number: String(e.estimate_number ?? ""),
        column: stageColumn(isStage(e.pipeline_stage) ? e.pipeline_stage : "draft", e.status as never), createdAt: String(e.created_at), updatedAt: String(e.updated_at),
        total: latest.get(String(e.id)) ?? null, stageAt: (e.stage_changed_at as string | null) ?? null,
      }));
    }),
    companySummary: () => once("company_summary", async () => {
      const { data } = await db.rpc("company_pipeline_summary", { p_from: null, p_to: null, p_team: null });
      return data as { winRate: number | null; openValue: number; awaitingReview: number } | null;
    }),
    customers: () => once("customers", async () => (await db.from("customers").select("id", { count: "exact", head: true })).count ?? 0),
    schedules: () => once("schedules", async (): Promise<ScheduleListRow[] | null> => listSchedules(db)),
    review: () => once("review", async (): Promise<QueueItem[] | null> => loadReviewQueue(db)),
    tasks: () => once("tasks", async (): Promise<TaskFact[]> => {
      const scheds = ((await listSchedules(db)) ?? []).filter((s) => s.status === "active");
      if (!scheds.length) return [];
      const names = new Map(scheds.map((s) => [s.id, s.name]));
      const { data } = await db.from("schedule_tasks").select("id, schedule_id, name, planned_start, planned_end, status, assignee")
        .in("schedule_id", scheds.slice(0, 200).map((s) => s.id)).eq("kind", "item").neq("status", "complete").order("planned_start").limit(3000);
      return ((data ?? []) as Row[]).map((t) => ({ id: String(t.id), scheduleId: String(t.schedule_id), project: names.get(String(t.schedule_id)) ?? "Project", name: String(t.name),
        start: String(t.planned_start).slice(0, 10), end: String(t.planned_end).slice(0, 10), status: String(t.status), assignee: (t.assignee as string | null) ?? null }));
    }),
    finHome: () => once("fin_home", async () => (ctx ? loadHome(db, ctx) : null)),
    finAcct: () => once("fin_acct", async () => {
      if (!ctx) return null;
      const L = await loadLookups(db, ctx.bookId);
      const bank = await loadBank(db, ctx.bookId, L);
      const q = await loadQueue(db, ctx.bookId, L, bank);
      const m = await loadAccountantMetrics(db, ctx.bookId, bank, queueTotal(q));
      const lastRecon = bank.ready ? [...bank.reconciliations].filter((r) => !r.reopened_at).sort((a, b) => b.period_end.localeCompare(a.period_end))[0] ?? null : null;
      return { m, unmatched: q.unmatched_bank.length, lastRecon };
    }),
    finJobs: () => once("fin_jobs", async () => {
      if (!ctx) return null;
      const [{ data: prof }, { data: jobs }] = await Promise.all([
        db.from("fin_job_profitability_v").select("job_id, job_number, name, status, contract_value, estimated_cost, committed_plus_actual, projected_profit").eq("book_id", ctx.bookId).limit(2000),
        db.from("fin_jobs").select("id, estimate_id").eq("book_id", ctx.bookId).limit(2000),
      ]);
      const est = new Map(((jobs ?? []) as Row[]).map((j) => [String(j.id), String(j.estimate_id)]));
      return ((prof ?? []) as Row[]).map((r) => ({ ...r, href: est.has(String(r.job_id)) ? `/financials/jobs/${est.get(String(r.job_id))}` : "/financials/records?view=jobs" })) as (Row & { href: string })[];
    }),
    ar: () => once("ar", async (): Promise<ArRow[] | null> => {
      if (!ctx) return null;
      const { data, error } = await db.from("fin_ar_invoices_v").select("*").eq("book_id", ctx.bookId).order("due_date").limit(5000);
      if (error) return null;
      const d10 = (v: unknown) => String(v ?? "").slice(0, 10);
      return ((data ?? []) as ArRow[]).map((r) => ({ ...r, issue_date: d10(r.issue_date), due_date: d10(r.due_date), days_overdue: Number(r.days_overdue) }));
    }),
    /**
     * The few most recently verified payments, for the Collected card's preview. Bounded (4 rows), verified and
     * active only: recorded-by-hand payments that nobody has checked against the bank never show as collected.
     */
    verifiedPayments: () => once("verified_payments", async (): Promise<VerifiedPayment[] | null> => {
      if (!ctx) return null;
      const { data, error } = await db.from("fin_payments").select("id, number, customer_id, job_id, amount, received_on, verified_at, method, source")
        .eq("book_id", ctx.bookId).eq("status", "active").eq("verified", true).not("verified_at", "is", null)
        .order("verified_at", { ascending: false }).order("received_on", { ascending: false }).limit(4);
      if (error) { if (!isMissing(error)) console.error(JSON.stringify({ level: "error", scope: "dashboard.verified_payments", code: error.code })); return null; }
      const P = (data ?? []) as Row[];
      if (!P.length) return [];
      const ids = P.map((p) => String(p.id));
      const jobIds = [...new Set(P.map((p) => p.job_id).filter(Boolean).map(String))];
      const [bal, jobs] = await Promise.all([
        db.from("fin_payment_balances_v").select("payment_id, refunded").in("payment_id", ids),
        jobIds.length ? db.from("fin_jobs").select("id, estimate_id, name, customer_id").in("id", jobIds) : Promise.resolve({ data: [] as Row[] }),
      ]);
      const jobOf = new Map(((jobs.data ?? []) as Row[]).map((j) => [String(j.id), j]));
      const custIds = [...new Set(P.map((p) => p.customer_id ?? jobOf.get(String(p.job_id))?.customer_id).filter(Boolean).map(String))];
      const { data: cust } = custIds.length ? await db.from("customers").select("id, name").in("id", custIds) : { data: [] as Row[] };
      const nameOf = new Map(((cust ?? []) as Row[]).map((c) => [String(c.id), String(c.name ?? "")]));
      const refundOf = new Map(((bal.data ?? []) as Row[]).map((b) => [String(b.payment_id), String(b.refunded ?? "0")]));
      return P.map((p) => {
        const job = p.job_id ? jobOf.get(String(p.job_id)) : undefined;
        const cid = (p.customer_id ?? job?.customer_id) as string | null | undefined;
        return {
          id: String(p.id), number: String(p.number), customer: (cid && nameOf.get(String(cid))) || null, job: job ? String(job.name) : null,
          href: job ? `/financials/jobs/${job.estimate_id}#fin-payments` : null,
          amount: String(p.amount), refunded: refundOf.get(String(p.id)) ?? "0", receivedOn: String(p.received_on).slice(0, 10),
          verifiedAt: String(p.verified_at), method: String(p.method), source: String(p.source ?? "manual"),
        };
      });
    }),
    pl: (period: ChartPeriod, basis: ReportBasis) => once(`pl:${period}:${basis}`, async (): Promise<(PlResult & { range: { from: string; to: string } }) | null> => {
      if (!ctx) return null;
      const range = chartRange(period);
      return { ...(await loadPl(db, ctx.bookId, basis, range.from, range.to)), range };
    }),
    time: () => once("time", async (): Promise<TimeFact[] | null> => {
      const since = new Date(Date.now() - 40 * 864e5).toISOString();
      const { data, error } = await db.from("pm_time_entries").select("resource_id, schedule_id, clock_in, clock_out, break_minutes, status")
        .gte("clock_in", since).neq("status", "rejected").order("clock_in", { ascending: false }).limit(5000);
      if (error) return null;
      const ids = [...new Set(((data ?? []) as Row[]).map((t) => String(t.resource_id)))];
      const { data: people } = ids.length ? await db.from("pm_resources").select("id, name").in("id", ids.slice(0, 300)) : { data: [] as Row[] };
      const nameOf = new Map(((people ?? []) as Row[]).map((r) => [String(r.id), String(r.name)]));
      return ((data ?? []) as Row[]).map((t) => ({ resourceId: String(t.resource_id), name: nameOf.get(String(t.resource_id)) ?? "Team member", clockIn: String(t.clock_in),
        clockOut: (t.clock_out as string | null) ?? null, breakMinutes: Number(t.break_minutes ?? 0), status: String(t.status), scheduleId: (t.schedule_id as string | null) ?? null }));
    }),
    scheduleNames: () => once("schedule_names", async () => new Map(((await listSchedules(db)) ?? []).map((s) => [s.id, s.name]))),
  };
}
export type DashboardData = ReturnType<typeof dataFor>;

/** Sources the shown widgets need (for prefetching everything in one parallel wave). */
export function sourcesFor(widgets: WidgetInstance[]): Set<Source> {
  const out = new Set<Source>();
  for (const w of widgets) for (const s of widgetDef(w.type)?.sources ?? []) out.add(s);
  return out;
}

export const esignOn = () => isEsignEnabled();
export type { TemplateKey };
