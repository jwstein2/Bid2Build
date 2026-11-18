import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { rowToBusiness } from "@/lib/data/mappers";
import { toMoney } from "./money";
import { render, type EmailFacts, type Tone } from "./emails";
import { COUNTED_STATUSES, localNow, mapRule, REMINDER_KINDS, reminderToPlan, SEND_HOUR, type ReminderKind, type ReminderRule } from "./reminders";

/**
 * Automatic payment reminders: planning (hourly, from runComms) and the final check + render right before
 * a reminder is delivered by deliverDue. Uses the service-role client; every query is scoped by book id.
 * Reminders are transactional (about money the customer owes), so they carry no marketing unsubscribe,
 * but they respect the account's "pause all customer emails" switch and bounced/complained addresses.
 */
type Db = SupabaseClient;
type Row = Record<string, unknown>;
/** YYYY-MM-DD from a date column (PostgREST sends a string; a pg driver may send a Date). */
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);

export interface InvoiceEmail { toEmail: string; toName: string; subject: string; body: string; fieldsHash: string; tone: Tone }

async function accountFor(admin: Db, book: Row) {
  const accountId = String(book.company_id ?? book.owner_user_id);
  let ownerId = book.owner_user_id ? String(book.owner_user_id) : null;
  if (!ownerId && book.company_id) {
    const { data } = await admin.from("companies").select("owner_user_id").eq("id", String(book.company_id)).maybeSingle();
    ownerId = ((data as Row | null)?.owner_user_id as string) ?? null;
  }
  const { data: bp } = ownerId ? await admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle() : { data: null };
  const b = rowToBusiness(bp as Row | null);
  return { accountId, companyName: b.companyName || String(book.name ?? "") || "Your contractor", phone: b.phone ?? null, email: b.email ?? null };
}

/** Render a reminder from the invoice as it is right now (current balance), with the company's saved wording. */
export async function renderInvoiceReminder(admin: Db, bookId: string, invoiceId: string, kind: ReminderKind): Promise<InvoiceEmail | null> {
  const [{ data: book }, { data: inv }, { data: bal }, { data: settings }] = await Promise.all([
    admin.from("fin_books").select("id, name, company_id, owner_user_id").eq("id", bookId).maybeSingle(),
    admin.from("fin_invoices").select("id, job_id, number, due_date, total, bill_to").eq("id", invoiceId).eq("book_id", bookId).maybeSingle(),
    admin.from("fin_invoice_balances_v").select("balance").eq("invoice_id", invoiceId).maybeSingle(),
    admin.from("fin_email_settings").select("tone").eq("book_id", bookId).maybeSingle(),
  ]);
  if (!book || !inv) return null;
  const invoice = inv as Row;
  const { data: job } = await admin.from("fin_jobs").select("name, estimate_id").eq("id", String(invoice.job_id)).maybeSingle();
  const { data: est } = (job as Row | null)?.estimate_id
    ? await admin.from("estimates").select("customer_name, customer_email").eq("id", String((job as Row).estimate_id)).maybeSingle() : { data: null };
  const billTo = (invoice.bill_to as Row | null) ?? null;
  const toEmail = String(billTo?.email ?? (est as Row | null)?.customer_email ?? "").trim().toLowerCase();
  const toName = String(billTo?.name ?? (est as Row | null)?.customer_name ?? "there");
  const acct = await accountFor(admin, book as Row);
  const tone = (((settings as Row | null)?.tone as Tone | undefined) ?? "professional");
  const contact = [acct.phone ? `call ${acct.phone}` : null, "reply to this email"].filter(Boolean).join(" or ");
  const facts: EmailFacts = {
    customerName: toName, companyName: acct.companyName, projectName: String((job as Row | null)?.name ?? ""),
    invoiceNumber: invoice.number ? String(invoice.number) : undefined, amountDue: toMoney(String((bal as Row | null)?.balance ?? invoice.total)),
    balance: toMoney(String((bal as Row | null)?.balance ?? invoice.total)), dueDate: invoice.due_date ? day(invoice.due_date) : undefined,
    payInstructions: `Questions about this invoice? Please ${contact}.`,
  };
  const { data: tpl } = await admin.from("fin_email_templates").select("subject, body").eq("book_id", bookId).eq("template_kind", kind).eq("tone", tone).maybeSingle();
  const r = render(kind, tone, facts, (tpl as { subject: string; body: string } | null) ?? null);
  return { toEmail, toName, subject: r.subject, body: r.body, fieldsHash: r.fieldsHash, tone };
}

