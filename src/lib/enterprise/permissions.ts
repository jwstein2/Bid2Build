/**
 * Enterprise roles and granular permissions, mirrored from the database (company_permission_keys /
 * company_role_permissions in 20261114005000_enterprise_workspace.sql). The database is the authority:
 * RLS and the member-admin functions enforce these. This copy only drives what the UI shows, and
 * tests/db/enterprise-workspace.test.ts fails if the two drift apart.
 */
export const PERMISSION_KEYS = [
  "view_own_bids",
  "view_team_bids",
  "view_company_bids",
  "create_estimates",
  "edit_team_estimates",
  "view_costs",
  "view_margin",
  "approve_bids",
  "manage_company_pricing",
  "view_analytics",
  "manage_teams",
  "manage_users",
  "manage_billing",
  // V4 Phase 9: project management and documents (20261116006000_pm_permissions.sql).
  "view_schedules",
  "create_schedules",
  "edit_assigned_schedules",
  "edit_all_schedules",
  "manage_dependencies",
  "update_progress",
  "publish_customer_updates",
  "download_schedule_pdf",
  "view_internal_reports",
  "download_internal_reports",
  "send_internal_reports",
  "manage_pm_seats",
  "manage_pm_addons",
  // V4.3 project operations (20261119001000_project_operations.sql).
  "review_approved_jobs",
  "edit_live_schedules",
  "confirm_task_completion",
  "create_change_orders",
  "send_change_orders",
  "share_subcontractor_scopes",
  "upload_photos",
  "view_subcontractor_costs",
  "edit_project_costs",
  // V4.4 proposal style.
  "view_proposal_style",
  "customize_proposal_style",
  "manage_proposal_templates",
  "change_proposal_policy",
  // V4.6 customer communications (20261121001000_customer_communications.sql).
  "view_communications",
  "edit_nurture_templates",
  "enable_customer_nurture",
  "approve_marketing_outreach",
  "configure_project_updates",
  "approve_customer_updates",
  "enable_auto_project_updates",
  "view_customer_replies",
  "manage_opt_outs",
  // Financial Command Center (supabase/migrations/20261123001000_fin_foundation.sql). No company role gets
  // these by default: financial access comes from a financial seat's role preset (src/lib/financials/permissions.ts).
  "view_company_financials",
  "view_project_financials",
  "create_invoices",
  "record_payments",
  "record_expenses",
  "approve_expenses",
  "record_bills",
  "approve_vendor_bills",
  "manage_accounts",
  "post_journal_entries",
  "reconcile",
  "close_periods",
  "export_financials",
  "manage_financial_config",
  "manage_sub_compliance",
  "manage_payment_connections",
  "manage_financial_seats",
] as const;
export type Permission = (typeof PERMISSION_KEYS)[number];

