/**
 * Dashboard widget registry: every widget a person can add, what it needs to be shown, how big it can be,
 * and which settings it has. Pure and client-safe (the library and the settings panel read it in the browser);
 * the server renders widget content in src/components/dashboard/widgets.tsx from the same keys.
 *
 * Rules:
 *  - Only widgets backed by real, working features. No sample numbers, no "coming soon" tiles.
 *  - `requires` uses the V6.7 capability vocabulary (feature + level). A widget the viewer can't access is never
 *    offered, is refused by the save API, and renders no data even if it is still in a saved layout.
 *  - `sources` names the data a widget reads, so the dashboard loads each source once and only for widgets shown.
 */
import { need, type CapabilityRequirement } from "./access";
import { CATEGORIES, CATEGORY_LABELS, BASIS_LABELS, PERIOD_LABELS } from "@/lib/financials/reports";
import { CHART_PERIODS, CHART_TYPE_LABELS, DATASETS, DATASET_INFO, chartTypesFor, isDataset, type Dataset } from "./charts";

export const GROUPS = ["overview", "projects", "sales", "accounting", "team", "growth", "actions"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABELS: Record<Group, string> = {
  overview: "Business overview", projects: "Projects", sales: "Sales & estimating", accounting: "Accounting",
  team: "Employees & subcontractors", growth: "Grow the business", actions: "Quick actions",
};

/** Data a widget reads. One load per source per page view, however many widgets use it. */
export type Source = "bids" | "signing" | "company_summary" | "customers" | "schedules" | "tasks" | "review" | "fin_home" | "fin_acct" | "fin_jobs" | "ar" | "payments" | "pl" | "time";

export type Option = { value: string; label: string };
export type SettingSpec =
  | { key: string; label: string; kind: "select"; options: readonly Option[]; default: string }
  | { key: string; label: string; kind: "multi"; options: readonly Option[]; default: readonly string[]; max?: number }
  /** Options come from the viewer's own records (projects, trades), supplied by the server. */
  | { key: string; label: string; kind: "dynamic"; from: "jobs" | "trades"; default: "" }
  /** The chart group: dataset, chart type (filtered by the dataset's shape), period, basis, categories, project, trade. */
  | { key: "chart"; label: string; kind: "chart" };

export type Width = 1 | 2 | 3 | 4;
export type Height = 1 | 2;

export interface WidgetDef {
  type: string;
  title: string;
  description: string;
  group: Group;
  requires: readonly CapabilityRequirement[];
  sources: readonly Source[];
  size: { w: Width; h: Height; minW?: Width; maxW?: Width; maxH?: Height };
  settings: readonly SettingSpec[];
  /** More than one copy allowed (charts). */
  multiple?: boolean;
}

const opt = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
const RANGE = { key: "range", label: "Date range", kind: "select", default: "all", options: opt([["30d", "Last 30 days"], ["90d", "Last 90 days"], ["year", "Last 12 months"], ["all", "All time"]]) } as const satisfies SettingSpec;
const PERIOD = { key: "period", label: "Period", kind: "select", default: "ytd", options: CHART_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] })) } as const satisfies SettingSpec;
const BASIS = { key: "basis", label: "Basis", kind: "select", default: "cash", options: opt([["cash", BASIS_LABELS.cash], ["billed", BASIS_LABELS.billed]]) } as const satisfies SettingSpec;
const LIMIT = { key: "limit", label: "Rows", kind: "select", default: "5", options: opt([["5", "5"], ["10", "10"]]) } as const satisfies SettingSpec;

const FIN_PROJECT: CapabilityRequirement[] = [need("fin_visibility", "project")];
const FIN_COMPANY: CapabilityRequirement[] = [need("fin_visibility", "company")];
const BIDS: CapabilityRequirement[] = [need("bids", "view")];
const SCHEDULE: CapabilityRequirement[] = [need("schedule", "view")];
const TEAM: CapabilityRequirement[] = [need("team_directory")];

