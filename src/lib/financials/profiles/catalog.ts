/**
 * What a financial dashboard can show. Profiles (presets) only choose and order these: they never grant
 * access (cards carry the permission they need, checked against the caller's real permissions) and never
 * touch recorded history.
 */
import type { FinPermission } from "../permissions";

/** Alerts no layout, lock or preference can hide. Mirror of public.fin_essential_alert_keys(). */
export const ESSENTIAL_ALERT_KEYS = [
  "overdue_invoices", "unapplied_payments", "unverified_payments", "bills_due", "needs_review", "commitment_overruns", "uncoded_costs", "read_only_books",
] as const;
export type EssentialAlertKey = (typeof ESSENTIAL_ALERT_KEYS)[number];

export const CARD_KEYS = [
  ...ESSENTIAL_ALERT_KEYS,
  "ar_aging", "invoices_to_send", "milestones_ready", "deposits_outstanding", "payments_received", "change_orders_billing",
  "job_profitability", "budget_vs_actual", "open_commitments", "bills_to_approve", "expenses_to_approve",
  "material_costs", "labor_costs", "subcontractor_costs", "equipment_costs", "permit_costs", "inventory_usage",
  "tm_unbilled", "service_calls_unbilled", "retainage_placeholder", "progress_billing_placeholder", "crew_utilization_placeholder",
  "my_jobs", "my_expenses", "my_jobs_billing", "export_center", "audit_trail",
] as const;
export type CardKey = (typeof CARD_KEYS)[number];

export interface CardDef { key: CardKey; title: string; needs: readonly FinPermission[]; essential?: boolean; accountantOnly?: boolean }

const VIEW_CO: readonly FinPermission[] = ["view_company_financials"];
const VIEW_PRJ: readonly FinPermission[] = ["view_project_financials"];

export const CARDS: Record<CardKey, CardDef> = {
  overdue_invoices: { key: "overdue_invoices", title: "Overdue invoices", needs: VIEW_PRJ, essential: true },
  unapplied_payments: { key: "unapplied_payments", title: "Unapplied payments", needs: VIEW_CO, essential: true },
  unverified_payments: { key: "unverified_payments", title: "Payments not yet verified", needs: VIEW_CO, essential: true },
  bills_due: { key: "bills_due", title: "Bills due", needs: VIEW_CO, essential: true },
  needs_review: { key: "needs_review", title: "Needs review", needs: VIEW_PRJ, essential: true },
  commitment_overruns: { key: "commitment_overruns", title: "Commitment overruns", needs: VIEW_PRJ, essential: true },
  uncoded_costs: { key: "uncoded_costs", title: "Uncoded costs", needs: VIEW_PRJ, essential: true },
  read_only_books: { key: "read_only_books", title: "Recording status", needs: VIEW_PRJ, essential: true },
  ar_aging: { key: "ar_aging", title: "Receivables aging", needs: VIEW_CO },
  invoices_to_send: { key: "invoices_to_send", title: "Draft invoices", needs: ["create_invoices"] },
  milestones_ready: { key: "milestones_ready", title: "Milestones ready to invoice", needs: VIEW_PRJ },
  deposits_outstanding: { key: "deposits_outstanding", title: "Deposits outstanding", needs: VIEW_PRJ },
  payments_received: { key: "payments_received", title: "Payments received", needs: VIEW_CO },
  change_orders_billing: { key: "change_orders_billing", title: "Change orders to bill", needs: VIEW_PRJ },
  job_profitability: { key: "job_profitability", title: "Job profitability", needs: VIEW_PRJ },
  budget_vs_actual: { key: "budget_vs_actual", title: "Budget vs actual", needs: VIEW_PRJ },
  open_commitments: { key: "open_commitments", title: "Open commitments", needs: VIEW_PRJ },
  bills_to_approve: { key: "bills_to_approve", title: "Bills to approve", needs: ["approve_vendor_bills"] },
  expenses_to_approve: { key: "expenses_to_approve", title: "Expenses to approve", needs: ["approve_expenses"] },
  material_costs: { key: "material_costs", title: "Material costs", needs: VIEW_PRJ },
  labor_costs: { key: "labor_costs", title: "Labor costs", needs: VIEW_PRJ },
  subcontractor_costs: { key: "subcontractor_costs", title: "Subcontractor costs", needs: VIEW_PRJ },
  equipment_costs: { key: "equipment_costs", title: "Equipment costs", needs: VIEW_PRJ },
  permit_costs: { key: "permit_costs", title: "Permits & fees", needs: VIEW_PRJ },
  inventory_usage: { key: "inventory_usage", title: "Inventory usage", needs: VIEW_PRJ },
  tm_unbilled: { key: "tm_unbilled", title: "Unbilled time & materials", needs: VIEW_PRJ },
  service_calls_unbilled: { key: "service_calls_unbilled", title: "Service calls to bill", needs: VIEW_PRJ },
  retainage_placeholder: { key: "retainage_placeholder", title: "Retainage (coming soon)", needs: VIEW_CO },
  progress_billing_placeholder: { key: "progress_billing_placeholder", title: "Progress billing (coming soon)", needs: VIEW_PRJ },
  crew_utilization_placeholder: { key: "crew_utilization_placeholder", title: "Crew utilization (coming soon)", needs: VIEW_CO },
  my_jobs: { key: "my_jobs", title: "My jobs", needs: VIEW_PRJ },
  my_expenses: { key: "my_expenses", title: "My expenses", needs: ["record_expenses"] },
  my_jobs_billing: { key: "my_jobs_billing", title: "Billing on my jobs", needs: VIEW_PRJ },
  export_center: { key: "export_center", title: "Exports", needs: ["export_financials"], accountantOnly: true },
  audit_trail: { key: "audit_trail", title: "Audit trail", needs: VIEW_CO, accountantOnly: true },
};

export const QUICK_ACTIONS = [
  "create_invoice", "invoice_milestone", "record_payment", "record_expense", "snap_receipt", "record_bill", "create_commitment",
  "bill_change_order", "log_time_materials", "bill_service_call", "issue_credit", "export",
] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];
export const QUICK_ACTION_NEEDS: Record<QuickAction, FinPermission> = {
  create_invoice: "create_invoices", invoice_milestone: "create_invoices", record_payment: "record_payments", record_expense: "record_expenses",
  snap_receipt: "record_expenses", record_bill: "record_bills", create_commitment: "record_bills", bill_change_order: "create_invoices",
  log_time_materials: "create_invoices", bill_service_call: "create_invoices", issue_credit: "create_invoices", export: "export_financials",
};

export const REPORTS = [
  "ar_aging", "job_profitability", "budget_vs_actual", "cost_by_code", "commitments", "payments_received", "change_order_log",
  "wip_placeholder", "sales_tax_placeholder", "vendor_spend", "material_spend", "tm_billing",
] as const;
export type ReportKey = (typeof REPORTS)[number];

export const KPI_KEYS = ["contract_value", "invoiced", "collected", "ar_outstanding", "overdue_amount", "estimated_margin", "projected_margin", "committed_cost", "actual_cost"] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const ONBOARDING_STEPS = [
  "confirm_trades", "choose_payment_structure", "review_cost_codes", "add_vendors", "connect_first_job", "set_invoice_defaults",
  "set_up_commitments", "set_up_retainage_placeholder", "set_up_inventory", "set_up_equipment", "invite_bookkeeper", "invite_accountant",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
