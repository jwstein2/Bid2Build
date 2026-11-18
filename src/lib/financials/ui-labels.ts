/** Plain-language labels for the Financials UI (client-safe). */
import type { KpiKey, QuickAction, ReportKey } from "./profiles/catalog";
import type { AlertKind, AlertSeverity, MilestoneState, MilestoneTriggerKind } from "./types";

export const KPI_LABELS: Record<KpiKey, string> = {
  contract_value: "Contract value", invoiced: "Invoiced", collected: "Collected", ar_outstanding: "Owed to you", overdue_amount: "Past due",
  estimated_margin: "Estimated profit", projected_margin: "Forecast profit", committed_cost: "Committed cost", actual_cost: "Actual cost",
};

export const QUICK_ACTION_LABELS: Record<QuickAction, string> = {
  create_invoice: "Create invoice", invoice_milestone: "Invoice a milestone", record_payment: "Record payment", record_expense: "Record expense",
  snap_receipt: "Add a receipt", record_bill: "Enter a vendor bill", create_commitment: "Commit a sub quote", bill_change_order: "Bill a change order",
  log_time_materials: "Log time & materials", bill_service_call: "Bill a service call", issue_credit: "Issue a credit", export: "Export for your accountant",
};
/** One line under each quick action in the Edit library. */
export const QUICK_ACTION_HINTS: Record<QuickAction, string> = {
  create_invoice: "Start an invoice on a job", invoice_milestone: "Bill a payment milestone that's ready", record_payment: "Log a check, cash or card payment",
  record_expense: "Log a cost on a job", snap_receipt: "Photo of a receipt, filed to a job", record_bill: "A bill from a supplier or sub",
  create_commitment: "Lock in an accepted sub quote or PO", bill_change_order: "Invoice an approved change order", log_time_materials: "Hours and materials to bill",
  bill_service_call: "Invoice a one-visit service job", issue_credit: "Credit a customer's balance", export: "Send your books to your accountant",
};
/** Quick actions that open on a job (the rest are not built yet and say so). */
export const QUICK_ACTION_TARGET: Partial<Record<QuickAction, string>> = {
  create_invoice: "invoice", invoice_milestone: "invoice", record_payment: "payment", record_expense: "expense", snap_receipt: "expense",
  record_bill: "bill", create_commitment: "commitment", bill_change_order: "invoice", issue_credit: "credit",
};

export const REPORT_LABELS: Record<ReportKey, string> = {
  profit_loss: "Profit & Loss", ar_aging: "Receivables aging", job_profitability: "Job profitability", budget_vs_actual: "Budget vs actual", cost_by_code: "Cost by cost code",
  commitments: "Commitments", payments_received: "Payments received", change_order_log: "Change order log", wip_placeholder: "Work in progress (coming later)",
  sales_tax_placeholder: "Sales tax (coming later)", vendor_spend: "Vendor spend", material_spend: "Material spend", tm_billing: "Time & materials billing",
};
export const REPORT_HREF: Partial<Record<ReportKey, string>> = {
  profit_loss: "/financials/reports", ar_aging: "/financials/receivables", job_profitability: "/financials/records?view=jobs", budget_vs_actual: "/financials/records?view=jobs",
  cost_by_code: "/financials/records?view=costs", commitments: "/financials/records?view=commitments", payments_received: "/financials/records?view=payments",
  vendor_spend: "/financials/records?view=costs", material_spend: "/financials/records?view=costs&filter=material",
};

export const TRIGGER_LABELS: Record<MilestoneTriggerKind, string> = {
  agreement_signed: "When the agreement is signed", project_start_confirmed: "When the start is confirmed", phase_completed_verified: "When the phase is verified complete",
  final_completion_confirmed: "When completion is confirmed", calendar_date: "On a set date", custom_approved: "When you approve it",
};
export const STATE_LABELS: Record<MilestoneState, string> = {
  not_triggered: "Waiting on trigger", ready_to_invoice: "Ready to invoice", invoiced: "Invoiced", partially_paid: "Partly paid", paid: "Paid",
};
export const SEVERITY_LABELS: Record<AlertSeverity, string> = { info: "Info", warning: "Warning", action_required: "Action required" };
export const ALERT_LABELS: Record<AlertKind, string> = {
  deposit_not_invoiced: "The deposit hasn't been invoiced yet",
  deposit_overdue: "The deposit is past due",
  start_with_prestart_unpaid: "The job started with a pre-start payment unpaid",
  milestone_ready_not_invoiced: "A milestone is ready but not invoiced",
  invoice_milestone_mismatch: "An invoice differs from the signed schedule",
  duplicate_milestone_invoice: "A milestone has more than one invoice",
  billed_over_contract: "Invoices add up to more than the contract",
  completion_with_balance: "The job is complete with a balance still owed",
  change_order_affects_billing: "An approved change order affects billing",
};
export const DISCREPANCY_LABELS: Record<string, string> = {
  amount_differs: "The amount differs from the signed schedule",
  due_date_differs: "The due date differs from the schedule's terms",
  not_triggered: "The milestone's trigger hasn't happened yet",
  duplicate_milestone_invoice: "This milestone already has an invoice",
};
export const BASIS_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"> = {
  Contracted: "brand", Invoiced: "accent", Paid: "ok", Outstanding: "warn", Estimated: "neutral", Committed: "warn", Actual: "ok", Forecast: "accent", Count: "neutral",
};