/** Books with at least one reminder rule turned on, that have an active (not read-only) Financials plan and aren't sandboxes. */
async function activeBooks(admin: Db): Promise<{ book: Row; rules: Record<ReminderKind, ReminderRule> }[]> {
  const { data: rows } = await admin.from("fin_reminder_rules").select("*").eq("enabled", true).limit(5000);
  const byBook = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) byBook.set(String(r.book_id), [...(byBook.get(String(r.book_id)) ?? []), r]);
  if (!byBook.size) return [];
  const { data: books } = await admin.from("fin_books").select("*").in("id", [...byBook.keys()]);
  const out: { book: Row; rules: Record<ReminderKind, ReminderRule> }[] = [];
  for (const b of (books ?? []) as Row[]) {
    if (b.sandbox_of) continue;
    const { data: ent } = await admin.rpc("fin_entitlement", { p_book_id: String(b.id) });
    const e = (Array.isArray(ent) ? ent[0] : ent) as Row | null;
    if (!e?.active || e.read_only) continue;
    const list = byBook.get(String(b.id)) ?? [];
    const rules = Object.fromEntries(REMINDER_KINDS.map((k) => [k, mapRule(list.find((r) => r.kind === k), k)])) as Record<ReminderKind, ReminderRule>;
    out.push({ book: b, rules });
  }
  return out;
}

