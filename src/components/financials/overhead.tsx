"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { finAction, newKey, today, usd } from "./fin-client";
import { OVERHEAD_CATEGORIES, RECURRENCE_LABEL, type OverheadCategory, type Recurrence } from "@/lib/financials/overhead";

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const toMoney = (v: string) => (MONEY.test(v.trim()) ? v.trim() : "");

export interface OverheadPrefill { vendorId?: string; payee?: string; category?: OverheadCategory; description?: string; amount?: string; dueDate?: string; recurringEventId?: string; label?: string }

async function upload(file: File): Promise<{ id: string } | { error: string }> {
  const fd = new FormData(); fd.set("file", file); fd.set("kind", "vendor_bill");
  const res = await fetch("/api/financials/documents", { method: "POST", body: fd }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  return res?.ok ? { id: body.documentId as string } : { error: (body?.error?.message ?? body.message ?? "We couldn't upload the file.") as string };
}

/** Add an overhead bill or expense: company costs that don't belong to a customer project. */
export function OverheadForm({ vendors, prefill, canPlan, onCancel }: { vendors: { id: string; name: string }[]; prefill?: OverheadPrefill | null; canPlan: boolean; onCancel?: () => void }) {
  const router = useRouter();
  const blank = {
    vendorId: prefill?.vendorId ?? "", payee: prefill?.payee ?? "", category: (prefill?.category ?? "rent_utilities") as OverheadCategory, description: prefill?.description ?? "",
    amount: prefill?.amount ?? "", billDate: today(), dueDate: prefill?.dueDate ?? "", reference: "", payment: "unpaid" as "unpaid" | "partial" | "paid", paidAmount: "",
    paidOn: today(), method: "card", recurrence: "none" as Recurrence,
  };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [key, setKey] = useState(newKey);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const newVendor = f.vendorId === "";

  const save = async () => {
    setMsg(null);
    if (newVendor && !f.payee.trim()) return setMsg({ tone: "danger", text: "Enter who the bill is from." });
    const amount = toMoney(f.amount);
    if (!amount || Number(amount) <= 0) return setMsg({ tone: "danger", text: "Enter the amount." });
    if (f.payment === "partial" && (!toMoney(f.paidAmount) || Number(f.paidAmount) >= Number(amount))) return setMsg({ tone: "danger", text: "Enter how much was paid (less than the total)." });
    setBusy(true);
    let documentId: string | undefined;
    if (file) { const up = await upload(file); if ("error" in up) { setBusy(false); return setMsg({ tone: "danger", text: up.error }); } documentId = up.id; }
    const res = await fetch("/api/financials/overhead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, p: {
      ...(newVendor ? { payee: f.payee.trim() } : { vendorId: f.vendorId }), category: f.category, description: f.description.trim() || undefined, amount,
      billDate: f.billDate, dueDate: f.dueDate || undefined, reference: f.reference.trim() || undefined, documentId, payment: f.payment,
      paidAmount: f.payment === "partial" ? toMoney(f.paidAmount) : undefined, paidOn: f.payment === "unpaid" ? undefined : f.paidOn, method: f.payment === "unpaid" ? undefined : f.method,
      recurrence: prefill?.recurringEventId ? "none" : f.recurrence, recurringEventId: prefill?.recurringEventId,
    } }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setMsg({ tone: "danger", text: (body?.error?.message as string | undefined) ?? "We couldn't save it. Nothing was changed." });
    const parts = [`Saved bill ${body.number}.`];
    if (!body.approved) parts.push("It's waiting for approval and shows in cash flow once approved.");
    else if (body.paid) parts.push(f.payment === "paid" ? "Marked paid." : `Recorded ${usd(body.paid)} paid.`);
    else parts.push("It's in your cash-flow forecast by its due date.");
    if (body.recurring === "added") parts.push("Future dates are in the cash-flow forecast.");
    if (body.recurring === "advanced") parts.push("The recurring plan moved to its next date.");
    if (body.recurring === "not_allowed") parts.push("Your role can't add planned cash events, so future dates weren't added to the forecast.");
    setMsg({ tone: "ok", text: parts.join(" ") });
    setF(blank); setFile(null); setKey(newKey());
    router.refresh();
  };

  return (
    <form id={prefill ? undefined : "add"} className="scroll-mt-4 space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="overhead-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold">{prefill?.label ? `Enter this bill: ${prefill.label}` : "Add an overhead bill or expense"}</h2>
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
      <p className="text-sm text-ink-soft">For company costs that don&apos;t belong to a customer project. They count as overhead in Profit &amp; Loss, and unpaid bills show in your cash-flow forecast by due date. No bank connection needed.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="label" htmlFor="oh-vendor">Paid to
          <select id="oh-vendor" className="field mt-1" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
            <option value="">New payee…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        {newVendor && <label className="label" htmlFor="oh-payee">Payee name<input id="oh-payee" className="field mt-1" maxLength={200} value={f.payee} onChange={(e) => set({ payee: e.target.value })} placeholder="e.g. Main St Properties" /></label>}
        <label className="label" htmlFor="oh-cat">Category
          <select id="oh-cat" className="field mt-1" value={f.category} onChange={(e) => set({ category: e.target.value as OverheadCategory })}>
            {OVERHEAD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="label" htmlFor="oh-desc">What it&apos;s for <span className="font-normal text-muted">(optional)</span><input id="oh-desc" className="field mt-1" maxLength={400} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Office rent, December" /></label>
        <label className="label" htmlFor="oh-amt">Amount<input id="oh-amt" required inputMode="decimal" className="field mt-1" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" /></label>
        <label className="label" htmlFor="oh-date">Bill date<input id="oh-date" required type="date" className="field mt-1" value={f.billDate} onChange={(e) => set({ billDate: e.target.value })} /></label>
        <label className="label" htmlFor="oh-due">Due date <span className="font-normal text-muted">(optional)</span><input id="oh-due" type="date" min={f.billDate} className="field mt-1" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></label>
        <label className="label" htmlFor="oh-ref">Bill or invoice # <span className="font-normal text-muted">(optional)</span><input id="oh-ref" className="field mt-1" maxLength={80} value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></label>
        <label className="label" htmlFor="oh-pay">Paid?
          <select id="oh-pay" className="field mt-1" value={f.payment} onChange={(e) => set({ payment: e.target.value as typeof f.payment })} data-testid="overhead-payment">
            <option value="unpaid">Not paid yet</option><option value="partial">Partly paid</option><option value="paid">Paid in full</option>
          </select>
        </label>
        {f.payment === "partial" && <label className="label" htmlFor="oh-paid">Amount paid<input id="oh-paid" inputMode="decimal" className="field mt-1" value={f.paidAmount} onChange={(e) => set({ paidAmount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" /></label>}
        {f.payment !== "unpaid" && <>
          <label className="label" htmlFor="oh-paidon">Paid on<input id="oh-paidon" type="date" className="field mt-1" value={f.paidOn} onChange={(e) => set({ paidOn: e.target.value })} /></label>
          <label className="label" htmlFor="oh-method">Paid by
            <select id="oh-method" className="field mt-1" value={f.method} onChange={(e) => set({ method: e.target.value })}>
              <option value="card">Card</option><option value="ach">ACH / bank transfer</option><option value="check">Check</option><option value="cash">Cash</option><option value="wire">Wire</option><option value="other">Other</option>
            </select>
          </label>
        </>}
        {!prefill?.recurringEventId && (
          <label className="label" htmlFor="oh-rec">Repeats
            <select id="oh-rec" className="field mt-1" value={f.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })} data-testid="overhead-recurrence">
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
            </select>
          </label>
        )}
        <label className="label sm:col-span-2" htmlFor="oh-file">Bill or receipt <span className="font-normal text-muted">(optional photo or PDF)</span>
          <input id="oh-file" type="file" accept="image/*,application/pdf" className="field mt-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {f.recurrence !== "none" && !prefill?.recurringEventId && (
        <p className="flex items-start gap-1.5 text-xs text-muted"><Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {canPlan ? "Future dates go into the cash-flow forecast as planned costs. Enter each actual bill when it arrives and the plan moves to the next date, so nothing is counted twice." : "Your role can record the bill, but adding future dates to the cash-flow forecast needs a role with cash planning."}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy} data-testid="overhead-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Save</Button>
        <span className="text-xs text-muted">Records the cost only. Nothing is paid or sent from Built2Bid.</span>
      </div>
      {msg && <p role="status" className={msg.tone === "ok" ? "rounded-md bg-ok-tint px-3 py-2 text-sm text-ok" : "rounded-md bg-danger-tint px-3 py-2 text-sm text-danger"}>{msg.text}</p>}
    </form>
  );
}

/** Record a payment made outside Built2Bid on an approved bill (full balance by default, or part of it). */
export function PayBill({ billId, balance }: { billId: string; balance: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState("card");
  const [paidOn, setPaidOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(newKey);
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid={`pay-${billId}`}>Record payment</Button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      if (!MONEY.test(amount) || Number(amount) <= 0 || Number(amount) > Number(balance)) return setErr(`Enter up to ${usd(balance)}.`);
      setBusy(true);
      const r = await finAction({ action: "pay_bill", key, p: { billId, amount, method, paidOn } });
      setBusy(false);
      if (!r.ok) return setErr(r.message);
      setOpen(false); router.refresh();
    }}>
      <label className="text-xs font-semibold text-ink-soft">Amount<input inputMode="decimal" className="field field-sm mt-1 w-28" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <label className="text-xs font-semibold text-ink-soft">Paid on<input type="date" className="field field-sm mt-1" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
      <label className="text-xs font-semibold text-ink-soft">By<select className="field field-sm mt-1" value={method} onChange={(e) => setMethod(e.target.value)}><option value="card">Card</option><option value="ach">ACH</option><option value="check">Check</option><option value="cash">Cash</option><option value="wire">Wire</option><option value="other">Other</option></select></label>
      <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </form>
  );
}

/** Approve a bill waiting for approval (roles with bill approval only; the server re-checks). */
export function ApproveBill({ billId }: { billId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setErr(null); const r = await finAction({ action: "approve_bill", billId }); setBusy(false); if (!r.ok) setErr(r.message); else router.refresh(); }}>Approve</Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

/** "Enter this bill" for a recurring overhead cost: opens the form prefilled for this period. */
export function RecurringEnter({ prefill, vendors, canPlan }: { prefill: OverheadPrefill; vendors: { id: string; name: string }[]; canPlan: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid={`enter-${prefill.recurringEventId}`}>Enter this bill</Button>;
  return <div className="mt-2 basis-full"><OverheadForm vendors={vendors} prefill={prefill} canPlan={canPlan} onCancel={() => setOpen(false)} /></div>;
}
