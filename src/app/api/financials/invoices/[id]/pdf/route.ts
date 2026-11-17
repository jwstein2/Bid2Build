import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { fail, logError } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { loadInvoiceDoc } from "@/lib/financials/invoice-doc";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

export const runtime = "nodejs";
const PRIVATE = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

/** Customer invoice PDF for an issued (or voided) invoice. Data and access rules: loadInvoiceDoc. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-invoice-pdf", limit: 120 });
  if ("error" in g) return g.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Invoice not found.");
  const doc = await loadInvoiceDoc(g.db, g.bookId, id);
  if (doc.status === "not_found") return fail(404, "not_found", "Invoice not found.");
  if (doc.status !== "ok") return fail(409, "draft", "Issue the invoice first. Drafts don't have a customer PDF.");
  let pdf: Buffer;
  try {
    pdf = await renderToBuffer(createElement(InvoicePdf, { d: doc.d, logo: doc.logo }) as React.ReactElement<DocumentProps>);
  } catch (e) {
    logError("fin.invoice-pdf", e);
    return fail(500, "pdf_failed", "We couldn't create the PDF. Please try again.");
  }
  const name = `Invoice_${doc.number.replace(/[^\w-]/g, "")}.pdf`;
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(pdf), { headers: { ...PRIVATE, "content-type": "application/pdf", "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"` } });
}
