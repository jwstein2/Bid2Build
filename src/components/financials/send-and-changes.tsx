"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { CoRow } from "@/lib/financials/change-orders";
import { cmp, toMoney } from "@/lib/financials/money";
import { SEND_LABEL, STEPS, VIA_LABEL, type SendInfo } from "@/lib/financials/send-state";
import { FinDialog } from "./fin-dialog";
import { finAction, fmtDate, newKey, usd } from "./fin-client";

type R = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const today = () => new Date().toLocaleDateString("en-CA");

/** Draft → Issued → Email prepared → Sent → Paid, as a badge plus a five-dot track. */
export function SendStatus({ send, daysLate }: { send: SendInfo | null | undefined; daysLate: number }) {
  if (!send) return null;
  const idx = send.step ? STEPS.findIndex((x) => x.key === send.step) : -1;
  const tone: "ok" | "danger" | "neutral" | "brand" | "warn" = send.state === "paid" ? "ok" : send.state === "email_failed" || daysLate > 0 ? "danger" : send.state === "void" || send.state === "draft" ? "neutral" : send.state === "sent" ? "brand" : "warn";
  const label = send.state === "sent" && send.at ? `Sent ${fmtDate(send.at.slice(0, 10))}` : SEND_LABEL[send.state];
  const via = send.via && (send.state === "sent" || send.state === "paid") ? VIA_LABEL[send.via] : "";
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="fin-send-status" data-state={send.state}>
      <Badge tone={tone}>{label}{send.partlyPaid ? " · partly paid" : ""}{daysLate > 0 ? ` · ${daysLate} days late` : ""}</Badge>
      {send.state !== "void" && (
        <span className="inline-flex items-center gap-1" role="img" aria-label={`Step ${idx + 1} of ${STEPS.length}: ${STEPS[idx]?.label ?? ""}${via ? `, ${via}` : ""}`}>
          {STEPS.map((x, k) => <span key={x.key} title={x.label} className={cn("h-1.5 w-4 rounded-full", k <= idx ? (send.state === "email_failed" && k === idx ? "bg-danger" : "bg-brand") : "bg-line")} />)}
        </span>
      )}
      {via && <span className="text-xs text-muted">{via}</span>}
    </span>
  );
}

const METHODS: [string, string][] = [["own_email", "From my own email"], ["printed", "Printed / mailed"], ["in_person", "Handed over in person"], ["text", "By text message"], ["other", "Other"]];

