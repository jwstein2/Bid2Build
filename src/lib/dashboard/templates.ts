/**
 * Starting dashboards. A template is a list of widgets; building one for a person keeps only the widgets that
 * person can access, so nobody starts with blank or locked tiles. Pure.
 */
import { allowed, type DashboardAccess } from "./access";
import { widgetDef } from "./registry";
import { newInstance, type DashboardMode, type Layout, type WidgetInstance } from "./schema";

type Entry = [type: string, w?: number, h?: number, settings?: Record<string, unknown>];

export const TEMPLATES = {
  simple: {
    label: "Simple", audience: "Solo contractor",
    description: "Create a bid, active projects, unpaid invoices, upcoming schedule and cash.",
    widgets: [
      ["quick_actions", 2, 1, { actions: ["create_bid", "open_schedule", "create_invoice", "customers"] }],
      ["sales_awaiting"], ["pm_active"],
      ["fin_ar"], ["fin_cash_received"], ["sales_drafts"], ["sales_win_rate"],
      ["pm_upcoming", 2, 1], ["sales_recent", 2, 1],
      ["fin_bank_balance"],
      ["industry_briefing", 2, 2],
    ] as Entry[],
  },
  sales: {
    label: "Sales & estimating", audience: "Sales reps and estimators",
    description: "Bids awaiting signature, drafts, wins, win rate, pipeline, recent estimates and customers.",
    widgets: [
      ["quick_actions", 2, 1, { actions: ["create_bid", "customers"] }],
      ["sales_awaiting"], ["sales_drafts"], ["sales_won"], ["sales_win_rate"],
      ["sales_pipeline", 2, 1], ["sales_recent", 2, 1],
      ["sales_avg_value"], ["customers"],
      ["pm_upcoming", 2, 1],
      ["industry_briefing", 2, 2],
    ] as Entry[],
  },
  job: {
    label: "Project manager", audience: "Project managers",
    description: "Active jobs, upcoming tasks, delayed work, crew time and project financials.",
    widgets: [
      ["pm_active"], ["pm_scheduled"], ["team_on_clock"], ["team_hours"],
      ["pm_calendar", 4, 1],
      ["pm_overdue_tasks", 2, 1], ["pm_upcoming", 2, 1],
      ["pm_review", 2, 1], ["fin_over_budget", 2, 1],
      ["fin_project_profitability", 2, 1], ["quick_actions", 2, 1, { actions: ["open_schedule", "time_clock", "add_expense", "create_bid"] }],
    ] as Entry[],
  },
  financial: {
    label: "Financial", audience: "Owners and accountants",
    description: "Bank and projected balance, AR and AP, expenses, P&L, reconciliation and alerts.",
    widgets: [
      ["fin_bank_balance"], ["fin_projected_balance"], ["fin_ar"], ["fin_ap"],
      ["chart", 2, 2, { dataset: "expenses", chart: "donut", period: "ytd" }],
      ["chart", 2, 2, { dataset: "cash_flow", chart: "bar", period: "last_12" }],
      ["fin_pl_summary", 2, 1], ["fin_alerts", 2, 1],
      ["fin_reconciliation"], ["fin_unmatched"], ["fin_uncategorized"], ["fin_unpaid_bills"],
      ["quick_actions", 4, 1, { actions: ["record_payment", "add_expense", "reconcile", "view_pl", "open_reports"] }],
    ] as Entry[],
  },
} as const satisfies Record<string, { label: string; audience: string; description: string; widgets: Entry[] }>;
export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];
export const isTemplate = (v: unknown): v is TemplateKey => typeof v === "string" && Object.hasOwn(TEMPLATES, v);

/** Widgets the person can access, with quick actions trimmed to the ones they may use. */
export function forAccess(entries: Entry[], access: DashboardAccess): WidgetInstance[] {
  const out: WidgetInstance[] = [];
  entries.forEach(([type, w, h, settings], i) => {
    const def = widgetDef(type);
    if (!def || !allowed(access, def.requires)) return;
    out.push(newInstance(type, settings, { w, h }, `${type.slice(0, 24)}-${i}`));
  });
  return out;
}

export function buildTemplate(key: TemplateKey, access: DashboardAccess): Layout {
  return { version: 1, template: key, widgets: forAccess(TEMPLATES[key].widgets, access) };
}

/**
 * The most relevant starting template. A Home page assigned in Team & Access comes first (Accountant Mode
 * always shows financial). Otherwise: Accountant Mode and accounting roles get financial; managers with
 * scheduling get project manager; estimators get sales & estimating; everyone else (most solo contractors)
 * gets simple.
 */
