"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Notice } from "@/components/ui/misc";
import { add, cmp, sub, toMoney } from "@/lib/financials/money";
import { DISCREPANCY_LABELS, STATE_LABELS, TRIGGER_LABELS } from "@/lib/financials/ui-labels";
import type { MilestoneState, MilestoneTriggerKind } from "@/lib/financials/types";
import { BasisBadge } from "./basis";
import { FinDialog } from "./fin-dialog";
import { finAction, fmtDate, newKey, today, usd } from "./fin-client";

export type R = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export interface Perms { invoice: boolean; pay: boolean; expense: boolean; bill: boolean; approveBill: boolean; approveExpense: boolean; config: boolean; company: boolean }

/** Original + approved change orders − deductions (± corrections) = current contract. Pending changes are listed apart. */
export function ContractCard({ contract, jobId, canEdit, onChanged }: { contract: R | null; jobId: string; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(newKey);
  if (!contract) return null;
  const line = (label: string, v: unknown, basis: string, strong = false) => (
    <div className={`flex items-center justify-between gap-2 py-1.5 ${strong ? "border-t border-line pt-2 font-bold" : ""}`}>
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2"><span className="tabular">{usd(v)}</span><BasisBadge basis={basis} /></span>
    </div>
  );
  const corrections = s(contract.corrections);
  const save = async () => {
    setErr(null);
    if (!MONEY.test(amount)) return setErr("Enter an amount like 250.00.");
    const r = await finAction({ action: "add_deduction", jobId, amount: `-${amount}`, description: desc.trim(), key });
    if (!r.ok) return setErr(r.message);
    setOpen(false); setAmount(""); setDesc(""); onChanged();
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="fin-contract-h" data-testid="fin-contract" data-guide="fin.contract">
      <h2 id="fin-contract-h" className="font-display text-lg font-extrabold">Contract</h2>
      <div className="mt-2">
        {line("Original contract (signed)", contract.original_contract, "Contracted")}
        {line("+ Approved change orders", contract.approved_changes, "Contracted")}
        {line("− Deductions", contract.deductions, "Contracted")}
        {corrections && cmp(corrections, 0) !== 0 && line("± Corrections", corrections, "Contracted")}
        {line("= Current contract", contract.current_contract, "Contracted", true)}
        <div className="mt-2 grid gap-1 rounded-lg bg-paper p-2 text-sm">
          <div className="flex justify-between"><span>Invoiced so far</span><span className="flex items-center gap-2 tabular">{usd(contract.invoiced)} <BasisBadge basis="Invoiced" /></span></div>
          <div className="flex justify-between"><span>Left to bill</span><span className="tabular">{usd(contract.remaining_to_bill)}</span></div>
          <div className="flex justify-between text-muted"><span>Pending change orders (not in the contract yet)</span><span className="tabular">{usd(contract.pending_changes)}</span></div>
        </div>
      </div>
      {canEdit && (open ? (
        <form className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="sr-only" htmlFor="ded-amt">Deduction amount</label>
          <input id="ded-amt" className="field" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} required />
          <label className="sr-only" htmlFor="ded-desc">What the deduction is for</label>
          <input id="ded-desc" className="field" placeholder="What it's for (e.g. owner supplied fixtures)" value={desc} onChange={(e) => setDesc(e.target.value)} required maxLength={300} />
          <Button type="submit" size="sm">Save deduction</Button>
          {err && <p role="alert" className="text-sm text-danger sm:col-span-3">{err}</p>}
        </form>
      ) : <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(true)}>Add a deduction</Button>)}
    </section>
  );
}

const TRIGGER_ACTION: Partial<Record<MilestoneTriggerKind, string>> = {
  project_start_confirmed: "Confirm start", phase_completed_verified: "Confirm phase complete", final_completion_confirmed: "Confirm completion", custom_approved: "Approve",
};

