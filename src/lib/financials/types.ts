/** Financial Command Center types (amounts are two-decimal strings; see ./money). */
import type { Money } from "./money";
import type { FinPermission, FinRole } from "./permissions";

export type BookKind = "solo" | "company";

/** public.fin_access(book) */
export interface FinAccess {
  bookId: string;
  name: string;
  kind: BookKind;
  active: boolean;
  readOnly: boolean;
  seatLimit: number;
  source: string;
  role: FinRole | null;
  accountantSeat: boolean;
  permissions: FinPermission[];
}

export type InvoiceKind = "deposit" | "milestone" | "progress" | "final" | "custom";
export type InvoiceLineKind = InvoiceKind | "deposit_application";
export type InvoiceStatus = "draft" | "issued" | "void";
export type PaymentMethod = "check" | "cash" | "ach" | "card" | "wire" | "other";
export type AgingBucket = "none" | "paid" | "current" | "1_30" | "31_60" | "61_90" | "over_90";

export interface InvoiceLineInput {
  kind: InvoiceLineKind;
  description?: string;
  quantity?: string;
  /** Omit for milestone/deposit (schedule amount), final (remaining contract) or deposit_application lines. */
  unitPrice?: string;
  taxable?: boolean;
  milestoneIndex?: number;
  appliesInvoiceId?: string;
}

export interface InvoiceDraftInput {
  id?: string;
  kind?: InvoiceKind;
  milestoneId?: string;
  dueDate?: string;
  memo?: string;
  lines: InvoiceLineInput[];
}

export type DiscrepancyCode = "amount_differs" | "due_date_differs" | "not_triggered" | "duplicate_milestone_invoice";
export interface Discrepancy { code: DiscrepancyCode; expected?: string; actual?: string }

export interface Allocation { invoiceId: string; amount: Money }

export interface PaymentInput {
  customerId?: string;
  jobId?: string;
  receivedOn?: string;
  method: PaymentMethod;
  reference?: string;
  amount: Money;
  memo?: string;
  allocations?: Allocation[];
}

export interface CreditMemoInput {
  jobId?: string;
  customerId?: string;
  invoiceId?: string;
  amount: Money;
  reason: string;
  issueDate?: string;
  applyTo?: Allocation[];
}

export interface RefundInput {
  paymentId?: string;
  creditMemoId?: string;
  amount: Money;
  refundedOn?: string;
  method: PaymentMethod;
  reference?: string;
  memo?: string;
}

export type MilestoneTriggerKind = "agreement_signed" | "project_start_confirmed" | "phase_completed_verified" | "final_completion_confirmed" | "calendar_date" | "custom_approved";
export type MilestoneState = "not_triggered" | "ready_to_invoice" | "invoiced" | "partially_paid" | "paid";
export type DueRule = "on_trigger" | "net_days" | "date";

export interface MilestoneStatus {
  milestone_id: string;
  job_id: string;
  seq: number;
  description: string;
  current_amount: Money;
  trigger_kind: MilestoneTriggerKind;
  due_rule: DueRule;
  is_deposit: boolean;
  triggered_at: string | null;
  due_on: string | null;
  invoiced: Money;
  paid: Money;
  state: MilestoneState;
  overdue: boolean;
}

export type AlertKind = "deposit_not_invoiced" | "deposit_overdue" | "start_with_prestart_unpaid" | "milestone_ready_not_invoiced" | "invoice_milestone_mismatch"
  | "duplicate_milestone_invoice" | "billed_over_contract" | "completion_with_balance" | "change_order_affects_billing";
export type AlertSeverity = "info" | "warning" | "action_required";

export interface BillInput {
  vendorId: string;
  vendorInvoiceNumber: string;
  billDate?: string;
  dueDate?: string;
  memo?: string;
  documentId?: string;
  lines: { jobId?: string; costCodeId?: string; commitmentId?: string; description: string; amount: Money }[];
}

export interface ExpenseInput {
  jobId?: string;
  vendorId?: string;
  payee?: string;
  costCodeId?: string;
  spentOn?: string;
  amount: Money;
  method?: "card" | "cash" | "check" | "ach" | "reimbursement" | "other";
  description: string;
  receiptDocumentId?: string;
}

export interface CommitmentInput {
  jobId: string;
  vendorId: string;
  costCodeId: string;
  title: string;
  kind?: "subcontract" | "purchase_order";
  amount: Money;
  quoteId?: string;
}

/** Each figure is labeled by its basis so the UI never mixes them up. */
export interface JobProfitability {
  job_id: string;
  contract_value: Money;
  invoiced_revenue: Money;
  estimated_cost: Money;
  committed_cost: Money;
  actual_cost: Money;
  estimated_profit: Money;
  projected_profit: Money;
  actual_profit_to_date: Money;
  pending_changes: Money;
}
