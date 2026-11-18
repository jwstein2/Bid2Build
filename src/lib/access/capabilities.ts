/**
 * V6.7 Enterprise Workspace & Granular Feature Access: the capability registry.
 *
 * This is NOT a second permission system. Every feature level below is a named bundle of the existing
 * company permissions (src/lib/enterprise/permissions.ts, enforced by RLS and the database functions) or
 * Financial Command Center permissions (src/lib/financials/permissions.ts, enforced by fin_has_permission).
 * Saving a member's access writes those same permissions_granted / permissions_revoked arrays, so the
 * database keeps being the authority for records and API calls.
 *
 * A few features have no permission today (Customers, the pricing library, proposal templates, the team
 * directory). For those, "No access" is stored in the member's access profile and enforced by the app (page,
 * navigation, search and API guards in src/lib/access/server.ts); records the person created stay theirs.
 *
 * Each permission key belongs to exactly one feature (tests/access/capabilities.test.ts checks this), so
 * turning a feature off can never take a permission away from a different feature.
 */
import { PERMISSION_KEYS, type Permission } from "@/lib/enterprise/permissions";

export const WORKSPACES = ["win", "run", "grow", "financials"] as const;
export type WorkspaceId = (typeof WORKSPACES)[number];
/** Company administration is not a workspace: it holds the owner-delegated admin rights. */
export type SectionId = WorkspaceId | "admin";

export const WORKSPACE_INFO: Record<SectionId, { label: string; blurb: string }> = {
  win: { label: "Win the Job", blurb: "Bids, estimates, customers, pricing and proposals." },
  run: { label: "Run the Job", blurb: "Projects, schedules, crews, change orders and customer updates." },
  grow: { label: "Grow the Business", blurb: "Sales analytics and customer follow-ups." },
  financials: { label: "Financials", blurb: "Invoices, payments, expenses, bills, banking and reports." },
  admin: { label: "Company administration", blurb: "Users, billing and company-wide switches. Most of these only the primary account holder can hand out." },
};

/**
 * Plan requirements a grant cannot bypass:
 *  - pm: Project Command Center (Enterprise or the PM add-on) and the projects feature switch.
 *  - pm_editor: a covered scheduling editor seat (create/edit schedules). Never bought by toggling access.
 *  - financials: the Financial Command Center add-on and a covered financial seat.
 *  - premium: Premium / Unlimited (Enterprise includes it).
 */
export type License = "pm" | "pm_editor" | "financials" | "premium";

export interface FeatureOption {
  /** Stable key, used by saved access profiles and widget requirements. */
  key: string;
  label: string;
  /** Permissions this step ADDS on top of the steps before it (levels are cumulative). */
  perms: readonly Permission[];
  /** A license needed from this step up (on top of the feature's own license). */
  license?: License;
}

export interface Feature {
  id: string;
  section: SectionId;
  label: string;
  description: string;
  /** App routes this feature opens (first = where its navigation link goes). Used for URL guards and preview. */
  routes?: readonly string[];
  /** What "no access" means for this feature, in plain words. */
  noneLabel?: string;
  options: readonly FeatureOption[];
  license?: License;
  /** No permission backs it: the app enforces it from the access profile. */
  appGated?: boolean;
  /** Only the primary account holder can grant it (mirrors company_owner_only_permissions()). */
  ownerOnly?: boolean;
  /** Resource-level note shown in the editor. */
  scopeNote?: string;
  /** Needs this other feature to be usable (the editor raises / lowers them together, so nothing is left unreachable). */
  requires?: { feature: string; level?: string };
}

const o = (key: string, label: string, perms: readonly Permission[] = [], license?: License): FeatureOption => ({ key, label, perms, license });

