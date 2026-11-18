/**
 * What the viewer may see on the dashboard, as the same contract the V6.7 workspace-access work uses
 * (src/lib/access: CapabilityRequirement = { feature, level? }, hasCapability(access, req)). Until that lands,
 * `accessFromFacts` builds it from today's permission sources (company role permissions, PM access, the
 * Financials seat), so each widget can already declare what it needs in V6.7's vocabulary.
 *
 * Pure and client-safe. Hiding a widget is presentation only: every widget's data is still read through
 * row-level security on the server, so a widget left in a saved layout never shows data its viewer can't open.
 */

/** Feature ids shared with V6.7 (src/lib/access/capabilities.ts). Only the ones dashboard widgets use. */
export type FeatureId =
  | "bids" | "bid_visibility" | "costs" | "customers" | "analytics" | "schedule" | "job_review" | "change_orders"
  | "team_directory" | "project_costs" | "fin_visibility" | "invoices" | "payments" | "expenses" | "bills" | "bank" | "ledger" | "exports";

export interface CapabilityRequirement { feature: FeatureId; level?: string }
/** Shorthand for a requirement: need("fin_visibility", "company"). */
export const need = (feature: FeatureId, level?: string): CapabilityRequirement => (level ? { feature, level } : { feature });

/** Levels per feature, lowest first. Holding a level includes the ones before it. */
const LEVELS: Partial<Record<FeatureId, readonly string[]>> = {
  bids: ["view", "create", "edit", "approve"],
  bid_visibility: ["team", "company"],
  costs: ["view", "margin"],
  schedule: ["view", "create", "edit", "approve", "manage"],
  change_orders: ["create", "approve"],
  project_costs: ["view", "edit"],
  fin_visibility: ["project", "company"],
  expenses: ["create", "approve"],
  bills: ["create", "approve"],
  ledger: ["post", "manage", "close"],
};

export interface DashboardAccess {
  /** feature -> highest level held ("use" for features without levels). Missing = no access. */
  features: Partial<Record<FeatureId, string>>;
  company: { id: string; role: "owner" | "manager" | "estimator" | "viewer"; isOwner: boolean } | null;
  /** Financials: the viewer's book role and whether recording is open (add-on active, not read-only, not lapsed). */
  fin: { role: string; canWrite: boolean; sandbox: boolean; accountantMode: boolean } | null;
}

export function hasCapability(a: DashboardAccess, req: CapabilityRequirement): boolean {
  const held = a.features[req.feature];
  if (!held) return false;
  if (!req.level) return true;
  const order = LEVELS[req.feature];
  if (!order) return held === req.level || held === "use";
  return order.indexOf(held) >= order.indexOf(req.level) && order.indexOf(req.level) >= 0;
}

export const allowed = (a: DashboardAccess, reqs: readonly CapabilityRequirement[]) => reqs.every((r) => hasCapability(a, r));

export interface AccessFacts {
  pmEnabled: boolean;
  financialsEnabled: boolean;
  company: { id: string; role: "owner" | "manager" | "estimator" | "viewer"; isOwner: boolean; permissions: readonly string[] } | null;
  /** Financial seat permissions (fin_access), or null without a book / seat. */
  fin: { role: string; permissions: readonly string[]; active: boolean; readOnly: boolean; sandbox: boolean } | null;
  accountantModeAllowed: boolean;
}

/** Today's permissions, expressed as V6.7 features. Solo accounts (no company) get everything their flags allow. */
export function accessFromFacts(f: AccessFacts): DashboardAccess {
  const features: Partial<Record<FeatureId, string>> = {};
  const c = f.company;
  const has = (p: string) => !c || c.permissions.includes(p);
  const top = (pairs: [string, boolean][]) => pairs.filter(([, ok]) => ok).map(([l]) => l).at(-1);
  const set = (k: FeatureId, level: string | undefined) => { if (level) features[k] = level; };

  set("bids", top([["view", has("view_own_bids")], ["create", has("create_estimates")], ["edit", has("edit_team_estimates")], ["approve", has("approve_bids")]]));
  if (c) set("bid_visibility", top([["team", c.permissions.includes("view_team_bids")], ["company", c.permissions.includes("view_company_bids")]]));
  set("costs", top([["view", has("view_costs")], ["margin", has("view_margin")]]));
  features.customers = "use";
  // Company analytics only exist for a company (solo people see their own numbers on the Bids pages).
  if (c?.permissions.includes("view_analytics")) features.analytics = "view";
  if (f.pmEnabled) {
    set("schedule", top([["view", has("view_schedules")], ["create", has("create_schedules")], ["edit", has("edit_assigned_schedules")], ["manage", has("edit_all_schedules")]]));
    if (has("review_approved_jobs")) features.job_review = "approve";
    set("change_orders", top([["create", has("create_change_orders")], ["approve", has("send_change_orders")]]));
    if (!c || c.isOwner || c.permissions.includes("manage_teams")) features.team_directory = "use";
    set("project_costs", top([["view", has("view_subcontractor_costs")], ["edit", has("edit_project_costs")]]));
  }
  const fin = f.financialsEnabled ? f.fin : null;
  if (fin) {
    const fp = (p: string) => fin.permissions.includes(p);
    set("fin_visibility", top([["project", fp("view_project_financials") || fp("view_company_financials")], ["company", fp("view_company_financials")]]));
    if (features.fin_visibility) {
      if (fp("create_invoices")) features.invoices = "create";
      if (fp("record_payments")) features.payments = "create";
      set("expenses", top([["create", fp("record_expenses")], ["approve", fp("approve_expenses")]]));
      set("bills", top([["create", fp("record_bills")], ["approve", fp("approve_vendor_bills")]]));
      if (fp("reconcile")) features.bank = "reconcile";
      set("ledger", top([["post", fp("post_journal_entries")], ["manage", fp("manage_accounts")], ["close", fp("close_periods")]]));
      if (fp("export_financials")) features.exports = "export";
    }
  }
  return {
    features,
    company: c ? { id: c.id, role: c.role, isOwner: c.isOwner } : null,
    fin: fin && features.fin_visibility ? { role: fin.role, canWrite: fin.active && !fin.readOnly, sandbox: fin.sandbox, accountantMode: f.accountantModeAllowed } : null,
  };
}
