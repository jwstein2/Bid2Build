"use client";
import { useState } from "react";
import Link from "next/link";
import { FileDown, Paperclip } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Field, Notice } from "@/components/ui/misc";
import { add, cmp, sub, toMoney } from "@/lib/financials/money";
import { BasisBadge } from "./basis";
import { FinDialog } from "./fin-dialog";
import { finAction, fmtDate, newKey, today, usd } from "./fin-client";
import type { Perms, R, VoidTarget } from "./job-billing";
import { FileDrop } from "@/components/ui/file-drop";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** Job profitability: every figure says whether it is Contracted, Estimated, Committed, Actual or Forecast. */
export function ProfitCard({ profit }: { profit: R | null }) {
  if (!profit) return null;
  const hasCost = [profit.estimated_cost, profit.committed_cost, profit.actual_cost].some((v) => cmp(s(v) || "0", 0) !== 0);
  const row = (label: string, v: unknown, basis: string, hint?: string) => (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <span className="text-sm">{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <span className="flex items-center gap-2"><span className="tabular font-semibold">{usd(v)}</span><BasisBadge basis={basis} /></span>
    </div>
  );
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="fin-profit-h" data-testid="fin-profit" data-guide="fin.profit">
      <h2 id="fin-profit-h" className="font-display text-lg font-extrabold">Job profit</h2>
      <div className="mt-2 divide-y divide-line">
        {row("Contract value", profit.contract_value, "Contracted")}
        {row("Estimated cost", profit.estimated_cost, "Estimated", "From the bid's costs when the contract was frozen")}
        {row("Committed, not yet billed", profit.committed_cost, "Committed")}
        {row("Actual cost", profit.actual_cost, "Actual", "Approved bills + approved expenses")}
        {hasCost ? (
          <>
            {row("Estimated profit", profit.estimated_profit, "Estimated")}
            {row("Forecast profit", profit.projected_profit, "Forecast", "Uses actual + committed when that's higher than the estimate")}
            {row("Profit to date", profit.actual_profit_to_date, "Actual", "Invoiced minus actual cost")}
          </>
        ) : <p className="py-2 text-sm text-ink-soft">Not enough cost data to show profit yet.</p>}
      </div>
    </section>
  );
}

