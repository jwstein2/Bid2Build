import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, logError } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { rowToBusiness } from "@/lib/data/mappers";
import { InvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice-pdf";

export const runtime = "nodejs";
const PRIVATE = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Customer invoice PDF for an issued (or voided) invoice. Every record is read with the signed-in user's
 * client, so RLS decides whether they can see this invoice at all. Only customer-safe fields are passed to
 * the renderer: invoice lines, totals, frozen bill-to, applied payments, contract total. The admin client
 * is used only to read the company's public branding (name, contact, logo).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-invoice-pdf", limit: 120 });
  if ("error" in g) return g.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Invoice not found.");
  const { db, bookId } = g;
  const { data: inv } = await db.from("fin_invoices").select("id, book_id, job_id, number, kind, status, issue_date, due_date, bill_to, memo, tax_rate, subtotal, tax, total").eq("id", id).eq("book_id", bookId).maybeSingle();
  const i = inv as Row | null;
  if (!i) return fail(404, "not_found", "Invoice not found.");
  if (i.status === "draft") return fail(409, "draft", "Issue the invoice first. Drafts don't have a customer PDF.");
  const [{ data: lines }, { data: bal }, { data: job }, { data: allocs }, { data: contract }, { data: book }] = await Promise.all([
    db.from("fin_invoice_lines").select("description, quantity, unit_price, amount").eq("invoice_id", id).order("line_no"),
    db.from("fin_invoice_balances_v").select("paid, credited, balance").eq("invoice_id", id).maybeSingle(),
    db.from("fin_jobs").select("id, job_number, name, estimate_id").eq("id", s(i.job_id)).maybeSingle(),
    db.from("fin_payment_allocations").select("amount, payment_id, reversed_at").eq("invoice_id", id).is("reversed_at", null),
    db.from("fin_job_summary_v").select("contract_value, invoiced, collected").eq("job_id", s(i.job_id)).maybeSingle(),
    db.from("fin_books").select("company_id, owner_user_id").eq("id", bookId).maybeSingle(),
  ]);
  const payIds = ((allocs ?? []) as Row[]).map((a) => s(a.payment_id));
  const { data: pays } = payIds.length ? await db.from("fin_payments").select("id, received_on, method").in("id", payIds) : { data: [] as Row[] };

  const admin = createAdminClient();
  const b = book as Row | null;
  let ownerId = s(b?.owner_user_id);
  if (!ownerId && b?.company_id) {
    const { data: co } = await admin.from("companies").select("owner_user_id").eq("id", s(b.company_id)).maybeSingle();
    ownerId = s(co?.owner_user_id);
  }
  const { data: bizRow } = ownerId ? await admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle() : { data: null };
  const biz = rowToBusiness(bizRow);
  let logo: { data: Buffer; format: "png" } | null = null;
  if (biz.logoPath) {
    const { data: file } = await admin.storage.from("logos").download(biz.logoPath);
    if (file) logo = { data: Buffer.from(await file.arrayBuffer()), format: "png" };
  }
  const { data: est } = job ? await db.from("estimates").select("project_address").eq("id", s((job as Row).estimate_id)).maybeSingle() : { data: null };
  const billTo = (i.bill_to ?? {}) as Row;
  const c = contract as Row | null;
  const d: InvoicePdfData = {
    company: { name: biz.companyName || "Your contractor", phone: biz.phone, email: biz.email, address: biz.address, website: biz.website, license: biz.licenseNumber, color: biz.primaryColor },
    invoice: { number: s(i.number), issueDate: s(i.issue_date), dueDate: s(i.due_date), kind: s(i.kind), memo: (i.memo as string | null) ?? null, status: i.status === "void" ? "void" : "issued" },
    project: { name: s((job as Row | null)?.name), jobNumber: s((job as Row | null)?.job_number), address: (est as Row | null)?.project_address as string | null ?? s(billTo.address) },
    billTo: { name: s(billTo.name), email: s(billTo.email), phone: s(billTo.phone), address: s(billTo.address) },
    lines: ((lines ?? []) as Row[]).map((l) => ({ description: s(l.description), quantity: s(l.quantity), unitPrice: s(l.unit_price), amount: s(l.amount) })),
    subtotal: s(i.subtotal), tax: s(i.tax), taxRate: s(i.tax_rate), total: s(i.total),
    paid: s((bal as Row | null)?.paid) || "0", credited: s((bal as Row | null)?.credited) || "0", balance: s((bal as Row | null)?.balance) || "0",
    payments: ((allocs ?? []) as Row[]).map((a) => { const p = ((pays ?? []) as Row[]).find((x) => x.id === a.payment_id); return { date: s(p?.received_on), method: s(p?.method), amount: s(a.amount) }; }),
    contract: c ? { current: s(c.contract_value), invoicedToDate: s(c.invoiced), paidToDate: s(c.collected) } : null,
  };
  let pdf: Buffer;
  try {
    pdf = await renderToBuffer(createElement(InvoicePdf, { d, logo }) as React.ReactElement<DocumentProps>);
  } catch (e) {
    logError("fin.invoice-pdf", e);
    return fail(500, "pdf_failed", "We couldn't create the PDF. Please try again.");
  }
  const name = `Invoice_${s(i.number).replace(/[^\w-]/g, "")}.pdf`;
  return new Response(new Uint8Array(pdf), { headers: { ...PRIVATE, "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"` } });
}