/** Record that an invoice reached the customer outside Built2Bid, or undo a mark made by mistake. */
export function MarkSentDialog({ target, onOpenChange, onDone }: { target: { id: string; number: string; issueDate: string; marked: boolean } | null; onOpenChange: (o: boolean) => void; onDone: (msg: string) => void }) {
  const [method, setMethod] = useState("own_email");
  const [sentOn, setSentOn] = useState(today());
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const undo = Boolean(target?.marked);
  const save = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    const r = undo ? await finAction({ action: "unmark_sent", invoiceId: target.id, reason: reason.trim() })
      : await finAction({ action: "mark_sent", invoiceId: target.id, method, sentOn, note: note.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setNote(""); setReason("");
    onDone(undo ? `${target.number} is no longer marked as sent.` : `${target.number} is marked as sent.`);
    onOpenChange(false);
  };
  return (
    <FinDialog open={Boolean(target)} onOpenChange={(o) => { if (!o) setErr(null); onOpenChange(o); }}
      title={target ? (undo ? `Undo "sent" on ${target.number}?` : `Mark ${target.number} as sent`) : ""}
      description={undo ? "For a mark made by mistake. The history keeps both the mark and your reason." : "For an invoice you sent yourself (your own email, mail, in person). Nothing is sent from here."}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="fin-mark-sent-form">
        {undo ? (
          <Field label="Reason" htmlFor="ms-reason"><input id="ms-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder="e.g. Marked the wrong invoice" /></Field>
        ) : <>
          <Field label="How it was sent" htmlFor="ms-method">
            <select id="ms-method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Date sent" htmlFor="ms-date"><input id="ms-date" type="date" className="field" value={sentOn} min={target?.issueDate || undefined} max={today()} onChange={(e) => setSentOn(e.target.value)} required /></Field>
          <Field label="Note (optional)" htmlFor="ms-note"><input id="ms-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Emailed to pat@example.com" /></Field>
        </>}
        {err && <Notice tone="danger">{err}</Notice>}
        <Button loading={busy} type="submit" disabled={busy || (undo && !reason.trim())} data-testid="fin-mark-sent-confirm">{busy ? "Saving…" : undo ? "Undo sent mark" : "Mark as sent"}</Button>
      </form>
    </FinDialog>
  );
}

const SETTLED: Record<CoRow["settlement"], { label: string; tone: "ok" | "warn" | "neutral" | "brand" }> = {
  open: { label: "Not in billing yet", tone: "warn" }, milestones: { label: "Own payment", tone: "ok" }, amendment_pending: { label: "Waiting for approval", tone: "brand" },
  amended: { label: "Taken off a payment", tone: "ok" }, credited: { label: "Credited", tone: "ok" },
};

type CoAct = { kind: "credit" | "amend" | "milestone"; co: CoRow } | null;

/**
 * Approved change orders and how each is billed (Scenario D). Added scope gets its own payment; removed scope is
 * taken off a remaining payment or credited. The original signed agreement and issued invoices never change.
 */
export function ChangeOrdersCard({ rows, jobId, invoices, canInvoice, canApprove, writable, onChanged }: {
  rows: CoRow[]; jobId: string; invoices: R[]; canInvoice: boolean; canApprove: boolean; writable: boolean; onChanged: (msg?: string) => void;
}) {
  const [act, setAct] = useState<CoAct>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!rows.length) return null;
  const decide = async (id: string, approve: boolean) => {
    setErr(null);
    const r = await finAction({ action: "amendment_decide", amendmentId: id, approve });
    if (!r.ok) return setErr(r.message);
    onChanged(approve ? "Payment reduced." : "Reduction rejected.");
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="fin-co-h" data-testid="fin-change-orders">
      <h2 id="fin-co-h" className="font-display text-lg font-extrabold">Change orders</h2>
      <p className="mt-1 text-xs text-muted">Approved and signed change orders. Each one is billed one way only. Your original signed agreement and issued invoices never change.</p>
      {err && <div className="mt-2"><Notice tone="danger">{err}</Notice></div>}
      <ul className="mt-2 divide-y divide-line">
        {rows.map((c) => {
          const reduction = Number(c.amount) < 0;
          return (
            <li key={c.changeOrderId} className="py-2 text-sm" data-testid="fin-co-row" data-settlement={c.settlement}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 basis-full font-semibold sm:basis-0 sm:flex-1">{c.label}</span>
                <span className={cn("tabular", reduction && "text-danger")}>{reduction ? `−${usd(c.amount.slice(1))}` : `+${usd(c.amount)}`}</span>
                <Badge tone={SETTLED[c.settlement].tone}>{SETTLED[c.settlement].label}</Badge>
              </div>
              {c.detail && <p className="mt-0.5 text-xs text-muted">{c.detail}</p>}
              {writable && canInvoice && c.settlement === "open" && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {reduction ? <>
                    <Button size="sm" variant="secondary" onClick={() => setAct({ kind: "credit", co: c })} data-testid="fin-co-credit">Credit the customer</Button>
                    {c.remaining.length > 0 && <Button size="sm" variant="ghost" onClick={() => setAct({ kind: "amend", co: c })} data-testid="fin-co-amend">Take off a remaining payment</Button>}
                  </> : <Button size="sm" variant="secondary" onClick={() => setAct({ kind: "milestone", co: c })} data-testid="fin-co-milestone">Add as a payment</Button>}
                </div>
              )}
              {writable && canApprove && c.settlement === "amendment_pending" && c.amendmentId && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" onClick={() => void decide(c.amendmentId!, true)}><Check className="h-4 w-4" aria-hidden /> Approve reduction</Button>
                  <Button size="sm" variant="ghost" onClick={() => void decide(c.amendmentId!, false)}>Reject</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <CoActionDialog act={act} jobId={jobId} invoices={invoices} canApprove={canApprove} onOpenChange={(o) => { if (!o) setAct(null); }} onDone={(m) => { setAct(null); onChanged(m); }} />
    </section>
  );
}

function CoActionDialog({ act, jobId, invoices, canApprove, onOpenChange, onDone }: { act: CoAct; jobId: string; invoices: R[]; canApprove: boolean; onOpenChange: (o: boolean) => void; onDone: (msg: string) => void }) {
  const openInv = invoices.filter((i) => i.status === "issued" && cmp(s(i.balance) || "0", 0) > 0);
  const [inv, setInv] = useState("");
  const [ms, setMs] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  if (!act) return <FinDialog open={false} onOpenChange={onOpenChange} title="">{null}</FinDialog>;
  const co = act.co;
  const abs = co.amount.replace(/^-/, "");
  const save = async () => {
    setBusy(true); setErr(null);
    let r;
    if (act.kind === "credit") {
      const target = openInv.find((i) => s(i.invoice_id) === inv);
      const apply = target ? (cmp(s(target.balance), abs) < 0 ? toMoney(s(target.balance)) : abs) : null;
      r = await finAction({ action: "co_credit", jobId, changeOrderId: co.changeOrderId, key, applyTo: apply ? [{ invoiceId: inv, amount: apply }] : undefined });
    } else if (act.kind === "amend") {
      r = await finAction({ action: "co_amend", milestoneId: ms || co.remaining[0]?.milestoneId, changeOrderId: co.changeOrderId, delta: co.amount, reason: `${co.label}: scope removed` });
      if (r.ok && canApprove) {
        const id = (r.data as { amendmentId?: string }).amendmentId;
        if (id) r = await finAction({ action: "amendment_decide", amendmentId: id, approve: true });
      }
    } else {
      r = await finAction({ action: "co_milestone", jobId, changeOrderId: co.changeOrderId, amount: co.amount, description: desc.trim() || undefined });
    }
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setKey(newKey()); setInv(""); setMs(""); setDesc("");
    onDone(act.kind === "credit" ? "Credit issued for the removed scope." : act.kind === "amend" ? (canApprove ? "Payment reduced." : "Sent for approval by your company owner or financial admin.") : "Payment added for the change order.");
  };
  const title = act.kind === "credit" ? `Credit ${usd(abs)} for removed scope` : act.kind === "amend" ? `Take ${usd(abs)} off a payment` : `Add ${usd(co.amount)} as a payment`;
  return (
    <FinDialog open onOpenChange={(o) => { if (!o) setErr(null); onOpenChange(o); }} title={title} description={co.label}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="fin-co-form">
        {act.kind === "credit" && <>
          <p className="text-sm text-ink-soft">Issues a numbered credit memo linked to this change order. Use it when the removed work was already billed or paid for.</p>
          <Field label="Apply to" htmlFor="co-inv">
            <select id="co-inv" className="field" value={inv} onChange={(e) => setInv(e.target.value)}>
              <option value="">Keep as credit for later (refund or next invoice)</option>
              {openInv.map((i) => <option key={s(i.invoice_id)} value={s(i.invoice_id)}>{s(i.number)} (owes {usd(i.balance)})</option>)}
            </select>
          </Field>
        </>}
        {act.kind === "amend" && <>
          <p className="text-sm text-ink-soft">Lowers a payment that has not been fully invoiced yet. {canApprove ? "" : "Your company owner or financial admin approves it."}</p>
          <Field label="Payment" htmlFor="co-ms">
            <select id="co-ms" className="field" value={ms || co.remaining[0]?.milestoneId} onChange={(e) => setMs(e.target.value)}>
              {co.remaining.map((m) => <option key={m.milestoneId} value={m.milestoneId}>{m.description} ({usd(m.current)} → {usd((Number(m.current) + Number(co.amount)).toFixed(2))})</option>)}
            </select>
          </Field>
        </>}
        {act.kind === "milestone" && (
          <Field label="Payment name (optional)" htmlFor="co-desc"><input id="co-desc" className="field" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} placeholder={co.label} /></Field>
        )}
        {err && <Notice tone="danger">{err}</Notice>}
        <Button loading={busy} type="submit" disabled={busy} data-testid="fin-co-confirm">{busy ? "Saving…" : act.kind === "credit" ? "Issue credit" : act.kind === "amend" ? (canApprove ? "Reduce payment" : "Send for approval") : "Add payment"}</Button>
      </form>
    </FinDialog>
  );
}
