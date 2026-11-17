import { z } from "zod";
import { json } from "@/lib/http/api";
import { finFail, finGuard } from "@/lib/financials/api";
import * as fin from "@/lib/financials/server";

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
  }) }),
  z.object({ action: z.literal("reset_dashboard") }),
  z.object({ action: z.literal("set_mode"), mode: z.enum(["contractor", "accountant"]) }),
  z.object({ action: z.literal("open_job"), estimateId: id, versionId: id.optional() }),
  z.object({ action: z.literal("save_project_profile"), estimateId: id, p: z.object({ primaryTradeSlug: text(60).nullable(), market: text(20).nullable(), projectModel: text(30).nullable(), paymentStructure: text(30).nullable(), workflow: text(20).nullable() }).partial() }),
  z.object({ action: z.literal("add_deduction"), jobId: id, amount, description: text(300).min(1), key }),
  z.object({ action: z.literal("save_invoice"), jobId: id, p: z.object({ id: id.optional(), kind: z.enum(["deposit", "milestone", "progress", "final", "custom"]).optional(), milestoneId: id.optional(), dueDate: day.optional(), memo: text(1000).optional(), lines: z.array(line).max(100).optional() }), key }),
  z.object({ action: z.literal("issue_invoice"), invoiceId: id, issueDate: day.optional(), exceptionReason: text(500).optional() }),
  z.object({ action: z.literal("delete_invoice_draft"), invoiceId: id }),
  z.object({ action: z.literal("void_invoice"), invoiceId: id, reason: text(500).min(1) }),
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
  z.object({ action: z.literal("record_expense"), p: z.object({ jobId: id.optional(), vendorId: id.optional(), payee: text(200).optional(), costCodeId: id.optional(), spentOn: day.optional(), amount, method: z.enum(["card", "cash", "check", "ach", "reimbursement", "other"]).optional(), description: text(500).min(1), receiptDocumentId: id.optional() }), key }),
  z.object({ action: z.literal("decide_expense"), expenseId: id, decision: z.enum(["approve", "reject", "void"]), note: text(500).optional() }),
  z.object({ action: z.literal("review_resolve"), itemId: id, status: z.enum(["resolved", "dismissed"]), resolution: text(500).optional() }),
  z.object({ action: z.literal("email_draft_save"), p: z.object({ templateKind: z.enum(["deposit", "progress", "final", "time_materials", "change_order", "balance_reminder", "overdue_reminder", "receipt", "partial_payment", "final_thanks", "credit_refund"]),
    tone: z.enum(["friendly", "professional", "brief"]), toEmail: z.string().trim().email().max(320), toName: text(200).optional(), subject: text(300).min(1), body: text(20000).min(1),
    invoiceId: id.optional(), paymentId: id.optional(), fieldsHash: z.string().regex(/^[0-9a-f]{64}$/), idempotencyKey: z.string().min(8).max(100) }) }),
  z.object({ action: z.literal("email_template_save"), templateKind: z.enum(["deposit", "progress", "final", "time_materials", "change_order", "balance_reminder", "overdue_reminder", "receipt", "partial_payment", "final_thanks", "credit_refund"]),
    tone: z.enum(["friendly", "professional", "brief"]), subject: text(300).min(1), body: text(10000).min(1) }),
]);

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
      case "open_job": return json(await fin.openJob(db, a.estimateId, a.versionId));
      case "save_project_profile": return json({ ok: await fin.saveProjectProfile(db, a.estimateId, a.p) ?? true });
      case "add_deduction": return json({ ok: await fin.addDeduction(db, a.jobId, a.amount, a.description, a.key) ?? true });
      case "save_invoice": return json(await fin.saveInvoiceDraft(db, a.jobId, { ...a.p, lines: a.p.lines ?? [] }, a.key));
      case "issue_invoice": return json(await fin.issueInvoice(db, a.invoiceId, { issueDate: a.issueDate, exceptionReason: a.exceptionReason || undefined }));
      case "delete_invoice_draft": { const { error } = await db.rpc("fin_invoice_delete_draft", { p_invoice_id: a.invoiceId }); if (error) throw new fin.FinError(error.message, error.message, error.details ?? undefined); return json({ ok: true }); }
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
      case "record_expense": return json(await fin.recordExpense(db, bookId, a.p, a.key));
      case "decide_expense": return json({ status: await fin.decideExpense(db, a.expenseId, a.decision, a.note) });
      case "review_resolve": { const { error } = await db.rpc("fin_review_resolve", { p_item_id: a.itemId, p_status: a.status, p_resolution: a.resolution ?? null }); if (error) throw new fin.FinError(error.message, error.message); return json({ ok: true }); }
      // Drafts only: saving a draft stores it for review. There is no send or queue action here.
      case "email_draft_save": return json({ messageId: await fin.saveEmailDraft(db, bookId, a.p) });
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