/** Budget vs actual by cost code, with the three bases kept apart. */
export function BudgetTable({ budget }: { budget: R[] }) {
  const tot = (k: string) => add(0, ...budget.map((b) => s(b[k]) || "0"));
  return (
    <section id="fin-budget" tabIndex={-1} className="rounded-xl border border-line bg-surface p-4 outline-none" aria-labelledby="fin-budget-h" data-testid="fin-budget" data-guide="fin.budget">
      <h2 id="fin-budget-h" className="font-display text-lg font-extrabold">Original estimate vs forecast vs actual</h2>
      <p className="text-xs text-muted">The estimate is frozen from the signed bid. Forecast = actual + still committed, or the estimate if that&apos;s higher. Cost changes never change the customer&apos;s price; use a change order for that.</p>
      {budget.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No budget or costs on this job yet.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-2 font-semibold">Cost code</th>
                <th className="py-2 pr-2 text-right font-semibold">Estimated <BasisBadge basis="Estimated" /></th>
                <th className="py-2 pr-2 text-right font-semibold">Committed <BasisBadge basis="Committed" /></th>
                <th className="py-2 pr-2 text-right font-semibold">Actual <BasisBadge basis="Actual" /></th>
                <th className="py-2 pr-2 text-right font-semibold">Forecast <BasisBadge basis="Forecast" /></th>
                <th className="py-2 text-right font-semibold">vs estimate</th>
              </tr>
            </thead>
            <tbody>
              {budget.map((b, i) => {
                // Forecast per cost code = the higher of the estimate and actual + still committed (matches fin_job_budget_v).
                const forecast = s(b.forecast) || (cmp(s(b.estimated) || "0", add(s(b.committed) || "0", s(b.actual) || "0")) >= 0 ? s(b.estimated) || "0" : add(s(b.committed) || "0", s(b.actual) || "0"));
                const left = sub(s(b.estimated) || "0", forecast);
                return (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2">{s(b.cost_code_name) || <span className="text-warn">Uncoded</span>}</td>
                    <td className="py-2 pr-2 text-right tabular">{usd(b.estimated)}</td>
                    <td className="py-2 pr-2 text-right tabular">{usd(b.committed)}</td>
                    <td className="py-2 pr-2 text-right tabular">{usd(b.actual)}</td>
                    <td className="py-2 pr-2 text-right tabular">{usd(forecast)}</td>
                    <td className={`py-2 text-right tabular ${cmp(left, 0) < 0 ? "font-semibold text-danger" : ""}`}>{usd(left)}</td>
                  </tr>
                );
              })}
              <tr className="font-bold"><td className="py-2 pr-2">Total</td><td className="py-2 pr-2 text-right tabular">{usd(tot("estimated"))}</td><td className="py-2 pr-2 text-right tabular">{usd(tot("committed"))}</td><td className="py-2 pr-2 text-right tabular">{usd(tot("actual"))}</td><td className="py-2 pr-2 text-right tabular">{usd(tot("forecast"))}</td><td className={`py-2 text-right tabular ${cmp(sub(tot("estimated"), tot("forecast")), 0) < 0 ? "text-danger" : ""}`}>{usd(sub(tot("estimated"), tot("forecast")))}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CostCodeSelect({ id, codes, value, onChange }: { id: string; codes: R[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose later (goes to Needs review)</option>
      {codes.map((c) => <option key={s(c.id)} value={s(c.id)}>{s(c.name)}</option>)}
    </select>
  );
}

/** Upload a receipt to the private financial-documents storage; returns the registered document id. */
async function uploadReceipt(file: File, kind: "receipt" | "vendor_bill"): Promise<{ id: string } | { error: string }> {
  const fd = new FormData(); fd.set("file", file); fd.set("kind", kind);
  const res = await fetch("/api/financials/documents", { method: "POST", body: fd }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  return res?.ok ? { id: body.documentId as string } : { error: body.message ?? "We couldn't upload the file." };
}

export function ExpenseDialog({ open, onOpenChange, jobId, codes, vendors, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; codes: R[]; vendors: R[]; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [payee, setPayee] = useState("");
  const [vendor, setVendor] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("card");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const save = async () => {
    setErr(null);
    if (!MONEY.test(amount) || cmp(amount, 0) <= 0) return setErr("Enter the amount spent.");
    setBusy(true);
    let receiptDocumentId: string | undefined;
    if (file) {
      const up = await uploadReceipt(file, "receipt");
      if ("error" in up) { setBusy(false); return setErr(up.error); }
      receiptDocumentId = up.id;
    }
    const r = await finAction({ action: "record_expense", key, p: { jobId, amount: toMoney(amount), description: desc.trim(), spentOn: date, method, ...(vendor ? { vendorId: vendor } : payee.trim() ? { payee: payee.trim() } : {}), ...(code ? { costCodeId: code } : {}), ...(receiptDocumentId ? { receiptDocumentId } : {}) } });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Record an expense" description="Waits for approval before it counts as an actual cost.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="fin-expense-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" htmlFor="ex-amt"><input id="ex-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} required /></Field>
          <Field label="Date" htmlFor="ex-date"><input id="ex-date" type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></Field>
        </div>
        <Field label="What was it for" htmlFor="ex-desc"><input id="ex-desc" className="field" value={desc} onChange={(e) => setDesc(e.target.value)} required maxLength={500} placeholder="e.g. Deck screws and joist hangers" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" optional htmlFor="ex-vendor">
            <select id="ex-vendor" className="field" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">Not in the list</option>
              {vendors.map((v) => <option key={s(v.id)} value={s(v.id)}>{s(v.name)}</option>)}
            </select>
          </Field>
          {!vendor && <Field label="Paid to" optional htmlFor="ex-payee"><input id="ex-payee" className="field" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} placeholder="e.g. Home Depot" /></Field>}
          <Field label="Cost code" optional htmlFor="ex-code"><CostCodeSelect id="ex-code" codes={codes} value={code} onChange={setCode} /></Field>
          <Field label="Paid with" htmlFor="ex-method">
            <select id="ex-method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
              {[["card", "Company card"], ["cash", "Cash"], ["check", "Check"], ["ach", "Bank transfer"], ["reimbursement", "Paid personally (reimburse)"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <FileDrop className="rounded-lg"><Field label="Receipt" optional htmlFor="ex-file" hint="PDF, JPG, PNG or WebP up to 20 MB. Stored privately; never sent to an AI service.">
          <input id="ex-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field></FileDrop>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button loading={busy} type="submit" disabled={busy} data-testid="fin-expense-save">{busy ? "Saving…" : "Save expense"}</Button>
      </form>
    </FinDialog>
  );
}

export function BillDialog({ open, onOpenChange, jobId, codes, vendors, commitments, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; codes: R[]; vendors: R[]; commitments: R[]; onDone: () => void }) {
  const [vendor, setVendor] = useState(vendors[0] ? s(vendors[0].id) : "");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [code, setCode] = useState("");
  const [commitment, setCommitment] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [due, setDue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const save = async () => {
    setErr(null);
    if (!vendor) return setErr("Add the vendor first (commit a sub quote or record an expense with a vendor).");
    if (!MONEY.test(amount)) return setErr("Enter the bill amount.");
    setBusy(true);
    let documentId: string | undefined;
    if (file) { const up = await uploadReceipt(file, "vendor_bill"); if ("error" in up) { setBusy(false); return setErr(up.error); } documentId = up.id; }
    const c = commitments.find((x) => x.commitment_id === commitment);
    const r = await finAction({ action: "record_bill", key, p: { vendorId: vendor, vendorInvoiceNumber: number.trim(), billDate, ...(due ? { dueDate: due } : {}), ...(documentId ? { documentId } : {}),
      lines: [{ jobId, description: desc.trim() || "Work billed", amount: toMoney(amount), ...(commitment ? { commitmentId: commitment } : {}), ...((code || c?.cost_code_id) ? { costCodeId: code || s(c?.cost_code_id) } : {}) }] } });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Enter a vendor bill" description="Counts as an actual cost once approved.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="bl-vendor">
            <select id="bl-vendor" className="field" value={vendor} onChange={(e) => setVendor(e.target.value)} required>
              {vendors.length === 0 && <option value="">No vendors yet</option>}
              {vendors.map((v) => <option key={s(v.id)} value={s(v.id)}>{s(v.name)}</option>)}
            </select>
          </Field>
          <Field label="Vendor's invoice #" htmlFor="bl-num"><input id="bl-num" className="field" value={number} onChange={(e) => setNumber(e.target.value)} required maxLength={80} /></Field>
          <Field label="Amount" htmlFor="bl-amt"><input id="bl-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} required /></Field>
          <Field label="Against commitment" optional htmlFor="bl-com">
            <select id="bl-com" className="field" value={commitment} onChange={(e) => setCommitment(e.target.value)}>
              <option value="">None</option>
              {commitments.filter((c) => c.status === "open").map((c) => <option key={s(c.commitment_id)} value={s(c.commitment_id)}>{s(c.number)} · {s(c.title)}</option>)}
            </select>
          </Field>
          <Field label="Bill date" htmlFor="bl-date"><input id="bl-date" type="date" className="field" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
          <Field label="Due date" optional htmlFor="bl-due"><input id="bl-due" type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Description" optional htmlFor="bl-desc"><input id="bl-desc" className="field" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></Field>
        <ComplianceNotice vendor={vendors.find((v) => s(v.id) === vendor)} />
        {!commitment && <Field label="Cost code" optional htmlFor="bl-code"><CostCodeSelect id="bl-code" codes={codes} value={code} onChange={setCode} /></Field>}
        <FileDrop className="rounded-lg"><Field label="Bill file" optional htmlFor="bl-file"><input id="bl-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field></FileDrop>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button loading={busy} type="submit" disabled={busy}>{busy ? "Saving…" : "Save bill"}</Button>
      </form>
    </FinDialog>
  );
}

/** Missing paperwork for a subcontractor vendor (W-9 / current insurance). A warning only; payments are never blocked. */
export function ComplianceNotice({ vendor }: { vendor: R | undefined }) {
  const c = vendor?.compliance as R | null | undefined;
  if (!c) return null;
  const expired = Array.isArray(c.expired) ? (c.expired as R[]) : [];
  const missing = [!c.w9OnFile && "no W-9", !c.insuranceOnFile && "no current insurance certificate", expired.length > 0 && `${expired.length} expired document${expired.length === 1 ? "" : "s"}`].filter(Boolean) as string[];
  if (!missing.length) return null;
  return (
    <Notice tone="warn">{s(vendor?.name)} has {missing.join(", ")} on file. You can still save this.{c.resourceId ? <> <Link href={`/projects/team/subs/${s(c.resourceId)}`} className="font-semibold underline">Open their records</Link> to request documents.</> : null}</Notice>
  );
}

/** Turn an accepted subcontractor quote (or a typed amount) into a commitment on this job. */
export function CommitmentDialog({ open, onOpenChange, jobId, codes, vendors, quotes, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; codes: R[]; vendors: R[]; quotes: R[]; onDone: () => void }) {
  const [quote, setQuote] = useState(quotes[0] ? s(quotes[0].id) : "");
  const q = quotes.find((x) => x.id === quote);
  const [title, setTitle] = useState(q ? `${s(q.vendorName)}: ${s(q.itemName)}` : "");
  const [amount, setAmount] = useState(q ? s(q.amount) : "");
  const [vendor, setVendor] = useState("");
  const [vendorName, setVendorName] = useState(q ? s(q.vendorName) : "");
  const [code, setCode] = useState(codes.find((c) => s(c.cost_type) === "subcontractor") ? s(codes.find((c) => s(c.cost_type) === "subcontractor")!.id) : codes[0] ? s(codes[0].id) : "");
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(newKey);
  const pick = (id: string) => {
    setQuote(id);
    const x = quotes.find((y) => y.id === id);
    if (x) { setTitle(`${s(x.vendorName)}: ${s(x.itemName)}`); setAmount(s(x.amount)); setVendorName(s(x.vendorName)); setVendor(""); }
  };
  const save = async () => {
    setErr(null);
    if (!MONEY.test(amount)) return setErr("Enter the committed amount.");
    if (!code) return setErr("Choose a cost code.");
    const matched = vendor || s(vendors.find((v) => q?.resourceId && v.resource_id === q.resourceId)?.id) || "";
    const r = await finAction({ action: "create_commitment", key, p: {
      jobId, costCodeId: code, title: title.trim() || "Subcontract", amount: toMoney(amount), ...(q ? { quoteId: q.id } : {}),
      ...(matched ? { vendorId: matched } : { vendorName: vendorName.trim() || "Subcontractor", ...(q?.resourceId ? { resourceId: q.resourceId } : {}) }),
    } });
    if (!r.ok) return setErr(r.message);
    onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Commit a subcontract" description="Reserves the amount against the budget as Committed until it's billed.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {quotes.length > 0 && (
          <Field label="From an accepted sub quote" htmlFor="cm-quote">
            <select id="cm-quote" className="field" value={quote} onChange={(e) => pick(e.target.value)}>
              <option value="">No quote (type it in)</option>
              {quotes.map((x) => <option key={s(x.id)} value={s(x.id)}>{s(x.vendorName)} · {s(x.itemName)}{x.amount ? ` · ${usd(x.amount)}` : ""}</option>)}
            </select>
          </Field>
        )}
        <Field label="Title" htmlFor="cm-title"><input id="cm-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" htmlFor="cm-amt"><input id="cm-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} required /></Field>
          <Field label="Cost code" htmlFor="cm-code">
            <select id="cm-code" className="field" value={code} onChange={(e) => setCode(e.target.value)} required>
              {codes.map((c) => <option key={s(c.id)} value={s(c.id)}>{s(c.name)}</option>)}
            </select>
          </Field>
          <Field label="Vendor" htmlFor="cm-vendor">
            <select id="cm-vendor" className="field" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">{vendorName ? `New: ${vendorName}` : "New vendor"}</option>
              {vendors.map((v) => <option key={s(v.id)} value={s(v.id)}>{s(v.name)}</option>)}
            </select>
          </Field>
          {!vendor && <Field label="New vendor name" htmlFor="cm-vname"><input id="cm-vname" className="field" value={vendorName} onChange={(e) => setVendorName(e.target.value)} maxLength={200} /></Field>}
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button type="submit">Save commitment</Button>
      </form>
    </FinDialog>
  );
}

/** Record a payment made to a vendor/sub outside Built2Bid. Never more than the bill's open balance. */
export function BillPaymentDialog({ open, onOpenChange, bill, vendors = [], onDone }: { open: boolean; onOpenChange: (o: boolean) => void; bill: R; vendors?: R[]; onDone: () => void }) {
  const [amount, setAmount] = useState(s(bill.balance));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("check");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const save = async () => {
    setErr(null);
    if (!MONEY.test(amount) || cmp(amount, 0) <= 0) return setErr("Enter the amount paid.");
    if (cmp(amount, s(bill.balance) || "0") > 0) return setErr(`That's more than the ${usd(bill.balance)} still owed on this bill.`);
    setBusy(true);
    const r = await finAction({ action: "pay_bill", key, p: { billId: bill.id, amount: toMoney(amount), method, paidOn: date, ...(ref.trim() ? { reference: ref.trim() } : {}) } });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title={`Pay bill ${s(bill.number)}`} description={`${usd(bill.balance)} still owed of ${usd(bill.total)}. This records a payment you made; Built2Bid doesn't send money.`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="fin-bill-pay-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount paid" htmlFor="bp-amt"><input id="bp-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} required /></Field>
          <Field label="Date paid" htmlFor="bp-date"><input id="bp-date" type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Paid with" htmlFor="bp-method">
            <select id="bp-method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="check">Check</option><option value="ach">ACH / bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="wire">Wire</option><option value="other">Other</option>
            </select>
          </Field>
          <Field label="Check # or reference" optional htmlFor="bp-ref"><input id="bp-ref" className="field" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></Field>
        </div>
        <ComplianceNotice vendor={vendors.find((v) => v.id === bill.vendor_id)} />
        {err && <Notice tone="danger">{err}</Notice>}
        <Button loading={busy} type="submit" disabled={busy}>{busy ? "Saving…" : "Record payment"}</Button>
      </form>
    </FinDialog>
  );
}

export function CostLists({ data, perms, writable, onChanged, onPayBill, onVoid }: { onPayBill?: (bill: R) => void; onVoid?: (t: VoidTarget) => void; data: { expenses: R[]; bills: R[]; billLines: R[]; commitments: R[]; costCodes: R[]; vendors: R[] }; perms: Perms; writable: boolean; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const codeName = (id: unknown) => s(data.costCodes.find((c) => c.id === id)?.name) || "Uncoded";
  const vendorName = (id: unknown) => s(data.vendors.find((v) => v.id === id)?.name);
  const act = async (payload: Record<string, unknown>) => { setErr(null); const r = await finAction(payload); if (!r.ok) setErr(r.message); else onChanged(); };
  const statusTone = (st: string) => (st === "approved" ? "ok" : st === "pending" || st === "pending_approval" ? "warn" : "neutral") as "ok" | "warn" | "neutral";
  return (
    <section className="space-y-4" aria-label="Costs" data-testid="fin-costs" data-guide="fin.cost-lists">
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-extrabold">Commitments</h2>
        {data.commitments.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No subcontracts or purchase orders yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {data.commitments.map((c) => (
              <li key={s(c.commitment_id)} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className="font-semibold">{s(c.number)} · {s(c.title)}</span><span className="block text-xs text-muted">{vendorName(c.vendor_id)} · {codeName(c.cost_code_id)} · billed {usd(c.billed)} of {usd(c.current_amount)}</span></span>
                <span className="flex items-center gap-2 tabular">{usd(c.open_committed)} <BasisBadge basis="Committed" /></span>
                {cmp(s(c.billed) || "0", s(c.current_amount) || "0") > 0 && <Badge tone="danger">Over committed</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-extrabold">Expenses</h2>
        {data.expenses.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No expenses on this job yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {data.expenses.map((x) => (
              <li key={s(x.id)} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="font-semibold">{s(x.number)} · {s(x.description)}</span>
                  <span className="block text-xs text-muted">{fmtDate(x.spent_on)} · {vendorName(x.vendor_id) || s(x.payee) || "No payee"} · {codeName(x.cost_code_id)}{x.receipt_document_id ? " · receipt attached" : ""}{x.status === "void" && x.decision_note ? ` · ${s(x.decision_note)}` : ""}</span></span>
                {x.receipt_document_id ? <Paperclip className="h-4 w-4 text-muted" aria-label="Receipt attached" /> : null}
                <span className="flex items-center gap-2 tabular">{usd(x.amount)} {x.status === "approved" && <BasisBadge basis="Actual" />}</span>
                <Badge tone={statusTone(s(x.status))}>{s(x.status)}</Badge>
                {x.status === "pending" && perms.approveExpense && writable && (
                  <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => act({ action: "decide_expense", expenseId: x.id, decision: "approve" })}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => act({ action: "decide_expense", expenseId: x.id, decision: "reject" })}>Reject</Button></span>
                )}
                {x.status === "approved" && perms.approveExpense && writable && onVoid && <Button size="sm" variant="ghost" onClick={() => onVoid({ kind: "expense", id: s(x.id), label: `expense ${s(x.number)}` })}>Void</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 id="fin-bills" tabIndex={-1} className="font-display text-lg font-extrabold outline-none">Vendor &amp; sub bills</h2>
        {data.bills.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No bills on this job yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {data.bills.map((b) => {
              const onJob = add(0, ...data.billLines.filter((l) => l.bill_id === b.id).map((l) => s(l.amount) || "0"));
              return (
                <li key={s(b.id)} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="font-semibold">{s(b.number)} · {vendorName(b.vendor_id)} #{s(b.vendor_invoice_number)}</span><span className="block text-xs text-muted">Billed {fmtDate(b.bill_date)} · due {fmtDate(b.due_date)}{cmp(onJob, s(b.total) || "0") !== 0 ? ` · ${usd(onJob)} on this job` : ""}</span></span>
                  <span className="flex items-center gap-2 tabular">{usd(onJob)} {b.status === "approved" && <BasisBadge basis="Actual" />}</span>
                  <Badge tone={statusTone(s(b.status))}>{b.status === "pending_approval" ? "Waiting for approval" : s(b.status)}</Badge>
                  {b.status === "pending_approval" && perms.approveBill && writable && <Button size="sm" variant="secondary" onClick={() => act({ action: "approve_bill", billId: b.id })}>Approve</Button>}
                  {b.status === "approved" && b.balance !== null && b.balance !== undefined && (cmp(s(b.balance) || "0", 0) > 0
                    ? <Badge tone={Number(b.days_overdue) > 0 ? "danger" : "warn"}>{usd(b.balance)} unpaid</Badge>
                    : <Badge tone="ok">Paid</Badge>)}
                  {b.status === "approved" && perms.bill && writable && onPayBill && cmp(s(b.balance) || "0", 0) > 0 && <Button size="sm" variant="secondary" onClick={() => onPayBill(b)}>Record bill payment</Button>}
                  {b.status !== "void" && perms.approveBill && writable && onVoid && !((b.payments as R[] | undefined) ?? []).some((p) => p.status === "active") && <Button size="sm" variant="ghost" onClick={() => onVoid({ kind: "bill", id: s(b.id), label: `bill ${s(b.number)}` })}>Void</Button>}
                  {((b.payments as R[] | undefined) ?? []).filter((p) => p.status === "active").length > 0 && (
                    <span className="basis-full text-xs text-muted">Paid: {((b.payments as R[]) ?? []).filter((p) => p.status === "active").map((p) => `${usd(p.amount)} ${s(p.method)} ${fmtDate(p.paid_on)}${p.reference ? ` #${s(p.reference)}` : ""}`).join(" · ")}
                      {((b.payments as R[]) ?? []).filter((p) => p.status === "active").map((p) => (
                        <span key={s(p.id)} className="ml-2 inline-flex gap-2">
                          <a className="inline-flex min-h-9 items-center gap-1 underline" href={`/api/financials/bill-payments/${s(p.id)}/receipt`} target="_blank" rel="noopener" data-testid="fin-bill-payment-receipt"><FileDown className="h-3.5 w-3.5" aria-hidden />record {usd(p.amount)}</a>
                          {perms.approveBill && writable && onVoid && <button type="button" className="min-h-9 underline" onClick={() => onVoid({ kind: "bill_payment", id: s(p.id), label: `bill payment of ${usd(p.amount)}` })}>void {usd(p.amount)}</button>}
                        </span>
                      ))}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ReviewQueue({ items, canResolve, onChanged }: { items: R[]; canResolve: boolean; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const LABEL: Record<string, string> = { uncoded_cost: "Cost without a cost code", missing_receipt: "Receipt missing", commitment_overrun: "Billed more than committed", duplicate_suspected: "Possible duplicate", other: "Needs a look" };
  const act = async (id: unknown, status: "resolved" | "dismissed", resolution?: string) => { setErr(null); const r = await finAction({ action: "review_resolve", itemId: id, status, resolution }); if (!r.ok) setErr(r.message); else onChanged(); };
  const dup = async (i: R) => { setErr(null); const r = await finAction({ action: "mark_duplicate", expenseId: i.entity_id, keepId: (i.details as R | null)?.duplicateOfId }); if (!r.ok) setErr(r.message); else onChanged(); };
  return (
    <section id="review" className="rounded-xl border border-line bg-surface p-4" aria-labelledby="fin-review-h" data-testid="fin-review" data-guide="fin.review">
      <h2 id="fin-review-h" className="font-display text-lg font-extrabold">Needs review</h2>
      {err && <Notice tone="danger" className="mt-2">{err}</Notice>}
      {items.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Nothing to review on this job.</p> : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((i) => (
            <li key={s(i.id)} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 font-semibold">{LABEL[s(i.kind)] ?? s(i.kind)} <span className="font-normal text-muted">({s(i.entity_type).replace("_", " ")})</span>
                {i.kind === "duplicate_suspected" && (i.details as R | null)?.duplicateOf ? <span className="block text-xs font-normal text-muted">Same amount ({usd((i.details as R).amount)}) and payee as {s((i.details as R).duplicateOf)}, within 3 days. Nothing was changed.</span> : null}</span>
              {canResolve && (i.kind === "duplicate_suspected" && i.entity_type === "expense" && (i.details as R | null)?.duplicateOfId
                ? <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => dup(i)} data-testid="fin-void-duplicate">Void as duplicate of {s((i.details as R).duplicateOf)}</Button><Button size="sm" variant="ghost" onClick={() => act(i.id, "dismissed", "Not a duplicate")}>Not a duplicate</Button></span>
                : <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => act(i.id, "resolved")}>Mark fixed</Button><Button size="sm" variant="ghost" onClick={() => act(i.id, "dismissed")}>Dismiss</Button></span>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface TimesheetLabor { counted: boolean; hours: string; amount: string; uncostedHours: string; workers: string[] }

/**
 * Approved timesheet hours on this job, costed at each worker's hourly cost (Team → Employees & time). They count
 * as actual labor in the table above and in the billed P&L unless the company turned that off (for companies that
 * record payroll per job as expenses, so labor isn't counted twice).
 */
export function TimesheetLaborCard({ labor, canConfig, writable, onChanged }: { labor: TimesheetLabor | null; canConfig: boolean; writable: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!labor) return null;
  const hours = Number(labor.hours), uncosted = Number(labor.uncostedHours);
  const toggle = async () => {
    setBusy(true); setErr(null);
    const r = await finAction({ action: "set_timesheet_labor", on: !labor.counted });
    setBusy(false);
    if (!r.ok) setErr(r.message); else onChanged();
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="fin-tl-h" data-testid="fin-timesheet-labor">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="fin-tl-h" className="font-display text-lg font-extrabold">Labor from timesheets</h2>
        <BasisBadge basis="Actual" />
      </div>
      {hours === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">No approved hours on this project yet. Hours your crew clock on this project&apos;s schedule show up here once a manager approves them.</p>
      ) : (
        <p className="mt-1 text-sm">
          <span className="font-semibold tabular">{hours.toFixed(2)} approved hours</span>
          {Number(labor.amount) > 0 && <> · <span className="font-semibold tabular">{usd(labor.amount)}</span> {labor.counted ? "counted as actual labor" : "(not counted: turned off)"}</>}
        </p>
      )}
      {uncosted > 0 && (
        <Notice tone="warn" className="mt-2" title={`${uncosted.toFixed(2)} hours have no hourly cost`}>
          Add an hourly cost for {labor.workers.join(", ") || "these workers"} on <Link className="font-semibold underline" href="/projects/team/time">Team → Employees &amp; time</Link> so their hours are costed.
        </Notice>
      )}
      <p className="mt-2 text-xs text-muted">Cost = hours (minus breaks) × the worker&apos;s current hourly cost. Shown on the billed P&amp;L as labor; the cash P&amp;L shows payroll you actually paid.</p>
      {canConfig && writable && (
        <div className="mt-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={toggle} data-testid="fin-tl-toggle">
            {labor.counted ? "Stop counting timesheet labor (we record payroll as job expenses)" : "Count approved timesheet hours as job labor"}
          </Button>
          <p className="mt-1 text-xs text-muted">This applies to every project in your books.</p>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-sm text-danger">{err}</p>}
    </section>
  );
}