/** Plan today's reminders as scheduled financial messages. Idempotent: one message per invoice, kind and sequence number. */
export async function planFinancialReminders(admin: Db, now: Date, out: Record<string, number>) {
  for (const { book, rules } of await activeBooks(admin)) {
    const bookId = String(book.id);
    try {
      const local = localNow(now, String(book.timezone ?? "America/Chicago"));
      if (local.hour < SEND_HOUR) continue;
      const { data: invs } = await admin.from("fin_invoice_balances_v").select("invoice_id, due_date, balance").eq("book_id", bookId).eq("status", "issued").gt("balance", 0).not("due_date", "is", null).limit(2000);
      const open = (invs ?? []) as Row[];
      if (!open.length) continue;
      const { data: prior } = await admin.from("comm_messages").select("fin_invoice_id, fin_template_kind, status, attempts, created_at, sent_at")
        .eq("fin_book_id", bookId).eq("kind", "financial").eq("automation", true).in("fin_invoice_id", open.map((i) => String(i.invoice_id)))
        .in("status", [...COUNTED_STATUSES]).limit(10000);
      const acct = await accountFor(admin, book);
      for (const i of open) {
        const iid = String(i.invoice_id);
        const mine = ((prior ?? []) as Row[]).filter((m) => m.fin_invoice_id === iid);
        const sentByKind: Partial<Record<ReminderKind, number>> = {};
        let lastSentOn: string | null = null;
        for (const m of mine) {
          const k = m.fin_template_kind as ReminderKind;
          sentByKind[k] = (sentByKind[k] ?? 0) + 1;
          const on = localNow(new Date(String(m.sent_at ?? m.created_at)), String(book.timezone ?? "America/Chicago")).date;
          if (!lastSentOn || on > lastSentOn) lastSentOn = on;
        }
        const plan = reminderToPlan(rules, { dueDate: day(i.due_date), balance: Number(i.balance), sentByKind, lastSentOn }, local.date);
        if (!plan) continue;
        const { data: why } = await admin.rpc("fin_reminder_suppressed", { p_invoice_id: iid, p_kind: plan.kind });
        if (why) continue;
        const mail = await renderInvoiceReminder(admin, bookId, iid, plan.kind);
        if (!mail?.toEmail) { out.reminderNoEmail = (out.reminderNoEmail ?? 0) + 1; continue; }
        const { data: invRow } = await admin.from("fin_invoices").select("customer_id, job_id").eq("id", iid).maybeSingle();
        const { data: job } = (invRow as Row | null)?.job_id ? await admin.from("fin_jobs").select("estimate_id").eq("id", String((invRow as Row).job_id)).maybeSingle() : { data: null };
        const { data: ins, error } = await admin.from("comm_messages").upsert({
          account_id: acct.accountId, kind: "financial", trigger: "financial", customer_id: (invRow as Row | null)?.customer_id ?? null,
          estimate_id: (job as Row | null)?.estimate_id ?? null, to_email: mail.toEmail, to_name: mail.toName.slice(0, 200), subject: mail.subject.slice(0, 300),
          body_text: mail.body, content: { templateKind: plan.kind, sequence: plan.sequence, automatic: true }, status: "scheduled", scheduled_for: now.toISOString(),
          automation: true, idempotency_key: `fr:${iid}:${plan.kind}:${plan.sequence}:${local.date}`, fin_book_id: bookId, fin_invoice_id: iid,
          fin_template_kind: plan.kind, fin_tone: mail.tone, fin_fields_hash: mail.fieldsHash,
        }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
        if (error) { logError("fin.reminders.insert", error, { book: bookId }); continue; }
        if (ins?.length) out.remindersPlanned = (out.remindersPlanned ?? 0) + 1;
      }
    } catch (e) { logError("fin.reminders.plan", e, { book: bookId }); }
  }
}

/**
 * Last check right before sending: the rule is still on, the plan is active and the invoice still owes
 * money (not paid, void or disputed). Returns the fresh wording, or the reason to cancel.
 */
export async function prepareFinancialReminder(admin: Db, m: Row, now: Date = new Date()): Promise<{ ok: true; mail: InvoiceEmail } | { ok: false; reason: string }> {
  const bookId = String(m.fin_book_id ?? ""), invoiceId = String(m.fin_invoice_id ?? ""), kind = m.fin_template_kind as ReminderKind;
  if (!m.automation || !REMINDER_KINDS.includes(kind) || !invoiceId) return { ok: false, reason: "Only automatic payment reminders are sent by Built2Bid" };
  const { data: ent } = await admin.rpc("fin_entitlement", { p_book_id: bookId });
  const e = (Array.isArray(ent) ? ent[0] : ent) as Row | null;
  if (!e?.active || e.read_only) return { ok: false, reason: "Financials plan isn't active" };
  const { data: why } = await admin.rpc("fin_reminder_suppressed", { p_invoice_id: invoiceId, p_kind: kind });
  if (why) {
    const label: Record<string, string> = { rule_off: "Reminders were turned off", paid: "Invoice is paid", void: "Invoice was voided", disputed: "Invoice is disputed", not_issued: "Invoice isn't issued", not_found: "Invoice not found" };
    return { ok: false, reason: label[String(why)] ?? "Reminder no longer needed" };
  }
  if (kind === "balance_reminder") {
    const [{ data: inv }, { data: book }] = await Promise.all([
      admin.from("fin_invoices").select("due_date").eq("id", invoiceId).maybeSingle(),
      admin.from("fin_books").select("timezone").eq("id", bookId).maybeSingle(),
    ]);
    const due = (inv as Row | null)?.due_date ? day((inv as Row).due_date) : null;
    if (due && localNow(now, String((book as Row | null)?.timezone ?? "America/Chicago")).date > due) return { ok: false, reason: "Invoice is now past due; the past-due reminder takes over" };
  }
  const mail = await renderInvoiceReminder(admin, bookId, invoiceId, kind);
  if (!mail) return { ok: false, reason: "Invoice not found" };
  if (!mail.toEmail) return { ok: false, reason: "No customer email address" };
  return { ok: true, mail };
}
