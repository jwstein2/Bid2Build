/**
 * Financial seat role presets: mirror of public.fin_permission_keys() / fin_role_permissions() in
 * supabase/migrations/20261123001000_fin_foundation.sql (a DB test keeps them in sync). The database is
 * the authority; this drives the UI only.
 */
export const FIN_PERMISSION_KEYS = [
  "view_company_financials", "view_project_financials", "create_invoices", "record_payments", "record_expenses", "approve_expenses",
  "record_bills", "approve_vendor_bills", "manage_accounts", "post_journal_entries", "reconcile", "close_periods", "export_financials",
  "manage_financial_config", "manage_sub_compliance", "manage_payment_connections", "manage_financial_seats",
] as const;
export type FinPermission = (typeof FIN_PERMISSION_KEYS)[number];

export const FIN_ROLES = ["owner", "financial_admin", "bookkeeper", "accountant", "project_manager", "sales_rep", "view_only"] as const;
export type FinRole = (typeof FIN_ROLES)[number];

/** Owner-only to delegate (also in company_owner_only_permissions()). */
export const FIN_OWNER_ONLY: readonly FinPermission[] = ["manage_payment_connections", "manage_financial_seats"];

export const FIN_ROLE_PERMISSIONS: Record<FinRole | "accountant_readonly", readonly FinPermission[]> = {
  owner: FIN_PERMISSION_KEYS,
  financial_admin: FIN_PERMISSION_KEYS.filter((k) => !FIN_OWNER_ONLY.includes(k)),
  bookkeeper: ["view_company_financials", "view_project_financials", "create_invoices", "record_payments", "record_expenses", "record_bills", "reconcile", "export_financials", "manage_sub_compliance"],
  accountant: ["view_company_financials", "view_project_financials", "manage_accounts", "post_journal_entries", "reconcile", "close_periods", "export_financials"],
  accountant_readonly: ["view_company_financials", "view_project_financials", "export_financials"],
  project_manager: ["view_project_financials", "record_expenses", "manage_sub_compliance"],
  sales_rep: ["view_project_financials"],
  view_only: ["view_company_financials", "view_project_financials"],
};

export const FIN_ROLE_LABELS: Record<FinRole, string> = {
  owner: "Owner",
  financial_admin: "Financial admin",
  bookkeeper: "Bookkeeper",
  accountant: "Accountant",
  project_manager: "Project manager",
  sales_rep: "Sales rep",
  view_only: "View only",
};

/** Seats: a solo book has 1 (the owner); a company book has 3 included + extras. Each book also has one free read-only accountant seat. */
export const SOLO_SEATS = 1;
export const COMPANY_INCLUDED_SEATS = 3;

/** Accountant Mode is offered only to people authorized for accounting work (same rule as public.fin_set_mode). */
export const ACCOUNTANT_MODE_PERMISSIONS: readonly FinPermission[] = ["reconcile", "manage_accounts", "post_journal_entries", "close_periods", "export_financials"];
export const canUseAccountantMode = (perms: readonly string[]) => ACCOUNTANT_MODE_PERMISSIONS.some((p) => perms.includes(p));
