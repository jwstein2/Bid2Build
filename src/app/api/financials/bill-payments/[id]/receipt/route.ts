import { fail } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { loadBranding } from "@/lib/financials/branding";
import { receiptResponse } from "@/lib/financials/receipt-response";

export const runtime = "nodejs";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Payment record for money paid to a sub or supplier against their bill. Void payments have none. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-receipt-pdf", limit: 120 });
  if ("error" in g) return g.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Payment not found.");
  const { db, bookId } = g;
  const { data: bp } = await db.from("fin_bill_payments").select("id, bill_id, paid_on, method, reference, amount, status, created_at").eq("id", id).eq("book_id", bookId).maybeSingle();
  const p = bp as Row | null;
  if (!p) return fail(404, "not_found", "Payment not found.");
  if (p.status !== "active") return fail(409, "void", "This payment was voided, so there is no payment record for it.");
  const { data: bill } = await db.from("fin_vendor_bills").select("id, number, vendor_id, vendor_invoice_number").eq("id", s(p.bill_id)).maybeSingle();
  const b = bill as Row | null;
  if (!b) return fail(404, "not_found", "Payment not found.");
  const [{ data: vendor }, { data: bal }, { data: siblings }] = await Promise.all([
    db.from("fin_vendors").select("name, email, phone").eq("id", s(b.vendor_id)).maybeSingle(),
    db.from("fin_bill_balances_v").select("balance").eq("bill_id", s(b.id)).maybeSingle(),
    db.from("fin_bill_payments").select("id, created_at").eq("bill_id", s(b.id)).order("created_at"),
  ]);
  const n = Math.max(1, ((siblings ?? []) as Row[]).findIndex((x) => x.id === id) + 1);
  const v = vendor as Row | null;
  const number = `${s(b.number)}-P${n}`;
  const brand = await loadBranding(db, bookId);
  return receiptResponse({
    kind: "vendor",
    company: brand.company,
    receipt: { number, date: s(p.paid_on), method: s(p.method), reference: (p.reference as string | null) ?? null, amount: s(p.amount), memo: null },  // the memo is an internal note: never printed
    party: { name: s(v?.name) || "Vendor", email: s(v?.email) || undefined, phone: s(v?.phone) || undefined },
    appliedTo: [{ label: `Bill ${s(b.number)} (their invoice #${s(b.vendor_invoice_number)})`, amount: s(p.amount), balanceNow: bal ? s((bal as Row).balance) : null }],
  }, brand, `Payment_${number}`, new URL(req.url).searchParams.get("download") === "1");
}
