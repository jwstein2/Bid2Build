import "server-only";
/**
 * Server-only data access for the Financial Command Center. Every write goes through a SECURITY DEFINER
 * RPC that re-checks the caller's financial permission and the add-on entitlement; tables are read-only to
 * the browser (RLS). Call these with the signed-in user's client (createClient), never the admin client,
 * so auth.uid() is the real actor in the audit log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillInput, CommitmentInput, CreditMemoInput, Discrepancy, ExpenseInput, FinAccess, InvoiceDraftInput, MilestoneTriggerKind, PaymentInput, RefundInput,
} from "./types";

type Db = SupabaseClient;

export class FinError extends Error {
  constructor(public code: string, message?: string, public detail?: string) { super(message ?? code); }
}

async function call<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new FinError(error.message || "rpc_failed", error.message, error.details ?? undefined);
  return data as T;
}

export const myBook = (db: Db, personal = false) => call<string | null>(db, "fin_my_book", { p_personal: personal });
export const finAccess = (db: Db, bookId: string) => call<FinAccess | null>(db, "fin_access", { p_book_id: bookId });

// Seats & configuration
export const assignSeat = (db: Db, bookId: string, userId: string, role: string) => call(db, "fin_seat_assign", { p_book_id: bookId, p_user_id: userId, p_role: role });
export const removeSeat = (db: Db, bookId: string, userId: string) => call(db, "fin_seat_remove", { p_book_id: bookId, p_user_id: userId });
export const assignAccountantSeat = (db: Db, bookId: string, email: string) => call(db, "fin_accountant_seat_assign", { p_book_id: bookId, p_email: email });
export const saveBusinessConfig = (db: Db, bookId: string, p: Record<string, unknown>) => call(db, "fin_business_config_save", { p_book_id: bookId, p });
export const saveProjectProfile = (db: Db, estimateId: string, p: Record<string, unknown>) => call(db, "fin_project_profile_save", { p_estimate_id: estimateId, p });
export const saveAiPreferences = (db: Db, bookId: string, p: Record<string, boolean>) => call(db, "fin_ai_preferences_save", { p_book_id: bookId, p });
export const dashboardLayout = (db: Db, bookId: string) => call<Record<string, unknown>>(db, "fin_dashboard_layout", { p_book_id: bookId });
export const saveDashboard = (db: Db, bookId: string, scope: "company" | "role" | "user", role: string | null, p: Record<string, unknown>) =>
  call(db, "fin_dashboard_save", { p_book_id: bookId, p_scope: scope, p_role: role, p });
export const resetDashboard = (db: Db, bookId: string) => call(db, "fin_dashboard_reset", { p_book_id: bookId });
export const setMode = (db: Db, bookId: string, mode: "contractor" | "accountant") => call<string>(db, "fin_set_mode", { p_book_id: bookId, p_mode: mode });

// Receivables
export const openJob = (db: Db, estimateId: string, versionId?: string) =>
  call<{ jobId: string; jobNumber: string; created: boolean }>(db, "fin_job_open", { p_estimate_id: estimateId, p_version_id: versionId ?? null });
export const addDeduction = (db: Db, jobId: string, amount: string, description: string, key?: string) =>
  call(db, "fin_contract_deduction_add", { p_job_id: jobId, p_amount: amount, p_description: description, p_idempotency_key: key ?? null });
export const saveInvoiceDraft = (db: Db, jobId: string, p: InvoiceDraftInput, key?: string) =>
  call<{ invoiceId: string; total: string; discrepancies: Discrepancy[] }>(db, "fin_invoice_save", { p_job_id: jobId, p, p_idempotency_key: key ?? null });
export const issueInvoice = (db: Db, invoiceId: string, opts: { issueDate?: string; exceptionReason?: string } = {}) =>
  call<{ invoiceId: string; number: string; total: string; discrepancies?: Discrepancy[] }>(db, "fin_invoice_issue",
    { p_invoice_id: invoiceId, p_issue_date: opts.issueDate ?? null, p_exception_reason: opts.exceptionReason ?? null });
export const voidInvoice = (db: Db, invoiceId: string, reason: string) => call(db, "fin_invoice_void", { p_invoice_id: invoiceId, p_reason: reason });
export const recordPayment = (db: Db, bookId: string, p: PaymentInput, key?: string) =>
  call<{ paymentId: string; number: string; unapplied: string }>(db, "fin_payment_record", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const allocatePayment = (db: Db, paymentId: string, allocations: PaymentInput["allocations"], key?: string) =>
  call(db, "fin_payment_allocate", { p_payment_id: paymentId, p_allocations: allocations ?? [], p_idempotency_key: key ?? null });
export const verifyPayment = (db: Db, paymentId: string) => call(db, "fin_payment_verify", { p_payment_id: paymentId });
export const voidPayment = (db: Db, paymentId: string, reason: string) => call(db, "fin_payment_void", { p_payment_id: paymentId, p_reason: reason });
export const issueCreditMemo = (db: Db, bookId: string, p: CreditMemoInput, key?: string) =>
  call<{ creditMemoId: string; number: string; available: string }>(db, "fin_credit_memo_issue", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const recordRefund = (db: Db, bookId: string, p: RefundInput, key?: string) =>
  call<{ refundId: string; number: string }>(db, "fin_refund_record", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const recordMilestoneTrigger = (db: Db, jobId: string, p: { triggerKind: MilestoneTriggerKind; milestoneId?: string; occurredAt?: string; note?: string }) =>
  call<string>(db, "fin_milestone_trigger_record", { p_job_id: jobId, p });
export const refreshAlerts = (db: Db, bookId: string) => call<{ opened: number; resolved: number }>(db, "fin_alerts_refresh", { p_book_id: bookId });
export const setAlertStatus = (db: Db, alertId: string, status: "acknowledged" | "overridden", reason?: string) =>
  call(db, "fin_alert_set_status", { p_alert_id: alertId, p_status: status, p_reason: reason ?? null });

// Costs
export const saveVendor = (db: Db, bookId: string, p: Record<string, unknown>) => call<string>(db, "fin_vendor_save", { p_book_id: bookId, p });
export const createCommitment = (db: Db, bookId: string, p: CommitmentInput, key?: string) =>
  call<{ commitmentId: string; number: string }>(db, "fin_commitment_create", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const reviseCommitment = (db: Db, commitmentId: string, delta: string, reason: string, key?: string) =>
  call(db, "fin_commitment_revise", { p_commitment_id: commitmentId, p_delta: delta, p_reason: reason, p_idempotency_key: key ?? null });
export const recordBill = (db: Db, bookId: string, p: BillInput, key?: string) =>
  call<{ billId: string; number: string; total: string }>(db, "fin_bill_record", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const approveBill = (db: Db, billId: string) => call(db, "fin_bill_approve", { p_bill_id: billId });
/** Record a payment made to a vendor/sub outside Built2Bid (check, ACH...). Never more than the bill. */
export const payBill = (db: Db, bookId: string, p: { billId: string; amount: string; method: string; paidOn?: string; reference?: string; memo?: string }, key?: string) =>
  call<{ billPaymentId: string; balance: string }>(db, "fin_bill_payment_record", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const voidBillPayment = (db: Db, billPaymentId: string, reason: string) => call(db, "fin_bill_payment_void", { p_bill_payment_id: billPaymentId, p_reason: reason });
export const recordExpense = (db: Db, bookId: string, p: ExpenseInput, key?: string) =>
  call<{ expenseId: string; number: string }>(db, "fin_expense_record", { p_book_id: bookId, p, p_idempotency_key: key ?? null });
export const decideExpense = (db: Db, expenseId: string, action: "approve" | "reject" | "void", note?: string) =>
  call<string>(db, "fin_expense_decide", { p_expense_id: expenseId, p_action: action, p_note: note ?? null });

// Emails (drafts only; nothing here sends)
export const saveEmailDraft = (db: Db, bookId: string, p: Record<string, unknown>) => call<string>(db, "fin_email_draft_save", { p_book_id: bookId, p });
export const queueEmail = (db: Db, messageId: string, currentFieldsHash: string) =>
  call<string>(db, "fin_email_queue", { p_message_id: messageId, p_current_fields_hash: currentFieldsHash });
