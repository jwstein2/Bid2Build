"use client";
import { useCallback, useEffect, useState } from "react";
import { FileDown, Mail, RefreshCw } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Field, Notice } from "@/components/ui/misc";
import { cmp } from "@/lib/financials/money";
import { cn } from "@/lib/cn";
import { AlertsPanel, type AlertRow } from "./alerts-panel";
import { BasisBadge } from "./basis";
import { EmailDraftDialog } from "./email-draft-dialog";
import { finAction, fmtDate, usd } from "./fin-client";
import { ContractCard, CreditDialog, InvoiceDialog, MilestoneCard, PaymentDialog, VoidDialog, type Perms, type R } from "./job-billing";
import { BillDialog, BillPaymentDialog, BudgetTable, CommitmentDialog, CostLists, ExpenseDialog, ProfitCard, ReviewQueue } from "./job-costs";
import { JobSummary, type SummaryTarget } from "./job-summary";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
type Section = "billing" | "costs" | "review";
const GUIDE_PAGE = { billing: "financials.job.billing", costs: "financials.job.costs", review: "financials.job.review" } as const;
/** The job's own trades, so the walkthrough's examples match the job on screen. */
const guideTrade = (est: R) => (Array.isArray(est.trades) ? (est.trades as unknown[]).filter((t) => typeof t === "string").join(" ") : undefined);
type Open = { kind: "invoice"; milestone: R | null; draft: R | null } | { kind: "payment"; invoice?: string | null } | { kind: "credit" } | { kind: "expense" } | { kind: "bill" } | { kind: "commitment" } | { kind: "bill_payment"; bill: R } | { kind: "email"; invoiceId?: string; paymentId?: string } | null;

interface Payload {
  estimate: R; versions: R[]; job: R | null; contract?: R | null; milestones?: R[]; invoices?: R[]; payments?: R[]; credits?: R[];
  expenses?: R[]; bills?: R[]; billLines?: R[]; commitments?: R[]; budget?: R[]; profit?: R | null; review?: R[]; alerts?: R[];
  costCodes?: R[]; vendors?: R[]; quotes?: R[]; summary?: R | null;
  access: { permissions: string[]; readOnly: boolean; active: boolean; role: string | null };
}

/**
 * Project → Financials (Phase 1). Loads everything for one job from /api/financials/jobs/[estimateId]
 * (RLS-scoped) and writes only through /api/financials/actions. What a person can do follows their
 * financial role; a view-only seat sees the same numbers with no buttons.
 */