export const FEATURES = [
  // ---- Win the Job ------------------------------------------------------------------------------------------
  { id: "bids", section: "win", label: "Bids & estimates", description: "Bids pipeline, estimate builder, trade calculators and proposals.", routes: ["/dashboard", "/bids"],
    options: [o("view", "View own bids", ["view_own_bids"]), o("create", "Create", ["create_estimates"]), o("edit", "Edit team bids", ["edit_team_estimates"]), o("approve", "Approve", ["approve_bids"])],
    scopeNote: "People always see bids they created. Which other bids they see is set by Bid visibility." },
  { id: "bid_visibility", requires: { feature: "bids" }, section: "win", label: "Bid visibility", description: "Whose bids and customers they can see.", routes: ["/company/pipeline"], noneLabel: "Own bids only",
    options: [o("team", "Their teams' bids", ["view_team_bids"]), o("company", "All company bids", ["view_company_bids"])] },
  { id: "costs", requires: { feature: "bids" }, section: "win", label: "Costs & margin", description: "Underlying costs and gross margin on bids.", noneLabel: "Hidden",
    options: [o("view", "View costs", ["view_costs"]), o("margin", "View margin", ["view_margin"])] },
  { id: "internal_reports", requires: { feature: "bids" }, section: "win", label: "Internal cost reports", description: "Internal estimate PDFs and financial documents.",
    options: [o("view", "View", ["view_internal_reports"]), o("download", "Download", ["download_internal_reports"]), o("send", "Send", ["send_internal_reports"])] },
  { id: "customers", section: "win", label: "Customers & leads", description: "Customer list, customer records and new leads.", routes: ["/dashboard/customers"], appGated: true,
    options: [o("use", "Use")], scopeNote: "They see the customers of the bids they can see." },
  { id: "pricing_library", section: "win", label: "Saved items & pricing library", description: "Saved items, assemblies and supplier price imports.", routes: ["/dashboard/items", "/settings/pricing"], appGated: true, license: "premium",
    options: [o("use", "Use")] },
  { id: "company_pricing", requires: { feature: "pricing_library" }, section: "win", label: "Company pricing", description: "Edit the saved pricing everyone in the company uses.", noneLabel: "Use only",
    options: [o("manage", "Manage", ["manage_company_pricing"])] },
  { id: "proposal_templates", section: "win", label: "Proposal templates", description: "Reusable proposal templates.", routes: ["/dashboard/templates"], appGated: true, license: "premium",
    options: [o("use", "Use")] },
  { id: "proposal_style", section: "win", label: "Proposal & bid style", description: "Company proposal look and wording.", routes: ["/company/proposal-style"],
    options: [o("view", "View", ["view_proposal_style"]), o("edit", "Customize own", ["customize_proposal_style"]), o("manage", "Manage company template", ["manage_proposal_templates"])] },

  // ---- Run the Job ------------------------------------------------------------------------------------------
  { id: "schedule", section: "run", label: "Projects & schedules", description: "Projects overview, calendar, timeline and schedules.", routes: ["/projects"], license: "pm",
    options: [o("view", "View", ["view_schedules", "download_schedule_pdf"]), o("create", "Create", ["create_schedules"], "pm_editor"), o("edit", "Edit assigned", ["edit_assigned_schedules", "manage_dependencies"], "pm_editor"),
      o("approve", "Edit live & publish", ["edit_live_schedules"], "pm_editor"), o("manage", "Edit all company schedules", ["edit_all_schedules"], "pm_editor")],
    scopeNote: "Creating or changing a schedule also needs a scheduling editor seat. Granting it here never buys one." },
  { id: "progress", requires: { feature: "schedule" }, section: "run", label: "Task progress", description: "Update progress and actual dates; confirm completed tasks.", license: "pm",
    options: [o("edit", "Update progress", ["update_progress"]), o("approve", "Confirm completion", ["confirm_task_completion"])] },
  { id: "job_review", requires: { feature: "schedule" }, section: "run", label: "Newly approved job review", description: "Review approved jobs before they are scheduled.", license: "pm",
    options: [o("approve", "Review jobs", ["review_approved_jobs"])] },
  { id: "change_orders", requires: { feature: "schedule" }, section: "run", label: "Change orders", description: "Create change orders, send them and record approval.", license: "pm",
    options: [o("create", "Create", ["create_change_orders"]), o("approve", "Send & record approval", ["send_change_orders"])] },
  { id: "subcontractors", requires: { feature: "schedule" }, section: "run", label: "Subcontractor scopes", description: "Share scopes of work with subcontractors.", license: "pm",
    options: [o("share", "Share scopes", ["share_subcontractor_scopes"])] },
  { id: "project_costs", requires: { feature: "schedule" }, section: "run", label: "Project costs", description: "Subcontractor quotes and internal project costs.", license: "pm",
    options: [o("view", "View", ["view_subcontractor_costs"]), o("edit", "Edit", ["edit_project_costs"])] },
  { id: "photos", requires: { feature: "schedule" }, section: "run", label: "Project photos", description: "Upload and label project photos.", license: "pm",
    options: [o("create", "Upload", ["upload_photos"])] },
  { id: "customer_updates", requires: { feature: "schedule" }, section: "run", label: "Customer progress updates", description: "Schedule updates and project update emails to customers.", license: "pm",
    options: [o("create", "Publish schedule updates", ["publish_customer_updates"]), o("edit", "Set update frequency", ["configure_project_updates"]), o("approve", "Approve & send emails", ["approve_customer_updates"])] },
  { id: "team_directory", section: "run", label: "Team, subs & suppliers", description: "Staff, subcontractors, suppliers, time clock and sub records.", routes: ["/projects/team"], appGated: true, license: "pm",
    options: [o("use", "Use")] },

  // ---- Grow the Business ------------------------------------------------------------------------------------
  { id: "analytics", section: "grow", label: "Sales analytics", description: "Company overview, conversion and revenue trends.", routes: ["/company"],
    options: [o("view", "View", ["view_analytics"])] },
  { id: "communications", requires: { feature: "customers" }, section: "grow", label: "Customer follow-ups", description: "Communication history, replies, follow-up templates and outreach.", routes: ["/dashboard/customers/communications"], license: "pm",
    options: [o("view", "View history", ["view_communications"]), o("replies", "Read replies", ["view_customer_replies"]), o("edit", "Edit templates", ["edit_nurture_templates"]),
      o("approve", "Approve & send", ["approve_marketing_outreach"]), o("manage", "Manage opt-outs", ["manage_opt_outs"])] },

  // ---- Financials -------------------------------------------------------------------------------------------
  { id: "fin_visibility", section: "financials", label: "Financial visibility", description: "Financial overview, receivables and reports.", routes: ["/financials"], license: "financials",
    options: [o("project", "Their projects", ["view_project_financials"]), o("company", "Whole company", ["view_company_financials"])],
    scopeNote: "Project level shows only the jobs they can see. Bank balances, payroll and the P&L need Whole company." },
  { id: "invoices", requires: { feature: "fin_visibility" }, section: "financials", label: "Invoices", description: "Create, issue and send invoices.", license: "financials",
    options: [o("create", "Create & send", ["create_invoices"])] },
  { id: "payments", requires: { feature: "fin_visibility" }, section: "financials", label: "Customer payments", description: "Record customer payments.", license: "financials",
    options: [o("create", "Record", ["record_payments"])] },
  { id: "expenses", requires: { feature: "fin_visibility" }, section: "financials", label: "Expenses", description: "Enter and approve expenses.", license: "financials",
    options: [o("create", "Enter", ["record_expenses"]), o("approve", "Approve", ["approve_expenses"])] },
  { id: "bills", requires: { feature: "fin_visibility" }, section: "financials", label: "Accounts payable", description: "Vendor bills and commitments.", license: "financials",
    options: [o("create", "Enter bills", ["record_bills"]), o("approve", "Approve bills", ["approve_vendor_bills"])] },
  { id: "bank", requires: { feature: "fin_visibility", level: "company" }, section: "financials", label: "Bank reconciliation", description: "Match and reconcile bank transactions.", routes: ["/financials/accounting/bank"], license: "financials",
    options: [o("reconcile", "Reconcile", ["reconcile"])] },
  { id: "ledger", requires: { feature: "fin_visibility", level: "company" }, section: "financials", label: "General ledger", description: "Journal entries, chart of accounts and period close.", routes: ["/financials/accounting"], license: "financials",
    options: [o("post", "Post journal entries", ["post_journal_entries"]), o("manage", "Manage chart of accounts", ["manage_accounts"]), o("close", "Close periods", ["close_periods"])] },
  { id: "exports", requires: { feature: "fin_visibility" }, section: "financials", label: "Financial exports", description: "Export statements and financial data.", license: "financials",
    options: [o("export", "Export", ["export_financials"])] },
  { id: "sub_compliance", requires: { feature: "fin_visibility" }, section: "financials", label: "Subcontractor compliance", description: "W-9s, insurance and 1099 records.", license: "financials",
    options: [o("manage", "Manage", ["manage_sub_compliance"])] },
  { id: "fin_settings", requires: { feature: "fin_visibility", level: "company" }, section: "financials", label: "Financial settings", description: "Business setup and accounting preferences.", routes: ["/company/business-config"], license: "financials",
    options: [o("manage", "Manage", ["manage_financial_config"])] },

  // ---- Company administration -------------------------------------------------------------------------------
  { id: "manage_users", section: "admin", label: "Manage users & access", description: "Invite people and manage their access.", routes: ["/company/users"], ownerOnly: true, options: [o("manage", "Allowed", ["manage_users"])] },
  { id: "manage_teams", section: "admin", label: "Manage teams", description: "Create teams and assign members.", options: [o("manage", "Allowed", ["manage_teams"])] },
  { id: "manage_billing", section: "admin", label: "Billing & licenses", description: "Enterprise billing and seat purchases.", routes: ["/company/billing"], ownerOnly: true, options: [o("manage", "Allowed", ["manage_billing"])] },
  { id: "manage_pm_seats", section: "admin", label: "Scheduling editor seats", description: "Assign scheduling editor seats.", ownerOnly: true, options: [o("manage", "Allowed", ["manage_pm_seats"])] },
  { id: "manage_pm_addons", section: "admin", label: "Project Command Center add-ons", description: "Manage paid add-ons.", ownerOnly: true, options: [o("manage", "Allowed", ["manage_pm_addons"])] },
  { id: "manage_financial_seats", section: "admin", label: "Financial seats", description: "Assign financial seats.", ownerOnly: true, options: [o("manage", "Allowed", ["manage_financial_seats"])] },
  { id: "payment_connections", section: "admin", label: "Payment connections", description: "Connect payment providers.", ownerOnly: true, options: [o("manage", "Allowed", ["manage_payment_connections"])] },
  { id: "proposal_policy", section: "admin", label: "Company proposal policy", description: "Change company-wide proposal rules.", ownerOnly: true, options: [o("manage", "Allowed", ["change_proposal_policy"])] },
  { id: "nurture_switch", section: "admin", label: "Turn on customer follow-ups", description: "Company-wide follow-up email switch.", ownerOnly: true, options: [o("manage", "Allowed", ["enable_customer_nurture"])] },
  { id: "auto_updates_switch", section: "admin", label: "Automatic project update sending", description: "Company-wide automatic update switch.", ownerOnly: true, options: [o("manage", "Allowed", ["enable_auto_project_updates"])] },
] as const satisfies readonly Feature[];