/** Quick actions: each one needs its own capability, and each opens a real page. */
export const QUICK_ACTIONS = {
  create_bid: { label: "Create bid", href: "/bids", requires: [need("bids", "create")] },
  customers: { label: "Customers", href: "/dashboard/customers", requires: [need("customers")] },
  open_schedule: { label: "Open schedule", href: "/projects", requires: SCHEDULE },
  create_invoice: { label: "Create invoice", href: "/financials/records?view=jobs&do=invoice", requires: [...FIN_PROJECT, need("invoices")], write: true },
  record_payment: { label: "Record payment", href: "/financials/records?view=jobs&do=payment", requires: [...FIN_PROJECT, need("payments")], write: true },
  add_expense: { label: "Add expense", href: "/financials/records?view=jobs&do=expense", requires: [...FIN_PROJECT, need("expenses", "create")], write: true },
  record_bill: { label: "Record bill", href: "/financials/records?view=jobs&do=bill", requires: [...FIN_PROJECT, need("bills", "create")], write: true },
  view_pl: { label: "View P&L", href: "/financials/reports", requires: FIN_COMPANY },
  reconcile: { label: "Reconcile bank", href: "/financials/accounting/bank", requires: [...FIN_COMPANY, need("bank")] },
  open_reports: { label: "Open reports", href: "/financials/accounting/reports", requires: FIN_COMPANY },
  receivables: { label: "Accounts receivable", href: "/financials/receivables", requires: FIN_PROJECT },
  time_clock: { label: "Time clock", href: "/projects/team/time", requires: TEAM },
} as const satisfies Record<string, { label: string; href: string; requires: readonly CapabilityRequirement[]; write?: boolean }>;
export type QuickActionKey = keyof typeof QUICK_ACTIONS;
export const QUICK_ACTION_KEYS = Object.keys(QUICK_ACTIONS) as QuickActionKey[];

