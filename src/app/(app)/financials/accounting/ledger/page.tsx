import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { loadLookups, todayIso } from "@/lib/financials/accounting-load";
import { fmtDateServer } from "@/lib/financials/accounting-format";
import { formatCurrency } from "@/lib/estimate/money";
import { Notice } from "@/components/ui/misc";
import { AccountingShell } from "@/components/financials/accounting/shell";
import { PrintButton } from "@/components/financials/accounting/controls";
import { ClosePeriod, JournalForm, ReverseEntry } from "@/components/financials/accounting/ledger-controls";
import {
  balanceSheet, incomeStatement, trialBalance, EVENT_LABELS, LEDGER_VIEWS, LEDGER_VIEW_LABELS, SOURCE_LABELS, type LedgerView, type StatementSection,
} from "@/lib/financials/general-ledger";
import { loadAccounts, loadActivity, loadBalances, loadJournal, loadLockedThrough, loadReversedIds, syncLedger } from "@/lib/financials/general-ledger-load";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "General ledger · Accounting", robots: { index: false } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: string | number) => formatCurrency(String(v));
const REVERSIBLE = new Set(["manual", "payroll", "opening"]);

function Section({ s, testid }: { s: StatementSection; testid: string }) {
  return (
    <tbody data-testid={testid}>
      <tr className="border-t border-line"><th colSpan={2} className="px-3 pb-1 pt-3 text-left font-display font-extrabold">{s.label}</th></tr>
      {s.lines.length === 0 && <tr><td colSpan={2} className="px-3 py-1 text-muted">None</td></tr>}
      {s.lines.map((l) => (
        <tr key={l.accountId}><td className="px-3 py-1"><Link className="underline-offset-2 hover:underline" href={`/financials/accounting/ledger?v=detail&account=${l.accountId}`}><span className="font-mono text-xs text-muted">{l.code}</span> {l.name}</Link></td><td className="px-3 py-1 text-right tabular-nums">{money(l.amount)}</td></tr>
      ))}
      <tr className="font-semibold"><td className="px-3 py-1">Total {s.label.toLowerCase()}</td><td className="px-3 py-1 text-right tabular-nums">{money(s.total)}</td></tr>
    </tbody>
  );
}

/**
 * General ledger: Balance sheet, Income statement, Trial balance, Account detail and the Journal. Opening the page
 * brings the ledger up to date (posting is idempotent), so every report reflects the records as they are now.
 */