/** V4.5: the signed payment schedule is the authority. One row per milestone: status, trigger, due, invoice, payment, next action. */
export function MilestoneCard({ milestones, perms, writable, jobId, onInvoice, onPay, onChanged }: {
  milestones: R[]; perms: Perms; writable: boolean; jobId: string; onInvoice: (m: R) => void; onPay: (m: R) => void; onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState<R | null>(null);
  const [when, setWhen] = useState(today());
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const record = async () => {
    if (!confirm) return;
    setBusy(true); setErr(null);
    const r = await finAction({ action: "record_trigger", jobId, triggerKind: confirm.trigger_kind, milestoneId: confirm.milestone_id, occurredAt: `${when}T12:00:00Z`, note: note.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setConfirm(null); setNote(""); onChanged();
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="fin-ms-h" data-testid="fin-milestones" data-guide="fin.milestones">
      <h2 id="fin-ms-h" className="font-display text-lg font-extrabold">Contract Payment Schedule</h2>
      <p className="text-xs text-muted">From the signed agreement. Invoices are checked against it.</p>
      <ol className="mt-3 space-y-2">
        {milestones.map((m) => {
          const state = s(m.state) as MilestoneState;
          const inv = (m.invoices as R[] | undefined) ?? [];
          const trig = s(m.trigger_kind) as MilestoneTriggerKind;
          const needsTrigger = state === "not_triggered" && TRIGGER_ACTION[trig] && writable && (perms.invoice || perms.config);
          const tone = m.overdue ? "danger" : state === "paid" ? "ok" : state === "ready_to_invoice" || state === "partially_paid" ? "warn" : "neutral";
          return (
            <li key={s(m.milestone_id)} className="rounded-lg border border-line p-3" data-state={state}>
              <div className="flex flex-wrap items-start gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand">{s(m.seq)}</span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-semibold">{s(m.description)}{m.is_deposit && !/deposit/i.test(s(m.description)) ? <span className="ml-2 text-xs font-normal text-muted">Deposit</span> : null}</p>
                  <p className="text-xs text-muted">{TRIGGER_LABELS[trig] ?? trig}{m.triggered_at ? ` · happened ${fmtDate(m.triggered_at)}` : ""}</p>
                </div>
                <span className="flex items-center gap-2"><span className="tabular font-semibold">{usd(m.current_amount)}</span><BasisBadge basis="Contracted" /></span>
                <Badge tone={tone}>{m.overdue ? `${s(m.days_overdue)} days past due` : STATE_LABELS[state] ?? state}</Badge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="text-muted">Due</dt><dd>{m.due_on ? fmtDate(m.due_on) : "After the trigger"}</dd></div>
                <div><dt className="text-muted">Invoice</dt><dd>{inv.length ? inv.map((i) => `${s(i.number) || "Draft"}${i.status === "draft" ? " (draft)" : ""}`).join(", ") : "—"}</dd></div>
                <div><dt className="text-muted">Invoiced</dt><dd className="tabular">{usd(m.invoiced)}</dd></div>
                <div><dt className="text-muted">Paid</dt><dd className="tabular">{usd(m.paid)}</dd></div>
              </dl>
              <div className="mt-2 flex flex-wrap gap-2">
                {needsTrigger && <Button size="sm" variant="secondary" onClick={() => { setConfirm(m); setWhen(today()); }}>{TRIGGER_ACTION[trig]}</Button>}
                {perms.invoice && writable && !inv.some((i) => i.status === "issued") && state !== "paid" && (
                  <Button size="sm" variant={state === "ready_to_invoice" ? "primary" : "secondary"} onClick={() => onInvoice(m)} data-testid={`fin-ms-invoice-${s(m.seq)}`}>
                    {inv.some((i) => i.status === "draft") ? "Finish invoice" : "Create invoice"}
                  </Button>
                )}
                {perms.pay && writable && inv.some((i) => i.status === "issued" && cmp(s(i.balance) || "0", 0) > 0) && <Button size="sm" variant="secondary" onClick={() => onPay(m)}>Record payment</Button>}
              </div>
            </li>
          );
        })}
      </ol>
      <FinDialog open={Boolean(confirm)} onOpenChange={(o) => { if (!o) setConfirm(null); }} title={confirm ? `${TRIGGER_ACTION[s(confirm.trigger_kind) as MilestoneTriggerKind] ?? "Confirm"}: ${s(confirm.description)}` : ""}
        description="Recording this makes the milestone ready to invoice and starts its due date. It doesn't create an invoice or send anything.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void record(); }}>
          <Field label="When it happened" htmlFor="tr-when"><input id="tr-when" type="date" className="field" value={when} max={today()} onChange={(e) => setWhen(e.target.value)} required /></Field>
          <Field label="Note" optional htmlFor="tr-note"><input id="tr-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Crew mobilized, materials delivered" /></Field>
          {err && <Notice tone="danger">{err}</Notice>}
          <Button type="submit" disabled={busy} data-testid="fin-trigger-save">{busy ? "Saving…" : "Record it"}</Button>
        </form>
      </FinDialog>
    </section>
  );
}

/**
 * Create or finish an invoice. From a milestone it's prefilled from the signed schedule; changing the
 * amount or due date is allowed but shows the discrepancy, and issuing then needs an exception reason
 * (saved with the invoice and raised as an info alert). Nothing is sent when an invoice is issued.
 */
export function InvoiceDialog({ open, onOpenChange, jobId, milestone, draft, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; milestone: R | null; draft: R | null; onDone: () => void }) {
  const expected = milestone ? s(milestone.current_amount) : "";
  const [amount, setAmount] = useState(draft ? s(draft.total) : expected);
  const [desc, setDesc] = useState(milestone ? s(milestone.description) : "");
  const [due, setDue] = useState(draft ? s(draft.due_date) : "");
  const [memo, setMemo] = useState("");
  const [invoiceId, setInvoiceId] = useState<string | null>(draft ? s(draft.invoice_id) : null);
  const [disc, setDisc] = useState<{ code: string; expected?: string; actual?: string }[]>((draft?.discrepancies as { code: string }[] | null) ?? []);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [key] = useState(newKey);
  const changedAmount = milestone && amount && expected && cmp(amount, expected) !== 0;

  const saveDraft = async () => {
    setErr(null);
    if (!MONEY.test(amount)) { setErr("Enter an amount like 1250.00."); return null; }
    const lines = [{ kind: milestone ? (milestone.is_deposit ? "deposit" : "milestone") : "custom", description: desc.trim() || (milestone ? s(milestone.description) : "Work completed"), unitPrice: toMoney(amount) }];
    setBusy(true);
    const r = await finAction<{ invoiceId: string; total: string; discrepancies: { code: string; expected?: string; actual?: string }[] }>({
      action: "save_invoice", jobId, key: invoiceId ? undefined : key,
      p: { ...(invoiceId ? { id: invoiceId } : {}), ...(milestone ? { milestoneId: milestone.milestone_id } : { kind: "custom" }), ...(due ? { dueDate: due } : {}), ...(memo ? { memo } : {}), lines },
    });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return null; }
    setInvoiceId(r.data.invoiceId); setDisc(r.data.discrepancies ?? []);
    return r.data;
  };
  const issue = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    if ((saved.discrepancies ?? []).length && !reason.trim()) { setErr("This invoice differs from the signed schedule. Add a reason to issue it."); return; }
    setBusy(true); setErr(null);
    const r = await finAction<{ number: string }>({ action: "issue_invoice", invoiceId: saved.invoiceId, exceptionReason: reason.trim() || undefined });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "milestone_discrepancy" && Array.isArray(r.detail)) setDisc(r.detail as { code: string }[]);
      return setErr(r.message);
    }
    setIssued(r.data.number);
    onDone();
  };

  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title={issued ? `Invoice ${issued} issued` : milestone ? `Invoice: ${s(milestone.description)}` : "New invoice"}
      description={issued ? "It's recorded. Nothing was emailed. Use Email draft to write the message." : milestone ? "Prefilled from the signed payment schedule." : "A custom invoice outside the payment schedule."}>
      {issued ? <Button onClick={() => onOpenChange(false)}>Done</Button> : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void issue(); }} data-testid="fin-invoice-dialog">
          {milestone && (
            <div className="rounded-lg bg-paper p-3 text-sm">
              <div className="flex justify-between"><span>Schedule amount</span><span className="flex items-center gap-2 tabular">{usd(expected)} <BasisBadge basis="Contracted" /></span></div>
              <div className="flex justify-between text-muted"><span>Due rule</span><span>{milestone.due_on ? fmtDate(milestone.due_on) : s(milestone.due_rule) === "net_days" ? `${s(milestone.due_days)} days after issue` : "On receipt"}</span></div>
            </div>
          )}
          <Field label="Description" htmlFor="inv-desc"><input id="inv-desc" className="field" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="inv-amt" hint={changedAmount ? "Differs from the signed schedule" : undefined}>
              <input id="inv-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setDisc([]); }} required aria-invalid={Boolean(changedAmount)} />
            </Field>
            <Field label="Due date" optional htmlFor="inv-due" hint="Leave blank to use the schedule's terms">
              <input id="inv-due" type="date" className="field" value={due} onChange={(e) => { setDue(e.target.value); setDisc([]); }} />
            </Field>
          </div>
          <Field label="Memo on the invoice" optional htmlFor="inv-memo"><input id="inv-memo" className="field" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={1000} /></Field>
          {disc.length > 0 && (
            <div className="rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" role="status" data-testid="fin-discrepancy">
              <p className="font-semibold">This differs from the signed payment schedule</p>
              <ul className="mt-1 list-disc pl-5">
                {disc.map((d, i) => <li key={i}>{DISCREPANCY_LABELS[d.code] ?? d.code}{d.expected ? ` (schedule: ${/^\d/.test(d.expected) && !d.expected.includes("-") ? usd(d.expected) : fmtDate(d.expected)}, this invoice: ${d.actual && /^\d/.test(d.actual) && !d.actual.includes("-") ? usd(d.actual) : fmtDate(d.actual)})` : ""}</li>)}
              </ul>
              <Field label="Exception reason (required to issue)" htmlFor="inv-reason">
                <input id="inv-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Customer asked to bill early; approved by phone 6/2" />
              </Field>
            </div>
          )}
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} data-testid="fin-invoice-issue">{busy ? "Working…" : "Issue invoice"}</Button>
            <Button variant="secondary" disabled={busy} onClick={async () => { if (await saveDraft()) onDone(); }}>Save draft</Button>
          </div>
          <p className="text-xs text-muted">Issuing gives it a number and locks it. To change an issued invoice, void it and create a new one.</p>
        </form>
      )}
    </FinDialog>
  );
}

