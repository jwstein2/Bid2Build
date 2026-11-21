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
import { AccountForm } from "@/components/financials/accounting/ledger-controls";
import { GL_TYPES, GL_TYPE_LABELS } from "@/lib/financials/general-ledger";
import { loadAccounts, loadBalances, syncLedger } from "@/lib/financials/general-ledger-load";
import Link from "next/link";

export const metadata: Metadata = { title: "Chart of accounts · Accounting", robots: { index: false } };
const TYPE_LABELS: Record<string, string> = { material: "Materials", delivery: "Delivery", labor: "Labor", labor_burden: "Labor burden", labor_material: "Labor & material", subcontractor: "Subcontractor", equipment: "Equipment", permit: "Permits & fees", overhead: "Overhead", contingency: "Contingency", other: "Other" };

/**
 * The general ledger's chart of accounts with each account's balance today, plus the cost codes that classify
 * job costs. Built-in accounts (cash, AR, AP, revenue...) receive the automatic postings; people add their own.
 * Falls back to the old balance-groups view until the general-ledger SQL is installed.
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
  const perms = state.ctx.access.permissions;
  const canManage = state.ctx.access.active && !state.ctx.access.readOnly && perms.includes("manage_accounts");
  const gl = await syncLedger(db, state.ctx.bookId);
  const [accounts, balances] = gl.ready ? await Promise.all([loadAccounts(db, state.ctx.bookId), loadBalances(db, state.ctx.bookId, null, null)]) : [[], []];
  const bal = new Map(balances.map((b) => [b.account_id, b.balance]));
  return (
    <AccountingShell state={state} title="Chart of accounts" active="accounts" guide="financials.accounting.accounts"
      intro={gl.ready ? "Every account in your general ledger with its balance today. Click an account to see its entries." : "Where money is classified today."}
      actions={<div className="flex flex-wrap gap-2">{canManage && gl.ready && <AccountForm />}<PrintButton /></div>}>
      {gl.ready ? (
        <section aria-labelledby="coa" className="space-y-3" data-guide="fin.acct-chart">
          <h2 id="coa" className="sr-only">Accounts</h2>
          {GL_TYPES.map((t) => {
            const list = accounts.filter((a) => a.type === t);
            if (!list.length) return null;
            return (
              <div key={t} className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[36rem] text-sm" data-testid={`gl-coa-${t}`}><caption className="px-3 pt-2 text-left text-sm font-bold">{GL_TYPE_LABELS[t]}</caption>
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2">Number</th><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Status</th>{canManage && <th className="px-3 py-2"><span className="sr-only">Edit</span></th>}</tr></thead>
                  <tbody>{list.map((a) => (
                    <tr key={a.id} className="border-t border-line align-top">
                      <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                      <td className="px-3 py-2"><Link className="font-semibold hover:underline" href={`/financials/accounting/ledger?v=detail&account=${a.id}`}>{a.name}</Link>{a.system_key && <span className="ml-2 text-xs text-muted">Built-in</span>}{a.description && <span className="block text-xs text-muted">{a.description}</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(String(bal.get(a.id) ?? "0"))}</td>
                      <td className="px-3 py-2">{a.active ? "Active" : "Off"}</td>
                      {canManage && <td className="px-3 py-2"><AccountForm account={{ id: a.id, code: a.code, name: a.name, type: a.type, active: a.active, system: Boolean(a.system_key) }} /></td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            );
          })}
          <p className="text-sm text-ink-soft">Invoices, payments, bills and expenses post to the built-in accounts automatically. Post anything else (loans, owner money, equipment, payroll from your payroll provider) as a <Link className="underline" href="/financials/accounting/ledger?v=journal">journal entry</Link>.</p>
        </section>
      ) : (
        <>
          <Notice title="General ledger: not installed yet">The chart of accounts with debit and credit balances turns on after the general-ledger database update is installed. Until then, use the groups and cost codes below.</Notice>
          <section aria-labelledby="grp" className="rounded-xl border border-line bg-surface p-4" data-guide="fin.acct-chart">
            <h2 id="grp" className="font-display text-lg font-extrabold">Balance groups</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              <li className="py-2"><span className="font-semibold">Receivables</span> · issued invoices minus payments and credits applied (see Accounts receivable)</li>
              <li className="py-2"><span className="font-semibold">Payables</span> · approved vendor bills minus bill payments (see AP aging)</li>
              {bank.ready && bank.accounts.map((a) => <li key={a.id} className="py-2"><span className="font-semibold">{a.name}{a.last4 ? ` ••${a.last4}` : ""}</span> · {a.kind.replace("_", " ")} · imported lines balance {formatCurrency(bank.balances[a.id] ?? "0")}{a.status === "archived" ? " · archived" : ""}</li>)}
              <li className="py-2"><span className="font-semibold">Income</span> · invoices and payments, by project and trade (see Profit &amp; Loss)</li>
            </ul>
          </section>
        </>
      )}
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
