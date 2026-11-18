"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/financials/accounting/controls";
import { useTb } from "./client";

const KINDS = { payroll: "Payroll", recurring_expense: "Recurring expense (rent, insurance…)", supplier_payment: "Supplier payment", sub_payment: "Subcontractor payment", expected_deposit: "Expected deposit", transfer: "Transfer between accounts", other_inflow: "Other money in", other_outflow: "Other money out" } as const;
const IN_KINDS = new Set(["expected_deposit", "other_inflow"]);

/** Add a planned cash event (a forecast entry only: nothing is paid, scheduled at the bank, or moved). */
export function CashPlanForm({ accounts, invoices }: { accounts: { id: string; label: string }[]; invoices: { id: string; label: string }[] }) {
  const { busy, msg, run } = useTb();
  const blank = { kind: "payroll", label: "", amount: "", expectedOn: "", recurrence: "none", recurUntil: "", certainty: "scheduled", accountId: "", toAccountId: "", invoiceId: "" };
  const [f, setF] = useState(blank);
  const transfer = f.kind === "transfer";
  return (
    <form id="plan" className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="cash-plan-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = { kind: f.kind, label: f.label, amount: f.amount, expectedOn: f.expectedOn, recurrence: f.recurrence, recurUntil: f.recurUntil || undefined, certainty: f.certainty,
          accountId: f.accountId || undefined, toAccountId: transfer ? f.toAccountId || undefined : undefined, invoiceId: IN_KINDS.has(f.kind) ? f.invoiceId || undefined : undefined };
        if (await run({ action: "cash_event_save", p }, "Added to the plan.")) setF(blank);
      }}>
      <h3 className="font-display text-base font-extrabold sm:col-span-2 lg:col-span-4">Add to the cash plan</h3>
      <label className="label" htmlFor="cp-kind">Type<select id="cp-kind" className="field mt-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="label" htmlFor="cp-label">Description<input id="cp-label" required maxLength={200} className="field mt-1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Biweekly payroll" /></label>
      <label className="label" htmlFor="cp-amt">Amount<input id="cp-amt" required inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="field mt-1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" /></label>
      <label className="label" htmlFor="cp-date">Date<input id="cp-date" required type="date" className="field mt-1" value={f.expectedOn} onChange={(e) => setF({ ...f, expectedOn: e.target.value })} /></label>
      <label className="label" htmlFor="cp-rec">Repeats<select id="cp-rec" className="field mt-1" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })}><option value="none">Doesn&apos;t repeat</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></label>
      {f.recurrence !== "none" && <label className="label" htmlFor="cp-until">Until (optional)<input id="cp-until" type="date" className="field mt-1" value={f.recurUntil} onChange={(e) => setF({ ...f, recurUntil: e.target.value })} /></label>}
      <label className="label" htmlFor="cp-cert">How sure<select id="cp-cert" className="field mt-1" value={f.certainty} onChange={(e) => setF({ ...f, certainty: e.target.value })}><option value="scheduled">Scheduled (set date)</option><option value="expected">Expected (estimate)</option></select></label>
      {accounts.length > 0 && <label className="label" htmlFor="cp-acct">{transfer ? "From account" : "Account (optional)"}<select id="cp-acct" required={transfer} className="field mt-1" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">{transfer ? "Choose…" : "Any"}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}
      {transfer && <label className="label" htmlFor="cp-to">To account<select id="cp-to" required className="field mt-1" value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}><option value="">Choose…</option>{accounts.filter((a) => a.id !== f.accountId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}
      {IN_KINDS.has(f.kind) && invoices.length > 0 && <label className="label" htmlFor="cp-inv">For invoice (optional)<select id="cp-inv" className="field mt-1" value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })}><option value="">None</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={busy}>Add</Button><Status msg={msg} busy={busy} />
        <span className="text-xs text-muted">Forecast only. Nothing is paid or moved.</span>
      </div>
    </form>
  );
}

export function CancelPlanned({ id }: { id: string }) {
  const { busy, msg, run } = useTb();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "cash_event_save", p: { id, status: "cancelled" } }, "Removed from the plan.")}>Remove</Button><Status msg={msg} busy={busy} /></span>;
}
