import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { fail, logError } from "@/lib/http/api";
import { ReceiptPdf, type ReceiptPdfData } from "@/lib/pdf/receipt-pdf";
import type { PdfBranding } from "./branding";

const PRIVATE = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

/** Renders a receipt PDF. Reading it never changes the payment (no status, no "sent" flag). */
export async function receiptResponse(d: ReceiptPdfData, brand: PdfBranding, fileStem: string, download: boolean): Promise<Response> {
  let pdf: Buffer;
  try {
    pdf = await renderToBuffer(createElement(ReceiptPdf, { d, logo: brand.logo }) as React.ReactElement<DocumentProps>);
  } catch (e) {
    logError("fin.receipt-pdf", e);
    return fail(500, "pdf_failed", "We couldn't create the PDF. Please try again.");
  }
  const name = `${fileStem.replace(/[^\w-]/g, "")}.pdf`;
  return new Response(new Uint8Array(pdf), { headers: { ...PRIVATE, "content-type": "application/pdf", "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"` } });
}
