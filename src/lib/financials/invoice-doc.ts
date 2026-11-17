import type { InvoicePdfData } from "@/lib/pdf/invoice-pdf";
import { loadBranding, type PdfBranding } from "./branding";

type Row = Record<string, unknown>;
type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export type InvoiceDoc =
  | { status: "ok"; d: InvoicePdfData; logo: PdfBranding["logo"]; number: string }
  | { status: "not_found" | "draft" };

/**
 * The customer-facing invoice (what the PDF and the in-app preview show). Every record is read with the
 * signed-in user's client, so RLS decides whether they can see this invoice at all. Only customer-safe
 * fields: lines, totals, frozen bill-to, applied payments, contract totals. No costs or margins.
 */
export async function loadInvoiceDoc(db: Db, bookId: string, id: string): Promise<InvoiceDoc> {
  const { data: inv } = await db.from("fin_invoices").select("id, book_id, job_id, number, kind, status, issue_date, due_date, bill_to, memo, tax_rate, subtotal, tax, total").eq("id", id).eq("book_id", bookId).maybeSingle();
  const i = inv as Row | null;
  if (!i) return { status: "not_found" };
  if (i.status === "draft") return { status: "draft" };
  const [{ data: lines }, { data: bal }, { data: job }, { data: allocs }, { data: contract }, brand] = await Promise.all([
    db.from("fin_invoice_lines").select("description, quantity, unit_price, amount").eq("invoice_id", id).order("line_no"),
    db.from("fin_invoice_balances_v").select("paid, credited, balance").eq("invoice_id", id).maybeSingle(),
    db.from("fin_jobs").select("id, job_number, name, estimate_id").eq("id", s(i.job_id)).maybeSingle(),
    db.from("fin_payment_allocations").select("amount, payment_id, reversed_at").eq("invoice_id", id).is("reversed_at", null),
    db.from("fin_job_summary_v").select("contract_value, invoiced, collected").eq("job_id", s(i.job_id)).maybeSingle(),
    loadBranding(db, bookId),
  ]);
  const payIds = ((allocs ?? []) as Row[]).map((a) => s(a.payment_id));
  const { data: pays } = payIds.length ? await db.from("fin_payments").select("id, received_on, method").in("id", payIds) : { data: [] as Row[] };
  const { data: est } = job ? await db.from("estimates").select("project_address").eq("id", s((job as Row).estimate_id)).maybeSingle() : { data: null };
  const billTo = (i.bill_to ?? {}) as Row;
  const c = contract as Row | null;
  const d: InvoicePdfData = {
    company: brand.company,
    invoice: { number: s(i.number), issueDate: s(i.issue_date), dueDate: s(i.due_date), kind: s(i.kind), memo: (i.memo as string | null) ?? null, status: i.status === "void" ? "void" : "issued" },
    project: { name: s((job as Row | null)?.name), jobNumber: s((job as Row | null)?.job_number), address: ((est as Row | null)?.project_address as string | null) ?? s(billTo.address) },
    billTo: { name: s(billTo.name), email: s(billTo.email), phone: s(billTo.phone), address: s(billTo.address) },
    lines: ((lines ?? []) as Row[]).map((l) => ({ description: s(l.description), quantity: s(l.quantity), unitPrice: s(l.unit_price), amount: s(l.amount) })),
    subtotal: s(i.subtotal), tax: s(i.tax), taxRate: s(i.tax_rate), total: s(i.total),
    paid: s((bal as Row | null)?.paid) || "0", credited: s((bal as Row | null)?.credited) || "0", balance: s((bal as Row | null)?.balance) || "0",
    payments: ((allocs ?? []) as Row[]).map((a) => { const p = ((pays ?? []) as Row[]).find((x) => x.id === a.payment_id); return { date: s(p?.received_on), method: s(p?.method), amount: s(a.amount) }; }),
    contract: c ? { current: s(c.contract_value), invoicedToDate: s(c.invoiced), paidToDate: s(c.collected) } : null,
  };
  return { status: "ok", d, logo: brand.logo, number: s(i.number) };
}