/** Record a payment: partial, across several invoices, or more than owed (the rest stays as customer credit). */
export function PaymentDialog({ open, onOpenChange, jobId, customerId, invoices, focusInvoice, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; jobId: string; customerId: string | null; invoices: R[]; focusInvoice?: string | null; onDone: () => void;
}) {
  const openInv = useMemo(() => invoices.filter((i) => i.status === "issued" && cmp(s(i.balance) || "0", 0) > 0)
    .sort((a, b) => (s(a.invoice_id) === focusInvoice ? -1 : s(b.invoice_id) === focusInvoice ? 1 : s(a.due_date).localeCompare(s(b.due_date)))), [invoices, focusInvoice]);
  const [amount, setAmount] = useState(openInv[0] ? s(openInv[0].balance) : "");
  const [method, setMethod] = useState("check");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(today());
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);

  // Oldest (or the chosen invoice) first until the payment runs out, unless the person edits the split.
  const auto = useMemo(() => {
    const out: Record<string, string> = {};
    if (!MONEY.test(amount)) return out;
    let left = toMoney(amount);
    for (const i of openInv) {
      if (cmp(left, 0) <= 0) break;
      const take = cmp(left, s(i.balance)) > 0 ? toMoney(s(i.balance)) : left;
      out[s(i.invoice_id)] = take; left = sub(left, take);
    }
    return out;
  }, [amount, openInv]);
  const split = touched ? alloc : auto;
  const applied = add(0, ...Object.values(split).filter((v) => MONEY.test(v)));
  const leftover = MONEY.test(amount) ? sub(amount, applied) : "0.00";

  const save = async () => {
    setErr(null);
    if (!MONEY.test(amount) || cmp(amount, 0) <= 0) return setErr("Enter the amount received.");
    if (cmp(leftover, 0) < 0) return setErr("The split adds up to more than the payment.");
    setBusy(true);
    const r = await finAction({ action: "record_payment", key, p: {
      jobId, ...(customerId ? { customerId } : {}), receivedOn: date, method, reference: ref.trim() || undefined, amount: toMoney(amount),
      allocations: Object.entries(split).filter(([, v]) => MONEY.test(v) && cmp(v, 0) > 0).map(([invoiceId, v]) => ({ invoiceId, amount: toMoney(v) })),
    } });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Record payment" description="Recorded by hand: it shows as “recorded, not verified” until you check it against the bank.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="fin-payment-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount received" htmlFor="pay-amt"><input id="pay-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); }} required /></Field>
          <Field label="Date received" htmlFor="pay-date"><input id="pay-date" type="date" className="field" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Method" htmlFor="pay-method">
            <select id="pay-method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
              {[["check", "Check"], ["cash", "Cash"], ["ach", "Bank transfer (ACH)"], ["card", "Card (outside Built2Bid)"], ["wire", "Wire"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={method === "check" ? "Check number" : "Reference"} optional htmlFor="pay-ref"><input id="pay-ref" className="field" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></Field>
        </div>
        {openInv.length > 0 && (
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="label px-1">Apply to invoices</legend>
            <ul className="space-y-2">
              {openInv.map((i) => (
                <li key={s(i.invoice_id)} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-semibold">{s(i.number)}</span> <span className="text-muted">owes {usd(i.balance)}</span></span>
                  <label className="sr-only" htmlFor={`al-${s(i.invoice_id)}`}>Amount for {s(i.number)}</label>
                  <input id={`al-${s(i.invoice_id)}`} className="field w-32" inputMode="decimal" value={split[s(i.invoice_id)] ?? ""}
                    onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); setTouched(true); setAlloc({ ...(touched ? alloc : auto), [s(i.invoice_id)]: v }); }} />
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div className="rounded-lg bg-paper p-3 text-sm">
          <div className="flex justify-between"><span>Applied to invoices</span><span className="tabular">{usd(applied)}</span></div>
          {cmp(leftover, 0) > 0 && <div className="flex justify-between font-semibold text-warn"><span>Left over: stays as customer credit (unapplied)</span><span className="tabular">{usd(leftover)}</span></div>}
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button type="submit" disabled={busy} data-testid="fin-payment-save">{busy ? "Saving…" : "Record payment"}</Button>
      </form>
    </FinDialog>
  );
}

/** Credit memo: reduces what the customer owes (optionally applied to one invoice right away). */
export function CreditDialog({ open, onOpenChange, jobId, invoices, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; invoices: R[]; onDone: () => void }) {
  const openInv = invoices.filter((i) => i.status === "issued" && cmp(s(i.balance) || "0", 0) > 0);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [inv, setInv] = useState(openInv[0] ? s(openInv[0].invoice_id) : "");
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(newKey);
  const save = async () => {
    setErr(null);
    if (!MONEY.test(amount)) return setErr("Enter an amount like 100.00.");
    const r = await finAction({ action: "issue_credit", key, p: { jobId, amount: toMoney(amount), reason: reason.trim(), ...(inv ? { invoiceId: inv, applyTo: [{ invoiceId: inv, amount: toMoney(amount) }] } : {}) } });
    if (!r.ok) return setErr(r.message);
    onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Issue a credit" description="A numbered credit memo. It never edits the original invoice.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Amount" htmlFor="cr-amt"><input id="cr-amt" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} required /></Field>
        <Field label="Reason" htmlFor="cr-reason"><input id="cr-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} /></Field>
        <Field label="Apply to" htmlFor="cr-inv">
          <select id="cr-inv" className="field" value={inv} onChange={(e) => setInv(e.target.value)}>
            <option value="">Keep as credit for later</option>
            {openInv.map((i) => <option key={s(i.invoice_id)} value={s(i.invoice_id)}>{s(i.number)} (owes {usd(i.balance)})</option>)}
          </select>
        </Field>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button type="submit">Issue credit</Button>
      </form>
    </FinDialog>
  );
}

export type VoidTarget = { kind: "invoice" | "payment" | "bill_payment" | "bill" | "credit" | "expense"; id: string; label: string };

/**
 * Void with a reason. Posted financial records are never deleted: the record keeps its number and history and
 * stops counting. To correct one, void it and enter it again. Drafts are the only thing that can be deleted.
 */
export function VoidDialog({ target, onOpenChange, onDone }: { target: VoidTarget | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!target) return;
    const why = reason.trim();
    const payload: Record<string, unknown> = {
      invoice: { action: "void_invoice", invoiceId: target.id, reason: why },
      payment: { action: "void_payment", paymentId: target.id, reason: why },
      bill_payment: { action: "void_bill_payment", billPaymentId: target.id, reason: why },
      bill: { action: "void_bill", billId: target.id, reason: why },
      credit: { action: "void_credit", creditMemoId: target.id, reason: why },
      expense: { action: "decide_expense", expenseId: target.id, decision: "void", note: why },
    }[target.kind];
    const r = await finAction(payload);
    if (!r.ok) return setErr(r.message);
    setReason(""); setErr(null); onDone(); onOpenChange(false);
  };
  return (
    <FinDialog open={Boolean(target)} onOpenChange={(o) => { if (!o) setErr(null); onOpenChange(o); }} title={target ? `Void ${target.label}` : ""} description="The record keeps its number and history; it stops counting toward balances and reports.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Reason" htmlFor="void-reason"><input id="void-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder="e.g. Entered twice, wrong amount" /></Field>
        <p className="text-xs text-muted" data-testid="fin-void-help">Posted records are voided, never deleted, so the audit trail stays complete. To correct a mistake, void it here and enter it again with the right details.</p>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button type="submit" variant="danger" disabled={!reason.trim()} data-testid="fin-void-confirm">Void</Button>
      </form>
    </FinDialog>
  );
}