const DEFS: WidgetDef[] = [
  // ---- Business overview --------------------------------------------------------------------------------------
  { type: "fin_revenue", title: "Revenue (invoiced)", description: "Total of issued invoices.", group: "overview", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_cash_received", title: "Cash received", description: "Payments recorded, net of refunds.", group: "overview", requires: FIN_PROJECT, sources: ["fin_home", "payments"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_bank_balance", title: "Bank balance", description: "Ending balance from your latest imported bank statements (never estimated).", group: "overview", requires: FIN_COMPANY, sources: ["fin_acct"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_projected_balance", title: "Projected bank balance", description: "Bank balance plus receivables due in 30 days, minus approved bills due in 30 days.", group: "overview", requires: FIN_COMPANY, sources: ["fin_acct"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_ar", title: "Outstanding receivables", description: "Unpaid invoices, with aging. Card or table.", group: "overview", requires: FIN_PROJECT, sources: ["ar"], size: { w: 1, h: 1, maxW: 4, maxH: 2 },
    settings: [
      { key: "bucket", label: "Show", kind: "select", default: "open", options: opt([["open", "All unpaid"], ["overdue", "Overdue only"], ["due_soon", "Due in 14 days"], ["current", "Current (not due)"], ["1_30", "1–30 days overdue"], ["31_60", "31–60 days overdue"], ["61_90", "61–90 days overdue"], ["over_90", "Over 90 days overdue"]]) },
      { key: "view", label: "View", kind: "select", default: "card", options: opt([["card", "Card"], ["table", "Table"]]) },
      LIMIT,
    ] },
  { type: "fin_ap", title: "Accounts payable", description: "Approved vendor bills not yet paid.", group: "overview", requires: FIN_COMPANY, sources: ["fin_acct"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_upcoming_payments", title: "Upcoming payments", description: "Approved bills due in the next 14 days.", group: "overview", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_profitability", title: "Company profitability", description: "Projected profit across open jobs.", group: "overview", requires: FIN_COMPANY, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },

  // ---- Projects --------------------------------------------------------------------------------------------------
  { type: "pm_active", title: "Active projects", description: "Projects with a published schedule.", group: "projects", requires: SCHEDULE, sources: ["schedules"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "pm_scheduled", title: "Scheduled projects", description: "Projects starting in the future.", group: "projects", requires: SCHEDULE, sources: ["schedules"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "pm_review", title: "Projects requiring review", description: "Newly approved jobs waiting for review before scheduling.", group: "projects", requires: SCHEDULE, sources: ["review"], size: { w: 2, h: 1, maxH: 2 }, settings: [LIMIT] },
  { type: "pm_overdue_tasks", title: "Overdue tasks", description: "Tasks past their planned finish that aren't complete.", group: "projects", requires: SCHEDULE, sources: ["schedules", "tasks"], size: { w: 2, h: 1, maxH: 2 }, settings: [LIMIT] },
  { type: "pm_upcoming", title: "Upcoming work", description: "Tasks starting soon on active projects.", group: "projects", requires: SCHEDULE, sources: ["schedules", "tasks"], size: { w: 2, h: 1, maxH: 2 },
    settings: [{ key: "days", label: "Look ahead", kind: "select", default: "14", options: opt([["7", "7 days"], ["14", "14 days"], ["30", "30 days"]]) }, LIMIT] },
  { type: "pm_calendar", title: "Schedule preview", description: "The next two weeks of work, day by day.", group: "projects", requires: SCHEDULE, sources: ["schedules", "tasks"], size: { w: 4, h: 1, minW: 2 }, settings: [] },
  { type: "fin_project_profitability", title: "Project profitability", description: "Jobs ranked by projected profit.", group: "projects", requires: FIN_PROJECT, sources: ["fin_jobs"], size: { w: 2, h: 1, maxH: 2 },
    settings: [{ key: "sort", label: "Order", kind: "select", default: "low", options: opt([["low", "Least profitable first"], ["high", "Most profitable first"]]) }, LIMIT] },
  { type: "fin_over_budget", title: "Jobs over budget", description: "Jobs where actual plus committed cost is above the bid's cost.", group: "projects", requires: FIN_PROJECT, sources: ["fin_jobs"], size: { w: 2, h: 1, maxH: 2 }, settings: [LIMIT] },

  // ---- Sales & estimating -------------------------------------------------------------------------------------
  { type: "sales_pipeline", title: "Sales pipeline", description: "Your bids by stage.", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 2, h: 1, maxH: 2 },
    settings: [{ key: "view", label: "View", kind: "select", default: "bar", options: opt([["bar", "Bar"], ["table", "Table"]]) }, RANGE] },
  { type: "sales_drafts", title: "Draft bids", description: "Estimates you're still building.", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "sales_awaiting", title: "Awaiting signature", description: "Proposals sent for signature.", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "sales_won", title: "Approved proposals", description: "Bids won or approved.", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 1, h: 1, maxW: 2 }, settings: [RANGE] },
  { type: "sales_win_rate", title: "Win rate", description: "Won out of decided bids (won + lost).", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 1, h: 1, maxW: 2 }, settings: [RANGE] },
  { type: "sales_avg_value", title: "Average bid value", description: "Average total of your latest proposal versions.", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 1, h: 1, maxW: 2 },
    settings: [{ key: "which", label: "Bids", kind: "select", default: "all", options: opt([["all", "All bids with a proposal"], ["won", "Won bids only"]]) }, RANGE] },
  { type: "sales_recent", title: "Recently created estimates", description: "Your newest bids.", group: "sales", requires: BIDS, sources: ["bids"], size: { w: 2, h: 1, maxH: 2 }, settings: [LIMIT] },
  { type: "company_pipeline", title: "Company pipeline", description: "Company win rate and open bid value.", group: "sales", requires: [need("analytics")], sources: ["company_summary"], size: { w: 2, h: 1 }, settings: [] },
  { type: "customers", title: "Customers", description: "Customers in your customer list.", group: "growth", requires: [need("customers")], sources: ["customers"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  // V6.8: free for every plan and every member; loads its own (public) news, so no shared data source.
  { type: "industry_briefing", title: "Your Industry Briefing", description: "Local, state and national news for your trades from official and trade sources.", group: "growth", requires: [], sources: [], size: { w: 2, h: 2, minW: 1, maxH: 2 },
    settings: [
      { key: "limit", label: "Stories", kind: "select", default: "5", options: opt([["3", "3"], ["5", "5"], ["10", "10"]]) },
      { key: "geo", label: "Emphasis", kind: "select", default: "balanced", options: opt([["balanced", "Balanced"], ["local", "Local first"], ["state", "State first"], ["national", "National first"]]) },
    ] },

  // ---- Accounting ------------------------------------------------------------------------------------------------
  { type: "chart", title: "Chart", description: "Expenses, revenue, P&L, job, labor or subcontractor costs, or cash in vs out. Add as many as you like.", group: "accounting", requires: FIN_COMPANY, sources: ["pl", "ar"], size: { w: 2, h: 2, minW: 1 }, settings: [{ key: "chart", label: "Chart", kind: "chart" }], multiple: true },
  { type: "fin_pl_summary", title: "Profit and loss summary", description: "Revenue, job costs, gross profit, overhead and net profit.", group: "accounting", requires: FIN_COMPANY, sources: ["pl"], size: { w: 2, h: 1, maxH: 2 }, settings: [PERIOD, BASIS] },
  { type: "fin_reconciliation", title: "Bank reconciliation", description: "Statement lines still to match, and your last reconciliation.", group: "accounting", requires: [...FIN_COMPANY, need("bank")], sources: ["fin_acct"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_unmatched", title: "Unmatched transactions", description: "Bank statement lines not yet matched or excluded.", group: "accounting", requires: [...FIN_COMPANY, need("bank")], sources: ["fin_acct"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "tax_updates", title: "Tax & regulatory updates", description: "New sales tax rate and rule changes for the states you work in, and which need your review.", group: "accounting", requires: FIN_COMPANY, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "cash_position", title: "Cash position", description: "Bank-reported balance from connected banks, linked to the cash-flow forecast.", group: "accounting", requires: [...FIN_COMPANY, need("bank")], sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_uncategorized", title: "Uncategorized expenses", description: "Costs on a job without a cost code.", group: "accounting", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_unpaid_bills", title: "Bills to approve", description: "Vendor bills waiting for approval.", group: "accounting", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_alerts", title: "Financial alerts", description: "Open alerts that need a decision.", group: "accounting", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 2, h: 1, maxH: 2 }, settings: [LIMIT] },

  // ---- Employees & subcontractors -----------------------------------------------------------------------------
  { type: "team_hours", title: "Labor hours", description: "Hours on the time clock.", group: "team", requires: TEAM, sources: ["time"], size: { w: 1, h: 1, maxW: 2 },
    settings: [{ key: "range", label: "Period", kind: "select", default: "week", options: opt([["week", "This week"], ["last_week", "Last week"], ["month", "This month"]]) }] },
  { type: "team_overtime", title: "Overtime alerts", description: "People over 40 hours this week on the time clock.", group: "team", requires: TEAM, sources: ["time"], size: { w: 1, h: 1, maxW: 2, maxH: 2 }, settings: [] },
  { type: "team_on_clock", title: "On the clock now", description: "People clocked in right now, and where.", group: "team", requires: TEAM, sources: ["time"], size: { w: 1, h: 1, maxW: 2, maxH: 2 }, settings: [] },
  { type: "fin_labor_costs", title: "Labor costs", description: "Labor recorded on bills and expenses (Built2Bid has no payroll system).", group: "team", requires: FIN_COMPANY, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_sub_commitments", title: "Subcontractor commitments", description: "Open commitments not yet billed.", group: "team", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },
  { type: "fin_sub_costs", title: "Subcontractor costs", description: "Subcontractor bills and expenses, with what's committed.", group: "team", requires: FIN_PROJECT, sources: ["fin_home"], size: { w: 1, h: 1, maxW: 2 }, settings: [] },

  // ---- Quick actions ---------------------------------------------------------------------------------------------
  { type: "quick_actions", title: "Quick actions", description: "Buttons for the things you do most.", group: "actions", requires: [], sources: [], size: { w: 2, h: 1, maxH: 1 },
    settings: [{ key: "actions", label: "Actions", kind: "multi", max: 8, default: ["create_bid", "open_schedule", "create_invoice", "record_payment"], options: QUICK_ACTION_KEYS.map((k) => ({ value: k, label: QUICK_ACTIONS[k].label })) }] },
];

export const WIDGETS: Readonly<Record<string, WidgetDef>> = Object.fromEntries(DEFS.map((d) => [d.type, d]));
export const WIDGET_TYPES = DEFS.map((d) => d.type);
export const widgetDef = (type: string): WidgetDef | undefined => (Object.hasOwn(WIDGETS, type) ? WIDGETS[type] : undefined);

// ---- Settings ------------------------------------------------------------------------------------------------
export const CHART_DEFAULTS = { dataset: "expenses" as Dataset, chart: "donut", period: "ytd", basis: "cash", categories: null as string[] | null, job: "", trade: "" };
const UUID = /^[0-9a-f-]{36}$/i, SLUG = /^[a-z0-9_-]{1,60}$/;

/**
 * Clean a widget's saved settings against its spec: unknown keys dropped, values outside the allowed options
 * replaced by the default. Never throws (an old or hand-edited layout always renders).
 */
export function sanitizeSettings(def: WidgetDef, raw: unknown): Record<string, unknown> {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const spec of def.settings) {
    if (spec.kind === "select") out[spec.key] = spec.options.some((o) => o.value === s[spec.key]) ? s[spec.key] : spec.default;
    else if (spec.kind === "multi") {
      const v = Array.isArray(s[spec.key]) ? [...new Set((s[spec.key] as unknown[]).filter((x): x is string => typeof x === "string" && spec.options.some((o) => o.value === x)))] : [...spec.default];
      out[spec.key] = v.slice(0, spec.max ?? 20);
    } else if (spec.kind === "dynamic") out[spec.key] = typeof s[spec.key] === "string" && (UUID.test(s[spec.key] as string) || SLUG.test(s[spec.key] as string)) ? s[spec.key] : "";
    else if (spec.kind === "chart") {
      const dataset = isDataset(s.dataset) ? s.dataset : CHART_DEFAULTS.dataset;
      const types = chartTypesFor(dataset);
      out.dataset = dataset;
      out.chart = types.includes(s.chart as never) ? s.chart : types[0];
      out.period = (CHART_PERIODS as readonly string[]).includes(s.period as string) ? s.period : CHART_DEFAULTS.period;
      out.basis = s.basis === "billed" ? "billed" : "cash";
      out.categories = DATASET_INFO[dataset].categories && Array.isArray(s.categories)
        ? [...new Set((s.categories as unknown[]).filter((c): c is string => typeof c === "string" && (CATEGORIES as readonly string[]).includes(c)))] : null;
      out.job = DATASET_INFO[dataset].filters && typeof s.job === "string" && UUID.test(s.job) ? s.job : "";
      out.trade = DATASET_INFO[dataset].filters && typeof s.trade === "string" && SLUG.test(s.trade) ? s.trade : "";
    }
  }
  return out;
}

export const defaultSettings = (def: WidgetDef) => sanitizeSettings(def, {});

/** Chart option lists for the settings panel. */
export const CHART_OPTIONS = {
  datasets: DATASETS.map((d) => ({ value: d, label: DATASET_INFO[d].label, hint: DATASET_INFO[d].hint })),
  types: (d: Dataset) => chartTypesFor(d).map((t) => ({ value: t, label: CHART_TYPE_LABELS[t] })),
  periods: CHART_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] })),
  bases: [{ value: "cash", label: BASIS_LABELS.cash }, { value: "billed", label: BASIS_LABELS.billed }],
  categories: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
};

/** A short title for a widget instance (charts are named after their dataset). */
export function instanceTitle(type: string, settings: Record<string, unknown>): string {
  const def = widgetDef(type);
  if (!def) return "Unavailable widget";
  if (type === "chart" && isDataset(settings.dataset)) return DATASET_INFO[settings.dataset].label;
  return def.title;
}
