import "server-only";
/**
 * Read side of the Financial Command Center UI. Everything here reads with the signed-in user's client,
 * so RLS decides what is visible (writes go through ./server and the SECURITY DEFINER RPCs). Every
 * amount stays a two-decimal string; sums use ./money.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/estimate/money";
import { add, cmp, isZero, sub, toMoney, D } from "./money";
import { dashboardLayout, finAccess, myBook } from "./server";
import type { FinAccess } from "./types";
import { resolveLayout, resolveProfile, resolveProjectProfile, type BusinessConfig, type ProjectOverride, type ResolvedLayout, type ResolvedProfile, type StoredPrefs } from "./profiles";
import { CARDS, type CardKey, type KpiKey } from "./profiles/catalog";
import { invoiceSendInfo } from "./send-state";
import { changeOrderSettlement } from "./change-orders";

type Db = SupabaseClient;
type Row = Record<string, unknown>;

export interface AiPrefs { expenseSuggestions: boolean; documentExtraction: boolean; communicationDrafting: boolean; photoLabeling: boolean }
export const AI_DEFAULTS: AiPrefs = { expenseSuggestions: false, documentExtraction: false, communicationDrafting: false, photoLabeling: true };

export interface FinContext {
  bookId: string;
  access: FinAccess;
  config: BusinessConfig;
  configSaved: boolean;
  profile: ResolvedProfile;
  layout: ResolvedLayout;
  stored: { company: StoredPrefs | null; roleLayout: StoredPrefs | null; user: StoredPrefs | null };
  /** The quick-actions SQL (20261129002000) is applied, so quick-action choices can be saved. */
  quickActionsReady: boolean;
  ai: AiPrefs;
}

export type FinState = { kind: "ready"; ctx: FinContext } | { kind: "not_installed" } | { kind: "no_book" } | { kind: "no_access"; access: FinAccess | null };

/** PostgREST / Postgres errors that mean "the Financials SQL hasn't been applied to this database yet". */
export const isMissing = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42883" || e.code === "42P01" || /could not find the (function|table)|does not exist/i.test(e.message ?? "")));

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function configFromRow(r: Row | null): BusinessConfig {
  if (!r) return { primaryTradeSlug: null };
  return {
    primaryTradeSlug: (r.primary_trade_slug as string | null) ?? null,
    additionalTradeSlugs: (r.additional_trade_slugs as string[] | null) ?? [],
    presetKey: (r.preset_key as BusinessConfig["presetKey"]) ?? null,
    market: (r.market as BusinessConfig["market"]) ?? undefined,
    projectModel: (r.project_model as BusinessConfig["projectModel"]) ?? undefined,
    paymentStructure: (r.payment_structure as BusinessConfig["paymentStructure"]) ?? undefined,
    laborModel: (r.labor_model as BusinessConfig["laborModel"]) ?? undefined,
    usesInventory: Boolean(r.uses_inventory),
    usesEquipment: Boolean(r.uses_equipment),
  };
}

const prefs = (r: unknown): StoredPrefs | null => (r && typeof r === "object" ? (r as StoredPrefs) : null);

