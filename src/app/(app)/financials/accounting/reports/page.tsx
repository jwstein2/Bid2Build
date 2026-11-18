import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import {
  loadApAging, loadCustomerBalances, loadExpensesByCategory, loadJobCosting, loadLaborVariance, loadLookups, loadSubPayments,
} from "@/lib/financials/accounting-load";
import { AGING_BUCKETS, AGING_LABELS, REPORT_CATALOG, searchCatalog } from "@/lib/financials/accounting";
import { PERIODS, PERIOD_LABELS, periodRange, type Period } from "@/lib/financials/reports";
import { add, cmp } from "@/lib/financials/money";
import { formatCurrency } from "@/lib/estimate/money";
import { Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { PrintButton, ReportCatalog } from "@/components/financials/accounting/controls";
import { fmtDateServer } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Reports · Accounting", robots: { index: false } };
const VIEWS = ["ap_aging", "customer_balances", "job_costing", "labor_variance", "expenses_by_category", "sub_payments"] as const;
type View = (typeof VIEWS)[number];
const DATED: View[] = ["expenses_by_category", "sub_payments"];
const $ = (v: string) => formatCurrency(v);
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted";
const thr = `${th} text-right`;
const td = "px-3 py-2";
const tdr = "px-3 py-2 text-right tabular-nums";

/** Searchable report catalog plus the Accountant Mode reports. Every number comes from recorded records; reports that need the ledger are listed as blocked. */
export default async function AccountingReports({ searchParams }: { searchParams: Promise<{ r?: string; period?: string; from?: string; to?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const view: View | null = sp.r && (VIEWS as readonly string[]).includes(sp.r) ? (sp.r as View) : null;
  const title = view ? REPORT_CATALOG.find((r) => r.key === view)!.label : "Reports";
  const active = view === "ap_aging" || view === "customer_balances" ? "arap" : "reports";
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} title={title} active={active} guide="financials.accounting.reports" />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const canExport = perms.includes("export_financials");

  if (!view) {
    return (
      <AccountingShell state={state} title="Reports" active="reports" guide="financials.accounting.reports"
        intro="Search every report. Each one is built from the records your team enters. Reports that need the general ledger are listed with what they need, and show no numbers.">
        <ReportCatalog items={searchCatalog("", perms)} canExport={canExport} />
      </AccountingShell>
    );
  }
  const L = await loadLookups(db, ctx.bookId);
  const range = periodRange((PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "ytd", new Date(), { from: sp.from, to: sp.to });
  const csvKind = REPORT_CATALOG.find((r) => r.key === view)?.csv;
  const csvHref = `/api/financials/export?kind=${csvKind}${DATED.includes(view) ? `&from=${range.from}&to=${range.to}` : ""}`;
  const actions = <div className="no-print flex flex-wrap gap-2">{canExport && csvKind && <ButtonLink href={csvHref} variant="secondary" size="sm" data-testid="fin-report-csv">Download CSV</ButtonLink>}<PrintButton /></div>;
  const periodForm = DATED.includes(view) && (
    <form method="get" className="no-print flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3" aria-label="Report period">
      <input type="hidden" name="r" value={view} />
      <label className="label" htmlFor="rp">Period<select id="rp" name="period" className="field field-sm mt-1" defaultValue={range.period}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</select></label>
      <label className="label" htmlFor="rf">From (custom)<input id="rf" name="from" type="date" className="field field-sm mt-1" defaultValue={range.from} /></label>
      <label className="label" htmlFor="rt">To (custom)<input id="rt" name="to" type="date" className="field field-sm mt-1" defaultValue={range.to} /></label>
      <button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white">Show</button>
      <p className="basis-full text-xs text-muted">{fmtDateServer(range.from)} to {fmtDateServer(range.to)}</p>
    </form>
  );
  const back = <Link href="/financials/accounting/reports" className="no-print inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">All reports</Link>;
  let body: React.ReactNode = null;

  if (view === "ap_aging") {
    const a = await loadApAging(db, ctx.bookId, L);
    body = (
      <>
        <p className="text-sm text-ink-soft">Approved bills with a balance, as of today. Bills waiting for approval aren&apos;t owed yet and are in the Review queue. Accounts receivable aging is on the <Link href="/financials/receivables" className="font-semibold text-accent-ink underline">Accounts receivable</Link> page.</p>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[44rem] text-sm" data-testid="fin-ap-aging">
          <thead><tr className="border-b border-line"><th className={th}>Vendor</th>{AGING_BUCKETS.map((b) => <th key={b} className={thr}>{AGING_LABELS[b]}</th>)}<th className={thr}>Total</th></tr></thead>
          <tbody>{a.byParty.map((p) => <tr key={p.party} className="border-b border-line"><td className={td}>{p.party}</td>{AGING_BUCKETS.map((b) => <td key={b} className={tdr}>{$(p.buckets[b])}</td>)}<td className={`${tdr} font-semibold`}>{$(p.total)}</td></tr>)}
            {!a.byParty.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No unpaid approved bills.</td></tr>}</tbody>
          <tfoot><tr className="font-semibold"><td className={td}>Total</td>{AGING_BUCKETS.map((b) => <td key={b} className={tdr}>{$(a.byBucket[b])}</td>)}<td className={tdr}>{$(a.total)}</td></tr></tfoot>
        </table></div>
        {a.rows.length > 0 && <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[36rem] text-sm"><thead><tr className="border-b border-line"><th className={th}>Bill</th><th className={th}>Vendor</th><th className={th}>Due</th><th className={thr}>Balance</th></tr></thead>
          <tbody>{a.rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><td className={td}><Link href="/financials/records?view=costs&filter=bills_due" className="text-accent-ink underline">{r.number}</Link></td><td className={td}>{r.party}</td><td className={td}>{fmtDateServer(r.due_date)}</td><td className={tdr}>{$(r.balance)}</td></tr>)}</tbody></table></div>}
      </>
    );
  } else if (view === "customer_balances") {
    const rows = await loadCustomerBalances(db, ctx.bookId, L);
    body = (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[48rem] text-sm" data-testid="fin-customer-balances">
        <thead><tr className="border-b border-line"><th className={th}>Customer</th><th className={thr}>Invoices</th><th className={thr}>Invoiced</th><th className={thr}>Paid</th><th className={thr}>Credited</th><th className={thr}>Owed</th><th className={thr}>Payments not applied</th></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.customer} className="border-b border-line last:border-0"><td className={td}>{c.customer}</td><td className={tdr}>{c.invoices}</td><td className={tdr}>{$(c.invoiced)}</td><td className={tdr}>{$(c.paid)}</td><td className={tdr}>{$(c.credited)}</td><td className={`${tdr} font-semibold`}>{$(c.balance)}</td><td className={tdr}>{$(c.unapplied)}</td></tr>)}
          {!rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No issued invoices yet.</td></tr>}</tbody>
        <tfoot><tr className="font-semibold"><td className={td}>Total</td><td className={tdr}>{rows.reduce((t, r) => t + r.invoices, 0)}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.invoiced)))}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.paid)))}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.credited)))}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.balance)))}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.unapplied)))}</td></tr></tfoot>
      </table></div>
    );
  } else if (view === "job_costing") {
    const rows = await loadJobCosting(db, ctx.bookId, L);
    const tot = (k: "budget" | "committed" | "actual" | "forecast" | "variance") => add(0, ...rows.map((r) => r[k]));
    body = (
      <>
        <p className="text-sm text-ink-soft"><strong>Budget</strong> is frozen from the contract version. <strong>Committed</strong> is open subcontracts and purchase orders not yet billed. <strong>Actual</strong> is approved bills and expenses. <strong>Forecast</strong> is the larger of budget and actual + committed, per cost code. <strong>Variance</strong> = budget − forecast (negative means over budget).</p>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[52rem] text-sm" data-testid="fin-job-costing">
          <thead><tr className="border-b border-line"><th className={th}>Project</th><th className={th}>Trade</th><th className={thr}>Budget</th><th className={thr}>Committed</th><th className={thr}>Actual</th><th className={thr}>Forecast</th><th className={thr}>Variance</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={`${r.jobId}${r.trade}`} className="border-b border-line last:border-0"><td className={td}>{r.href ? <Link href={r.href} className="text-accent-ink underline">{r.project}</Link> : r.project}</td><td className={td}>{r.trade}</td>
            <td className={tdr}>{$(r.budget)}</td><td className={tdr}>{$(r.committed)}</td><td className={tdr}>{$(r.actual)}</td><td className={tdr}>{$(r.forecast)}</td><td className={`${tdr} font-semibold ${cmp(r.variance, 0) < 0 ? "text-danger" : ""}`}>{$(r.variance)}</td></tr>)}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No project budgets or costs yet.</td></tr>}</tbody>
          <tfoot><tr className="font-semibold"><td className={td} colSpan={2}>Total</td><td className={tdr}>{$(tot("budget"))}</td><td className={tdr}>{$(tot("committed"))}</td><td className={tdr}>{$(tot("actual"))}</td><td className={tdr}>{$(tot("forecast"))}</td><td className={tdr}>{$(tot("variance"))}</td></tr></tfoot>
        </table></div>
      </>
    );
  } else if (view === "labor_variance") {
    const rows = await loadLaborVariance(db, ctx.bookId, L);
    body = (
      <>
        <Notice title="Built2Bid doesn't run payroll">These are labor costs recorded as bills and expenses (labor cost codes) compared with the bid&apos;s labor estimate. Payroll itself, taxes and pay stubs stay with your payroll provider. Hours from the time clock are on <Link href="/projects/team/time" className="font-semibold underline">Team time</Link>.</Notice>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[44rem] text-sm" data-testid="fin-labor-variance">
          <thead><tr className="border-b border-line"><th className={th}>Project</th><th className={thr}>Estimated labor</th><th className={thr}>Committed</th><th className={thr}>Actual labor</th><th className={thr}>Variance</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.jobId} className="border-b border-line last:border-0"><td className={td}>{r.href ? <Link href={r.href} className="text-accent-ink underline">{r.project}</Link> : r.project}</td><td className={tdr}>{$(r.estimated)}</td><td className={tdr}>{$(r.committed)}</td><td className={tdr}>{$(r.actual)}</td><td className={`${tdr} font-semibold ${cmp(r.variance, 0) < 0 ? "text-danger" : ""}`}>{$(r.variance)}</td></tr>)}
            {!rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No labor budgets or labor costs yet.</td></tr>}</tbody>
        </table></div>
      </>
    );
  } else if (view === "expenses_by_category") {
    const r = await loadExpensesByCategory(db, ctx.bookId, range.from, range.to);
    body = r ? (
      <>
        <p className="text-sm text-ink-soft">Billed basis: approved vendor bills (on the bill date) plus approved expenses (on the day spent). The same numbers as the cost side of the <Link href={`/financials/reports?basis=billed&period=custom&from=${range.from}&to=${range.to}`} className="font-semibold text-accent-ink underline">Profit &amp; Loss</Link>.</p>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[24rem] text-sm" data-testid="fin-exp-category">
          <thead><tr className="border-b border-line"><th className={th}>Category</th><th className={thr}>Amount</th><th className={thr}>Share</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.category} className="border-b border-line last:border-0"><td className={td}>{x.category}</td><td className={tdr}>{$(x.amount)}</td><td className={tdr}>{cmp(r.total, 0) > 0 ? `${((Number(x.amount) / Number(r.total)) * 100).toFixed(1)}%` : "—"}</td></tr>)}
            {!r.rows.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">No approved costs in this period.</td></tr>}</tbody>
          <tfoot><tr className="font-semibold"><td className={td}>Total</td><td className={tdr}>{$(r.total)}</td><td /></tr></tfoot>
        </table></div>
      </>
    ) : <Notice title="Not available">Company reports need a company financial role.</Notice>;
  } else if (view === "sub_payments") {
    const rows = await loadSubPayments(db, ctx.bookId, L, range.from, range.to);
    body = (
      <>
        <p className="text-sm text-ink-soft">Money paid to vendors marked as subcontractors: bill payments (on the day paid) plus approved expenses with that vendor. For 1099 totals by tax year, with W-9 status, see <Link href="/projects/team/1099" className="font-semibold text-accent-ink underline">1099 totals</Link>.</p>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[36rem] text-sm" data-testid="fin-sub-payments">
          <thead><tr className="border-b border-line"><th className={th}>Subcontractor</th><th className={thr}>Bill payments</th><th className={thr}>Expenses</th><th className={thr}>Total</th><th className={thr}>Records</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.vendor} className="border-b border-line last:border-0"><td className={td}>{x.vendor}</td><td className={tdr}>{$(x.bills)}</td><td className={tdr}>{$(x.expenses)}</td><td className={`${tdr} font-semibold`}>{$(x.total)}</td><td className={tdr}>{x.count}</td></tr>)}
            {!rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No payments to subcontractors in this period.</td></tr>}</tbody>
          <tfoot><tr className="font-semibold"><td className={td}>Total</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.bills)))}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.expenses)))}</td><td className={tdr}>{$(add(0, ...rows.map((r) => r.total)))}</td><td className={tdr}>{rows.reduce((t, r) => t + r.count, 0)}</td></tr></tfoot>
        </table></div>
      </>
    );
  }

  return (
    <AccountingShell state={state} title={title} active={active} guide="financials.accounting.reports" actions={actions}>
      {back}
      {periodForm}
      <div className="space-y-3" data-guide="fin.acct-report">{body}</div>
    </AccountingShell>
  );
}
