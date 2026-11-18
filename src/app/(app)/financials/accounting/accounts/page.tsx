import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadBank, loadLookups } from "@/lib/financials/accounting-load";
import { formatCurrency } from "@/lib/estimate/money";
import { Notice } from "@/components/ui/misc";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { PrintButton } from "@/components/financials/accounting/controls";

export const metadata: Metadata = { title: "Chart of accounts · Accounting", robots: { index: false } };
const TYPE_LABELS: Record<string, string> = { material: "Materials", delivery: "Delivery", labor: "Labor", labor_burden: "Labor burden", labor_material: "Labor & material", subcontractor: "Subcontractor", equipment: "Equipment", permit: "Permits & fees", overhead: "Overhead", contingency: "Contingency", other: "Other" };

/**
 * What exists today in place of a chart of accounts: the fixed balance groups (receivables, payables, bank
 * accounts) and the cost codes costs are classified with. A real chart of accounts with double-entry
 * postings is the general-ledger phase and needs a CPA review; this page says so instead of faking one.
 */
export default async function Accounts() {
  if (!isFinancialsEnabled()) notFound();
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} title="Chart of accounts" active="accounts" guide="financials.accounting.accounts" />;
  const L = await loadLookups(db, state.ctx.bookId);
  const bank = await loadBank(db, state.ctx.bookId, L);
  const { data: codes } = await db.from("fin_cost_codes").select("id, code, name, trade_slug, cost_type, active").eq("book_id", state.ctx.bookId).order("code");
  const rows = (codes ?? []) as { id: string; code: string; name: string; trade_slug: string | null; cost_type: string | null; active: boolean }[];
  const trades = [...new Set(rows.map((r) => r.trade_slug ?? "general"))];
  return (
    <AccountingShell state={state} title="Chart of accounts" active="accounts" guide="financials.accounting.accounts"
      intro="Where money is classified today. Built2Bid doesn't keep a double-entry general ledger yet, so there's no editable chart of accounts with debit and credit balances."
      actions={<PrintButton />}>
      <Notice title="General ledger: not built yet">A full chart of accounts (assets, liabilities, equity, income, expense) with journal entries, a trial balance and a balance sheet needs the general-ledger phase and a CPA review of the account mapping. Until then, use the groups and cost codes below, and export the transaction ledger for your accountant&apos;s books.</Notice>
      <section aria-labelledby="grp" className="rounded-xl border border-line bg-surface p-4" data-guide="fin.acct-groups">
        <h2 id="grp" className="font-display text-lg font-extrabold">Balance groups</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          <li className="py-2"><span className="font-semibold">Receivables</span> · issued invoices minus payments and credits applied (see Accounts receivable)</li>
          <li className="py-2"><span className="font-semibold">Payables</span> · approved vendor bills minus bill payments (see AP aging)</li>
          {bank.ready && bank.accounts.map((a) => <li key={a.id} className="py-2"><span className="font-semibold">{a.name}{a.last4 ? ` ••${a.last4}` : ""}</span> · {a.kind.replace("_", " ")} · imported lines balance {formatCurrency(bank.balances[a.id] ?? "0")}{a.status === "archived" ? " · archived" : ""}</li>)}
          <li className="py-2"><span className="font-semibold">Income</span> · invoices and payments, by project and trade (see Profit &amp; Loss)</li>
        </ul>
      </section>
      <section aria-labelledby="cc" className="space-y-3" data-guide="fin.acct-codes">
        <h2 id="cc" className="font-display text-lg font-extrabold">Cost codes ({rows.length})</h2>
        <p className="text-sm text-ink-soft">Every bill line and expense is classified with one of these. They come from your trade setup; manage them in Trade setup.</p>
        {trades.map((t) => (
          <div key={t} className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[32rem] text-sm"><caption className="px-3 pt-2 text-left text-sm font-bold capitalize">{t.replace(/[-_]/g, " ")}</caption>
              <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>{rows.filter((r) => (r.trade_slug ?? "general") === t).map((r) => <tr key={r.id} className="border-t border-line"><td className="px-3 py-2 font-mono text-xs">{r.code}</td><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2">{TYPE_LABELS[r.cost_type ?? ""] ?? "—"}</td><td className="px-3 py-2">{r.active ? "Active" : "Inactive"}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-muted">No cost codes yet. Finish Trade setup to get starter codes.</p>}
      </section>
    </AccountingShell>
  );
}
