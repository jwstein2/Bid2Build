import { z } from "zod";
import { fail, json } from "@/lib/http/api";
import { finFail, finGuard } from "@/lib/financials/api";
import { finAccess } from "@/lib/financials/server";
import { loadBranding } from "@/lib/financials/branding";
import { displayPhone } from "@/lib/proposal/customer-text";
import { payInstructionsText } from "@/lib/financials/emails/render";
import { defaultTemplate, render, TEMPLATE_KINDS, TONES, type EmailFacts, type TemplateKind, type Tone } from "@/lib/financials/emails";
import { sub, toMoney } from "@/lib/financials/money";

export const runtime = "nodejs";

const body = z.object({
  kind: z.enum(TEMPLATE_KINDS).optional(),
  tone: z.enum(TONES).optional(),
  invoiceId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
});
type Row = Record<string, unknown>;

/**
 * Render an invoice or payment email from verified records (deterministic templates; no AI). Returns the
 * company's saved wording for this kind + tone when there is one, and the standard wording to restore.
 * This route only renders text: nothing is stored or sent. Sending is not built (it turns on after approval),
 * so it stays open in Demo Mode (see DEMO_BLOCKED): a demo can show the draft without reaching anyone.
 */
export async function POST(req: Request) {
  const g = await finGuard({ write: true, limitKey: "fin-email-render", limit: 300 });
  if ("error" in g) return g.error;
  const { db, bookId } = g;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.invoiceId && !p.data.paymentId)) return fail(400, "invalid", "Choose an invoice or payment.");
  try {
    const [access, brand] = await Promise.all([finAccess(db, bookId), loadBranding(db, bookId, { logo: false }).catch(() => null)]);
    const [{ data: settings }, inv, pay] = await Promise.all([
      db.from("fin_email_settings").select("tone").eq("book_id", bookId).maybeSingle(),
      p.data.invoiceId ? db.from("fin_invoices").select("id, job_id, kind, number, status, due_date, total, bill_to, milestone_id, memo").eq("id", p.data.invoiceId).eq("book_id", bookId).maybeSingle() : Promise.resolve({ data: null }),
      p.data.paymentId ? db.from("fin_payment_balances_v").select("*").eq("payment_id", p.data.paymentId).eq("book_id", bookId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const invoice = inv.data as Row | null, payment = pay.data as Row | null;
    if (!invoice && !payment) return fail(404, "not_found", "We couldn't find that record.");
    const jobId = String(invoice?.job_id ?? payment?.job_id ?? "");
    const [{ data: job }, { data: contract }, { data: snap }, { data: bal }, { data: ms }, { data: jobBalances }] = await Promise.all([
      db.from("fin_jobs").select("id, name, estimate_id, customer_id").eq("id", jobId).maybeSingle(),
      db.from("fin_job_contract_v").select("current_contract").eq("job_id", jobId).maybeSingle(),
      db.from("fin_contract_snapshots").select("payment_schedule").eq("job_id", jobId).maybeSingle(),
      invoice ? db.from("fin_invoice_balances_v").select("balance, days_overdue").eq("invoice_id", invoice.id as string).maybeSingle() : Promise.resolve({ data: null }),
      invoice?.milestone_id ? db.from("fin_payment_milestones").select("description").eq("id", invoice.milestone_id as string).maybeSingle() : Promise.resolve({ data: null }),
      db.from("fin_invoice_balances_v").select("balance").eq("job_id", jobId).eq("status", "issued"),
    ]);
    const est = job ? (await db.from("estimates").select("customer_name, customer_email").eq("id", (job as Row).estimate_id as string).maybeSingle()).data as Row | null : null;
    const billTo = (invoice?.bill_to as Row | null) ?? null;
    const customerName = String(billTo?.name ?? est?.customer_name ?? "there");
    const toEmail = String(billTo?.email ?? est?.customer_email ?? "");
    const jobOwed = toMoney(((jobBalances ?? []) as Row[]).reduce((s, r) => s + Number(r.balance ?? 0), 0));
    const invKind = String(invoice?.kind ?? "");
    const options: TemplateKind[] = invoice
      ? [invKind === "deposit" ? "deposit" : invKind === "final" ? "final" : "progress", "balance_reminder", "overdue_reminder"]
      : ["receipt", "partial_payment", "final_thanks", "credit_refund"];
    const kind: TemplateKind = p.data.kind && options.includes(p.data.kind) ? p.data.kind
      : invoice ? (Number((bal as Row | null)?.days_overdue ?? 0) > 0 ? "overdue_reminder" : options[0])
      : Number(jobOwed) <= 0 ? "final_thanks" : "receipt";
    const tone: Tone = p.data.tone ?? ((settings as Row | null)?.tone as Tone | undefined) ?? "professional";
    const schedule = ((snap as Row | null)?.payment_schedule as Row[] | null) ?? [];
    const facts: EmailFacts = {
      customerName, companyName: access?.name || brand?.company.name || "", projectName: String((job as Row | null)?.name ?? ""),
      invoiceNumber: invoice?.number ? String(invoice.number) : undefined,
      amountDue: invoice ? toMoney(String((bal as Row | null)?.balance ?? invoice.total)) : undefined,
      dueDate: invoice?.due_date ? String(invoice.due_date) : undefined,
      milestone: (ms as Row | null)?.description ? String((ms as Row).description) : undefined,
      // Invoice emails talk about this invoice's open balance (as the automatic reminders do); receipts about the job's.
      balance: invoice ? toMoney(String((bal as Row | null)?.balance ?? invoice.total)) : jobOwed,
      contractTotal: kind === "deposit" && contract ? toMoney(String((contract as Row).current_contract)) : undefined,
      schedule: kind === "deposit" ? schedule.map((s) => ({ label: String(s.label), percent: String(s.percent) })) : undefined,
      // Same "How to pay" wording as the invoice PDF (invoice emails only).
      payInstructions: invoice ? payInstructionsText({ name: access?.name || brand?.company.name, phone: brand?.company.phone ? displayPhone(brand.company.phone) : undefined, email: brand?.company.email }, invoice.number ? String(invoice.number) : undefined) : undefined,
      payment: payment ? { amount: toMoney(sub(String(payment.amount), String(payment.refunded ?? "0"))), date: String(payment.received_on), method: String(payment.method), verified: Boolean(payment.verified) } : undefined,
    };
    const { data: tpl } = await db.from("fin_email_templates").select("subject, body").eq("book_id", bookId).eq("template_kind", kind).eq("tone", tone).maybeSingle();
    const standard = render(kind, tone, facts);
    const rendered = tpl ? render(kind, tone, facts, tpl as { subject: string; body: string }) : standard;
    const canSaveTemplate = Boolean(access?.permissions.includes("manage_financial_config"));
    return json({
      kind, tone, options, toEmail, toName: customerName, subject: rendered.subject, body: rendered.body, fieldsHash: rendered.fieldsHash,
      standard: { subject: standard.subject, body: standard.body }, companyTemplate: Boolean(tpl), canSaveTemplate,
      // Raw template text (placeholders intact) so a company template can be saved from the editor.
      template: (tpl as { subject: string; body: string } | null) ?? defaultTemplate(kind, tone),
      standardTemplate: defaultTemplate(kind, tone),
      sendingEnabled: false,
      // The customer PDF stays available as the fallback for any email (issued invoices only).
      pdfUrl: invoice && invoice.status !== "draft" ? `/api/financials/invoices/${String(invoice.id)}/pdf?download=1` : null,
    });
  } catch (e) {
    return finFail(e, "financials.email.render");
  }
}
