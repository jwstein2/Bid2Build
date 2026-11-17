import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { formatCurrency } from "@/lib/estimate/money";
import { buildLedger } from "@/lib/financials/ledger";
import { add } from "@/lib/financials/money";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/misc";
import { FinStateNotice } from "@/components/financials/fin-state-notice";

export const metadata: Metadata = { title: "Customer ledger", robots: { index: false } };
type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const $ = (v: unknown) => formatCurrency(s(v) || "0");
const fmt = (d: unknown) => { const x = s(d).slice(0, 10); if (!x) return "—"; const [y, m, dd] = x.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };

/**
 * Customer financial view (V5 §8.4, V5.1 §9): approved contracts, change orders, invoices, payments,
 * credits and the running balance, from the same records the jobs use. Read through RLS: a person sees
 * only the jobs and documents their financial role allows. Internal costs and margin aren't shown here.
 */
export default async function CustomerLedger({ params }: { params: Promise<{ customerId: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const { customerId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) notFound();
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready") return <div className="mx-auto max-w-4xl space-y-4"><FinStateNotice state={state} /></div>;
  const b = state.ctx.bookId;
  const [{ data: cust }, { data: jobs }, { data: inv }, { data: pays }, { data: credits }, { data: bal }] = await Promise.all([
    db.from("customers").select("id, name, email, phone, project_address").eq("id", customerId).maybeSingle(),
    db.from("fin_jobs").select("id, estimate_id, job_number, name, status").eq("book_id", b).eq("customer_id", customerId),
    db.from("fin_ar_invoices_v").select("invoice_id, number, job_id, job_name, estimate_id, issue_date, due_date, total, paid, credited, balance, days_overdue, customer_name").eq("book_id", b).eq("customer_id", customerId).order("issue_date"),
    db.from("fin_payment_balances_v").select("payment_id, number, received_on, method, amount, refunded, unapplied, status, verified").eq("book_id", b).eq("customer_id", customerId).order("received_on"),
    db.from("fin_credit_memo_balances_v").select("credit_memo_id, number, issue_date, amount, refunded, available, status").eq("book_id", b).eq("customer_id", customerId).order("issue_date"),
    db.from("fin_customer_balances_v").select("*").eq("book_id", b).eq("customer_id", customerId).maybeSingle(),
  ]);
  const J = (jobs ?? []) as Row[], I = (inv ?? []) as Row[], P = (pays ?? []) as Row[], C = (credits ?? []) as Row[];
  if (!cust && J.length === 0 && I.length === 0 && P.length === 0) notFound();
  const name = s((cust as Row | null)?.name) || s(I[0]?.customer_name) || "Customer";
  const jobIds = J.map((j) => s(j.id));
  const [{ data: summaries }, { data: changes }, { data: voided }] = jobIds.length ? await Promise.all([
    db.from("fin_job_summary_v").select("job_id, contract_value, original_contract, contract_changes, invoiced, collected, outstanding_ar, unbilled, pending_changes").in("job_id", jobIds),
    db.from("fin_contract_changes").select("id, job_id, kind, amount, description, effective_at").in("job_id", jobIds).order("effective_at"),
    db.from("fin_invoices").select("id, number, issue_date, total, status").in("job_id", jobIds).eq("status", "void"),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const S = (summaries ?? []) as Row[];
  const ledger = buildLedger({
    invoices: [...I.map((x) => ({ id: s(x.invoice_id), number: s(x.number), issue_date: s(x.issue_date).slice(0, 10), total: s(x.total), status: "issued", job_name: s(x.job_name) })),
      ...((voided ?? []) as Row[]).filter((x) => x.issue_date).map((x) => ({ id: s(x.id), number: s(x.number), issue_date: s(x.issue_date).slice(0, 10), total: s(x.total), status: "void" }))],
    payments: P.map((x) => ({ id: s(x.payment_id), number: s(x.number), received_on: s(x.received_on).slice(0, 10), amount: s(x.amount), refunded: s(x.refunded) || "0", status: s(x.status), method: s(x.method) })),
    credits: C.map((x) => ({ id: s(x.credit_memo_id), number: s(x.number), issue_date: s(x.issue_date).slice(0, 10), amount: s(x.amount), refunded: s(x.refunded) || "0", status: s(x.status) })),
  });
  const B = (bal ?? {}) as Row;
  const contracted = add(0, ...S.map((x) => s(x.contract_value) || "0"));

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="fin-customer-ledger" data-guide-page="financials.customer">
      <Breadcrumbs items={[{ label: "Financials", href: "/financials" }, { label: "Accounts receivable", href: "/financials/receivables" }, { label: name }]} />
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Customer account</p>
        <h1 className="text-3xl font-extrabold">{name}</h1>
        <p className="text-sm text-ink-soft">{[s((cust as Row | null)?.email), s((cust as Row | null)?.phone), s((cust as Row | null)?.project_address)].filter(Boolean).join(" · ")}</p>
        {cust && <Link href={`/dashboard/customers/${customerId}`} className="text-sm font-semibold text-accent-ink underline">Customer details</Link>}
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Account summary">
        <MetricCard size="sm" title="Approved contracts" value={$(contracted)} sub={`${J.length} project${J.length === 1 ? "" : "s"}`} href="#contracts" action="Projects" testId="cust-contracts" />
        <MetricCard size="sm" title="Open balance" value={$(B.open_balance)} sub="Issued invoices not yet paid" tone={Number(B.days_1_30 ?? 0) + Number(B.days_31_60 ?? 0) + Number(B.days_61_90 ?? 0) + Number(B.over_90 ?? 0) > 0 ? "danger" : "default"} href={`/financials/receivables?customer=${customerId}`} action="Open invoices" testId="cust-open" />
        <MetricCard size="sm" title="Unapplied money" value={$(add(s(B.unapplied_payments) || "0", s(B.available_credits) || "0"))} sub="Payments + credits not applied yet" href="#activity" action="Activity" testId="cust-unapplied" />
        <MetricCard size="sm" title="Net balance" value={$(ledger.balance)} sub="Owed after unapplied money" href="#activity" action="Activity" testId="cust-net" />
      </section>

      <section id="contracts" aria-labelledby="cust-proj-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="cust-proj-h" className="font-display text-lg font-extrabold">Projects &amp; contracts</h2>
        {J.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No projects with financials yet.</p> : (
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[44rem] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted">{["Project", "Signed", "Approved changes", "Contract", "Invoiced", "Collected", "Outstanding", "Not billed yet"].map((h, i) => <th key={h} className={`py-2 pr-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{J.map((j) => { const x = S.find((y) => y.job_id === j.id) ?? {}; return (
              <tr key={s(j.id)} className="border-b border-line last:border-0">
                <td className="py-2 pr-2"><Link className="font-semibold underline" href={`/financials/jobs/${s(j.estimate_id)}`}>{s(j.name)}</Link><span className="block text-xs text-muted">{s(j.job_number)}{Number((x as Row).pending_changes ?? 0) > 0 ? ` · ${$((x as Row).pending_changes)} pending changes` : ""}</span></td>
                {["original_contract", "contract_changes", "contract_value", "invoiced", "collected", "outstanding_ar", "unbilled"].map((k) => <td key={k} className="py-2 pr-2 text-right tabular">{$((x as Row)[k])}</td>)}
              </tr>); })}</tbody>
          </table></div>
        )}
        {((changes ?? []) as Row[]).length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <h3 className="text-sm font-bold">Approved change orders &amp; adjustments</h3>
            <ul className="divide-y divide-line">{((changes ?? []) as Row[]).map((c) => <li key={s(c.id)} className="flex justify-between gap-2 py-1.5 text-sm"><span>{fmt(c.effective_at)} · {s(c.description) || s(c.kind).replace(/_/g, " ")} <span className="text-muted">({s(J.find((j) => j.id === c.job_id)?.name)})</span></span><span className="tabular">{$(c.amount)}</span></li>)}</ul>
          </div>
        )}
      </section>

      <section id="activity" aria-labelledby="cust-led-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="cust-led-h" className="font-display text-lg font-extrabold">Account activity</h2>
        {ledger.lines.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No invoices or payments yet.</p> : (
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[40rem] text-sm" data-testid="cust-ledger-table">
            <thead><tr className="border-b border-line text-left text-xs text-muted">{["Date", "Type", "Number", "Detail", "Charges", "Payments & credits", "Balance"].map((h, i) => <th key={h} className={`py-2 pr-2 font-semibold ${i >= 4 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{ledger.lines.map((l) => (
              <tr key={l.key} className={`border-b border-line last:border-0 ${l.voided ? "text-muted line-through" : ""}`}>
                <td className="py-2 pr-2 tabular">{fmt(l.date)}</td>
                <td className="py-2 pr-2">{l.kind === "invoice" ? "Invoice" : l.kind === "payment" ? "Payment" : l.kind === "credit" ? "Credit" : "Refund"}{l.voided && <Badge tone="neutral">Void</Badge>}</td>
                <td className="py-2 pr-2">{l.kind === "invoice" ? <a className="underline" href={`/api/financials/invoices/${l.key.slice(1)}/pdf`} target="_blank" rel="noopener">{l.ref}</a> : l.ref}</td>
                <td className="py-2 pr-2 text-muted">{l.detail}</td>
                <td className="py-2 pr-2 text-right tabular">{Number(l.charge) ? $(l.charge) : ""}</td>
                <td className="py-2 pr-2 text-right tabular">{Number(l.credit) ? $(l.credit) : ""}</td>
                <td className="py-2 text-right font-semibold tabular">{$(l.balance)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
