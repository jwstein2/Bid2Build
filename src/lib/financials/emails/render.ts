/**
 * Deterministic invoice / payment email renderer. Same inputs -> same subject, body and fields hash.
 * The hash covers only the financial facts (amounts, dates, numbers, verification): a draft whose facts
 * changed since rendering is stale and is refused by public.fin_email_queue.
 */
import { createHash } from "node:crypto";
import { formatCurrency } from "@/lib/estimate/money";
import { splitMixed, toMoney } from "../money";
import { defaultTemplate, type Template, type TemplateKind, type Tone } from "./templates";

export interface ScheduleLine { label: string; percent?: string; fixed?: string }

export interface EmailFacts {
  customerName: string;
  companyName: string;
  senderName?: string;
  projectName: string;
  invoiceNumber?: string;
  amountDue?: string;
  dueDate?: string;          // YYYY-MM-DD
  milestone?: string;
  balance?: string;
  contractTotal?: string;
  schedule?: ScheduleLine[];
  payment?: { amount: string; date: string; method: string; verified: boolean };
  creditAmount?: string;
  changeOrder?: string;
  payInstructions?: string;
}

export interface RenderedEmail { subject: string; body: string; fieldsHash: string; tone: Tone; kind: TemplateKind }

const fmt = (m?: string) => (m === undefined ? "" : formatCurrency(toMoney(m)));
const fmtDate = (d?: string) => {
  if (!d) return "";
  const [y, mo, da] = d.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, da)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const firstName = (n: string) => n.trim().split(/\s+/)[0] || "there";

/** Payment schedule lines against the contract: percents / fixed parts, last part absorbs the remainder (Σ = contract). */
export function scheduleLines(contractTotal: string, schedule: readonly ScheduleLine[]): { label: string; amount: string }[] {
  const amounts = splitMixed(contractTotal, schedule.map((s) => (s.fixed !== undefined ? { fixed: s.fixed } : { percent: s.percent ?? "0" })));
  return schedule.map((s, i) => ({ label: s.label, amount: amounts[i] }));
}

/** "We've recorded..." for unverified manual payments; "We've received..." only once verified. Never "confirmed by the bank". */
export function paymentStatusSentence(p: NonNullable<EmailFacts["payment"]>): string {
  const amt = fmt(p.amount);
  const when = fmtDate(p.date);
  return p.verified ? `We've received your payment of ${amt} on ${when}.` : `We've recorded your payment of ${amt} (${p.method}) on ${when}.`;
}

/**
 * "How to pay" for invoice emails: the same instructions the invoice PDF prints, so the email and the
 * attached/linked PDF never disagree. Built only from the company's public contact details.
 */
export function payInstructionsText(company: { name?: string; phone?: string; email?: string }, invoiceNumber?: string): string {
  const name = company.name?.trim() || "us";
  const ref = invoiceNumber ? ` and include invoice number ${invoiceNumber} with your payment` : "";
  const contact = [company.phone?.trim(), company.email?.trim()].filter(Boolean).join(" or ");
  return `How to pay: make payment to ${name}${ref}.${contact ? ` Questions about this invoice? Reach us at ${contact}.` : ""}`;
}

export function canonicalFacts(kind: TemplateKind, f: EmailFacts): string {
  const facts = {
    kind, invoiceNumber: f.invoiceNumber ?? null, amountDue: f.amountDue !== undefined ? toMoney(f.amountDue) : null, dueDate: f.dueDate ?? null,
    balance: f.balance !== undefined ? toMoney(f.balance) : null, contractTotal: f.contractTotal !== undefined ? toMoney(f.contractTotal) : null,
    schedule: f.schedule && f.contractTotal ? scheduleLines(f.contractTotal, f.schedule) : null,
    payment: f.payment ? { amount: toMoney(f.payment.amount), date: f.payment.date, method: f.payment.method, verified: f.payment.verified } : null,
    creditAmount: f.creditAmount !== undefined ? toMoney(f.creditAmount) : null, milestone: f.milestone ?? null, changeOrder: f.changeOrder ?? null,
  };
  return JSON.stringify(facts);
}

export const fieldsHash = (kind: TemplateKind, f: EmailFacts) => createHash("sha256").update(canonicalFacts(kind, f)).digest("hex");

export function render(kind: TemplateKind, tone: Tone, facts: EmailFacts, override?: Template | null): RenderedEmail {
  const t = override ?? defaultTemplate(kind, tone);
  const sched = facts.schedule && facts.contractTotal
    ? scheduleLines(facts.contractTotal, facts.schedule).map((l, i) => {
        const s = facts.schedule![i];
        return `  - ${l.label}${s.percent !== undefined && s.fixed === undefined ? ` (${s.percent}%)` : ""}: ${fmt(l.amount)}`;
      }).join("\n")
    : "";
  const values: Record<string, string> = {
    customer_first_name: firstName(facts.customerName), company_name: facts.companyName, sender_name: facts.senderName ?? facts.companyName,
    project_name: facts.projectName, invoice_number: facts.invoiceNumber ?? "", amount_due: fmt(facts.amountDue), due_date: fmtDate(facts.dueDate),
    milestone: facts.milestone ?? "", schedule: sched, balance: fmt(facts.balance), contract_total: fmt(facts.contractTotal),
    payment_amount: facts.payment ? fmt(facts.payment.amount) : "", payment_date: facts.payment ? fmtDate(facts.payment.date) : "",
    payment_status_sentence: facts.payment ? paymentStatusSentence(facts.payment) : "", credit_amount: fmt(facts.creditAmount),
    change_order: facts.changeOrder ?? "", pay_instructions: facts.payInstructions ?? "",
  };
  const fill = (s: string) => s.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in values ? values[k] : m)).replace(/\n{3,}/g, "\n\n").trim();
  return { subject: fill(t.subject), body: fill(t.body), fieldsHash: fieldsHash(kind, facts), tone, kind };
}