export function JobFinancials({ estimateId, initialAction }: { estimateId: string; initialAction?: string | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(initialAction === "expense" || initialAction === "bill" || initialAction === "commitment" ? "costs" : "billing");
  const [open, setOpen] = useState<Open>(null);
  const [voiding, setVoiding] = useState<{ kind: "invoice" | "payment" | "bill_payment"; id: string; label: string } | null>(null);
  const [versionId, setVersionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionUsed, setActionUsed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/financials/jobs/${estimateId}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !body) { setError(body?.message ?? "We couldn't load this job's financials."); return; }
    setError(null); setData(body);
    setVersionId((v) => v || s((body.versions as R[])[0]?.id));
  }, [estimateId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load the job's records once on mount
  useEffect(() => { void load(); }, [load]);

  const perms: Perms = {
    invoice: Boolean(data?.access.permissions.includes("create_invoices")), pay: Boolean(data?.access.permissions.includes("record_payments")),
    expense: Boolean(data?.access.permissions.includes("record_expenses")), bill: Boolean(data?.access.permissions.includes("record_bills")),
    approveBill: Boolean(data?.access.permissions.includes("approve_vendor_bills")), approveExpense: Boolean(data?.access.permissions.includes("approve_expenses")),
    config: Boolean(data?.access.permissions.includes("manage_financial_config")), company: Boolean(data?.access.permissions.includes("view_company_financials")),
  };
  const writable = Boolean(data && data.access.active && !data.access.readOnly);

  // Quick actions from the home page arrive as ?do=<action> and open the matching form once.
  useEffect(() => {
    if (!data?.job || actionUsed || !initialAction || !writable) return;
    const ready = (data.milestones ?? []).find((m) => m.state === "ready_to_invoice");
    const next: Open = initialAction === "invoice" && perms.invoice ? { kind: "invoice", milestone: ready ?? null, draft: null }
      : initialAction === "payment" && perms.pay ? { kind: "payment" } : initialAction === "credit" && perms.invoice ? { kind: "credit" }
      : initialAction === "expense" && perms.expense ? { kind: "expense" } : initialAction === "bill" && perms.bill ? { kind: "bill" }
      : initialAction === "commitment" && perms.bill ? { kind: "commitment" } : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time open from the URL
    setActionUsed(true); if (next) setOpen(next);
  }, [data, actionUsed, initialAction, writable, perms.invoice, perms.pay, perms.expense, perms.bill]);

  if (error) return <Notice tone="warn" title="Financials">{error}</Notice>;
  if (!data) return <p className="text-sm text-ink-soft" aria-busy="true">Loading financials…</p>;

  if (!data.job) {
    const won = ["won", "scheduled", "in_progress", "completed"].includes(s(data.estimate.pipeline_stage));
    const openJob = async () => {
      setBusy(true);
      const r = await finAction({ action: "open_job", estimateId, versionId: versionId || undefined });
      setBusy(false);
      if (!r.ok) return setError(r.message);
      void load();
    };
    return (
      <section className="rounded-xl border border-line bg-surface p-4" data-testid="fin-open-job" data-guide-page="financials.job" data-guide-trade={guideTrade(data.estimate)} data-guide="fin.open-job">
        <h2 className="font-display text-lg font-extrabold">Job financials</h2>
        {!won ? <p className="mt-2 text-sm text-ink-soft">Financials start when the bid is won. Mark it won in your pipeline, then come back.</p>
          : !perms.invoice || !writable ? <p className="mt-2 text-sm text-ink-soft">Someone with invoicing access opens the job&apos;s financials. Nothing is recorded yet.</p> : (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-ink-soft">This freezes the contract amount and the signed payment schedule so invoices can be checked against them. It doesn&apos;t create an invoice or send anything.</p>
              {data.versions.length > 0 && (
                <Field label="Which proposal is the contract?" htmlFor="job-version" hint="If the bid was e-signed, the signed version is used automatically.">
                  <select id="job-version" className="field" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                    {data.versions.map((v) => <option key={s(v.id)} value={s(v.id)}>Version {s(v.version_number)} · {usd(v.total)} · {fmtDate(v.created_at)}</option>)}
                  </select>
                </Field>
              )}
              <Button onClick={openJob} disabled={busy} data-testid="fin-open-job-btn">{busy ? "Opening…" : "Open job financials"}</Button>
            </div>
          )}
      </section>
    );
  }

  const job = data.job, jobId = s(job.id);
  const invoices = data.invoices ?? [], payments = data.payments ?? [];
  const alerts: AlertRow[] = (data.alerts ?? []) as unknown as AlertRow[];
  const done = () => { void load(); };
  const del = async (invoiceId: unknown) => { const r = await finAction({ action: "delete_invoice_draft", invoiceId }); if (!r.ok) setError(r.message); else done(); };
  // Summary cards open the records behind each number on this page.
  const jumpTo = (t: SummaryTarget) => {
    const target = { contract: ["billing", "fin-contract"], invoices: ["billing", "fin-invoices"], payments: ["billing", "fin-payments"], budget: ["costs", "fin-budget"], bills: ["costs", "fin-bills"] }[t] as [Section, string];
    setSection(target[0]);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(target[1]);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.focus({ preventScroll: true });
    }));
  };
  const verify = async (paymentId: unknown) => { const r = await finAction({ action: "verify_payment", paymentId }); if (!r.ok) setError(r.message); else done(); };

  return (
    <div className="space-y-4" data-testid="fin-job" data-guide-page={GUIDE_PAGE[section]} data-guide-trade={guideTrade(data.estimate)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Job {s(job.job_number)}</p>
          <h2 className="truncate font-display text-xl font-extrabold">{s(job.name)}</h2>
          <p className="text-sm text-ink-soft">{s(data.estimate.customer_name)}</p>
        </div>
        {data.access.readOnly && <Badge tone="warn">Read-only</Badge>}
        <Button variant="ghost" size="sm" onClick={done} aria-label="Reload"><RefreshCw className="h-4 w-4" aria-hidden /></Button>
      </div>

      {data.summary && (
        <JobSummary summary={data.summary} estimateId={estimateId} customerId={s(job.customer_id) || null} writable={writable}
          perms={{ invoice: perms.invoice, pay: perms.pay, expense: perms.expense, bill: perms.bill, company: perms.company }}
          onOpen={jumpTo}
          onAction={(a) => {
            if (a === "invoice") setOpen({ kind: "invoice", milestone: (data.milestones ?? []).find((m) => m.state === "ready_to_invoice") ?? null, draft: null });
            else if (a === "payment") setOpen({ kind: "payment" });
            else { setSection("costs"); setOpen({ kind: a }); }
          }} />
      )}

      <AlertsPanel alerts={alerts} canAct={writable && (perms.invoice || perms.config)} onChanged={done} />

      <div role="tablist" aria-label="Job financials" data-guide="fin.job-tabs" className="flex gap-1 overflow-x-auto border-b border-line">
        {([["billing", "Billing"], ["costs", "Costs"], ["review", `Needs review${data.review?.length ? ` (${data.review.length})` : ""}`]] as [Section, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => setSection(k)}
            className={cn("-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold", section === k ? "border-brand text-navy" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>

      {section === "billing" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div id="fin-contract" tabIndex={-1} className="outline-none"><ContractCard contract={data.contract ?? null} jobId={jobId} canEdit={writable && perms.invoice} onChanged={done} /></div>
            <MilestoneCard milestones={data.milestones ?? []} perms={perms} writable={writable} jobId={jobId} onChanged={done}
              onInvoice={(m) => setOpen({ kind: "invoice", milestone: m, draft: invoices.find((i) => i.milestone_id === m.milestone_id && i.status === "draft") ?? null })}
              onPay={(m) => setOpen({ kind: "payment", invoice: s(invoices.find((i) => i.milestone_id === m.milestone_id && i.status === "issued")?.invoice_id) || null })} />
          </div>

          <section id="fin-invoices" tabIndex={-1} className="rounded-xl border border-line bg-surface p-4 outline-none" aria-labelledby="fin-inv-h" data-testid="fin-invoices" data-guide="fin.invoices">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="fin-inv-h" className="font-display text-lg font-extrabold">Invoices</h2>
              {perms.invoice && writable && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen({ kind: "invoice", milestone: null, draft: null })}>Custom invoice</Button>}
              {perms.invoice && writable && <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: "credit" })}>Issue credit</Button>}
            </div>
            {invoices.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No invoices yet. Start from a milestone above.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {invoices.map((i) => (
                  <li key={s(i.invoice_id)} className="py-2 text-sm" data-status={s(i.status)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1"><span className="font-semibold">{s(i.number) || "Draft"}</span> <span className="text-muted">· {s(i.kind)}{i.issue_date ? ` · issued ${fmtDate(i.issue_date)}` : ""}{i.due_date ? ` · due ${fmtDate(i.due_date)}` : ""}</span>
                        {s(i.exception_reason) && <span className="block text-xs text-muted">Differs from schedule: {s(i.exception_reason)}</span>}</span>
                      <span className="flex items-center gap-2 tabular">{usd(i.total)} <BasisBadge basis="Invoiced" /></span>
                      {i.status === "issued" && <span className="flex items-center gap-2 tabular">{usd(i.balance)} <BasisBadge basis="Outstanding" /></span>}
                      <Badge tone={i.status === "void" ? "neutral" : i.status === "draft" ? "neutral" : Number(i.days_overdue) > 0 ? "danger" : cmp(s(i.balance) || "0", 0) <= 0 ? "ok" : "warn"}>
                        {i.status === "void" ? "Void" : i.status === "draft" ? "Draft" : Number(i.days_overdue) > 0 ? `${s(i.days_overdue)} days late` : cmp(s(i.balance) || "0", 0) <= 0 ? "Paid" : "Open"}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.status === "draft" && perms.invoice && writable && <>
                        <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "invoice", milestone: (data.milestones ?? []).find((m) => m.milestone_id === i.milestone_id) ?? null, draft: i })}>Review &amp; issue</Button>
                        <Button size="sm" variant="ghost" onClick={() => del(i.invoice_id)}>Delete draft</Button>
                      </>}
                      {i.status === "issued" && perms.pay && writable && cmp(s(i.balance) || "0", 0) > 0 && <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "payment", invoice: s(i.invoice_id) })}>Record payment</Button>}
                      {i.status === "issued" && <a className={buttonClass("ghost", "sm")} href={`/api/financials/invoices/${s(i.invoice_id)}/pdf`} target="_blank" rel="noopener" data-testid="fin-invoice-pdf"><FileDown className="h-4 w-4" aria-hidden /> PDF</a>}
                      {i.status === "issued" && perms.invoice && <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: "email", invoiceId: s(i.invoice_id) })}><Mail className="h-4 w-4" aria-hidden /> Email draft</Button>}
                      {i.status === "issued" && perms.invoice && writable && <Button size="sm" variant="ghost" onClick={() => setVoiding({ kind: "invoice", id: s(i.invoice_id), label: `invoice ${s(i.number)}` })}>Void</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">Issued invoices have a customer PDF (no internal costs or margin). Nothing is emailed from here.</p>
          </section>

          <section id="fin-payments" tabIndex={-1} className="rounded-xl border border-line bg-surface p-4 outline-none" aria-labelledby="fin-pay-h" data-testid="fin-payments" data-guide="fin.payments">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="fin-pay-h" className="font-display text-lg font-extrabold">Payments</h2>
              {perms.pay && writable && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen({ kind: "payment" })} data-testid="fin-record-payment">Record payment</Button>}
            </div>
            {payments.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No payments recorded yet.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {payments.map((p) => (
                  <li key={s(p.payment_id)} className="py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1"><span className="font-semibold">{s(p.number)}</span> <span className="text-muted">· {fmtDate(p.received_on)} · {s(p.method)}</span>
                        <span className="block text-xs text-muted">{((p.allocations as R[]) ?? []).map((a) => `${usd(a.amount)} to ${s(invoices.find((i) => i.invoice_id === a.invoice_id)?.number)}`).join(", ") || "Not applied to an invoice"}</span></span>
                      <span className="flex items-center gap-2 tabular">{usd(p.amount)} <BasisBadge basis="Paid" /></span>
                      {p.status === "active" && cmp(s(p.unapplied) || "0", 0) > 0 && <Badge tone="warn">{usd(p.unapplied)} credit</Badge>}
                      <Badge tone={p.status === "void" ? "neutral" : p.verified ? "ok" : "warn"}>{p.status === "void" ? "Void" : p.verified ? "Verified" : "Recorded, not verified"}</Badge>
                    </div>
                    {p.status === "active" && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!p.verified && perms.pay && writable && <Button size="sm" variant="ghost" onClick={() => verify(p.payment_id)}>Mark verified</Button>}
                        {perms.pay && <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: "email", paymentId: s(p.payment_id) })}><Mail className="h-4 w-4" aria-hidden /> Receipt draft</Button>}
                        {perms.pay && writable && <Button size="sm" variant="ghost" onClick={() => setVoiding({ kind: "payment", id: s(p.payment_id), label: `payment ${s(p.number)}` })}>Void</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(data.credits ?? []).length > 0 && (
              <div className="mt-3 border-t border-line pt-2">
                <h3 className="text-sm font-bold">Credits</h3>
                <ul className="divide-y divide-line">
                  {(data.credits ?? []).map((c) => <li key={s(c.credit_memo_id)} className="flex justify-between py-1.5 text-sm"><span>{s(c.number)} · {fmtDate(c.issue_date)}{c.status === "void" ? " · void" : ""}</span><span className="tabular">{usd(c.amount)} · {usd(c.available)} left</span></li>)}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {section === "costs" && (
        <div id="costs" className="space-y-4">
          <div className="flex flex-wrap gap-2" data-guide="fin.cost-actions">
            {perms.expense && writable && <Button size="sm" onClick={() => setOpen({ kind: "expense" })} data-testid="fin-add-expense">Record expense</Button>}
            {perms.bill && writable && <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "bill" })}>Enter a vendor bill</Button>}
            {perms.bill && writable && <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "commitment" })}>Commit a sub quote</Button>}
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <BudgetTable budget={data.budget ?? []} />
            <ProfitCard profit={data.profit ?? null} />
          </div>
          <CostLists onPayBill={(b) => setOpen({ kind: "bill_payment", bill: b })} onVoidBillPayment={(p) => setVoiding({ kind: "bill_payment", id: s(p.id), label: `bill payment of ${usd(p.amount)}` })} data={{ expenses: data.expenses ?? [], bills: data.bills ?? [], billLines: data.billLines ?? [], commitments: data.commitments ?? [], costCodes: data.costCodes ?? [], vendors: data.vendors ?? [] }} perms={perms} writable={writable} onChanged={done} />
        </div>
      )}

      {section === "review" && <ReviewQueue items={data.review ?? []} canResolve={writable && (perms.approveBill || perms.approveExpense)} onChanged={done} />}

      {open?.kind === "invoice" && <InvoiceDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} jobId={jobId} milestone={open.milestone} draft={open.draft} onDone={done} />}
      {open?.kind === "payment" && <PaymentDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} jobId={jobId} customerId={s(job.customer_id) || null} invoices={invoices} focusInvoice={open.invoice} onDone={done} />}
      {open?.kind === "credit" && <CreditDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} jobId={jobId} invoices={invoices} onDone={done} />}
      {open?.kind === "expense" && <ExpenseDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} jobId={jobId} codes={data.costCodes ?? []} vendors={data.vendors ?? []} onDone={done} />}
      {open?.kind === "bill" && <BillDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} jobId={jobId} codes={data.costCodes ?? []} vendors={data.vendors ?? []} commitments={data.commitments ?? []} onDone={done} />}
      {open?.kind === "commitment" && <CommitmentDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} jobId={jobId} codes={data.costCodes ?? []} vendors={data.vendors ?? []} quotes={data.quotes ?? []} onDone={done} />}
      {open?.kind === "bill_payment" && <BillPaymentDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} bill={open.bill} onDone={done} />}
      {open?.kind === "email" && <EmailDraftDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} invoiceId={open.invoiceId} paymentId={open.paymentId} />}
      <VoidDialog target={voiding} onOpenChange={(o) => { if (!o) setVoiding(null); }} onDone={done} />
    </div>
  );
}
