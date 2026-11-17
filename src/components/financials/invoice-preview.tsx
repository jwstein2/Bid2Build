"use client";
import { useEffect, useState } from "react";
import { Download, FileDown } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/misc";
import type { InvoicePdfData } from "@/lib/pdf/invoice-pdf";
import { FinDialog } from "./fin-dialog";
import { finAction, fmtDate, usd } from "./fin-client";

const KIND: Record<string, string> = { deposit: "Deposit invoice", milestone: "Progress payment", progress: "Progress payment", final: "Final invoice", custom: "Invoice" };
const METHOD: Record<string, string> = { check: "Check", cash: "Cash", ach: "Bank transfer", card: "Card", wire: "Wire", other: "Other" };

/**
 * Click an invoice number: the same customer-facing invoice as the PDF (no costs or margins), in a window
 * over a blurred, faded page. Loaded from /api/financials/invoices/[id]/preview through the user's own access.
 */
export function InvoicePreviewDialog({ invoiceId, onOpenChange }: { invoiceId: string | null; onOpenChange: (o: boolean) => void }) {
  const [state, setState] = useState<{ id: string; d?: InvoicePdfData; logo?: string | null; error?: string } | null>(null);
  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/financials/invoices/${invoiceId}/preview`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) setState({ id: invoiceId, error: j?.error?.message ?? "We couldn't load this invoice." });
        else setState({ id: invoiceId, d: j.invoice as InvoicePdfData, logo: j.logo as string | null });
      } catch {
        if (!cancelled) setState({ id: invoiceId, error: "We couldn't load this invoice. Check your connection and try again." });
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId]);
  const cur = state && state.id === invoiceId ? state : null;
  const d = cur?.d;
  return (
    <FinDialog preview open={Boolean(invoiceId)} onOpenChange={onOpenChange} title={d ? `Invoice ${d.invoice.number}` : "Invoice"}
      description={d ? `${KIND[d.invoice.kind] ?? "Invoice"} · what your customer sees` : undefined}>
      {!cur && <div className="space-y-3" aria-busy="true" aria-label="Loading invoice">{[0, 1, 2].map((k) => <div key={k} className="h-10 animate-pulse rounded-lg bg-black/5" />)}</div>}
      {cur?.error && <Notice tone="danger">{cur.error}</Notice>}
      {d && (
        <div className="space-y-4" data-testid="fin-invoice-preview">
          {d.sandbox && <div data-testid="fin-preview-sandbox"><Notice tone="warn">Sandbox practice invoice. It is not real and is never sent to a customer.</Notice></div>}
          {d.invoice.status === "void" && <Notice tone="warn">This invoice is void. It no longer counts toward what the customer owes.</Notice>}
          <div className="rounded-xl border border-line bg-white p-4 text-[#16202e] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 pb-3" style={{ borderColor: d.company.color || "#0b2d4d" }}>
              <div className="flex min-w-0 items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL from the API */}
                {cur?.logo && <img src={cur.logo} alt="" className="max-h-12 max-w-32 object-contain" />}
                <div className="min-w-0 text-sm">
                  <p className="font-bold">{d.company.name}</p>
                  {d.company.address && <p className="text-[#56677a]">{d.company.address}</p>}
                  <p className="text-[#56677a]">{[d.company.phone, d.company.email].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="font-display text-2xl font-extrabold text-[#0b2d4d]">INVOICE</p>
                <p className="font-bold">{d.invoice.number}</p>
                <p className="text-[#56677a]">Issued {fmtDate(d.invoice.issueDate)}</p>
                <p className="text-[#56677a]">Due {fmtDate(d.invoice.dueDate)}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><p className="text-[11px] font-semibold uppercase text-[#56677a]">Bill to</p><p className="font-semibold">{d.billTo.name}</p>{d.billTo.address && <p>{d.billTo.address}</p>}{d.billTo.email && <p className="text-[#56677a]">{d.billTo.email}</p>}</div>
              <div><p className="text-[11px] font-semibold uppercase text-[#56677a]">Project</p><p className="font-semibold">{d.project.name}</p><p className="text-[#56677a]">{d.project.jobNumber}</p>{d.project.address && <p>{d.project.address}</p>}</div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead><tr className="bg-[#f5f8fb] text-left text-xs text-[#56677a]"><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Price</th><th className="px-2 py-1.5 text-right">Amount</th></tr></thead>
                <tbody>{d.lines.map((l, k) => (
                  <tr key={k} className="border-b border-[#dde5ee]"><td className="px-2 py-1.5">{l.description}</td><td className="px-2 py-1.5 text-right tabular-nums">{Number(l.quantity)}</td><td className="px-2 py-1.5 text-right tabular-nums">{usd(l.unitPrice)}</td><td className="px-2 py-1.5 text-right tabular-nums">{usd(l.amount)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
              {Number(d.tax) !== 0 && <><div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{usd(d.subtotal)}</dd></div><div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{usd(d.tax)}</dd></div></>}
              <div className="flex justify-between font-bold"><dt>Invoice total</dt><dd className="tabular-nums">{usd(d.total)}</dd></div>
              {Number(d.paid) > 0 && <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">-{usd(d.paid)}</dd></div>}
              {Number(d.credited) > 0 && <div className="flex justify-between"><dt>Credits</dt><dd className="tabular-nums">-{usd(d.credited)}</dd></div>}
              <div className="flex justify-between rounded-md px-2 py-1.5 font-bold text-white" style={{ background: d.company.color || "#0b2d4d" }}><dt>Balance due</dt><dd className="tabular-nums">{usd(d.balance)}</dd></div>
            </dl>
            {d.payments.length > 0 && <p className="mt-3 text-xs text-[#56677a]">Payments: {d.payments.map((p) => `${usd(p.amount)} ${METHOD[p.method] ?? ""} ${fmtDate(p.date)}`).join(" · ")}</p>}
            {d.invoice.memo && <p className="mt-3 text-sm"><span className="font-semibold">Notes: </span>{d.invoice.memo}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a className={buttonClass("secondary", "sm")} href={`/api/financials/invoices/${invoiceId}/pdf`} target="_blank" rel="noopener"><FileDown className="h-4 w-4" aria-hidden /> Open PDF</a>
            <a className={buttonClass("ghost", "sm")} href={`/api/financials/invoices/${invoiceId}/pdf?download=1`}><Download className="h-4 w-4" aria-hidden /> Download</a>
          </div>
        </div>
      )}
    </FinDialog>
  );
}

/**
 * Delete an issued invoice that was a mistake. The database decides: only with no payments (even voided),
 * credits, deposit deductions, disputes or sent/queued emails. Anything else must be voided.
 */
export function DeleteInvoiceDialog({ target, onOpenChange, onDone, onVoidInstead }: { target: { id: string; number: string } | null; onOpenChange: (o: boolean) => void; onDone: (msg: string) => void; onVoidInstead: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    const r = await finAction({ action: "delete_invoice", invoiceId: target.id, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    const released = (r.data as { numberReleased?: boolean } | undefined)?.numberReleased;
    setReason("");
    onDone(released ? `${target.number} was deleted. Its number will be used for your next invoice.` : `${target.number} was deleted. A copy is kept in the history, and its number won't be reused.`);
    onOpenChange(false);
  };
  return (
    <FinDialog open={Boolean(target)} onOpenChange={(o) => { if (!o) setErr(null); onOpenChange(o); }} title={target ? `Delete ${target.number}?` : ""}
      description="For an invoice that should never have been issued.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft" data-testid="fin-delete-rules">
          <li>You can delete it only if no payment or credit was ever applied, and no email for it was sent.</li>
          <li>Unsent email drafts for it are removed too.</li>
          <li>A copy stays in the history with your reason.</li>
          <li>If anything already depends on it, void it instead. Voiding keeps the record and stops it counting.</li>
        </ul>
        <Field label="Reason" htmlFor="del-reason"><input id="del-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder="e.g. Issued for the wrong job" /></Field>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" disabled={!reason.trim() || busy} data-testid="fin-delete-invoice-confirm">{busy ? "Deleting…" : "Delete invoice"}</Button>
          {err && <Button type="button" variant="secondary" onClick={() => { setErr(null); onOpenChange(false); onVoidInstead(); }}>Void instead</Button>}
        </div>
      </form>
    </FinDialog>
  );
}
