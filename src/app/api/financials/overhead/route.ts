import { z } from "zod";
import { json } from "@/lib/http/api";
import { finFail, finGuard } from "@/lib/financials/api";
import * as fin from "@/lib/financials/server";
import { autoReference, nextOccurrence, overheadCategoryLabel, overheadLine, recurringNote, OVERHEAD_CATEGORIES, type OverheadCategory } from "@/lib/financials/overhead";

export const runtime = "nodejs";

/**
 * Record a business overhead cost (no customer project) in one step. Built only from the existing Financials
 * RPCs, each re-checking the caller's financial permissions with their own client:
 *   vendor (found or added) → vendor bill with project-less lines → approve (if the role may) → payment (if paid
 *   or partly paid) → recurring plan in the cash-flow forecast (if it repeats).
 * Nothing is paid at a bank and no email is sent: a payment here records money already paid outside Built2Bid.
 */
const id = z.string().uuid();
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const categories = OVERHEAD_CATEGORIES.map((c) => c.key) as [OverheadCategory, ...OverheadCategory[]];

const body = z.object({
  key: z.string().min(8).max(100),
  p: z.object({
    vendorId: id.optional(),
    payee: text(200).optional(),
    category: z.enum(categories),
    description: text(400).optional(),
    amount,
    billDate: day,
    dueDate: day.optional(),
    reference: text(80).optional(),
    documentId: id.optional(),
    payment: z.enum(["unpaid", "partial", "paid"]),
    paidAmount: amount.optional(),
    paidOn: day.optional(),
    method: z.enum(["check", "ach", "card", "cash", "wire", "other"]).optional(),
    recurrence: z.enum(["none", "weekly", "biweekly", "monthly"]),
    /** Entering this period's bill for an existing recurring cost: that plan moves to its next date. */
    recurringEventId: id.optional(),
  }).refine((p) => p.vendorId || p.payee, { message: "payee" })
    .refine((p) => !p.dueDate || p.dueDate >= p.billDate, { message: "due" })
    .refine((p) => p.payment !== "partial" || (p.paidAmount && Number(p.paidAmount) > 0 && Number(p.paidAmount) < Number(p.amount)), { message: "partial" }),
});

export async function POST(req: Request) {
  const g = await finGuard({ write: true, limitKey: "fin-overhead", limit: 120 });
  if ("error" in g) return g.error;
  const { db, bookId } = g;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const why = parsed.error.issues[0]?.message;
    const message = why === "payee" ? "Enter who the bill is from." : why === "due" ? "The due date can't be before the bill date." : why === "partial" ? "For a partly paid bill, enter an amount paid that's less than the total." : "Check the details and try again.";
    return Response.json({ error: { code: "invalid", message } }, { status: 400 });
  }
  const { p, key } = parsed.data;
  try {
    // 1. Vendor: reuse one with the same name (case-insensitive) so overhead doesn't scatter across duplicates.
    let vendorId = p.vendorId ?? null;
    if (!vendorId) {
      const name = p.payee!.trim();
      const { data: same } = await db.from("fin_vendors").select("id, name").eq("book_id", bookId).ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1);
      vendorId = (same as { id: string }[] | null)?.[0]?.id ?? await fin.saveVendor(db, bookId, { name, kind: "other" });
    }

    // 2. The overhead cost code ("General - Overhead") when the book has it; the line is overhead either way (no project).
    const { data: code } = await db.from("fin_cost_codes").select("id").eq("book_id", bookId).eq("code", "general:overhead").eq("active", true).maybeSingle();

    // 3. The bill.
    const due = p.dueDate ?? p.billDate;
    const bill = await fin.recordBill(db, bookId, {
      vendorId, vendorInvoiceNumber: p.reference?.trim() || autoReference(p.billDate), billDate: p.billDate, dueDate: due,
      memo: `Overhead: ${overheadCategoryLabel(p.category)}`, ...(p.documentId ? { documentId: p.documentId } : {}),
      lines: [{ description: overheadLine(p.category, p.description ?? ""), amount: p.amount, ...(code ? { costCodeId: (code as { id: string }).id } : {}) }],
    }, `${key}:bill`);

    // 4. Approve when this role may (otherwise it waits in the approval queue, like any bill).
    let approved = true;
    try { await fin.approveBill(db, bill.billId); } catch (e) {
      if (e instanceof fin.FinError && /forbidden|read_only/.test(e.code)) approved = false; else throw e;
    }

    // 5. Payment already made outside Built2Bid.
    let paidRecorded: string | null = null;
    if (approved && p.payment !== "unpaid") {
      const paid = p.payment === "paid" ? p.amount : p.paidAmount!;
      await fin.payBill(db, bookId, { billId: bill.billId, amount: paid, method: p.method ?? "card", paidOn: p.paidOn ?? p.billDate, memo: "Recorded with the overhead bill" }, `${key}:pay`);
      paidRecorded = paid;
    }

    // 6. Repeating costs: the next dates go into the cash-flow forecast (planned, never paid automatically).
    let recurring: "added" | "advanced" | "not_allowed" | null = null;
    try {
      if (p.recurringEventId) {
        const { data: ev } = await db.from("fin_cash_events").select("id, expected_on, recurrence").eq("id", p.recurringEventId).eq("book_id", bookId).maybeSingle();
        const e = ev as { id: string; expected_on: string; recurrence: "none" | "weekly" | "biweekly" | "monthly" } | null;
        if (e && e.recurrence !== "none") {
          let next = String(e.expected_on).slice(0, 10);
          while (next <= due) next = nextOccurrence(next, e.recurrence);
          await db.rpc("fin_cash_event_save", { p_book_id: bookId, p: { id: e.id, expectedOn: next } }).then(({ error }) => { if (error) throw new fin.FinError(error.message, error.message); });
          recurring = "advanced";
        }
      } else if (p.recurrence !== "none") {
        const label = `${overheadCategoryLabel(p.category)}${p.description ? `: ${p.description}` : ""}`.slice(0, 200);
        const { error } = await db.rpc("fin_cash_event_save", { p_book_id: bookId, p: {
          kind: "recurring_expense", label, amount: p.amount, expectedOn: nextOccurrence(due, p.recurrence), recurrence: p.recurrence, certainty: "scheduled",
          note: recurringNote(p.category, vendorId),
        } });
        if (error) throw new fin.FinError(error.message, error.message);
        recurring = "added";
      }
    } catch (e) {
      // The bill is saved either way; a role that can't edit the cash plan just doesn't get the forecast entry.
      if (e instanceof fin.FinError && /forbidden|read_only/.test(e.code)) recurring = "not_allowed"; else throw e;
    }

    return json({ billId: bill.billId, number: bill.number, approved, paid: paidRecorded, recurring });
  } catch (e) {
    return finFail(e, "financials.overhead");
  }
}