export type FeatureId = (typeof FEATURES)[number]["id"];
export const FEATURE_BY_ID: Record<FeatureId, Feature> = Object.fromEntries(FEATURES.map((f) => [f.id, f as Feature])) as unknown as Record<FeatureId, Feature>;
export const isFeatureId = (v: unknown): v is FeatureId => typeof v === "string" && v in FEATURE_BY_ID;
export const featuresIn = (s: SectionId): Feature[] => (FEATURES as readonly Feature[]).filter((f) => f.section === s);

/** "none" or one of the feature's option keys. */
export type LevelKey = string;
export const NONE = "none";

/** What a dashboard widget, nav link or action needs. level omitted = any access to the feature. */
export interface CapabilityRequirement { feature: FeatureId; level?: LevelKey }

/** Cumulative permissions for a level of a feature. */
export function permsForLevel(f: Feature, level: LevelKey): Permission[] {
  if (level === NONE) return [];
  const i = f.options.findIndex((x) => x.key === level);
  if (i < 0) return [];
  return f.options.slice(0, i + 1).flatMap((x) => x.perms);
}

/** Highest level whose cumulative permissions are all held ("none" when not even the first). App-gated features answer from `on`. */
export function levelFromPerms(f: Feature, perms: ReadonlySet<string>): LevelKey {
  if (f.appGated) return f.options[0].key;
  let level: LevelKey = NONE;
  for (const opt of f.options) {
    if (!opt.perms.every((p) => perms.has(p))) break;
    level = opt.key;
  }
  return level;
}