export function defaultTemplate(access: DashboardAccess, mode: DashboardMode): TemplateKey {
  const finCompany = access.features.fin_visibility === "company";
  if (mode === "accountant" && finCompany) return "financial";
  if (access.company && isTemplate(access.home)) {
    // A financial Home without company financials would be nearly empty: fall through to the automatic pick.
    if (access.home !== "financial" || finCompany) return access.home;
  }
  if (access.fin && ["accountant", "bookkeeper", "financial_admin"].includes(access.fin.role) && finCompany) return "financial";
  if (access.company?.role === "manager" && access.features.schedule) return "job";
  if (access.company?.role === "estimator") return access.features.bids ? "sales" : access.features.schedule ? "job" : "simple";
  return "simple";
}

// ---- "Set Up My Dashboard" -----------------------------------------------------------------------------------
export const INTERESTS = {
  sales: { label: "Sales and estimates", widgets: [["sales_pipeline", 2, 1], ["sales_awaiting"], ["sales_win_rate"], ["sales_recent", 2, 1]] as Entry[] },
  scheduling: { label: "Project scheduling", widgets: [["pm_calendar", 4, 1], ["pm_upcoming", 2, 1], ["pm_overdue_tasks", 2, 1]] as Entry[] },
  cash: { label: "Cash flow", widgets: [["fin_bank_balance"], ["fin_projected_balance"], ["fin_cash_received"], ["chart", 2, 2, { dataset: "cash_flow", chart: "bar", period: "last_12" }]] as Entry[] },
  invoices: { label: "Invoices", widgets: [["fin_ar", 2, 1, { view: "table" }], ["chart", 2, 2, { dataset: "invoice_status", chart: "donut", period: "last_12" }]] as Entry[] },
  profitability: { label: "Job profitability", widgets: [["fin_project_profitability", 2, 1], ["fin_over_budget", 2, 1], ["fin_profitability"]] as Entry[] },
  accounting: { label: "Accounting", widgets: [["fin_pl_summary", 2, 1], ["chart", 2, 2, { dataset: "expenses", chart: "donut", period: "ytd" }], ["fin_reconciliation"], ["fin_unmatched"], ["fin_uncategorized"], ["fin_alerts", 2, 1]] as Entry[] },
  team: { label: "Team management", widgets: [["team_on_clock"], ["team_hours"], ["team_overtime"], ["fin_labor_costs"], ["fin_sub_commitments"]] as Entry[] },
} as const satisfies Record<string, { label: string; widgets: Entry[] }>;
export type InterestKey = keyof typeof INTERESTS;
export const INTEREST_KEYS = Object.keys(INTERESTS) as InterestKey[];

/** Interests the person can actually use (no point asking a solo contractor without Financials about reconciliation). */
export const availableInterests = (access: DashboardAccess) => INTEREST_KEYS.filter((k) => forAccess(INTERESTS[k].widgets, access).length > 0);

/** Suggested layout for the chosen interests: quick actions first, then each interest's widgets, no duplicates. */
export function suggestLayout(interests: InterestKey[], access: DashboardAccess): Layout {
  if (interests.length === 0) return buildTemplate("simple", access);
  const entries: Entry[] = [["quick_actions", 2, 1]];
  const seen = new Set<string>(["quick_actions"]);
  for (const k of interests) {
    for (const e of INTERESTS[k].widgets) {
      const sig = e[0] === "chart" ? `chart:${String(e[3]?.dataset)}` : e[0];
      if (seen.has(sig)) continue;
      seen.add(sig);
      entries.push(e);
    }
  }
  const finance = interests.some((k) => k === "cash" || k === "accounting" || k === "invoices");
  const sched = interests.includes("scheduling") || interests.includes("team");
  const template: TemplateKey = finance && !interests.includes("sales") ? "financial" : sched ? "job" : "simple";
  const widgets = forAccess(entries, access).map((w) => (w.type === "quick_actions" ? { ...w, settings: { actions: quickActionsFor(interests) } } : w));
  return { version: 1, template, widgets };
}

function quickActionsFor(interests: InterestKey[]): string[] {
  const a: string[] = [];
  if (interests.includes("sales")) a.push("create_bid", "customers");
  if (interests.includes("scheduling")) a.push("open_schedule");
  if (interests.includes("invoices")) a.push("create_invoice", "record_payment");
  if (interests.includes("cash") || interests.includes("accounting")) a.push("add_expense", "view_pl");
  if (interests.includes("accounting")) a.push("reconcile");
  if (interests.includes("team")) a.push("time_clock");
  if (a.length === 0) a.push("create_bid");
  return [...new Set(a)].slice(0, 8);
}