/** Friendly text for the database's error codes (the database stays the authority). */
const ERRORS: Record<string, string> = {
  forbidden: "Your financial role doesn't allow this.",
  period_locked: "That bank line is in a reconciled period. Reopen the period first (with a reason).",
  amount_mismatch: "The amounts don't match. A bank line can only be matched to a record of the same amount.",
  already_matched: "That bank line or record is already matched. Undo the other match first.",
  already_set: "That's already filled in. To change it, void the record and record it again.",
  differences_need_note: "The balance or unmatched lines don't add up. Add a note explaining the difference to confirm anyway.",
  period_already_confirmed: "That period (or a later one) is already confirmed for this account.",
  not_latest: "Only the most recent confirmed period can be reopened.",
  not_withdrawal: "Only money going out can become an expense.",
  account_archived: "That bank account is archived.",
  bad_rows: "Some statement lines are missing a date, description or amount.",
  bad_last4: "Use just the last 4 digits of the account number.",
  before_opening: "The period ends before the account's opening date.",
  bad_input: "Check the date and statement balance.",
  bad_kind: "Unknown export.",
  read_only: "Financials is read-only right now (the add-on lapsed). Everything stays readable.",
  not_entitled: "Financials isn't active for this account.",
  milestone_discrepancy: "This invoice differs from the signed schedule. Add an exception reason to issue it.",
  bad_amount: "Check the amount.",
  over_applied_invoice: "That's more than the invoice's balance.",
  over_applied_payment: "Allocations add up to more than the payment.",
  over_applied_credit: "That's more than the credit available.",
  over_refund: "That's more than can be refunded.",
  invoice_not_open: "That invoice isn't open.",
  reason_required: "Add a reason.",
  record_immutable: "Issued records can't be edited. Void it instead.",
  empty_invoice: "Add at least one line.",
  duplicate_bill: "That vendor invoice number is already recorded.",
  milestone_invoiced: "That milestone already has an invoice.",
  essential_alert: "Essential alerts can't be hidden.",
  forbidden_mode: "Accountant Mode needs an accounting permission.",
  stale_draft: "The amounts changed since this draft was written. Re-create the draft.",
  bad_lines: "Check the lines.",
  not_accepted: "This bid isn't marked as won yet.",
  version_required: "Pick which proposal version is the contract.",
  bad_state: "That can't be done in the record's current state.",
  has_refunds: "Void the refund first.",
  has_payments: "Void the payments on this bill first.",
  invoice_has_payments: "A payment was applied to this invoice (even if later voided), so it can't be deleted. Void it instead.",
  has_credits: "A credit was applied to this invoice, so it can't be deleted. Void it instead.",
  deposit_applied: "A later invoice deducts this deposit, so it can't be deleted. Void it instead.",
  has_dispute: "This invoice has a dispute on file, so it can't be deleted. Void it instead.",
  already_emailed: "An email for this invoice was sent or queued, so it can't be deleted. Void it instead.",
  already_sent: "This invoice is marked as sent, so your customer has it and it can't be deleted. Void it instead, or undo the sent mark if it was a mistake.",
  already_marked_sent: "This invoice is already marked as sent.",
  sandbox_no_email: "Emails are turned off in the sandbox, so nothing reaches a real customer. Leave the sandbox to send emails.",
  sandbox_setting: "This setting belongs to your real books. Leave the sandbox to change it.",
  sandbox_needs_real_job: "Open this job in your real books first, then it can be copied into the sandbox.",
  not_sandbox: "You're not in the sandbox.",
  not_marked_sent: "This invoice isn't marked as sent.",
  bad_method: "Choose how the invoice was sent.",
  bad_date: "The sent date must be between the issue date and today.",
  not_a_reduction: "Only a change order that removes scope (a negative amount) can be settled with a credit.",
  already_billed_plan: "This change order is already in the billing (its own payment, a reduced payment or a credit). Undo that first.",
  not_approved: "This change order isn't approved or signed yet.",
  milestones_must_sum: "The payment must equal the change order amount.",
  keep_is_void: "The record you're keeping is void. Pick a live one.",
  same_record: "Pick a different record to keep.",
  has_applications: "Reverse the credit's applications first.",
  has_bills: "This commitment already has bills.",
  customer_mismatch: "That invoice belongs to a different customer.",
  not_found: "We couldn't find that record.",
  idempotency_conflict: "That was already saved.",
};
export const finErrorText = (code: string | undefined | null) => (code && ERRORS[code]) || "Something went wrong. Nothing was changed.";
