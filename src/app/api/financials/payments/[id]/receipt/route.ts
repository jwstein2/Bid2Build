import { fail } from "@/lib/http/api";
import { finGuard } from "@/lib/financials/api";
import { loadBranding } from "@/lib/financials/branding";
import { receiptResponse } from "@/lib/financials/receipt-response";

export const runtime = "nodejs";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Customer payment receipt for a recorded payment. RLS (the signed-in user's client) decides whether the
 * payment is visible at all. A voided payment has no receipt: it no longer counts as money received.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await finGuard({ write: false, limitKey: "fin-receipt-pdf", limit: 120 });
  if ("error" in g) return g.error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "Payment not found.");
  const { db, bookId } = g;
  const { data: pay } = await db.from("fin_payments").select("id, number, received_on, method, reference, amount, status, customer_id, job_id").eq("id", id).eq("book_id", bookId).maybeSingle();
  const p = pay as Row | null;
  if (!p) return fail(404, "not_found", "Payment not found.");
  if (p.status !== "active") return fail(409, "void", "This payment was voided, so there is no receipt for it.");
  const [{ data: allocs }, { data: cust }, { data: job }, { data: pb }] = await Promise.all([
    db.from("fin_payment_allocations").select("invoice_id, amount").eq("payment_id", id).is("reversed_at", null),
    p.customer_id ? db.from("customers").select("name, email, phone, project_address").eq("id", s(p.customer_id)).maybeSingle() : Promise.resolve({ data: null }),
    p.job_id ? db.from("fin_jobs").select("job_number, name, estimate_id").eq("id", s(p.job_id)).maybeSingle() : Promise.resolve({ data: null }),
    db.from("fin_payment_balances_v").select("unapplied, refunded").eq("payment_id", id).maybeSingle(),
  ]);
  const invIds = ((allocs ?? []) as Row[]).map((a) => s(a.invoice_id));
  const [{ data: invs }, { data: bals }] = invIds.length
    ? await Promise.all([
      db.from("fin_invoices").select("id, number, kind").in("id", invIds),
      db.from("fin_invoice_balances_v").select("invoice_id, balance").in("invoice_id", invIds),
    ])
    : [{ data: [] as Row[] }, { data: [] as Row[] }];
  const applied = ((allocs ?? []) as Row[]).map((a) => {
    const inv = ((invs ?? []) as Row[]).find((x) => x.id === a.invoice_id);
    const bal = ((bals ?? []) as Row[]).find((x) => x.invoice_id === a.invoice_id);
    return { label: `Invoice ${s(inv?.number)}`, amount: s(a.amount), balanceNow: bal ? s(bal.balance) : null };
  });
  // Unapplied net of refunds, from the same view the app uses (never recomputed here).
  const unapplied = s((pb as Row | null)?.unapplied) || "0";
  const c = cust as Row | null, j = job as Row | null;
  const brand = await loadBranding(db, bookId);
  return receiptResponse({
    kind: "customer",
    company: brand.company,
    receipt: { number: s(p.number), date: s(p.received_on), method: s(p.method), reference: (p.reference as string | null) ?? null, amount: s(p.amount), memo: null },  // the payment memo is an internal note: never printed
    party: { name: s(c?.name) || "Customer", email: s(c?.email) || undefined, phone: s(c?.phone) || undefined, address: s(c?.project_address) || undefined },
    project: j ? { name: s(j.name), jobNumber: s(j.job_number) } : null,
    appliedTo: applied,
    unapplied,
  }, brand, `Receipt_${s(p.number)}`, new URL(req.url).searchParams.get("download") === "1");
}