/** Permissions of this feature held beyond its level's bundle (a custom mix from the older editor). */
export function extraPerms(f: Feature, perms: ReadonlySet<string>): Permission[] {
  const lvl = new Set<string>(permsForLevel(f, levelFromPerms(f, perms)));
  return f.options.flatMap((x) => x.perms).filter((p) => perms.has(p) && !lvl.has(p));
}

export const levelIndex = (f: Feature, level: LevelKey) => (level === NONE ? -1 : f.options.findIndex((x) => x.key === level));
export const levelLabel = (f: Feature, level: LevelKey) => (level === NONE ? f.noneLabel ?? "No access" : f.options.find((x) => x.key === level)?.label ?? level);
/** At least `want` (or any access when want is omitted). */
export const meets = (f: Feature, have: LevelKey, want?: LevelKey) => (want ? levelIndex(f, have) >= levelIndex(f, want) && levelIndex(f, want) >= 0 : have !== NONE);

/** The feature a permission belongs to. */
export const FEATURE_OF_PERMISSION: Record<Permission, FeatureId> = Object.fromEntries(
  FEATURES.flatMap((f) => f.options.flatMap((x) => x.perms.map((p) => [p, f.id]))),
) as Record<Permission, FeatureId>;

/** Every company permission is covered (checked by a test; listed here so a missing one fails type-free too). */
export const UNMAPPED_PERMISSIONS = PERMISSION_KEYS.filter((k) => !(k in FEATURE_OF_PERMISSION));

/** Feature that owns a route (longest matching prefix), for direct-URL guards. */
export function featureForPath(path: string): Feature | null {
  let best: { f: Feature; len: number } | null = null;
  for (const f of FEATURES as readonly Feature[]) {
    for (const r of f.routes ?? []) {
      const hit = r === "/dashboard" || r === "/company" ? path === r : path === r || path.startsWith(`${r}/`);
      if (hit && (!best || r.length > best.len)) best = { f, len: r.length };
    }
  }
  return best?.f ?? null;
}
