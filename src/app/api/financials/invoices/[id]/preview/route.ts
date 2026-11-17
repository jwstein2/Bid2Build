import { fail, json } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { loadInvoiceDoc } from "@/lib/financials/invoice-doc";

export const runtime = "nodejs";

/** The same customer-facing invoice the PDF shows, as JSON for the in-app preview window. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-invoice-pdf", limit: 120 });
  if ("error" in g) return g.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Invoice not found.");
  const doc = await loadInvoiceDoc(g.db, g.bookId, id);
  if (doc.status === "not_found") return fail(404, "not_found", "Invoice not found.");
  if (doc.status !== "ok") return fail(409, "draft", "Issue the invoice first. Drafts don't have a customer preview.");
  const logo = doc.logo ? `data:image/${doc.logo.format};base64,${doc.logo.data.toString("base64")}` : null;
  const res = json({ invoice: doc.d, logo });
  res.headers.set("cache-control", "private, no-store, max-age=0");
  return res;
}
