import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadBank, loadLookups, loadTxns } from "@/lib/financials/accounting-load";
import { filterTxns, POSTING_LABELS, RECON_LABELS, TXN_SOURCE_LABELS, type Posting, type Recon, type TxnFilter, type TxnSource } from "@/lib/financials/accounting";
import { formatCurrency } from "@/lib/estimate/money";
import { add } from "@/lib/financials/money";
import { Badge } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { PrintButton } from "@/components/financials/accounting/controls";
import { fmtDateServer } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Transactions · Accounting", robots: { index: false } };
const SHOW = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const POSTING_TONE: Record<Posting, "neutral" | "ok" | "warn" | "danger"> = { draft: "neutral", pending: "warn", posted: "ok", void: "danger", rejected: "danger" };

/**
 * The transaction ledger: every invoice, credit, payment, refund, bill, bill payment and expense, from the
 * same records Contractor Mode uses (no second ledger). Filters live in the URL. Corrections happen on the
 * record: drafts can be deleted where allowed, anything posted is voided or reversed, and history stays.
 */
export default async function Transactions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} title="Transactions" active="transactions" guide="financials.accounting.transactions" />;
  const { ctx } = state;
  const L = await loadLookups(db, ctx.bookId);
  const bank = await loadBank(db, ctx.bookId, L);
  const all = await loadTxns(db, ctx.bookId, L, bank);
  const f: TxnFilter = {
    q: (sp.q ?? "").slice(0, 100), source: (sp.source && sp.source in TXN_SOURCE_LABELS ? sp.source : "") as TxnSource | "",
    posting: (sp.posting && sp.posting in POSTING_LABELS ? sp.posting : "") as Posting | "", recon: (sp.recon && sp.recon in RECON_LABELS ? sp.recon : "") as Recon | "",
    job: sp.job ?? "", dir: sp.dir === "in" || sp.dir === "out" ? sp.dir : "", from: DAY.test(sp.from ?? "") ? sp.from : "", to: DAY.test(sp.to ?? "") ? sp.to : "",
  };
  const rows = filterTxns(all, f);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const canExport = ctx.access.permissions.includes("export_financials");
  const inTotal = add(0, ...rows.filter((r) => r.direction === "in" && r.posting === "posted").map((r) => r.amount));
  const outTotal = add(0, ...rows.filter((r) => r.direction === "out" && r.posting === "posted").map((r) => r.amount));
  const sel = "field field-sm mt-1";

  return (
    <AccountingShell state={state} title="Transactions" active="transactions" guide="financials.accounting.transactions"
      intro="Every money record in one list, from the same records your team enters. This is a transaction list, not a double-entry general ledger (that comes with the ledger phase)."
      actions={<div className="flex flex-wrap gap-2">{canExport && <ButtonLink href={`/api/financials/export?kind=transactions${qs ? `&${qs}` : ""}`} variant="secondary" size="sm" data-testid="fin-txn-export">Download CSV</ButtonLink>}<PrintButton /></div>}>
      <form method="get" className="no-print grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6" data-guide="fin.acct-txn-filters" role="search" aria-label="Filter transactions">
        <label className="label sm:col-span-3 lg:col-span-2" htmlFor="tq">Search<input id="tq" name="q" type="search" className={sel} defaultValue={f.q} placeholder="Number, description, customer, vendor, amount" /></label>
        <label className="label" htmlFor="ts">Type<select id="ts" name="source" className={sel} defaultValue={f.source}><option value="">All types</option>{Object.entries(TXN_SOURCE_LABELS).filter(([k]) => k !== "bank").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="label" htmlFor="tp">Posting status<select id="tp" name="posting" className={sel} defaultValue={f.posting}><option value="">Any</option>{Object.entries(POSTING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="label" htmlFor="tr">Bank status<select id="tr" name="recon" className={sel} defaultValue={f.recon}><option value="">Any</option>{(["matched", "unmatched", "reconciled"] as const).map((k) => <option key={k} value={k}>{RECON_LABELS[k]}</option>)}</select></label>
        <label className="label" htmlFor="tj">Project<select id="tj" name="job" className={sel} defaultValue={f.job}><option value="">All projects</option><option value="none">No project / overhead</option>{[...L.jobs.values()].map((j) => <option key={j.id} value={j.id}>{j.number} · {j.name}</option>)}</select></label>
        <label className="label" htmlFor="td">In / out<select id="td" name="dir" className={sel} defaultValue={f.dir}><option value="">Both</option><option value="in">Money in</option><option value="out">Money out</option></select></label>
        <label className="label" htmlFor="tf">From<input id="tf" name="from" type="date" className={sel} defaultValue={f.from} /></label>
        <label className="label" htmlFor="tt">To<input id="tt" name="to" type="date" className={sel} defaultValue={f.to} /></label>
        <div className="flex items-end gap-2"><button type="submit" className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white">Apply</button>{qs && <Link href="/financials/accounting/transactions" className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-ink underline">Clear</Link>}</div>
      </form>
      <p className="text-sm text-ink-soft" data-testid="fin-txn-count">{rows.length} transaction{rows.length === 1 ? "" : "s"}{rows.length > SHOW ? ` (first ${SHOW} shown; the CSV has all)` : ""} · Posted money in {formatCurrency(inTotal)} · Posted money out {formatCurrency(outTotal)}</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface" data-guide="fin.acct-txn-table">
        <table className="w-full min-w-[72rem] text-sm" data-testid="fin-txn-table">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Date</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">In / out</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Customer / vendor</th><th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">Posting</th><th className="px-3 py-2">Bank</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Docs</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, SHOW).map((r) => (
              <tr key={r.key} className="border-b border-line align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2">{fmtDateServer(r.date)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.href ? <Link href={r.href} className="font-semibold text-accent-ink underline">{r.number}</Link> : r.number}</td>
                <td className="px-3 py-2">{r.description}</td>
                <td className="px-3 py-2">{r.account}</td>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2">{r.direction === "in" ? "In" : r.direction === "out" ? "Out" : "—"}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${r.posting === "void" ? "text-muted line-through" : ""}`}>{formatCurrency(r.amount)}</td>
                <td className="px-3 py-2">{r.party ?? "—"}</td>
                <td className="px-3 py-2">{r.project ?? "—"}</td>
                <td className="px-3 py-2"><Badge tone={POSTING_TONE[r.posting]}>{POSTING_LABELS[r.posting]}</Badge></td>
                <td className="px-3 py-2">{RECON_LABELS[r.recon]}</td>
                <td className="px-3 py-2">{TXN_SOURCE_LABELS[r.source]}</td>
                <td className="px-3 py-2">{r.documents ? `${r.documents}` : "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={13} className="px-3 py-6 text-center text-muted">No transactions match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Corrections: a draft invoice can be deleted from its project; anything posted is voided or reversed on its record (with a reason), so the original and the correction both stay in the audit trail. Bank status shows whether a payment or expense is matched to an imported bank line.</p>
    </AccountingShell>
  );
}