export default async function Ledger({ searchParams }: { searchParams: Promise<{ v?: string; from?: string; to?: string; account?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const shell = { title: "General ledger", active: "ledger" as const, guide: "financials.accounting.ledger" as const };
  if (state.kind !== "ready" || !state.ctx.access.permissions.includes("view_company_financials")) return <AccountingShell state={state} {...shell} />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const canWrite = ctx.access.active && !ctx.access.readOnly;
  const view: LedgerView = (LEDGER_VIEWS as readonly string[]).includes(sp.v ?? "") ? (sp.v as LedgerView) : "balance";
  const today = todayIso();
  const to = DAY.test(sp.to ?? "") ? sp.to! : today;
  const from = DAY.test(sp.from ?? "") && sp.from! <= to ? sp.from! : `${to.slice(0, 4)}-01-01`;

  const sync = await syncLedger(db, ctx.bookId);
  if (!sync.ready) {
    return (
      <AccountingShell state={state} {...shell}>
        <Notice title="The general ledger isn't installed yet">It turns on after the general-ledger database update is installed. Until then, use the Transaction ledger and the Profit &amp; Loss report.</Notice>
      </AccountingShell>
    );
  }
  const [accounts, lockedThrough, L] = await Promise.all([loadAccounts(db, ctx.bookId), loadLockedThrough(db, ctx.bookId), loadLookups(db, ctx.bookId)]);
  const acctName = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const jobName = (id: string | null) => (id ? (L.jobs.get(id) ? `${L.jobs.get(id)!.number} · ${L.jobs.get(id)!.name}` : "") : "");
  const accountId = accounts.find((a) => a.id === sp.account)?.id ?? accounts.find((a) => a.system_key === "cash")?.id ?? accounts[0]?.id;
  const usesFrom = view === "income" || view === "detail" || view === "journal";
  const href = (v: LedgerView) => `/financials/accounting/ledger?v=${v}&from=${from}&to=${to}${v === "detail" && accountId ? `&account=${accountId}` : ""}`;
  const csvKind = { balance: "gl_balance_sheet", income: "gl_income_statement", trial: "gl_trial_balance", detail: "general_ledger", journal: "general_ledger" }[view];
  const canExport = perms.includes("export_financials");

  let body: React.ReactNode = null;
  if (view === "balance" || view === "trial") {
    const rows = await loadBalances(db, ctx.bookId, null, to);
    if (view === "balance") {
      const b = balanceSheet(rows);
      body = (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[28rem] text-sm" data-testid="gl-balance-sheet">
            <caption className="px-3 pt-3 text-left text-sm text-ink-soft">Balance sheet at {fmtDateServer(to)}</caption>
            <Section s={b.assets} testid="gl-bs-assets" />
            <Section s={b.liabilities} testid="gl-bs-liabilities" />
            <Section s={b.equity} testid="gl-bs-equity" />
            <tbody>
              <tr><td className="px-3 py-1">Retained earnings and current profit</td><td className="px-3 py-1 text-right tabular-nums">{money(b.earnings)}</td></tr>
              <tr className="font-semibold"><td className="px-3 py-1">Total equity</td><td className="px-3 py-1 text-right tabular-nums">{money(b.totalEquity)}</td></tr>
              <tr className="border-t-2 border-line font-bold"><td className="px-3 py-2">Total liabilities and equity</td><td className="px-3 py-2 text-right tabular-nums">{money(b.totalLiabilitiesAndEquity)}</td></tr>
            </tbody>
          </table>
          {!b.balanced && <Notice tone="danger" className="m-3" title="Out of balance">Assets don&apos;t equal liabilities plus equity. This shouldn&apos;t happen; contact support.</Notice>}
        </div>
      );
    } else {
      const t = trialBalance(rows);
      body = (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[32rem] text-sm" data-testid="gl-trial-balance">
            <caption className="px-3 pt-3 text-left text-sm text-ink-soft">Trial balance at {fmtDateServer(to)}</caption>
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr></thead>
            <tbody>{t.rows.map((r) => (
              <tr key={r.accountId} className="border-t border-line"><td className="px-3 py-1.5"><Link className="hover:underline" href={`/financials/accounting/ledger?v=detail&account=${r.accountId}&to=${to}`}><span className="font-mono text-xs text-muted">{r.code}</span> {r.name}</Link></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.debit && money(r.debit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.credit && money(r.credit)}</td></tr>
            ))}</tbody>
            <tfoot><tr className="border-t-2 border-line font-bold"><td className="px-3 py-2">Totals {t.balanced ? "(balanced)" : "(OUT OF BALANCE)"}</td><td className="px-3 py-2 text-right tabular-nums">{money(t.debit)}</td><td className="px-3 py-2 text-right tabular-nums">{money(t.credit)}</td></tr></tfoot>
          </table>
        </div>
      );
    }
  } else if (view === "income") {
    const i = incomeStatement(await loadBalances(db, ctx.bookId, from, to));
    body = (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[28rem] text-sm" data-testid="gl-income-statement">
          <caption className="px-3 pt-3 text-left text-sm text-ink-soft">Income statement (accrual), {fmtDateServer(from)} to {fmtDateServer(to)}</caption>
          <Section s={i.income} testid="gl-is-income" />
          <Section s={i.cogs} testid="gl-is-cogs" />
          <tbody><tr className="font-bold"><td className="px-3 py-2">Gross profit</td><td className="px-3 py-2 text-right tabular-nums">{money(i.grossProfit)}</td></tr></tbody>
          <Section s={i.expense} testid="gl-is-expense" />
          <tbody><tr className="border-t-2 border-line font-bold"><td className="px-3 py-2">Net income</td><td className="px-3 py-2 text-right tabular-nums">{money(i.netIncome)}</td></tr></tbody>
        </table>
      </div>
    );
  } else if (view === "detail") {
    const act = accountId ? await loadActivity(db, ctx.bookId, accountId, from, to) : [];
    body = (
      <div className="space-y-3">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <input type="hidden" name="v" value="detail" /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
          <label className="text-xs font-semibold text-ink-soft" htmlFor="gl-acct">Account
            <select id="gl-acct" name="account" defaultValue={accountId} className="field field-sm mt-1 block">{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
          </label>
          <button type="submit" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold">Show</button>
        </form>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[44rem] text-sm" data-testid="gl-detail">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Memo</th><th className="px-3 py-2">Project</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody>{act.map((r, k) => (
              <tr key={`${r.entry_id}-${k}`} className="border-t border-line">
                <td className="whitespace-nowrap px-3 py-1.5">{fmtDateServer(r.entry_date)}</td>
                <td className="px-3 py-1.5">{SOURCE_LABELS[r.source_type] ?? r.source_type}{EVENT_LABELS[r.event_kind] ? ` · ${EVENT_LABELS[r.event_kind]}` : ""}</td>
                <td className="px-3 py-1.5">{r.memo}{r.description ? <span className="block text-xs text-muted">{r.description}</span> : null}</td>
                <td className="px-3 py-1.5 text-xs">{jobName(r.job_id)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.debit) ? money(r.debit) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.credit) ? money(r.credit) : ""}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(r.running)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!act.length && <p className="p-3 text-sm text-muted">No entries in this account for these dates.</p>}
        </div>
      </div>
    );
  } else {
    const [entries, reversed] = await Promise.all([loadJournal(db, ctx.bookId, from, to), loadReversedIds(db, ctx.bookId)]);
    const canPost = canWrite && perms.includes("post_journal_entries");
    const opts = accounts.filter((a) => a.active).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));
    const jobs = [...L.jobs.values()].map((j) => ({ id: j.id, label: `${j.number} · ${j.name}` }));
    const minDate = lockedThrough ? new Date(Date.parse(lockedThrough) + 86400000).toISOString().slice(0, 10) : null;
    body = (
      <div className="space-y-3">
        {canPost && <JournalForm accounts={opts} jobs={jobs} minDate={minDate} />}
        <ul className="space-y-2" data-testid="gl-journal">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold">{fmtDateServer(e.entry_date)}</span>
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{SOURCE_LABELS[e.source_type] ?? e.source_type}{EVENT_LABELS[e.event_kind] ? ` · ${EVENT_LABELS[e.event_kind]}` : ""}</span>
                <span className="min-w-0 flex-1">{e.memo}</span>
                {canPost && REVERSIBLE.has(e.source_type) && e.event_kind === "post" && !reversed.has(e.id) && <ReverseEntry entryId={e.id} />}
                {reversed.has(e.id) && <span className="text-xs text-muted">Reversed</span>}
              </div>
              <table className="mt-2 w-full text-sm"><tbody>
                {e.lines.map((l, k) => (
                  <tr key={k} className="border-t border-line">
                    <td className={cn("py-1", Number(l.credit) && "pl-6")}>{acctName.get(l.account_id) ?? "Account"}{l.description ? <span className="text-xs text-muted"> · {l.description}</span> : null}{l.job_id ? <span className="text-xs text-muted"> · {jobName(l.job_id)}</span> : null}</td>
                    <td className="w-28 py-1 text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</td>
                    <td className="w-28 py-1 text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody></table>
            </li>
          ))}
        </ul>
        {!entries.length && <p className="text-sm text-muted">No entries for these dates.</p>}
        {entries.length >= 200 && <p className="text-sm text-muted">Showing the newest 200. Narrow the dates or export the full ledger.</p>}
      </div>
    );
  }

  return (
    <AccountingShell state={state} {...shell}
      intro="A double-entry book built from your invoices, payments, bills and expenses (accrual basis), plus your own journal entries. Have your CPA review the account setup before you rely on it for taxes."
      actions={<div className="flex flex-wrap gap-2">{canExport && <a className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-sm font-semibold no-print" href={`/api/financials/export?kind=${csvKind}&from=${from}&to=${to}${view === "detail" && accountId ? `&account=${accountId}` : ""}`}><Download className="h-4 w-4" aria-hidden /> CSV</a>}<PrintButton /></div>}>
      <nav aria-label="Ledger views" className="flex flex-wrap gap-2" data-guide="fin.gl-views">
        {LEDGER_VIEWS.map((v) => (
          <Link key={v} href={href(v)} aria-current={view === v ? "page" : undefined} data-testid={`gl-view-${v}`}
            className={cn("inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold", view === v ? "border-brand bg-brand text-white" : "border-line bg-surface")}>{LEDGER_VIEW_LABELS[v]}</Link>
        ))}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-2 no-print">
        <input type="hidden" name="v" value={view} />
        {view === "detail" && accountId && <input type="hidden" name="account" value={accountId} />}
        {usesFrom && <label className="text-xs font-semibold text-ink-soft" htmlFor="gl-from">From<input id="gl-from" type="date" name="from" defaultValue={from} className="field field-sm mt-1 block" /></label>}
        <label className="text-xs font-semibold text-ink-soft" htmlFor="gl-to">{usesFrom ? "To" : "As of"}<input id="gl-to" type="date" name="to" defaultValue={to} className="field field-sm mt-1 block" /></label>
        <button type="submit" className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-semibold">Update</button>
        {sync.posted > 0 && <span role="status" className="text-sm text-muted">{sync.posted} new {sync.posted === 1 ? "entry" : "entries"} posted from your records.</span>}
      </form>
      <div data-guide="fin.gl-body">{body}</div>
      <section className="space-y-2 rounded-xl border border-line bg-surface p-4 no-print" aria-labelledby="gl-close-h">
        <h2 id="gl-close-h" className="font-display text-lg font-extrabold">Closing the books</h2>
        <p className="text-sm text-ink-soft">{lockedThrough ? `Closed through ${fmtDateServer(lockedThrough)}. Nothing can post on or before that date; late records post on the next open day.` : "No period is closed yet. Close a month once it's reconciled so nothing changes behind your accountant's back."}</p>
        {canWrite && perms.includes("close_periods") ? <ClosePeriod lockedThrough={lockedThrough} /> : <span data-guide="fin.gl-close" />}
      </section>
    </AccountingShell>
  );
}