/** The caller's book, access, configuration and resolved dashboard. */
export async function loadFinState(db: Db): Promise<FinState> {
  let bookId: string | null;
  try { bookId = await myBook(db); } catch (e) { return isMissing(e as { message?: string }) ? { kind: "not_installed" } : { kind: "no_book" }; }
  if (!bookId) return { kind: "no_book" };
  const access = await finAccess(db, bookId).catch(() => null);
  if (!access || !(access.permissions.includes("view_company_financials") || access.permissions.includes("view_project_financials"))) return { kind: "no_access", access };
  const [cfg, ai, layoutRaw] = await Promise.all([
    db.from("fin_business_config").select("*").eq("book_id", bookId).maybeSingle(),
    db.from("fin_ai_preferences").select("*").eq("book_id", bookId).maybeSingle(),
    dashboardLayout(db, bookId).catch(() => ({} as Row)),
  ]);
  const config = configFromRow((cfg.data as Row | null) ?? null);
  const profile = resolveProfile(config);
  const stored = { company: prefs(layoutRaw.company), roleLayout: prefs(layoutRaw.roleLayout), user: prefs(layoutRaw.user) };
  const layout = resolveLayout({ profile, role: access.role, permissions: access.permissions, mode: (layoutRaw.mode as "contractor" | "accountant" | undefined) ?? "contractor", ...stored });
  const a = (ai.data as Row | null) ?? {};
  return {
    kind: "ready",
    ctx: {
      bookId, access, config, configSaved: Boolean(cfg.data), profile, layout, stored, quickActionsReady: layoutRaw.quickActionsReady === true,
      ai: {
        expenseSuggestions: bool(a.expense_suggestions, AI_DEFAULTS.expenseSuggestions), documentExtraction: bool(a.document_extraction, AI_DEFAULTS.documentExtraction),
        communicationDrafting: bool(a.communication_drafting, AI_DEFAULTS.communicationDrafting), photoLabeling: bool(a.photo_labeling, AI_DEFAULTS.photoLabeling),
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Home: KPIs + card figures. Every figure carries the records link behind it.
// ---------------------------------------------------------------------------------------------------------
export type Basis = "Contracted" | "Invoiced" | "Paid" | "Outstanding" | "Estimated" | "Committed" | "Actual" | "Forecast" | "Count";
export interface Figure { value: string; money: boolean; basis: Basis; sub?: string; href: string; tone?: "default" | "ok" | "warn" | "danger"; empty?: boolean; note?: string }

const $ = (m: string) => formatCurrency(toMoney(m));
const sumOf = (rows: Row[], k: string) => add(0, ...rows.map((r) => String(r[k] ?? "0")));
const pct = (num: string, den: string) => (isZero(den) ? null : new D(num).div(den).times(100).toFixed(1));

export async function loadHome(db: Db, ctx: FinContext) {
  const b = ctx.bookId;
  const [prof, inv, pay, ms, alerts, review, bills, exps, comm, costs] = await Promise.all([
    db.from("fin_job_profitability_v").select("*").eq("book_id", b),
    db.from("fin_invoice_balances_v").select("invoice_id, job_id, number, kind, status, due_date, total, paid, balance, days_overdue, aging_bucket").eq("book_id", b),
    db.from("fin_payment_balances_v").select("payment_id, amount, verified, status, unapplied, refunded, received_on").eq("book_id", b),
    db.from("fin_milestone_status_v").select("milestone_id, job_id, state, is_deposit, current_amount, paid").eq("book_id", b),
    db.from("fin_alerts").select("id, job_id, kind, severity, status, details, created_at").eq("book_id", b).in("status", ["open", "acknowledged"]),
    db.from("fin_review_items").select("id, kind, status").eq("book_id", b).eq("status", "open"),
    db.from("fin_vendor_bills").select("id, status, due_date, total").eq("book_id", b).neq("status", "void"),
    db.from("fin_expenses").select("id, status, amount, cost_code_id, job_id, created_by").eq("book_id", b).neq("status", "void"),
    db.from("fin_commitment_balances_v").select("commitment_id, current_amount, billed, open_committed, status").eq("book_id", b),
    db.from("fin_job_budget_v").select("cost_type, estimated, committed, actual, cost_code_id").eq("book_id", b),
  ]);
  // Accountant Mode cards: audit activity this week (RLS: company-financials viewers only).
  const accountantCards = ctx.layout.cards.some((c) => c.key === "audit_trail" && c.visible);
  const auditWeek = accountantCards
    ? (await db.from("fin_audit_log").select("id", { count: "exact", head: true }).eq("book_id", b).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString())).count ?? 0
    : 0;
  const P = (prof.data ?? []) as Row[], I = (inv.data ?? []) as Row[], Y = (pay.data ?? []) as Row[], M = (ms.data ?? []) as Row[];
  // V6.9 cards: new tax alerts and the latest bank-reported balances (tables may not exist yet: errors read as empty).
  // Loaded whenever the viewer may see them (the V6.6 dashboard reads the same figures outside the home layout).
  const shows = (k: CardKey) => CARDS[k].needs.every((n) => ctx.access.permissions.includes(n));
  const [taxNew, bankBal] = await Promise.all([
    shows("tax_updates") ? db.from("fin_tax_alerts").select("id, review_needed").eq("book_id", b).eq("status", "new").limit(200) : Promise.resolve({ data: null }),
    shows("cash_position") ? db.from("fin_bank_balances").select("account_id, current_balance, as_of").eq("book_id", b).order("as_of", { ascending: false }).limit(200) : Promise.resolve({ data: null }),
  ]);
  const TA = (taxNew.data ?? []) as Row[];
  const latestBal = new Map<string, Row>();
  for (const r of (bankBal.data ?? []) as Row[]) if (!latestBal.has(String(r.account_id))) latestBal.set(String(r.account_id), r);
  const balAsOf = [...latestBal.values()].map((r) => String(r.as_of)).sort()[0] ?? null;
  const A = (alerts.data ?? []) as Row[], R = (review.data ?? []) as Row[], B = (bills.data ?? []) as Row[], X = (exps.data ?? []) as Row[];
  const C = (comm.data ?? []) as Row[], K = (costs.data ?? []) as Row[];
  const issued = I.filter((r) => r.status === "issued");
  const open = issued.filter((r) => cmp(String(r.balance), 0) > 0);
  const overdue = open.filter((r) => Number(r.days_overdue) > 0);
  const activePay = Y.filter((r) => r.status === "active");
  const contract = sumOf(P, "contract_value");
  const estProfit = sumOf(P, "estimated_profit");
  const projProfit = sumOf(P, "projected_profit");
  const hasCostData = P.some((r) => !isZero(String(r.estimated_cost)) || !isZero(String(r.actual_cost)) || !isZero(String(r.committed_cost)));
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const money = (value: string, basis: Basis, href: string, extra: Partial<Figure> = {}): Figure => ({ value, money: true, basis, href, empty: isZero(value), ...extra });
  const count = (n: number, href: string, extra: Partial<Figure> = {}): Figure => ({ value: String(n), money: false, basis: "Count", href, empty: n === 0, ...extra });
  const byType = (types: string[], basis: "actual" | "committed" = "actual") => add(0, ...K.filter((r) => types.includes(String(r.cost_type))).map((r) => String(r[basis] ?? "0")));

  const kpis: Record<KpiKey, Figure> = {
    contract_value: money(contract, "Contracted", "/financials/records?view=jobs", { sub: `${P.length} job${P.length === 1 ? "" : "s"} · signed + approved changes` }),
    invoiced: money(sumOf(issued, "total"), "Invoiced", "/financials/records?view=invoices", { sub: `${issued.length} issued invoice${issued.length === 1 ? "" : "s"}` }),
    collected: money(sub(sumOf(activePay, "amount"), sumOf(activePay, "refunded")), "Paid", "/financials/records?view=payments",
      { sub: `${activePay.filter((r) => !r.verified).length} not yet verified`, note: "Recorded payments, verified or not" }),
    ar_outstanding: money(sumOf(open, "balance"), "Outstanding", "/financials/receivables", { sub: `${open.length} open invoice${open.length === 1 ? "" : "s"}` }),
    overdue_amount: money(sumOf(overdue, "balance"), "Outstanding", "/financials/receivables?bucket=overdue", { sub: `${overdue.length} past due`, tone: overdue.length ? "danger" : "default" }),
    estimated_margin: hasCostData ? money(estProfit, "Estimated", "/financials/records?view=jobs", { sub: `${pct(estProfit, contract) ?? "0.0"}% of contract (from the bid's costs)` })
      : { value: "Not enough cost data", money: false, basis: "Estimated", href: "/financials/records?view=jobs", empty: true },
    projected_margin: hasCostData ? money(projProfit, "Forecast", "/financials/records?view=jobs", { sub: `${pct(projProfit, contract) ?? "0.0"}% · per trade: actual + committed when higher than the estimate` })
      : { value: "Not enough cost data", money: false, basis: "Forecast", href: "/financials/records?view=jobs", empty: true },
    committed_cost: money(sumOf(P, "committed_cost"), "Committed", "/financials/records?view=commitments", { sub: "Open commitments not yet billed" }),
    actual_cost: money(sumOf(P, "actual_cost"), "Actual", "/financials/records?view=costs", { sub: "Approved bills + approved expenses" }),
  };

  const alertCount = (kinds: string[]) => A.filter((a) => kinds.includes(String(a.kind))).length;
  const readyMs = M.filter((m) => m.state === "ready_to_invoice");
  const deposits = M.filter((m) => m.is_deposit && m.state !== "paid");
  const unverified = activePay.filter((r) => !r.verified);
  const unapplied = activePay.filter((r) => cmp(String(r.unapplied), 0) > 0);
  const billsDue = B.filter((r) => r.status === "approved" && String(r.due_date) <= in14);
  const overruns = C.filter((c) => cmp(String(c.billed), String(c.current_amount)) > 0);
  const uncoded = X.filter((x) => x.job_id && !x.cost_code_id).length + R.filter((r) => r.kind === "uncoded_cost").length;
  const soon = (label: string): Figure => ({ value: "Coming soon", money: false, basis: "Count", href: "/financials/tools", empty: true, note: label });

  const cards: Partial<Record<CardKey, Figure>> = {
    overdue_invoices: count(overdue.length, "/financials/receivables?bucket=overdue", { sub: overdue.length ? `${$(sumOf(overdue, "balance"))} past due` : "Nothing past due", tone: overdue.length ? "danger" : "ok" }),
    unapplied_payments: count(unapplied.length, "/financials/records?view=payments&filter=unapplied", { sub: unapplied.length ? `${$(sumOf(unapplied, "unapplied"))} not applied to an invoice` : "Every payment is applied", tone: unapplied.length ? "warn" : "ok" }),
    unverified_payments: count(unverified.length, "/financials/records?view=payments&filter=unverified", { sub: "Recorded by hand, not yet checked against the bank", tone: unverified.length ? "warn" : "ok" }),
    bills_due: count(billsDue.length, "/financials/records?view=costs&filter=bills_due", { sub: "Approved bills due in the next 14 days", tone: billsDue.some((x) => String(x.due_date) < today) ? "danger" : "default" }),
    needs_review: count(R.length, "/financials/records?view=review", { sub: "Uncoded costs, missing receipts, overruns", tone: R.length ? "warn" : "ok" }),
    commitment_overruns: count(overruns.length, "/financials/records?view=commitments&filter=overrun", { sub: "Billed more than committed", tone: overruns.length ? "danger" : "ok" }),
    uncoded_costs: count(uncoded, "/financials/records?view=review&filter=uncoded", { sub: "Costs on a job without a cost code", tone: uncoded ? "warn" : "ok" }),
    read_only_books: { value: ctx.access.readOnly ? "Read-only" : "Active", money: false, basis: "Count", href: "/financials/tools", tone: ctx.access.readOnly ? "warn" : "ok", sub: ctx.access.readOnly ? (P.length ? "Add-on lapsed: everything stays readable and exportable" : "Recording turns on with the Financials add-on") : "Recording is on" },
    ar_aging: money(sumOf(open, "balance"), "Outstanding", "/financials/receivables", { sub: agingSub(open) }),
    invoices_to_send: count(I.filter((r) => r.status === "draft").length, "/financials/records?view=invoices&filter=draft", { sub: "Draft invoices not yet issued" }),
    milestones_ready: count(readyMs.length, "/financials/records?view=milestones&filter=ready", { sub: readyMs.length ? `${$(sumOf(readyMs, "current_amount"))} ready to bill` : "No milestone is waiting for an invoice", tone: readyMs.length ? "warn" : "default" }),
    deposits_outstanding: count(deposits.length, "/financials/records?view=milestones&filter=deposits", { sub: deposits.length ? `${$(sub(sumOf(deposits, "current_amount"), sumOf(deposits, "paid")))} of deposits unpaid` : "All deposits paid" }),
    payments_received: money(sub(sumOf(activePay, "amount"), sumOf(activePay, "refunded")), "Paid", "/financials/records?view=payments", { sub: `${activePay.length} payment${activePay.length === 1 ? "" : "s"} recorded` }),
    change_orders_billing: count(alertCount(["change_order_affects_billing"]), "/financials/records?view=alerts&filter=change_order_affects_billing", { sub: "Approved changes that change the schedule" }),
    job_profitability: hasCostData ? money(projProfit, "Forecast", "/financials/records?view=jobs", { sub: `Estimated ${$(estProfit)} · Actual to date ${$(sumOf(P, "actual_profit_to_date"))}` })
      : { value: "Not enough cost data", money: false, basis: "Forecast", href: "/financials/records?view=jobs", empty: true, sub: "Add costs or open a job from a bid with costs" },
    budget_vs_actual: money(sumOf(P, "actual_cost"), "Actual", "/financials/records?view=jobs", { sub: `Estimated ${$(sumOf(P, "estimated_cost"))} · Committed ${$(sumOf(P, "committed_cost"))}` }),
    open_commitments: money(sumOf(C, "open_committed"), "Committed", "/financials/records?view=commitments", { sub: `${C.filter((c) => c.status === "open").length} open` }),
    bills_to_approve: count(B.filter((r) => r.status === "pending_approval").length, "/financials/records?view=costs&filter=bills_pending", { sub: "Vendor bills waiting for approval" }),
    expenses_to_approve: count(X.filter((r) => r.status === "pending").length, "/financials/records?view=costs&filter=expenses_pending", { sub: "Expenses waiting for approval" }),
    material_costs: money(byType(["material", "delivery"]), "Actual", "/financials/records?view=costs&filter=material"),
    labor_costs: money(byType(["labor", "labor_material", "labor_burden"]), "Actual", "/financials/records?view=costs&filter=labor"),
    subcontractor_costs: money(byType(["subcontractor"]), "Actual", "/financials/records?view=costs&filter=subcontractor", { sub: `Committed ${$(byType(["subcontractor"], "committed"))}` }),
    equipment_costs: money(byType(["equipment"]), "Actual", "/financials/records?view=costs&filter=equipment"),
    permit_costs: money(byType(["permit"]), "Actual", "/financials/records?view=costs&filter=permit"),
    inventory_usage: soon("Inventory tracking is planned for a later phase"),
    tm_unbilled: soon("Time & materials billing is planned for Phase 1b"),
    service_calls_unbilled: soon("Service-call billing is planned for a later phase"),
    retainage_placeholder: soon("Retainage is planned for Phase 1b"),
    progress_billing_placeholder: soon("Schedule-of-values progress billing is planned for Phase 1b"),
    crew_utilization_placeholder: soon("Crew utilization is planned for a later phase"),
    my_jobs: count(P.filter((r) => r.status === "open").length, "/financials/records?view=jobs", { sub: "Open jobs you can see" }),
    my_expenses: count(X.filter((r) => r.status === "pending").length, "/financials/records?view=costs&filter=expenses_pending", { sub: "Expenses waiting for approval" }),
    my_jobs_billing: money(sumOf(P, "invoiced_revenue"), "Invoiced", "/financials/records?view=jobs", { sub: `of ${$(contract)} contracted` }),
    export_center: { value: "CSV + PDF", money: false, basis: "Count", href: "/financials/accounting/reports", sub: "Ledger, aging, job costing, audit trail and more", note: "Every export is recorded in the audit trail" },
    audit_trail: count(auditWeek, "/financials/accounting/audit", { sub: "Financial actions recorded in the last 7 days" }),
    tax_updates: count(TA.length, "/financials/tax", { sub: TA.length ? `${TA.filter((a) => a.review_needed).length} need review` : "No new tax changes for your states", tone: TA.some((a) => a.review_needed) ? "warn" : "ok" }),
    cash_position: latestBal.size
      ? money(add(0, ...[...latestBal.values()].map((r) => String(r.current_balance ?? "0"))), "Actual", "/financials/cash", { sub: `Bank-reported · ${latestBal.size} account${latestBal.size === 1 ? "" : "s"}`, note: balAsOf ? `Oldest update ${balAsOf.slice(0, 10)}` : undefined })
      : { value: "No bank connected", money: false, basis: "Count", href: "/financials/banks", empty: true, sub: "Connect a bank or see the forecast" },
  };
  return { kpis, cards, alerts: A, jobs: P.length };
}

function agingSub(open: Row[]) {
  const b = (k: string) => $(sumOf(open.filter((r) => r.aging_bucket === k), "balance"));
  return `Current ${b("current")} · 1–30 ${b("1_30")} · 31–60 ${b("31_60")} · 61+ ${$(add(sumOf(open.filter((r) => r.aging_bucket === "61_90"), "balance"), sumOf(open.filter((r) => r.aging_bucket === "over_90"), "balance")))}`;
}

// ---------------------------------------------------------------------------------------------------------
// Job (project) financials
// ---------------------------------------------------------------------------------------------------------
/**
 * The bid's basic details for a job page. People who can read the bid get it directly; a Financials seat
 * alone (no bid permission) gets the same basics through fin_job_header(), never line items or costs.
 */
export async function loadJobHeader(db: Db, estimateId: string): Promise<Row | null> {
  const { data: est } = await db.from("estimates").select("id, title, customer_name, customer_email, customer_id, pipeline_stage, trades, company_id, user_id").eq("id", estimateId).maybeSingle();
  if (est) return { ...(est as Row), bid_readable: true };
  const { data: hdr, error } = await db.rpc("fin_job_header", { p_estimate_id: estimateId });
  if (error || !hdr) return null;
  return hdr as Row;
}

export async function loadJob(db: Db, estimateId: string, ctx: FinContext) {
  const est = await loadJobHeader(db, estimateId);
  if (!est) return null;
  const [{ data: job }, { data: versions }, { data: override }] = await Promise.all([
    db.from("fin_jobs").select("*").eq("estimate_id", estimateId).eq("book_id", ctx.bookId).maybeSingle(),
    db.from("estimate_versions").select("id, version_number, total, created_at").eq("estimate_id", estimateId).order("version_number", { ascending: false }).limit(5),
    db.from("fin_project_profiles").select("*").eq("estimate_id", estimateId).maybeSingle(),
  ]);
  const ov = override as Row | null;
  const projectOverride: ProjectOverride | null = ov ? {
    primaryTradeSlug: (ov.primary_trade_slug as string | null) ?? null, market: (ov.market as ProjectOverride["market"]) ?? null,
    projectModel: (ov.project_model as ProjectOverride["projectModel"]) ?? null, paymentStructure: (ov.payment_structure as ProjectOverride["paymentStructure"]) ?? null,
    workflow: (ov.workflow as ProjectOverride["workflow"]) ?? null,
  } : null;
  const profile = resolveProjectProfile(ctx.config, projectOverride);
  const base = { estimate: est as Row, versions: (versions ?? []) as Row[], profile, override: projectOverride };
  if (!job) return { ...base, job: null };
  const j = job as Row, jid = String(j.id);
  const [contract, snapshot, changes, msStatus, msRows, triggers, invoices, invRows, payments, allocations, credits, expenses, bills, billLines, commitments, budget, profit, review, alerts, codes, vendors, quotes] = await Promise.all([
    db.from("fin_job_contract_v").select("*").eq("job_id", jid).maybeSingle(),
    db.from("fin_contract_snapshots").select("id, total, payment_schedule, source, version_number, created_at").eq("job_id", jid).maybeSingle(),
    db.from("fin_contract_changes").select("id, kind, amount, description, effective_at, change_order_id").eq("job_id", jid).order("effective_at"),
    db.from("fin_milestone_status_v").select("*").eq("job_id", jid).order("seq"),
    db.from("fin_payment_milestones").select("id, due_days, due_date, percent").eq("job_id", jid),
    db.from("fin_milestone_triggers").select("id, milestone_id, trigger_kind, occurred_at, note").eq("job_id", jid).order("occurred_at"),
    db.from("fin_invoice_balances_v").select("*").eq("job_id", jid).order("issue_date", { ascending: false, nullsFirst: true }),
    db.from("fin_invoices").select("id, milestone_id, discrepancies, exception_reason, memo, bill_to, subtotal, tax, created_at, void_reason").eq("job_id", jid),
    db.from("fin_payment_balances_v").select("*").eq("job_id", jid).order("received_on", { ascending: false }),
    db.from("fin_payment_allocations").select("id, payment_id, invoice_id, amount, reversed_at").eq("book_id", ctx.bookId).is("reversed_at", null),
    db.from("fin_credit_memo_balances_v").select("*").eq("job_id", jid),
    db.from("fin_expenses").select("id, number, spent_on, amount, description, payee, status, cost_code_id, vendor_id, receipt_document_id, decision_note").eq("job_id", jid).order("spent_on", { ascending: false }),
    db.from("fin_vendor_bills").select("id, number, vendor_id, vendor_invoice_number, bill_date, due_date, total, status, document_id").eq("book_id", ctx.bookId).order("bill_date", { ascending: false }),
    db.from("fin_vendor_bill_lines").select("bill_id, job_id, cost_code_id, commitment_id, description, amount").eq("job_id", jid),
    db.from("fin_commitment_balances_v").select("*").eq("job_id", jid),
    db.from("fin_job_budget_v").select("*").eq("job_id", jid),
    db.from("fin_job_profitability_v").select("*").eq("job_id", jid).maybeSingle(),
    db.from("fin_review_items").select("id, kind, entity_type, entity_id, details, status, created_at").eq("job_id", jid).eq("status", "open"),
    db.from("fin_alerts").select("id, kind, severity, status, details, status_reason, created_at").eq("job_id", jid).in("status", ["open", "acknowledged"]),
    db.from("fin_cost_codes").select("id, code, name, trade_slug, cost_type").eq("book_id", ctx.bookId).eq("active", true).order("code"),
    db.from("fin_vendors").select("id, name, kind, resource_id").eq("book_id", ctx.bookId).eq("status", "active").order("name"),
    db.from("subcontractor_quotes").select("id, item_name, vendor_name, resource_id, status, applied_revision_id").eq("estimate_id", estimateId).eq("status", "accepted"),
  ]);
  // V5.1 summary + bill balances/payments (20261126001000). Missing objects (migration not run yet) read as null.
  const [summary, billBal, billPays] = await Promise.all([
    db.from("fin_job_summary_v").select("*").eq("job_id", jid).maybeSingle(),
    db.from("fin_bill_balances_v").select("bill_id, paid, balance, days_overdue").eq("book_id", ctx.bookId),
    db.from("fin_bill_payments").select("id, bill_id, paid_on, method, reference, amount, status").eq("book_id", ctx.bookId).order("paid_on", { ascending: false }),
  ]);
  // V6 P1-B part 2 (20261130101000): send states and change-order settlement. Missing objects read as empty.
  const jobInvIds = ((invoices.data ?? []) as Row[]).map((r) => String(r.invoice_id));
  const [emails, sends, amendments, coCredits] = await Promise.all([
    jobInvIds.length ? db.from("comm_messages").select("fin_invoice_id, status, sent_at, created_at").in("fin_invoice_id", jobInvIds) : Promise.resolve({ data: [] as Row[] }),
    jobInvIds.length ? db.from("fin_invoice_sends").select("invoice_id, method, sent_on, note").in("invoice_id", jobInvIds).is("undone_at", null) : Promise.resolve({ data: [] as Row[] }),
    db.from("fin_milestone_amendments").select("id, milestone_id, change_order_id, delta, status, reason").eq("job_id", jid),
    db.from("fin_credit_memos").select("id, number, change_order_id, amount, status").eq("job_id", jid).not("change_order_id", "is", null),
  ]);
  const emailRows = ((emails as { data: Row[] | null }).data ?? []) as Row[];
  const sendRows = ((sends as { data: Row[] | null; error?: unknown }).error ? [] : (sends as { data: Row[] | null }).data ?? []) as Row[];
  const ms = (msRows.data ?? []) as Row[];
  const quoteRows = (quotes.data ?? []) as Row[];
  const { data: revRows } = quoteRows.length
    ? await db.from("subcontractor_quote_revisions").select("id, quote_id, revision, amount").in("quote_id", quoteRows.map((q) => String(q.id)))
    : { data: [] as Row[] };
  const invExtra = new Map(((invRows.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  const jobBillIds = new Set(((billLines.data ?? []) as Row[]).map((l) => String(l.bill_id)));
  const allocs = ((allocations.data ?? []) as Row[]);
  const invoiceList = ((invoices.data ?? []) as Row[]).map((r) => {
    const id = String(r.invoice_id);
    const mark = sendRows.find((x) => String(x.invoice_id) === id) ?? null;
    return { ...r, ...invExtra.get(id), send: invoiceSendInfo(r, emailRows.filter((e) => String(e.fin_invoice_id) === id), mark), send_note: mark?.note ?? null } as Row;
  });
  const invIds = new Set(invoiceList.map((r) => String(r.invoice_id)));
  // Approved timesheet hours costed into this job (20270103001000). Missing function reads as null.
  const { data: tl } = await db.rpc("fin_job_timesheet_labor", { p_job_id: jid });
  return {
    ...base,
    job: j,
    timesheetLabor: (tl as { counted: boolean; hours: string; amount: string; uncostedHours: string; workers: string[] } | null) ?? null,
    contract: (contract.data as Row | null) ?? null,
    snapshot: (snapshot.data as Row | null) ?? null,
    changes: (changes.data ?? []) as Row[],
    milestones: ((msStatus.data ?? []) as Row[]).map((m) => {
      const extra = ms.find((x) => x.id === m.milestone_id);
      const inv = invoiceList.filter((i) => i.milestone_id === m.milestone_id && i.status !== "void");
      return { ...m, due_days: extra?.due_days ?? null, due_date: extra?.due_date ?? null, invoices: inv.map((i) => ({ id: i.invoice_id, number: i.number, status: i.status, total: i.total, balance: i.balance })) };
    }),
    triggers: (triggers.data ?? []) as Row[],
    invoices: invoiceList,
    changeOrders: changeOrderSettlement((changes.data ?? []) as Row[], (msStatus.data ?? []) as Row[],
      ((amendments as { data: Row[] | null; error?: unknown }).data ?? []) as Row[], ((coCredits as { data: Row[] | null; error?: unknown }).error ? [] : (coCredits as { data: Row[] | null }).data ?? []) as Row[]),
    payments: ((payments.data ?? []) as Row[]).map((p) => ({ ...p, allocations: allocs.filter((a) => a.payment_id === p.payment_id && invIds.has(String(a.invoice_id))) })),
    credits: (credits.data ?? []) as Row[],
    expenses: (expenses.data ?? []) as Row[],
    bills: ((bills.data ?? []) as Row[]).filter((b) => jobBillIds.has(String(b.id))).map((b) => {
      const bb = ((billBal.data ?? []) as Row[]).find((x) => x.bill_id === b.id);
      return { ...b, paid: bb?.paid ?? null, balance: bb?.balance ?? null, days_overdue: bb?.days_overdue ?? 0,
        payments: ((billPays.data ?? []) as Row[]).filter((p) => p.bill_id === b.id) };
    }),
    summary: (summary.error ? null : (summary.data as Row | null)) ?? null,
    billLines: (billLines.data ?? []) as Row[],
    commitments: (commitments.data ?? []) as Row[],
    budget: (budget.data ?? []) as Row[],
    profit: (profit.data as Row | null) ?? null,
    review: (review.data ?? []) as Row[],
    alerts: (alerts.data ?? []) as Row[],
    costCodes: (codes.data ?? []) as Row[],
    vendors: (vendors.data ?? []) as Row[],
    quotes: quoteRows.map((q) => {
      const revs = ((revRows ?? []) as Row[]).filter((r) => r.quote_id === q.id);
      const rev = revs.find((r) => r.id === q.applied_revision_id) ?? revs.sort((a, b) => Number(b.revision) - Number(a.revision))[0];
      return { id: q.id, itemName: q.item_name, vendorName: q.vendor_name, resourceId: q.resource_id, amount: rev ? toMoney(String(rev.amount)) : null };
    }),
  };
}
export type JobData = NonNullable<Awaited<ReturnType<typeof loadJob>>>;