export const COMPANY_ROLES = ["owner", "manager", "estimator", "viewer"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const ROLE_PERMISSIONS: Record<CompanyRole, readonly Permission[]> = {
  owner: PERMISSION_KEYS,
  manager: [
    "view_own_bids", "view_team_bids", "create_estimates", "edit_team_estimates", "view_costs", "view_margin", "approve_bids", "view_analytics",
    "view_schedules", "create_schedules", "edit_assigned_schedules", "edit_all_schedules", "manage_dependencies",
    "update_progress", "publish_customer_updates", "download_schedule_pdf",
    "view_internal_reports", "download_internal_reports", "send_internal_reports",
    "review_approved_jobs", "edit_live_schedules", "confirm_task_completion",
    "create_change_orders", "send_change_orders", "share_subcontractor_scopes", "upload_photos",
    "view_subcontractor_costs", "edit_project_costs",
    "view_proposal_style", "customize_proposal_style",
    "view_communications", "edit_nurture_templates", "approve_marketing_outreach",
    "configure_project_updates", "approve_customer_updates", "view_customer_replies", "manage_opt_outs",
  ],
  estimator: [
    "view_own_bids", "create_estimates", "view_costs", "view_schedules", "create_schedules", "edit_assigned_schedules", "manage_dependencies", "update_progress", "download_schedule_pdf",
    "review_approved_jobs", "edit_live_schedules", "confirm_task_completion", "create_change_orders", "upload_photos",
    "view_proposal_style", "customize_proposal_style",
    "view_communications", "view_customer_replies",
  ],
  viewer: ["view_own_bids", "view_team_bids", "view_analytics", "view_schedules", "download_schedule_pdf", "view_proposal_style", "view_communications"],
};

/** Only the company owner may grant these. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ["manage_billing", "manage_users", "manage_pm_seats", "manage_pm_addons", "change_proposal_policy", "enable_customer_nurture", "enable_auto_project_updates", "manage_payment_connections", "manage_financial_seats"];

export const ROLE_LABELS: Record<CompanyRole, string> = {
  owner: "Company Owner",
  manager: "Manager",
  estimator: "Estimator / Sales Rep",
  viewer: "Viewer / Reviewer",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_own_bids: "View own bids",
  view_team_bids: "View team bids",
  view_company_bids: "View all company bids",
  create_estimates: "Create estimates",
  edit_team_estimates: "Edit team estimates",
  view_costs: "View underlying costs",
  view_margin: "View gross margin",
  approve_bids: "Approve, reject or request revisions",
  manage_company_pricing: "Manage saved company pricing",
  view_analytics: "View analytics",
  manage_teams: "Manage team assignments",
  manage_users: "Manage users",
  manage_billing: "Manage billing",
  view_schedules: "View project schedules",
  create_schedules: "Create schedules from estimates",
  edit_assigned_schedules: "Edit assigned schedules (own bids)",
  edit_all_schedules: "Edit all company schedules",
  manage_dependencies: "Manage task dependencies",
  update_progress: "Update progress and actual dates",
  publish_customer_updates: "Publish customer schedule updates",
  download_schedule_pdf: "Download customer schedule PDFs",
  view_internal_reports: "View internal cost reports",
  download_internal_reports: "Download internal estimate PDFs",
  send_internal_reports: "Send internal financial documents",
  manage_pm_seats: "Manage scheduling editor seats",
  manage_pm_addons: "Manage paid Project Command Center add-ons",
  review_approved_jobs: "Review newly approved jobs",
  edit_live_schedules: "Edit live (published) schedules",
  confirm_task_completion: "Confirm task completion",
  create_change_orders: "Create change orders",
  send_change_orders: "Send and record approval of change orders",
  share_subcontractor_scopes: "Share scopes with subcontractors",
  upload_photos: "Upload and label photos",
  view_subcontractor_costs: "View subcontractor quotes and costs",
  edit_project_costs: "Edit internal project costs",
  view_proposal_style: "View company proposal style",
  customize_proposal_style: "Customize individual proposal style (when allowed)",
  manage_proposal_templates: "Manage company proposal template",
  change_proposal_policy: "Change company-wide proposal policy",
  view_communications: "View customer communication history",
  edit_nurture_templates: "Edit follow-up email templates and offers",
  enable_customer_nurture: "Turn on customer follow-ups (company-wide)",
  approve_marketing_outreach: "Approve and send follow-up emails",
  configure_project_updates: "Set project update frequency",
  approve_customer_updates: "Approve and send project update emails",
  enable_auto_project_updates: "Turn on automatic project update sending",
  view_customer_replies: "Read customer replies",
  manage_opt_outs: "Manage opt-outs and paused contacts",
  view_company_financials: "View company financials",
  view_project_financials: "View financials of their projects",
  create_invoices: "Create and send invoices",
  record_payments: "Record customer payments",
  record_expenses: "Record expenses",
  approve_expenses: "Approve expenses",
  record_bills: "Record vendor bills and commitments",
  approve_vendor_bills: "Approve vendor bills",
  manage_accounts: "Manage chart of accounts",
  post_journal_entries: "Post journal entries",
  reconcile: "Reconcile bank accounts",
  close_periods: "Close accounting periods",
  export_financials: "Export financial data",
  manage_financial_config: "Manage financial settings",
  manage_sub_compliance: "Manage subcontractor compliance",
  manage_payment_connections: "Manage payment connections",
  manage_financial_seats: "Manage financial seats",
};

/** How the Users & Permissions screen groups permissions. */
export const PERMISSION_GROUPS: { title: string; keys: readonly Permission[]; note?: string }[] = [
  { title: "Bids", keys: ["view_own_bids", "view_team_bids", "view_company_bids", "create_estimates", "edit_team_estimates", "approve_bids", "manage_company_pricing"] },
  { title: "Costs and internal reports", keys: ["view_costs", "view_margin", "view_internal_reports", "download_internal_reports", "send_internal_reports", "view_analytics"] },
  {
    title: "Project Command Center",
    keys: ["view_schedules", "create_schedules", "edit_assigned_schedules", "edit_all_schedules", "edit_live_schedules", "manage_dependencies", "update_progress", "confirm_task_completion", "publish_customer_updates", "download_schedule_pdf"],
    note: "Changing a schedule also needs a scheduling editor seat.",
  },
  {
    title: "Project operations",
    keys: ["review_approved_jobs", "create_change_orders", "send_change_orders", "share_subcontractor_scopes", "upload_photos", "view_subcontractor_costs", "edit_project_costs"],
  },
  { title: "Proposal style", keys: ["view_proposal_style", "customize_proposal_style", "manage_proposal_templates", "change_proposal_policy"], note: "Only the company owner can grant permission to change the company-wide proposal policy." },
  {
    title: "Customer communications",
    keys: ["view_communications", "view_customer_replies", "edit_nurture_templates", "approve_marketing_outreach", "enable_customer_nurture", "configure_project_updates", "approve_customer_updates", "enable_auto_project_updates", "manage_opt_outs"],
    note: "Needs Project Command Center. Only the company owner can grant turning on company-wide follow-ups or automatic sending.",
  },
  {
    title: "Financials",
    keys: ["view_company_financials", "view_project_financials", "create_invoices", "record_payments", "record_expenses", "approve_expenses", "record_bills", "approve_vendor_bills", "manage_accounts", "post_journal_entries", "reconcile", "close_periods", "export_financials", "manage_financial_config", "manage_sub_compliance", "manage_payment_connections", "manage_financial_seats"],
    note: "Needs the Financial Command Center add-on and a financial seat. Only the company owner can grant payment connections and financial seats.",
  },
  { title: "Administration", keys: ["manage_teams", "manage_users", "manage_billing", "manage_pm_seats", "manage_pm_addons"] },
];

/** Same rule as public.member_permissions(): role defaults + grants - revocations; the owner holds everything. */
export function effectivePermissions(role: CompanyRole, granted: readonly string[] = [], revoked: readonly string[] = []): Permission[] {
  if (role === "owner") return [...PERMISSION_KEYS];
  const base = new Set<string>(ROLE_PERMISSIONS[role]);
  return PERMISSION_KEYS.filter((k) => (base.has(k) || granted.includes(k)) && !revoked.includes(k));
}
