import { z } from "zod";
import { json } from "@/lib/http/api";
import { finFail, finGuard } from "@/lib/financials/api";
import * as fin from "@/lib/financials/server";
import { snapshotIssuedInvoice } from "@/lib/tax-banking/tax/estimate-tax";

export const runtime = "nodejs";

/**
 * Every Financials write from the UI. Each action calls one SECURITY DEFINER RPC with the signed-in user's
 * client, which re-checks the financial permission, the add-on entitlement and the book. The book is
 * resolved on the server; the browser never chooses it. Nothing here sends an email or touches Stripe.
 */
const id = z.string().uuid();
const amount = z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const key = z.string().min(8).max(100).optional();
const alloc = z.array(z.object({ invoiceId: id, amount })).max(50);
const line = z.object({
  kind: z.enum(["deposit", "milestone", "progress", "final", "custom", "deposit_application"]),
  description: text(500).optional(), quantity: z.string().regex(/^\d{1,10}(\.\d{1,4})?$/).optional(), unitPrice: amount.optional(),
  taxable: z.boolean().optional(), milestoneIndex: z.number().int().min(0).max(99).optional(), appliesInvoiceId: id.optional(),
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_business_config"), p: z.object({
    primaryTradeSlug: text(60).nullable(), additionalTradeSlugs: z.array(text(60)).max(30), presetKey: text(40).nullable().optional(),
    market: z.enum(["residential", "commercial", "mixed"]), projectModel: z.enum(["fixed_price", "time_materials", "cost_plus", "service_call", "mixed"]),
    paymentStructure: z.enum(["deposit_progress_final", "milestones", "progress_sov", "on_completion", "time_materials", "cost_plus", "mixed"]),
    laborModel: z.enum(["employees", "subcontractors", "both"]), usesInventory: z.boolean(), usesEquipment: z.boolean(),
  }) }),
  z.object({ action: z.literal("save_ai_preferences"), p: z.object({ expenseSuggestions: z.boolean(), documentExtraction: z.boolean(), communicationDrafting: z.boolean(), photoLabeling: z.boolean() }).partial() }),
  z.object({ action: z.literal("save_dashboard"), scope: z.enum(["company", "role", "user"]), role: text(40).nullable().optional(), p: z.object({
    cards: z.array(z.object({ key: text(60), visible: z.boolean().optional() })).max(60).optional(), kpis: z.array(text(40)).max(9).optional(),
    lockedCards: z.array(text(60)).max(60).optional(), collapsedSections: z.array(text(40)).max(20).optional(),
    quickActions: z.array(text(40)).max(20).nullable().optional(),
  }) }),
  z.object({ action: z.literal("reset_dashboard") }),
  z.object({ action: z.literal("set_timesheet_labor"), on: z.boolean() }),
  z.object({ action: z.literal("save_reminders"), reminders: z.array(z.object({
    kind: z.enum(["balance_reminder", "overdue_reminder"]), enabled: z.boolean(), offsetDays: z.number().int().min(0).max(90),
    repeatEveryDays: z.number().int().min(1).max(60).nullable(), maxReminders: z.number().int().min(1).max(10),
  })).min(1).max(2) }),
  z.object({ action: z.literal("set_mode"), mode: z.enum(["contractor", "accountant"]) }),
  z.object({ action: z.literal("open_job"), estimateId: id, versionId: id.optional() }),
  z.object({ action: z.literal("sandbox_enter") }),
  z.object({ action: z.literal("sandbox_leave") }),
  z.object({ action: z.literal("sandbox_reset") }),
  z.object({ action: z.literal("save_project_profile"), estimateId: id, p: z.object({ primaryTradeSlug: text(60).nullable(), market: text(20).nullable(), projectModel: text(30).nullable(), paymentStructure: text(30).nullable(), workflow: text(20).nullable() }).partial() }),
  z.object({ action: z.literal("add_deduction"), jobId: id, amount, description: text(300).min(1), key }),
  z.object({ action: z.literal("save_invoice"), jobId: id, p: z.object({ id: id.optional(), kind: z.enum(["deposit", "milestone", "progress", "final", "custom"]).optional(), milestoneId: id.optional(), dueDate: day.optional(), memo: text(1000).optional(), lines: z.array(line).max(100).optional() }), key }),
  z.object({ action: z.literal("issue_invoice"), invoiceId: id, issueDate: day.optional(), exceptionReason: text(500).optional() }),
  z.object({ action: z.literal("delete_invoice_draft"), invoiceId: id }),
  z.object({ action: z.literal("void_invoice"), invoiceId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("delete_invoice"), invoiceId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("mark_sent"), invoiceId: id, method: z.enum(["own_email", "printed", "in_person", "text", "other"]), sentOn: day.optional(), note: text(500).optional() }),
  z.object({ action: z.literal("unmark_sent"), invoiceId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("co_credit"), jobId: id, changeOrderId: id, applyTo: alloc.optional(), key }),
  z.object({ action: z.literal("co_milestone"), jobId: id, changeOrderId: id, amount, description: text(300).optional() }),
  z.object({ action: z.literal("co_amend"), milestoneId: id, changeOrderId: id, delta: amount, reason: text(500).min(1) }),
  z.object({ action: z.literal("amendment_decide"), amendmentId: id, approve: z.boolean() }),
  z.object({ action: z.literal("record_payment"), p: z.object({ customerId: id.optional(), jobId: id.optional(), receivedOn: day.optional(), method: z.enum(["check", "cash", "ach", "card", "wire", "other"]), reference: text(120).optional(), amount, memo: text(1000).optional(), allocations: alloc.optional() }), key }),
  z.object({ action: z.literal("allocate_payment"), paymentId: id, allocations: alloc, key }),
  z.object({ action: z.literal("verify_payment"), paymentId: id }),
  z.object({ action: z.literal("void_payment"), paymentId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("issue_credit"), p: z.object({ jobId: id.optional(), customerId: id.optional(), invoiceId: id.optional(), amount, reason: text(500).min(1), issueDate: day.optional(), applyTo: alloc.optional() }), key }),
  z.object({ action: z.literal("record_trigger"), jobId: id, triggerKind: z.enum(["agreement_signed", "project_start_confirmed", "phase_completed_verified", "final_completion_confirmed", "calendar_date", "custom_approved"]), milestoneId: id.optional(), occurredAt: z.string().max(40).optional(), note: text(500).optional() }),
  z.object({ action: z.literal("refresh_alerts") }),
  z.object({ action: z.literal("alert_status"), alertId: id, status: z.enum(["acknowledged", "overridden"]), reason: text(500).optional() }),
  z.object({ action: z.literal("save_vendor"), p: z.object({ id: id.optional(), name: text(200).optional(), kind: z.enum(["subcontractor", "supplier", "other"]).optional(), resourceId: id.optional(), email: text(320).optional(), phone: text(40).optional() }) }),
  z.object({ action: z.literal("create_commitment"), p: z.object({ jobId: id, vendorId: id.optional(), vendorName: text(200).optional(), resourceId: id.optional(), costCodeId: id, title: text(300), kind: z.enum(["subcontract", "purchase_order"]).optional(), amount, quoteId: id.optional() }), key }),
  z.object({ action: z.literal("record_bill"), p: z.object({ vendorId: id, vendorInvoiceNumber: text(80).min(1), billDate: day.optional(), dueDate: day.optional(), memo: text(1000).optional(), documentId: id.optional(),
    lines: z.array(z.object({ jobId: id.optional(), costCodeId: id.optional(), commitmentId: id.optional(), description: text(500).min(1), amount })).min(1).max(50) }), key }),
  z.object({ action: z.literal("approve_bill"), billId: id }),
  z.object({ action: z.literal("pay_bill"), key, p: z.object({ billId: id, amount, method: z.enum(["check", "ach", "card", "cash", "wire", "other"]), paidOn: day.optional(), reference: text(120).optional(), memo: text(1000).optional() }) }),
  z.object({ action: z.literal("void_bill_payment"), billPaymentId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("void_bill"), billId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("void_credit"), creditMemoId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("mark_duplicate"), expenseId: id, keepId: id }),
  z.object({ action: z.literal("record_expense"), p: z.object({ jobId: id.optional(), vendorId: id.optional(), payee: text(200).optional(), costCodeId: id.optional(), spentOn: day.optional(), amount, method: z.enum(["card", "cash", "check", "ach", "reimbursement", "other"]).optional(), description: text(500).min(1), receiptDocumentId: id.optional() }), key }),
  z.object({ action: z.literal("decide_expense"), expenseId: id, decision: z.enum(["approve", "reject", "void"]), note: text(500).optional() }),
  z.object({ action: z.literal("review_resolve"), itemId: id, status: z.enum(["resolved", "dismissed"]), resolution: text(500).optional() }),
  // Accountant Mode (20261213001000): bank statements, matching, reconciliation, classification. No money moves.
  z.object({ action: z.literal("bank_account_save"), p: z.object({ id: id.optional(), name: text(120).optional(), kind: z.enum(["checking", "savings", "credit_card", "other"]).optional(),
    last4: z.string().regex(/^\d{4}$/).optional(), openingBalance: amount.optional(), openingDate: day.optional(), status: z.enum(["active", "archived"]).optional() }) }),
  z.object({ action: z.literal("bank_import"), accountId: id, p: z.object({ fileName: text(200).min(1), fileHash: z.string().regex(/^[0-9a-f]{64}$/), statementStart: day.optional(), statementEnd: day.optional(),
    openingBalance: amount.optional(), endingBalance: amount.optional(),
    rows: z.array(z.object({ date: day, description: text(300).min(1), amount, checkNumber: text(20).optional(), ref: text(80).optional() })).min(1).max(5000) }) }),
  z.object({ action: z.literal("bank_match"), txnId: id, p: z.object({ targetType: z.enum(["payment", "refund", "bill_payment", "expense", "excluded"]), targetId: id.optional(),
    excludeReason: z.enum(["transfer", "duplicate", "owner", "not_business", "other"]).optional(), note: text(500).optional() }) }),
  z.object({ action: z.literal("bank_unmatch"), matchId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("bank_create_expense"), txnId: id, p: z.object({ jobId: id.optional(), costCodeId: id.optional(), vendorId: id.optional(), description: text(500).optional(), payee: text(200).optional() }) }),
  z.object({ action: z.literal("bank_reconcile"), accountId: id, p: z.object({ periodEnd: day, statementBalance: amount, note: text(1000).optional() }) }),
  z.object({ action: z.literal("bank_reconcile_reopen"), reconciliationId: id, reason: text(500).min(1) }),
  z.object({ action: z.literal("cost_fill"), entityType: z.enum(["expense", "bill_line"]), entityId: id,
    p: z.object({ jobId: id.optional(), vendorId: id.optional(), costCodeId: id.optional(), scopeSectionId: id.optional() }).refine((x) => Object.values(x).some(Boolean)) }),
  z.object({ action: z.literal("email_draft_save"), p: z.object({ templateKind: z.enum(["deposit", "progress", "final", "time_materials", "change_order", "balance_reminder", "overdue_reminder", "receipt", "partial_payment", "final_thanks", "credit_refund"]),
    tone: z.enum(["friendly", "professional", "brief"]), toEmail: z.string().trim().email().max(320), toName: text(200).optional(), subject: text(300).min(1), body: text(20000).min(1),
    invoiceId: id.optional(), paymentId: id.optional(), fieldsHash: z.string().regex(/^[0-9a-f]{64}$/), idempotencyKey: z.string().min(8).max(100) }) }),
  z.object({ action: z.literal("email_template_save"), templateKind: z.enum(["deposit", "progress", "final", "time_materials", "change_order", "balance_reminder", "overdue_reminder", "receipt", "partial_payment", "final_thanks", "credit_refund"]),
    tone: z.enum(["friendly", "professional", "brief"]), subject: text(300).min(1), body: text(10000).min(1) }),
]);

type RpcDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string; details?: string | null } | null }> };
async function rpcOk(db: RpcDb, fn: string, args: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args);
  if (error) throw new fin.FinError(error.message, error.message, error.details ?? undefined);
  return json({ ok: true });
}
type RpcDataDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; details?: string | null } | null }> };
async function rpcData(db: RpcDataDb, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new fin.FinError(error.message, error.message, error.details ?? undefined);
  return data;
}

export async function POST(req: Request) {
  const g = await finGuard({ write: true, limitKey: "fin-action" });
  if ("error" in g) return g.error;
  const { db, bookId } = g;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: "Check the details and try again." }, { status: 400 });
  const a = parsed.data;
  try {
    switch (a.action) {
      case "save_business_config": return json({ ok: await fin.saveBusinessConfig(db, bookId, a.p) ?? true });
      case "save_ai_preferences": return json({ ok: await fin.saveAiPreferences(db, bookId, a.p as Record<string, boolean>) ?? true });
      case "save_dashboard": return json({ ok: await fin.saveDashboard(db, bookId, a.scope, a.role ?? null, a.p) ?? true });
      case "reset_dashboard": return json({ ok: await fin.resetDashboard(db, bookId) ?? true });
      case "set_mode": return json({ mode: await fin.setMode(db, bookId, a.mode) });
      case "open_job": {
        // In the sandbox a job is never opened for real: it is copied in from the real books.
        const { data: sbx } = await db.rpc("fin_is_sandbox", { p_book_id: bookId });
        if (sbx === true) return json((await rpcData(db, "fin_sandbox_copy_job", { p_sandbox: bookId, p_estimate_id: a.estimateId })) as Record<string, unknown>);
        return json(await fin.openJob(db, a.estimateId, a.versionId));
      }
      case "sandbox_enter": case "sandbox_reset": {
        const { data: live, error } = await db.rpc("fin_book_live", { p_book_id: bookId });
        if (error) throw new fin.FinError(error.message, error.message);
        return json((await rpcData(db, a.action === "sandbox_enter" ? "fin_sandbox_enter" : "fin_sandbox_reset", { p_live_book: live })) as Record<string, unknown>);
      }
      case "sandbox_leave": await rpcData(db, "fin_sandbox_leave", {}); return json({ ok: true });
      case "save_project_profile": return json({ ok: await fin.saveProjectProfile(db, a.estimateId, a.p) ?? true });
      case "add_deduction": return json({ ok: await fin.addDeduction(db, a.jobId, a.amount, a.description, a.key) ?? true });
      case "save_invoice": return json(await fin.saveInvoiceDraft(db, a.jobId, { ...a.p, lines: a.p.lines ?? [] }, a.key));
      case "issue_invoice": {
        const r = await fin.issueInvoice(db, a.invoiceId, { issueDate: a.issueDate, exceptionReason: a.exceptionReason || undefined });
        // V6.9: lock a tax snapshot of the invoice as issued (never changes its amounts). Best effort: a missing
        // table (SQL not run yet) or a tax-service hiccup never blocks issuing.
        const snap = await snapshotIssuedInvoice(db, a.invoiceId).catch(() => null);
        return json({ ...r, taxReview: snap?.note ?? null });
      }
      case "delete_invoice_draft": { const { error } = await db.rpc("fin_invoice_delete_draft", { p_invoice_id: a.invoiceId }); if (error) throw new fin.FinError(error.message, error.message, error.details ?? undefined); return json({ ok: true }); }
      case "delete_invoice": {
        const { data, error } = await db.rpc("fin_invoice_delete_mistake", { p_invoice_id: a.invoiceId, p_reason: a.reason });
        if (error) throw new fin.FinError(error.message, error.message, error.details ?? undefined);
        return json(data);
      }
      case "mark_sent": return json({ id: await rpcData(db, "fin_invoice_mark_sent", { p_invoice_id: a.invoiceId, p: { method: a.method, sentOn: a.sentOn, note: a.note } }) });
      case "unmark_sent": await rpcData(db, "fin_invoice_unmark_sent", { p_invoice_id: a.invoiceId, p_reason: a.reason }); return json({ ok: true });
      case "co_credit": return json((await rpcData(db, "fin_change_order_credit", { p_job_id: a.jobId, p: { changeOrderId: a.changeOrderId, applyTo: a.applyTo ?? [] }, p_idempotency_key: a.key ?? null })) as Record<string, unknown>);
      case "co_milestone": return json((await rpcData(db, "fin_change_order_milestones_add", { p_job_id: a.jobId, p: { changeOrderId: a.changeOrderId, milestones: [{ description: a.description || undefined, amount: a.amount }] } })) as Record<string, unknown>);
      case "co_amend": return json({ amendmentId: await rpcData(db, "fin_milestone_amendment_request", { p_milestone_id: a.milestoneId, p: { changeOrderId: a.changeOrderId, delta: a.delta, reason: a.reason } }) });
      case "amendment_decide": return json({ status: await rpcData(db, "fin_milestone_amendment_decide", { p_amendment_id: a.amendmentId, p_approve: a.approve }) });
      case "void_invoice": return json({ ok: await fin.voidInvoice(db, a.invoiceId, a.reason) ?? true });
      case "record_payment": return json(await fin.recordPayment(db, bookId, a.p, a.key));
      case "allocate_payment": return json({ ok: await fin.allocatePayment(db, a.paymentId, a.allocations, a.key) ?? true });
      case "verify_payment": return json({ ok: await fin.verifyPayment(db, a.paymentId) ?? true });
      case "void_payment": return json({ ok: await fin.voidPayment(db, a.paymentId, a.reason) ?? true });
      case "issue_credit": return json(await fin.issueCreditMemo(db, bookId, a.p, a.key));
      case "record_trigger": {
        const r = await fin.recordMilestoneTrigger(db, a.jobId, { triggerKind: a.triggerKind, milestoneId: a.milestoneId, occurredAt: a.occurredAt, note: a.note });
        await fin.refreshAlerts(db, bookId).catch(() => null);   // alerts follow the event; a refresh failure never blocks recording it
        return json({ triggerId: r });
      }
      case "refresh_alerts": return json(await fin.refreshAlerts(db, bookId));
      case "alert_status": return json({ ok: await fin.setAlertStatus(db, a.alertId, a.status, a.reason) ?? true });
      case "save_vendor": return json({ vendorId: await fin.saveVendor(db, bookId, a.p) });
      case "create_commitment": {
        const { vendorName, resourceId, ...rest } = a.p;
        const vendorId = rest.vendorId ?? await fin.saveVendor(db, bookId, { name: vendorName, resourceId, kind: "subcontractor" });
        return json(await fin.createCommitment(db, bookId, { ...rest, vendorId }, a.key));
      }
      case "record_bill": return json(await fin.recordBill(db, bookId, a.p, a.key));
      case "approve_bill": return json({ ok: await fin.approveBill(db, a.billId) ?? true });
      case "pay_bill": return json(await fin.payBill(db, bookId, a.p, a.key));
      case "void_bill_payment": return json({ ok: await fin.voidBillPayment(db, a.billPaymentId, a.reason) ?? true });
      case "void_bill": return await rpcOk(db, "fin_bill_void", { p_bill_id: a.billId, p_reason: a.reason });
      case "void_credit": return await rpcOk(db, "fin_credit_memo_void", { p_credit_memo_id: a.creditMemoId, p_reason: a.reason });
      case "mark_duplicate": return await rpcOk(db, "fin_expense_mark_duplicate", { p_expense_id: a.expenseId, p_keep_id: a.keepId });
      case "record_expense": return json(await fin.recordExpense(db, bookId, a.p, a.key));
      case "decide_expense": return json({ status: await fin.decideExpense(db, a.expenseId, a.decision, a.note) });
      case "review_resolve": { const { error } = await db.rpc("fin_review_resolve", { p_item_id: a.itemId, p_status: a.status, p_resolution: a.resolution ?? null }); if (error) throw new fin.FinError(error.message, error.message); return json({ ok: true }); }
      case "bank_account_save": return json({ accountId: await rpcData(db, "fin_bank_account_save", { p_book_id: bookId, p: a.p }) });
      case "bank_import": {
        // The account must be in the caller's book (the RPC re-checks "reconcile" on the account's own book).
        const { data: acct } = await db.from("fin_bank_accounts").select("book_id").eq("id", a.accountId).maybeSingle();
        if (!acct || acct.book_id !== bookId) throw new fin.FinError("not_found");
        return json((await rpcData(db, "fin_bank_import", { p_account_id: a.accountId, p: a.p })) as Record<string, unknown>);
      }
      case "bank_match": return json({ matchId: await rpcData(db, "fin_bank_match", { p_txn_id: a.txnId, p: a.p }) });
      case "bank_unmatch": return await rpcOk(db, "fin_bank_unmatch", { p_match_id: a.matchId, p_reason: a.reason });
      case "bank_create_expense": return json((await rpcData(db, "fin_bank_create_expense", { p_txn_id: a.txnId, p: a.p })) as Record<string, unknown>);
      case "bank_reconcile": return json((await rpcData(db, "fin_bank_reconcile", { p_account_id: a.accountId, p: a.p })) as Record<string, unknown>);
      case "bank_reconcile_reopen": return await rpcOk(db, "fin_bank_reconcile_reopen", { p_id: a.reconciliationId, p_reason: a.reason });
      case "cost_fill": return await rpcOk(db, "fin_cost_fill", { p_entity_type: a.entityType, p_entity_id: a.entityId, p: a.p });
      // Drafts only: saving a draft stores it for review. There is no send or queue action here.
      case "email_draft_save": return json({ messageId: await fin.saveEmailDraft(db, bookId, a.p) });
      // Automatic payment reminder rules. The hourly customer-email job sends them (src/lib/financials/reminder-run.ts).
      case "set_timesheet_labor": return await rpcOk(db, "fin_set_timesheet_labor", { p_book_id: bookId, p_on: a.on });
      case "save_reminders": {
        const { error } = await db.rpc("fin_email_config_save", { p_book_id: bookId, p: { reminders: a.reminders } });
        if (error) throw new fin.FinError(error.message, error.message);
        return json({ ok: true });
      }
      case "email_template_save": {
        const { error } = await db.rpc("fin_email_config_save", { p_book_id: bookId, p: { templates: [{ templateKind: a.templateKind, tone: a.tone, subject: a.subject, body: a.body }] } });
        if (error) throw new fin.FinError(error.message, error.message);
        return json({ ok: true });
      }
    }
  } catch (e) {
    return finFail(e, `financials.${a.action}`);
  }
}
