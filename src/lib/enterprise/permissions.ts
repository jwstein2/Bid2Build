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
  ],
  estimator: ["view_own_bids", "create_estimates", "view_costs", "view_schedules", "create_schedules", "edit_assigned_schedules", "manage_dependencies", "update_progress", "download_schedule_pdf"],
  viewer: ["view_own_bids", "view_team_bids", "view_analytics", "view_schedules", "download_schedule_pdf"],
};

/** Only the company owner may grant these. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ["manage_billing", "manage_users", "manage_pm_seats", "manage_pm_addons"];

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
};

/** How the Users & Permissions screen groups permissions. */
export const PERMISSION_GROUPS: { title: string; keys: readonly Permission[]; note?: string }[] = [
  { title: "Bids", keys: ["view_own_bids", "view_team_bids", "view_company_bids", "create_estimates", "edit_team_estimates", "approve_bids", "manage_company_pricing"] },
  { title: "Costs and internal reports", keys: ["view_costs", "view_margin", "view_internal_reports", "download_internal_reports", "send_internal_reports", "view_analytics"] },
  {
    title: "Project Command Center",
    keys: ["view_schedules", "create_schedules", "edit_assigned_schedules", "edit_all_schedules", "manage_dependencies", "update_progress", "publish_customer_updates", "download_schedule_pdf"],
    note: "Changing a schedule also needs a scheduling editor seat.",
  },
  { title: "Administration", keys: ["manage_teams", "manage_users", "manage_billing", "manage_pm_seats", "manage_pm_addons"] },
];

/** Same rule as public.member_permissions(): role defaults + grants - revocations; the owner holds everything. */
export function effectivePermissions(role: CompanyRole, granted: readonly string[] = [], revoked: readonly string[] = []): Permission[] {
  if (role === "owner") return [...PERMISSION_KEYS];
  const base = new Set<string>(ROLE_PERMISSIONS[role]);
  return PERMISSION_KEYS.filter((k) => (base.has(k) || granted.includes(k)) && !revoked.includes(k));
}
